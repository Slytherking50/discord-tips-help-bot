// limpia un mensaje de chat para leerlo en voz alta: sin markdown, sin emojis, con las menciones convertidas en nombres y los
// links como "enlace". Devuelve { text, skipped }: skipped = 'empty' | 'banned' | 'invite' cuando el mensaje no se debe leer.

const INVITE = /(discord\.gg|discord(app)?\.com\/invite)\/\S+/i;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/gi;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function prepareSpeech(text, { resolveUser = () => '', resolveRole = () => '', resolveChannel = () => '', bannedWords = [], maxChars = 200 } = {}) {
  const raw = String(text ?? '');
  if (INVITE.test(raw)) return { text: '', skipped: 'invite' };

  const plain = normalize(raw);
  if (bannedWords.some((word) => word && plain.includes(normalize(word)))) return { text: '', skipped: 'banned' };

  let speech = raw
    .replace(/<@!?(\d+)>/g, (match, id) => ` ${resolveUser(id) || 'alguien'} `)
    .replace(/<@&(\d+)>/g, (match, id) => ` ${resolveRole(id) || 'un rol'} `)
    .replace(/<#(\d+)>/g, (match, id) => ` canal ${resolveChannel(id) || ''} `)
    .replace(/@(everyone|here)\b/gi, ' todos ')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' bloque de código ')
    .replace(/\|\|[\s\S]*?\|\|/g, ' spoiler ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(URL_PATTERN, ' enlace ')
    .replace(/^[>#\s]+/gm, '')
    .replace(/[*_~|]+/g, ' ')
    .replace(EMOJI, ' ')
    // "holaaaaaaa" -> "holaaa"; "!!!!!" -> "!"
    .replace(/(\p{L})\1{3,}/gu, '$1$1$1')
    .replace(/([!?.,;:])\1+/g, '$1')
    .replace(/(\benlace\b\s*){2,}/gi, 'enlace ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[\p{L}\p{N}]/u.test(speech)) return { text: '', skipped: 'empty' };

  if (speech.length > maxChars) {
    const cut = speech.slice(0, maxChars);
    speech = cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(maxChars * 0.6))).trim();
  }
  return { text: speech, skipped: null };
}

module.exports = { prepareSpeech };
