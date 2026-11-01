// lo que dicen los canales de informacion del server (reglas, sobre nosotros, anuncios, alianzas...). El bot los lee solo cada
// tanto y guarda el texto (en la base, para no volver a leerlos en cada arranque) como documentos que la IA consulta por la pregunta
// (src/knowledge.js). Asi sabe las reglas reales y los avisos reales sin que el staff los copie a mano en el panel.
// Reglas de seguridad: solo canales que @everyone ve (nada privado), solo mensajes del staff o de bots/webhooks (lo que escribe cualquier
// miembro no entra: es ruido y una puerta a engañar a la IA), y el texto va a la IA marcado como "informacion, no ordenes".

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { cleanName } = require('./serverBrain');

const INFO_CHANNEL = /(regla|rules|norma|informaci|\binfo\b|sobre|about|nosotros|faq|pregunta|guia|tutorial|anunci|aviso|novedad|alianza|partner|boost)/i;
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const MAX_AUTO_CHANNELS = 8;
const MAX_EXPLICIT_CHANNELS = 12;
const FETCH_LIMIT = 50;
const MAX_CHARS_PER_CHANNEL = 4000;
const CHUNK_CHARS = 1300;
const STAFF_PERMISSIONS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageMessages];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPublic(guild, channel) {
  try {
    return Boolean(channel.permissionsFor?.(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel));
  } catch {
    return false;
  }
}

// los canales que se leen: los que eligio el staff en el panel, o (si no eligio ninguno) las reglas y los canales de informacion
function pickChannels(guild, config) {
  const knowledge = config?.knowledge || {};
  if (knowledge.autoLearn === false) return [];
  const candidates = [...guild.channels.cache.values()].filter((channel) => TEXT_TYPES.has(channel.type) && isPublic(guild, channel));
  const explicit = (knowledge.learnChannelIds || []).map((id) => candidates.find((channel) => channel.id === id)).filter(Boolean);
  if (explicit.length) return explicit.slice(0, MAX_EXPLICIT_CHANNELS);
  const auto = candidates.filter((channel) => channel.id === guild.rulesChannelId || INFO_CHANNEL.test(cleanName(channel.name)));
  return auto.sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0)).slice(0, MAX_AUTO_CHANNELS);
}

// los canales que el staff puede elegir en el panel: los de texto y anuncios que ve cualquiera, en el orden de Discord
function candidateChannels(guild) {
  return [...guild.channels.cache.values()]
    .filter((channel) => TEXT_TYPES.has(channel.type) && isPublic(guild, channel))
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map((channel) => ({ id: channel.id, name: cleanName(channel.name) }));
}

function authorIsTrusted(message) {
  if (message.webhookId || message.author?.bot) return true;
  const permissions = message.member?.permissions;
  return Boolean(permissions && STAFF_PERMISSIONS.some((permission) => permissions.has(permission)));
}

function trimUrl(url) {
  return url.length > 90 ? `${url.slice(0, 90)}…` : url;
}

// el texto de los bloques de un mensaje con componentes (type 10 = bloque de texto) que estan dentro de contenedores (17), secciones (9) o filas
// (1): asi estan escritos los "mensajes avanzados" que arma el panel. Los botones, imagenes y separadores no traen texto que valga
function componentTexts(components, found = []) {
  for (const raw of components || []) {
    const component = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
    if (!component) continue;
    if (component.type === 10 && component.content) found.push(component.content);
    if (Array.isArray(component.components)) componentTexts(component.components, found);
  }
  return found;
}

