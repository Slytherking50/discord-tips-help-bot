// voz: convierte texto en audio listo para Discord (PCM s16le de 48 kHz estereo). Proveedores, sin claves nuevas:
//  - Google Traductor (voz en varios idiomas; es el que usan casi todos los bots de TTS gratis). Devuelve MP3
//  - Groq Orpheus (voces en ingles de alta calidad, con la clave de Groq que el server ya tiene). Devuelve WAV
// Las voces neuronales de Microsoft Edge NO se usan: su servicio exige hacerse pasar por el navegador Edge.
// Todo es JavaScript puro (mpg123-decoder es WASM): no hace falta ffmpeg en el servidor.

// el decodificador de MP3 (WASM) se carga la primera vez que hace falta, no al arrancar el bot
let MPEGDecoderClass = null;
function loadMpegDecoder() {
  if (!MPEGDecoderClass) ({ MPEGDecoder: MPEGDecoderClass } = require('mpg123-decoder'));
  return MPEGDecoderClass;
}

const GOOGLE_URL = 'https://translate.google.com/translate_tts';
const GROQ_SPEECH_URL = 'https://api.groq.com/openai/v1/audio/speech';
const ORPHEUS_MODEL = 'canopylabs/orpheus-v1-english';
const REQUEST_TIMEOUT_MS = 15000;
const GOOGLE_CHUNK_CHARS = 180; // Google acepta unos 200 caracteres por pedido
const ORPHEUS_CHUNK_CHARS = 190; // Orpheus tambien tiene tope de 200
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CHUNKS = 6;
const TARGET_RATE = 48000;
const LEAD_SILENCE_MS = 120;
const FADE_MS = 6;

const VOICES = [
  { id: 'google:es', label: 'Español', provider: 'google', lang: 'es' },
  { id: 'google:en', label: 'Inglés', provider: 'google', lang: 'en' },
  { id: 'google:pt', label: 'Portugués', provider: 'google', lang: 'pt' },
  { id: 'google:fr', label: 'Francés', provider: 'google', lang: 'fr' },
  { id: 'google:de', label: 'Alemán', provider: 'google', lang: 'de' },
  { id: 'google:it', label: 'Italiano', provider: 'google', lang: 'it' },
  { id: 'google:ja', label: 'Japonés', provider: 'google', lang: 'ja' },
  { id: 'google:ko', label: 'Coreano', provider: 'google', lang: 'ko' },
  { id: 'google:ru', label: 'Ruso', provider: 'google', lang: 'ru' },
  { id: 'google:zh-CN', label: 'Chino', provider: 'google', lang: 'zh-CN' },
  { id: 'google:ar', label: 'Árabe', provider: 'google', lang: 'ar' },
  ...['diana', 'hannah', 'autumn', 'austin', 'daniel', 'troy'].map((name) => ({
    id: `orpheus:${name}`,
    label: `Inglés HD · ${name[0].toUpperCase()}${name.slice(1)} (IA)`,
    provider: 'orpheus',
    voice: name,
  })),
];
const DEFAULT_VOICE = 'google:es';
const FALLBACK_VOICE = 'google:en';

class TtsError extends Error {
  // code: 'empty' | 'busy' | 'no-key' | 'provider' | 'decode'
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function findVoice(id) {
  return VOICES.find((voice) => voice.id === id) || null;
}

function voiceLabel(id) {
  return (findVoice(id) || findVoice(DEFAULT_VOICE)).label;
}

// parte el texto en pedazos que caben en un pedido, cortando por frases y, si hace falta, por palabras
function splitText(text, max) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const pieces = clean.match(/[^.!?;:\n]+[.!?;:]*\s*/g) || [clean];
  const chunks = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const piece of pieces) {
    if (piece.length > max) {
      flush();
      let rest = piece.trim();
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < max * 0.4) cut = max;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    if ((current + piece).length > max) flush();
    current += piece;
  }
  flush();
  return chunks.filter(Boolean);
}

async function download(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > MAX_RESPONSE_BYTES) throw new TtsError('provider', 'La respuesta de voz es demasiado grande');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_RESPONSE_BYTES) throw new TtsError('provider', 'La respuesta de voz es demasiado grande');
  return buffer;
}

function failure(response, name) {
  if (response.status === 429) return new TtsError('busy', `${name} está limitando los pedidos (429)`);
  return new TtsError('provider', `${name} respondió ${response.status}`);
}

