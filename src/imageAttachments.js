// imagenes que alguien adjunta a un mensaje (renders, animaciones, skins...). Las usan el
// modo conversacion y las menciones para que el bot las vea, y el feedback por reaccion.

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;
// Groq acepta hasta 20 MB por imagen (cuando se le pasa la URL): se deja un margen
const MAX_IMAGE_BYTES = 18 * 1024 * 1024;
// cuantas imagenes se miran por mensaje (cada una suma ~1000 tokens al pedido)
const MAX_IMAGES = 3;

function isImageAttachment(attachment) {
  const type = String(attachment?.contentType || '').toLowerCase();
  if (type.startsWith('image/')) return !type.includes('svg');
  return IMAGE_EXTENSIONS.test(attachment?.name || attachment?.url || '');
}

// devuelve hasta `max` adjuntos que son imagenes como { url, name, size }. Los que pesan mas
// de `maxBytes` se dejan afuera (Groq los rechazaria)
function findImageAttachments(message, { max = MAX_IMAGES, maxBytes = MAX_IMAGE_BYTES } = {}) {
  const found = [];
  for (const attachment of message?.attachments?.values?.() || []) {
    if (!isImageAttachment(attachment)) continue;
    if (attachment.size && attachment.size > maxBytes) continue;
    found.push({ url: attachment.url, name: attachment.name || '', size: attachment.size || 0 });
    if (found.length >= max) break;
  }
  return found;
}

// la primera imagen, sin limite de tamano (para el feedback por reaccion, que avisa si no la pudo abrir)
function findImageAttachment(message) {
  return findImageAttachments(message, { max: 1, maxBytes: Infinity })[0] || null;
}

module.exports = { findImageAttachments, findImageAttachment, isImageAttachment, MAX_IMAGES, MAX_IMAGE_BYTES };
