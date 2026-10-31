// utilidades de emojis: los personalizados de Discord (<:nombre:id>, <a:nombre:id>), comparar un emoji
// guardado en la config con el de una reaccion, y validar lo que escribe o elige una persona en el panel.
// Un emoji "invalido" en un boton, un menu o una reaccion hace que Discord rechace el mensaje entero, por
// eso lo que no es un emoji de verdad ("abc", "★") se descarta antes de guardarlo.

const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
const SHORT_CUSTOM_EMOJI = /^([A-Za-z0-9_]{2,32}):(\d{17,20})$/;
const KEYCAP = /^[#*0-9]️?⃣$/u;
const SEGMENTER = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// { id, name, animated, markup } si es un emoji personalizado ("<:ns:123…>", "<a:ns:123…>" o "ns:123…")
function parseCustomEmoji(text) {
  const value = String(text ?? '').trim();
  const full = value.match(CUSTOM_EMOJI);
  if (full) return { id: full[3], name: full[2], animated: full[1] === 'a', markup: value };
  const short = value.match(SHORT_CUSTOM_EMOJI);
  if (short) return { id: short[2], name: short[1], animated: false, markup: `<:${short[1]}:${short[2]}>` };
  return null;
}

function customEmojiMarkup({ id, name, animated }) {
  return `<${animated ? 'a' : ''}:${name}:${id}>`;
}

// imagen de un emoji personalizado en el CDN de Discord (los animados son gif)
function customEmojiUrl({ id, animated }, size = 48) {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=${size}&quality=lossless`;
}

function graphemes(text) {
  return SEGMENTER ? [...SEGMENTER.segment(text)].map((part) => part.segment) : [...text];
}

function isEmojiGrapheme(grapheme) {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(grapheme) || KEYCAP.test(grapheme);
}

// "❤" -> "❤️": los simbolos que por defecto se dibujan como texto necesitan el selector de variacion
// para verse (y contarse) como emoji
function withEmojiPresentation(grapheme) {
  const points = [...grapheme];
  const first = points[0];
  const code = first.codePointAt(0);
  const isTextDefault = code > 0x7f && /\p{Emoji}/u.test(first) && !/\p{Emoji_Presentation}/u.test(first);
  if (points.length === 1 && isTextDefault) return `${first}️`;
  return grapheme;
}

// valida un emoji para un campo de UN solo emoji (reaccion, boton, menu, estrella...): devuelve el emoji
// listo para guardar, o null si no es un emoji de verdad. Acepta los de Unicode (con tonos, banderas,
// secuencias, numeros "1️⃣") y los personalizados del server
function normalizeEmoji(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const custom = parseCustomEmoji(text);
  if (custom) return custom.markup;

  const parts = graphemes(text);
  if (parts.length !== 1 || !isEmojiGrapheme(parts[0])) return null;
  return withEmojiPresentation(parts[0]);
}

// para comparar emojis sin importar como se escribieron: el id si es personalizado, y si no el emoji
// sin selectores de variacion ("❤" y "❤️" son el mismo)
function emojiKey(value) {
  const text = String(value ?? '').trim();
  const custom = parseCustomEmoji(text);
  return custom ? custom.id : text.replace(/️/g, '');
}

// ¿el emoji guardado en la config es el de esta reaccion? (reaction.emoji trae { id, name })
function reactionMatches(configured, reactionEmoji) {
  if (!configured || !reactionEmoji) return false;
  const custom = parseCustomEmoji(configured);
  if (custom) return reactionEmoji.id === custom.id;
  // un id suelto guardado a mano (config vieja) tambien vale
  if (/^\d{17,20}$/.test(String(configured).trim())) return reactionEmoji.id === String(configured).trim();
  // emoji de Unicode, o (config vieja) un emoji personalizado guardado solo por su nombre
  return emojiKey(configured) === emojiKey(reactionEmoji.name);
}

module.exports = { parseCustomEmoji, customEmojiMarkup, customEmojiUrl, normalizeEmoji, emojiKey, reactionMatches, withEmojiPresentation, isEmojiGrapheme, graphemes };
