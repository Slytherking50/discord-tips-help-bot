// transcripcion de mensajes de voz (y audios sueltos) con Whisper de Groq: baja el audio de Discord, lo manda a
// transcribir y descarta lo que Whisper "inventa" cuando hay silencio. Todo lo que toca Discord vive en aiApps.js;
// aca solo hay audio -> texto.

const { MessageFlags } = require('discord.js');

const TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// turbo es mas rapido y casi igual de bueno; si no esta disponible (o no queda cupo) se prueba el otro
const WHISPER_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];
// Groq acepta hasta 25 MB por archivo en la cuenta gratis
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 45000;
const DOWNLOAD_TIMEOUT_MS = 20000;
const AUDIO_EXTENSIONS = /\.(mp3|ogg|oga|opus|wav|m4a|mp4|webm|flac|mpeg|mpga)$/i;

const LANGUAGE_NAMES = {
  spanish: 'español', english: 'inglés', portuguese: 'portugués', french: 'francés', german: 'alemán', italian: 'italiano',
  japanese: 'japonés', korean: 'coreano', russian: 'ruso', chinese: 'chino', arabic: 'árabe', turkish: 'turco', polish: 'polaco',
  dutch: 'neerlandés', catalan: 'catalán', ukrainian: 'ucraniano', hindi: 'hindi', indonesian: 'indonesio',
};

// Whisper, ante silencio o ruido, escribe frases de los videos con los que se entreno
const HALLUCINATIONS = /^(subt[ií]tulos? (realizados? )?por|subt[ií]tulos? de|gracias por ver|suscr[ií]be?te|no olvides suscribirte|amara\.org|thanks for watching|thank you\.?$|music$|\[?m[uú]sica\]?$)/i;

function isAudioAttachment(attachment) {
  const type = String(attachment?.contentType || '').toLowerCase();
  if (type.startsWith('audio/')) return true;
  if (type.startsWith('video/') || type.startsWith('image/')) return false;
  return AUDIO_EXTENSIONS.test(attachment?.name || '');
}

// un mensaje de voz de Discord lleva la marca IsVoiceMessage (y un adjunto .ogg con su forma de onda)
function isVoiceMessage(message) {
  try {
    if (message?.flags?.has?.(MessageFlags.IsVoiceMessage)) return true;
  } catch {
    // flags raros: se mira el adjunto
  }
  for (const attachment of message?.attachments?.values?.() || []) if (attachment.waveform) return true;
  return false;
}

// el primer audio del mensaje como { url, name, size, duration, contentType, voice }, o null si no hay.
// Si es demasiado grande o largo trae `problem` ('too-big' | 'too-long') para poder explicarlo
function findAudioAttachment(message, { maxBytes = MAX_AUDIO_BYTES, maxSeconds = DEFAULT_MAX_SECONDS } = {}) {
  const voice = isVoiceMessage(message);
  for (const attachment of message?.attachments?.values?.() || []) {
    if (!isAudioAttachment(attachment) && !attachment.waveform) continue;
    const found = {
      url: attachment.url,
      name: attachment.name || 'audio.ogg',
      size: attachment.size || 0,
      duration: Number(attachment.duration) || null,
      contentType: attachment.contentType || 'audio/ogg',
      voice,
    };
    if (found.size > maxBytes) found.problem = 'too-big';
    else if (found.duration && found.duration > maxSeconds) found.problem = 'too-long';
    return found;
  }
  return null;
}