async function fetchGoogle(chunk, lang, fetchImpl) {
  const url = `${GOOGLE_URL}?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunk)}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw failure(response, 'Google Traductor');
  const buffer = await download(response);
  if (buffer.length < 200) throw new TtsError('provider', 'Google Traductor devolvió un audio vacío');
  return { kind: 'mp3', buffer };
}

async function fetchOrpheus(chunk, voice, apiKey, fetchImpl) {
  const response = await fetchImpl(GROQ_SPEECH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ORPHEUS_MODEL, voice, input: chunk, response_format: 'wav' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw failure(response, 'Groq Orpheus');
  return { kind: 'wav', buffer: await download(response) };
}

// MP3 -> { channels: [Float32Array], sampleRate }
async function decodeMp3(buffer) {
  const decoder = new (loadMpegDecoder())();
  try {
    await decoder.ready;
    const decoded = decoder.decode(new Uint8Array(buffer));
    if (!decoded.samplesDecoded) throw new TtsError('decode', 'No se pudo decodificar el MP3');
    return { channels: decoded.channelData, sampleRate: decoded.sampleRate };
  } finally {
    decoder.free();
  }
}

// WAV PCM de 16 bits -> { channels: [Float32Array], sampleRate }
function decodeWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new TtsError('decode', 'El WAV no es válido');
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') format = { tag: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2), sampleRate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
    if (id === 'data') {
      // algunos servicios mandan el tamaño en 0 o 0xFFFFFFFF cuando transmiten: se toma hasta el final
      data = buffer.subarray(body, size && size !== 0xffffffff ? Math.min(body + size, buffer.length) : buffer.length);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data || format.bits !== 16 || ![1, 2].includes(format.channels)) throw new TtsError('decode', 'Formato de WAV no soportado');
  const frames = Math.floor(data.length / (2 * format.channels));
  const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < format.channels; c++) channels[c][i] = data.readInt16LE((i * format.channels + c) * 2) / 32768;
  return { channels, sampleRate: format.sampleRate };
}

// pasa cualquier audio a PCM s16le de 48 kHz estereo (lo que Discord espera), con un respiro al inicio
// para que no se coma la primera silaba y un fundido corto para evitar chasquidos
function toDiscordPcm({ channels, sampleRate }) {
  const left = channels[0];
  const right = channels[1] || left;
  const outFrames = Math.max(1, Math.round((left.length * TARGET_RATE) / sampleRate));
  const lead = Math.round((LEAD_SILENCE_MS / 1000) * TARGET_RATE);
  const fade = Math.round((FADE_MS / 1000) * TARGET_RATE);
  const out = Buffer.alloc((lead + outFrames) * 4);
  const step = sampleRate / TARGET_RATE;
  for (let i = 0; i < outFrames; i++) {
    const position = i * step;
    const base = Math.floor(position);
    const next = Math.min(base + 1, left.length - 1);
    const fraction = position - base;
    let gain = 1;
    if (i < fade) gain = i / fade;
    else if (outFrames - i < fade) gain = (outFrames - i) / fade;
    const l = (left[base] + (left[next] - left[base]) * fraction) * gain;
    const r = (right[base] + (right[next] - right[base]) * fraction) * gain;
    const offset = (lead + i) * 4;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), offset);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), offset + 2);
  }
  return out;
}

async function synthesizeWith(voice, text, { groqKey, fetchImpl }) {
  const max = voice.provider === 'orpheus' ? ORPHEUS_CHUNK_CHARS : GOOGLE_CHUNK_CHARS;
  const chunks = splitText(text, max).slice(0, MAX_CHUNKS);
  // sin una sola letra o numero (solo emojis o signos) no hay nada que decir
  if (!chunks.length || !/[\p{L}\p{N}]/u.test(chunks.join(''))) throw new TtsError('empty', 'No hay nada que decir');
  if (voice.provider === 'orpheus' && !groqKey) throw new TtsError('no-key', 'Falta la clave de Groq para las voces HD');

  const parts = [];
  for (const chunk of chunks) {
    const audio = voice.provider === 'orpheus' ? await fetchOrpheus(chunk, voice.voice, groqKey, fetchImpl) : await fetchGoogle(chunk, voice.lang, fetchImpl);
    const decoded = audio.kind === 'wav' ? decodeWav(audio.buffer) : await decodeMp3(audio.buffer);
    parts.push(toDiscordPcm(decoded));
  }
  return Buffer.concat(parts);
}

// { pcm, durationMs, voice } o lanza TtsError. Si la voz elegida falla (sin clave, sin cupo, sin red) prueba con una voz de
// Google para no dejar el mensaje sin leer; el idioma de esa voz de respaldo es el ingles porque las voces HD solo hablan ingles
async function synthesize(text, { voice = DEFAULT_VOICE, groqKey = null, fetchImpl = fetch } = {}) {
  const chosen = findVoice(voice) || findVoice(DEFAULT_VOICE);
  try {
    const pcm = await synthesizeWith(chosen, text, { groqKey, fetchImpl });
    return { pcm, durationMs: Math.round((pcm.length / 4 / TARGET_RATE) * 1000), voice: chosen.id };
  } catch (err) {
    if (chosen.provider !== 'orpheus' || err.code === 'empty') throw err;
    const fallback = findVoice(FALLBACK_VOICE);
    const pcm = await synthesizeWith(fallback, text, { groqKey, fetchImpl });
    return { pcm, durationMs: Math.round((pcm.length / 4 / TARGET_RATE) * 1000), voice: fallback.id, fellBack: true };
  }
}

module.exports = {
  VOICES,
  DEFAULT_VOICE,
  TtsError,
  findVoice,
  voiceLabel,
  splitText,
  decodeWav,
  decodeMp3,
  toDiscordPcm,
  synthesize,
  TARGET_RATE,
  GOOGLE_CHUNK_CHARS,
  ORPHEUS_CHUNK_CHARS,
};
