const { EmbedBuilder } = require('discord.js');

const COLORS = {
  brand: 0x5865f2,
  success: 0x3ba55d,
  error: 0xed4245,
  warning: 0xf0b232,
  info: 0x5865f2,
};

// icono por defecto de cada tipo: da una lectura visual rapida (verde con ✅,
// rojo con ❌) sin que cada modulo tenga que repetirlo a mano
const TYPE_ICONS = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  brand: '',
};

function hexToInt(hex) {
  if (!hex) return null;
  const value = parseInt(String(hex).replace('#', ''), 16);
  return Number.isNaN(value) ? null : value;
}

// resuelve el color de un embed: primero el que configuró el server desde el
// dashboard (config.branding.colors), si no hay usa el default de la marca
function resolveColor(config, type = 'brand') {
  const custom = hexToInt(config?.branding?.colors?.[type]);
  return custom !== null ? custom : COLORS[type] || COLORS.brand;
}

function buildEmbed({ type = 'brand', title, description, fields, footer, thumbnail, image, author, url, timestamp = true, config } = {}) {
  const embed = new EmbedBuilder().setColor(resolveColor(config, type));
  if (timestamp) embed.setTimestamp();
  if (title) embed.setTitle(title);
  if (url) embed.setURL(url);
  if (description) embed.setDescription(description);
  if (fields && fields.length) embed.addFields(fields);

  const brandedFooter =
    footer || (config?.branding?.footerText ? { text: config.branding.footerText, iconURL: config.branding.footerIcon || undefined } : null);
  if (brandedFooter) embed.setFooter(typeof brandedFooter === 'string' ? { text: brandedFooter } : brandedFooter);

  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (author) embed.setAuthor(author);
  return embed;
}

// atajos de estado: mismo look en todos los modulos. `title` es opcional; si
// se pasa se le antepone el icono del tipo (a menos que ya empiece con un emoji)
function statusEmbed(type, config, { title, description, fields, footer, thumbnail, image, author } = {}) {
  const icon = TYPE_ICONS[type] || '';
  const startsWithEmoji = title && /^\p{Extended_Pictographic}/u.test(title);
  const decoratedTitle = title && icon && !startsWithEmoji ? `${icon} ${title}` : title;
  const decoratedDescription = !title && icon && description ? `${icon} ${description}` : description;
  return buildEmbed({ type, title: decoratedTitle, description: decoratedDescription, fields, footer, thumbnail, image, author, config });
}

const successEmbed = (config, options) => statusEmbed('success', config, options);
const errorEmbed = (config, options) => statusEmbed('error', config, options);
const warningEmbed = (config, options) => statusEmbed('warning', config, options);
const infoEmbed = (config, options) => statusEmbed('info', config, options);

// barra de progreso de texto: progressBar(3, 10, 10) -> "▰▰▰▱▱▱▱▱▱▱"
function progressBar(value, max, size = 10) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

module.exports = {
  COLORS,
  TYPE_ICONS,
  buildEmbed,
  resolveColor,
  statusEmbed,
  successEmbed,
  errorEmbed,
  warningEmbed,
  infoEmbed,
  progressBar,
};