async function downloadAudio(url, { maxBytes = MAX_AUDIO_BYTES, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`No se pudo bajar el audio (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const declared = Number(res.headers?.get?.('content-length'));
    if (declared > maxBytes) {
      const err = new Error('El audio es demasiado grande');
      err.code = 'too-big';
      throw err;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      const err = new Error('El audio es demasiado grande');
      err.code = 'too-big';
      throw err;
    }
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestTranscription(apiKey, model, audio, { filename, contentType, language, fetchImpl = fetch }) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType || 'audio/ogg' }), filename || 'voice-message.ogg');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (language) form.append('language', language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(TRANSCRIBE_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal });
    if (!res.ok) {
      const detail = await res
        .json()
        .then((body) => String(body?.error?.message || '').replace(/org_\w+/g, 'org_…').replace(/\s+/g, ' ').slice(0, 200))
        .catch(() => '');
      const err = new Error(`Groq respondió ${res.status}${detail ? `: ${detail}` : ''}`);
      err.status = res.status;
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      if (retryAfter > 0) err.retryAfterMs = Math.round(retryAfter * 1000);
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// el texto sin los tramos que Whisper dio por silencio o inventados; '' si no quedo nada que se entienda
function cleanTranscript(body, seconds) {
  const segments = Array.isArray(body?.segments) ? body.segments : [];
  let text;
  if (segments.length) {
    text = segments
      .filter((segment) => !(segment.no_speech_prob > 0.6 && segment.avg_logprob < -0.8))
      .map((segment) => String(segment.text || '').trim())
      .filter(Boolean)
      .join(' ');
  } else {
    text = String(body?.text || '');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // una frase de "gracias por ver el video" en un audio cortito es casi seguro una alucinacion
  if ((seconds || 0) < 12 && HALLUCINATIONS.test(text)) return '';
  return text;
}

// { ok: true, text, language, seconds } o { ok: false, reason } con reason 'no-speech' | 'bad-audio' | 'too-big' |
// 'busy' (sin cupo ahora) | 'unavailable' | 'error'
async function transcribeAudio({ apiKey, audio, filename, contentType, language = null, models = WHISPER_MODELS, fetchImpl = fetch }) {
  if (!apiKey) return { ok: false, reason: 'unavailable' };
  if (!audio?.length) return { ok: false, reason: 'bad-audio' };
  if (audio.length > MAX_AUDIO_BYTES) return { ok: false, reason: 'too-big' };

  let busy = false;
  let gone = false;
  for (const model of models) {
    try {
      const body = await requestTranscription(apiKey, model, audio, { filename, contentType, language, fetchImpl });
      const seconds = Number(body.duration) || null;
      const text = cleanTranscript(body, seconds);
      if (!text) return { ok: false, reason: 'no-speech' };
      const languageName = String(body.language || '').toLowerCase();
      return { ok: true, text, seconds, language: LANGUAGE_NAMES[languageName] || languageName || null, model };
    } catch (err) {
      if (err.status === 400) return { ok: false, reason: 'bad-audio' };
      if (err.status === 413) return { ok: false, reason: 'too-big' };
      if (err.status === 429 || (typeof err.status === 'number' && err.status >= 500)) busy = true;
      else if (err.status === 404 || err.status === 403) gone = true;
      else return { ok: false, reason: 'error', error: err };
      console.warn(`Whisper: el modelo ${model} falló (${err.status}).`);
    }
  }
  return { ok: false, reason: busy ? 'busy' : gone ? 'unavailable' : 'error' };
}

function clock(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const MAX_REPLY_TEXT = 1700;

// el mensaje con la transcripcion (cita en bloque; se recorta si es muy largo). summary = resumen opcional de la IA
function formatTranscript(result, { authorName = null, summary = null } = {}) {
  const details = [result.seconds ? clock(result.seconds) : null, result.language].filter(Boolean).join(' · ');
  const header = `🎙️ **Transcripción${authorName ? ` del mensaje de voz de ${authorName}` : ''}**${details ? ` · ${details}` : ''}`;
  const clipped = result.text.length > MAX_REPLY_TEXT ? `${result.text.slice(0, MAX_REPLY_TEXT).replace(/\s+\S*$/, '')}…` : result.text;
  const quoted = clipped.split(/(?<=[.!?¡¿])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/).join('\n').split('\n').map((line) => `> ${line}`).join('\n');
  return `${header}\n${quoted}${summary ? `\n\n**En resumen:** ${summary}` : ''}`;
}

// por que no se pudo, en una frase para quien lo pidio
function failureMessage(reason) {
  return {
    'no-speech': '🎙️ No escuché nada que se entienda en ese audio (silencio o solo ruido).',
    'bad-audio': '⚠️ No pude abrir ese audio (formato raro o dañado).',
    'too-big': '⚠️ Ese audio es demasiado grande para transcribirlo.',
    'too-long': '⚠️ Ese audio es demasiado largo para transcribirlo.',
    busy: '⏳ La IA de voz está ocupada ahora mismo. Prueba de nuevo en un minuto.',
    unavailable: '⚠️ La transcripción no está disponible ahora (revisa la clave de Groq).',
    error: '⚠️ No pude transcribir ese audio ahora. Prueba de nuevo en un rato.',
  }[reason] || '⚠️ No pude transcribir ese audio.';
}

module.exports = {
  isVoiceMessage,
  isAudioAttachment,
  findAudioAttachment,
  downloadAudio,
  transcribeAudio,
  cleanTranscript,
  formatTranscript,
  failureMessage,
  clock,
  WHISPER_MODELS,
  MAX_AUDIO_BYTES,
  DEFAULT_MAX_SECONDS,
};