// el texto de un mensaje: su contenido, lo que traigan sus embeds y sus bloques de texto (las reglas suelen estar en alguno de los dos). Las menciones de personas se
// quitan (no hay por que repetir quien es quien en cada mensaje) y las de roles se vuelven el nombre del rol; las de canales se conservan
function messageText(message, guild) {
  const parts = [message.content || ''];
  for (const embed of message.embeds || []) {
    parts.push(embed.title || '', embed.description || '');
    for (const field of embed.fields || []) parts.push(`${field.name}: ${field.value}`);
  }
  parts.push(...componentTexts(message.components));
  return parts
    .join('\n')
    .replace(/<@&(\d+)>/g, (match, id) => `@${guild.roles?.cache?.get?.(id)?.name || 'rol'}`)
    .replace(/<@!?\d+>/g, '')
    // los emojis propios del server ("<:confeti:123>", "<a:baile:456>") son solo ruido para la IA
    .replace(/<a?:[\w]+:\d+>/g, '')
    .replace(/@(everyone|here)/g, '$1')
    .replace(/https?:\/\/\S+/g, trimUrl)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toChunks(text) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    current += `${current ? '\n' : ''}${line}`;
    while (current.length > CHUNK_CHARS) {
      chunks.push(current.slice(0, CHUNK_CHARS));
      current = current.slice(CHUNK_CHARS);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function create({ client, db, now = Date.now, logger = console, intervalMs = 6 * 60 * 60 * 1000, startDelayMs = 45000, pauseMs = 1500 } = {}) {
  // guildId -> { docs (misma lista mientras no cambie), channels: [{ id, name, chars, syncedAt }], lastSyncAt }
  const byGuild = new Map();
  let timer = null;
  const syncing = new Set();

  function build(guildId, rows) {
    const docs = [];
    const channels = [];
    for (const row of rows) {
      const clean = cleanName(row.name);
      (row.chunks || []).forEach((chunk, index) => docs.push({ id: `canal:${row.channelId}:${index}`, group: 'canal', title: `#${clean}${row.chunks.length > 1 ? ` (${index + 1}/${row.chunks.length})` : ''}`, text: chunk, keywords: [clean] }));
      channels.push({ id: row.channelId, name: clean, chars: (row.chunks || []).join('').length, syncedAt: row.syncedAt ? new Date(row.syncedAt).getTime() : null });
    }
    const lastSyncAt = channels.reduce((latest, channel) => Math.max(latest, channel.syncedAt || 0), 0) || null;
    byGuild.set(guildId, { docs, channels, lastSyncAt });
  }

  async function load(guildId) {
    try {
      build(guildId, await db.listServerMemory(guildId));
    } catch (err) {
      logger.warn?.(`[memoria] no se pudo cargar lo aprendido de los canales: ${err.message}`);
    }
  }

  async function syncChannel(guild, channel) {
    const collected = new Map();
    try {
      const pins = await channel.messages.fetchPins?.();
      for (const item of pins?.items || []) collected.set(item.message.id, { message: item.message, pinned: true });
    } catch {
      // sin permiso para ver los fijados: se sigue con los ultimos mensajes
    }
    const recent = await channel.messages.fetch({ limit: FETCH_LIMIT });
    for (const message of recent.values()) if (!collected.has(message.id)) collected.set(message.id, { message, pinned: false });

    // lo fijado primero (es lo que el staff marco como importante) y, con el espacio que quede, lo mas NUEVO (si el canal tiene mas de lo
    // que cabe, lo viejo es lo que sobra: un aviso de ayer importa mas que uno de hace meses); lo reciente se deja en orden de lectura
    const trusted = [...collected.values()].filter(({ message }) => authorIsTrusted(message)).map((entry) => ({ ...entry, body: messageText(entry.message, guild) })).filter((entry) => entry.body);
    const pinned = trusted.filter((entry) => entry.pinned);
    const newestFirst = trusted.filter((entry) => !entry.pinned).sort((a, b) => b.message.createdTimestamp - a.message.createdTimestamp);
    let used = 0;
    const fit = (entry) => {
      if (used + entry.body.length + 2 > MAX_CHARS_PER_CHANNEL) return false;
      used += entry.body.length + 2;
      return true;
    };
    const keptPinned = pinned.filter(fit);
    const keptRecent = newestFirst.filter(fit).reverse();
    const bodies = [...keptPinned, ...keptRecent].map((entry) => entry.body);
    return { name: channel.name, chunks: bodies.length ? toChunks(bodies.join('\n\n')) : [], messageCount: bodies.length };
  }

  // lee los canales del server y guarda lo aprendido. force: ignorar si se leyo hace poco
  async function syncGuild(guild, config, { force = false } = {}) {
    if (syncing.has(guild.id)) return { skipped: true, reason: 'ya se está leyendo' };
    const state = byGuild.get(guild.id);
    if (!force && state?.lastSyncAt && now() - state.lastSyncAt < intervalMs) return { skipped: true, reason: 'se leyó hace poco' };
    syncing.add(guild.id);
    const result = { synced: 0, errors: 0, channels: [] };
    try {
      const wanted = pickChannels(guild, config);
      const rows = [];
      for (const channel of wanted) {
        try {
          const data = await syncChannel(guild, channel);
          await db.saveServerMemory(guild.id, channel.id, data);
          rows.push({ channelId: channel.id, ...data, syncedAt: new Date(now()) });
          result.synced += 1;
          result.channels.push(cleanName(channel.name));
        } catch (err) {
          result.errors += 1;
          logger.warn?.(`[memoria] no se pudo leer #${channel.name}: ${err.message}`);
          // si Discord esta limitando, no se insiste con el resto: se vuelve a intentar en el siguiente turno
          if (err.status === 429 || String(err.name).startsWith('RateLimitError')) break;
        }
        if (pauseMs) await sleep(pauseMs);
      }
      // lo que ya no se lee (canal sacado de la lista o apagado) se borra para que la IA no siga usandolo
      await db.deleteServerMemory(guild.id, wanted.map((channel) => channel.id)).catch(() => {});
      if (result.errors === 0 || rows.length) build(guild.id, wanted.length ? await db.listServerMemory(guild.id).catch(() => rows) : []);
      return result;
    } finally {
      syncing.delete(guild.id);
    }
  }

  function documentsFor(guildId) {
    return byGuild.get(guildId)?.docs || [];
  }

  function status(guildId) {
    const state = byGuild.get(guildId);
    return { channels: state?.channels || [], lastSyncAt: state?.lastSyncAt || null, syncing: syncing.has(guildId) };
  }

  // al arrancar se carga lo guardado y, pasado un rato (sin competir con el arranque), se lee lo que toque; despues se revisa cada 30 min
  function start(getConfig) {
    const tick = async (force) => {
      for (const guild of client.guilds.cache.values()) {
        const config = getConfig(guild.id);
        if (!config) continue;
        await syncGuild(guild, config, { force }).catch((err) => logger.warn?.(`[memoria] ${err.message}`));
      }
    };
    (async () => {
      for (const guild of client.guilds.cache.values()) await load(guild.id);
      setTimeout(() => tick(false), startDelayMs).unref?.();
      timer = setInterval(() => tick(false), 30 * 60 * 1000);
      timer.unref?.();
    })().catch((err) => logger.warn?.(`[memoria] ${err.message}`));
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, load, syncGuild, documentsFor, status, pickChannels: (guild, config) => pickChannels(guild, config), candidates: (guild) => candidateChannels(guild) };
}

module.exports = { create, pickChannels, candidateChannels, messageText, componentTexts, toChunks, authorIsTrusted, INFO_CHANNEL, MAX_CHARS_PER_CHANNEL, CHUNK_CHARS };
