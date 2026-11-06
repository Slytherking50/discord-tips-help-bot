// logica del selector de emojis del dashboard que depende de Discord: los emojis personalizados del server,
// cuantos lugares quedan y la instalacion de un emoji pixel (se sube al server solo cuando alguien lo elige).

const { PermissionFlagsBits } = require('discord.js');
const { SIMPLE, DETAILED, TEXT_SYMBOLS } = require('./emojiCatalog');
const pixelEmojis = require('./pixelEmojis');
const { customEmojiMarkup } = require('./emojiUtil');

// lugares de emojis por nivel de boost (estaticos y animados cuentan por separado, cada uno con este tope)
const EMOJI_LIMITS_BY_TIER = [50, 100, 150, 250];

const CATALOG = { simple: SIMPLE, detailed: DETAILED, symbols: TEXT_SYMBOLS, pixelGroups: pixelEmojis.GROUPS };

function catalogPayload() {
  return CATALOG;
}

function canManageEmojis(guild) {
  const permissions = guild.members?.me?.permissions;
  if (!permissions) return false;
  return permissions.has(PermissionFlagsBits.Administrator) || permissions.has(PermissionFlagsBits.CreateGuildExpressions) || permissions.has(PermissionFlagsBits.ManageGuildExpressions);
}

function capacityFor(guild) {
  const limit = EMOJI_LIMITS_BY_TIER[guild.premiumTier] ?? EMOJI_LIMITS_BY_TIER[0];
  const emojis = [...guild.emojis.cache.values()];
  const staticUsed = emojis.filter((emoji) => !emoji.animated).length;
  const animatedUsed = emojis.length - staticUsed;
  return { limit, static: staticUsed, animated: animatedUsed, free: Math.max(0, limit - staticUsed), canCreate: canManageEmojis(guild) };
}

// los emojis de un server cambian cuando alguien sube uno: con el intent GuildExpressions la cache se actualiza sola, y ademas se piden a
// Discord al abrir el selector (con un respiro corto para no repetirlo en cada clic) por si el bot se perdio algun aviso o el intent no llego
const REFRESH_COOLDOWN_MS = 10 * 1000;
const REFRESH_TIMEOUT_MS = 4000;
const lastRefresh = new Map();

// devuelve true si se actualizo la lista. Nunca falla: si Discord tarda o rechaza el pedido, el selector sigue con lo que ya tenia
async function refreshEmojis(guild, now = Date.now(), timeoutMs = REFRESH_TIMEOUT_MS) {
  if (typeof guild?.emojis?.fetch !== 'function') return false;
  if (now - (lastRefresh.get(guild.id) || 0) < REFRESH_COOLDOWN_MS) return false;
  lastRefresh.set(guild.id, now);
  let timer;
  try {
    await Promise.race([guild.emojis.fetch(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Discord no respondió a tiempo')), timeoutMs); })]);
    return true;
  } catch (err) {
    console.warn('No se pudieron actualizar los emojis del servidor:', err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function customEmojisOf(guild) {
  return [...guild.emojis.cache.values()]
    .filter((emoji) => emoji.available !== false)
    .map((emoji) => ({ id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated), markup: customEmojiMarkup(emoji) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

// lo que el selector necesita de ESTE server: sus emojis, los lugares libres y que pixeles ya estan instalados
function guildPayload(guild) {
  const custom = customEmojisOf(guild);
  const byName = new Map(custom.map((emoji) => [emoji.name, emoji]));
  const pixel = pixelEmojis.all().map((sprite) => {
    const installed = byName.get(sprite.name);
    return { id: sprite.id, label: sprite.label, keywords: sprite.keywords, group: sprite.group, svg: sprite.svg, installed: installed ? { id: installed.id, markup: installed.markup } : null };
  });
  return { custom, capacity: capacityFor(guild), pixel };
}

class InstallError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// sube el emoji pixel al server (o devuelve el que ya esta). Errores con .code: 'unknown' | 'no-permission' | 'full' | 'discord'
async function installPixelEmoji(guild, id) {
  const sprite = pixelEmojis.getPixelEmoji(String(id || ''));
  if (!sprite) throw new InstallError('unknown', 'Ese emoji píxel no existe.');

  const existing = [...guild.emojis.cache.values()].find((emoji) => emoji.name === sprite.name);
  if (existing) return { emoji: { id: existing.id, name: existing.name, animated: false, markup: customEmojiMarkup(existing) }, created: false };

  if (!canManageEmojis(guild)) throw new InstallError('no-permission', 'El bot no tiene permiso para crear emojis en este servidor (Gestionar expresiones).');
  const capacity = capacityFor(guild);
  if (capacity.free <= 0) throw new InstallError('full', `El servidor ya usa todos sus lugares de emojis (${capacity.static}/${capacity.limit}). Borra alguno y vuelve a intentarlo.`);

  try {
    const created = await guild.emojis.create({ attachment: pixelEmojis.renderPng(sprite), name: sprite.name, reason: 'Emoji píxel elegido desde el dashboard' });
    return { emoji: { id: created.id, name: created.name, animated: false, markup: customEmojiMarkup(created) }, created: true };
  } catch (err) {
    // 30008 = sin lugares de emojis, 50013 = sin permisos
    if (err.code === 30008) throw new InstallError('full', 'El servidor ya usa todos sus lugares de emojis. Borra alguno y vuelve a intentarlo.');
    if (err.code === 50013) throw new InstallError('no-permission', 'El bot no tiene permiso para crear emojis en este servidor (Gestionar expresiones).');
    throw new InstallError('discord', `Discord no dejó crear el emoji: ${String(err.message || err).slice(0, 120)}`);
  }
}

module.exports = { catalogPayload, guildPayload, installPixelEmoji, refreshEmojis, capacityFor, InstallError, EMOJI_LIMITS_BY_TIER };
