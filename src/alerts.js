const db = require('./db');
const { buildEmbed } = require('./embedStyle');

// alertas de contenido nuevo (estilo Pingcord): videos de YouTube y directos
// de Twitch. YouTube se lee del feed RSS publico (sin clave); Twitch necesita
// una app gratis (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET en el .env).

const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS_PER_GUILD = 10;
const MAX_SEEN_IDS = 40;
const FRESH_VIDEO_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/;
const TWITCH_LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
const TWITCH_PURPLE = 0x9146ff;

const DEFAULT_MESSAGES = {
  youtube: '🔔 {role}**{channel}** subió un video nuevo: **{title}**\n{link}',
  twitch: '🔴 {role}**{channel}** está en vivo: **{title}**\n{link}',
};

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PlanetBot/1.0)', ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} respondió ${res.status}`);
  return res.text();
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function renderTemplate(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value ?? '')), template);
}

// --- YouTube ---

function parseYoutubeFeed(xml) {
  const author = xml.match(/<author>\s*<name>([^<]*)<\/name>/);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match) => ({
      id: (match[1].match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1],
      title: decodeXml((match[1].match(/<title>([^<]*)<\/title>/) || [])[1]),
      published: (match[1].match(/<published>([^<]+)<\/published>/) || [])[1],
    }))
    .filter((entry) => entry.id);
  return { channelName: decodeXml(author?.[1]) || null, entries };
}

async function fetchYoutubeFeed(channelId) {
  return parseYoutubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`));
}

// acepta URL del canal, @usuario o el ID (UC...). Para @usuario se lee la
// pagina del canal (la URL siempre se arma contra youtube.com, nunca con lo
// que pegue el usuario, asi no se puede apuntar a otro host)
async function resolveYoutubeChannel(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) throw new Error('Escribe el canal de YouTube (URL, @usuario o ID).');

  let channelId = null;
  let handle = null;
  if (YOUTUBE_CHANNEL_ID.test(input)) {
    channelId = input;
  } else {
    const byUrl = input.match(/youtube\.com\/channel\/(UC[\w-]{22})/i);
    if (byUrl) {
      channelId = byUrl[1];
    } else {
      const handleMatch = input.match(/@([\w.-]{3,60})/) || input.match(/youtube\.com\/(?:c|user)\/([\w.-]{3,60})/i);
      handle = handleMatch ? handleMatch[1] : /^[\w.-]{3,60}$/.test(input) ? input : null;
      if (!handle) throw new Error('No reconocí ese canal. Pega la URL del canal, su @usuario o su ID (empieza con UC).');
    }
  }

  if (!channelId) {
    const html = await fetchText(`https://www.youtube.com/@${encodeURIComponent(handle)}`, { 'Accept-Language': 'es', Cookie: 'CONSENT=YES+1' }).catch(() => '');
    const found = html.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/) || html.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
    if (!found) throw new Error('No pude encontrar ese canal. Prueba pegando su ID (empieza con UC) o la URL con /channel/...');
    channelId = found[1];
  }

  let feed;
  try {
    feed = await fetchYoutubeFeed(channelId);
  } catch {
    throw new Error('Ese canal no existe o no tiene feed público.');
  }
  // se guardan los videos que ya existen para no avisar de contenido viejo
  return { target: channelId, name: feed.channelName || handle || channelId, seenIds: feed.entries.map((entry) => entry.id).slice(0, MAX_SEEN_IDS) };
}

// --- Twitch ---

const twitchToken = { value: null, expiresAt: 0 };

function twitchConfigured() {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

async function getTwitchToken() {
  if (twitchToken.value && Date.now() < twitchToken.expiresAt - 60000) return twitchToken.value;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Twitch no entregó el token (status ${res.status})`);
  const data = await res.json();
  twitchToken.value = data.access_token;
  twitchToken.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return twitchToken.value;
}

async function twitchApi(pathAndQuery) {
  const token = await getTwitchToken();
  const res = await fetch(`https://api.twitch.tv/helix/${pathAndQuery}`, {
    headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 401) {
    twitchToken.value = null;
    throw new Error('Twitch rechazó el token; se renueva en el próximo chequeo');
  }
  if (!res.ok) throw new Error(`Twitch respondió ${res.status}`);
  return res.json();
}

async function resolveTwitchChannel(rawInput) {
  if (!twitchConfigured()) {
    throw new Error('Twitch no está configurado en este bot (faltan TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET).');
  }
  const input = String(rawInput || '').trim();
  const fromUrl = input.match(/twitch\.tv\/([a-zA-Z0-9_]{3,25})/i);
  const login = (fromUrl ? fromUrl[1] : input.replace(/^@/, '')).toLowerCase();
  if (!TWITCH_LOGIN.test(login)) throw new Error('No reconocí ese canal de Twitch (usa la URL o el nombre).');

  const data = await twitchApi(`users?login=${encodeURIComponent(login)}`);
  const user = data.data?.[0];
  if (!user) throw new Error('Ese canal de Twitch no existe.');
  return { target: user.login, name: user.display_name };
}

async function fetchTwitchStreams(logins) {
  const query = logins.slice(0, 100).map((login) => `user_login=${encodeURIComponent(login)}`).join('&');
  const data = await twitchApi(`streams?${query}`);
  return new Map((data.data || []).filter((stream) => stream.type === 'live').map((stream) => [stream.user_login.toLowerCase(), stream]));
}

// --- envio ---

async function postAlert(client, item, { content, embeds }) {
  const channel = await client.channels.fetch(item.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;
  await channel.send({
    content,
    embeds,
    allowedMentions: item.roleId ? { roles: [item.roleId] } : { parse: [] },
  });
  return true;
}

function roleMention(item) {
  return item.roleId ? `<@&${item.roleId}> ` : '';
}

function youtubeContent(item, entry) {
  return renderTemplate(item.message || DEFAULT_MESSAGES.youtube, {
    role: roleMention(item),
    channel: item.name,
    title: entry.title,
    link: `https://www.youtube.com/watch?v=${entry.id}`,
  });
}

function twitchPayload(config, item, stream) {
  const url = `https://www.twitch.tv/${item.target}`;
  const content = renderTemplate(item.message || DEFAULT_MESSAGES.twitch, {
    role: roleMention(item),
    channel: item.name,
    title: stream.title,
    game: stream.game_name || '',
    link: url,
  });
  const embed = buildEmbed({
    type: 'brand',
    title: stream.title || 'Directo en Twitch',
    url,
    author: { name: `${stream.user_name} está en vivo`, url },
    fields: [
      { name: 'Jugando', value: stream.game_name || '—', inline: true },
      { name: 'Espectadores', value: String(stream.viewer_count ?? 0), inline: true },
    ],
    image: stream.thumbnail_url ? `${stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?t=${Date.now()}` : undefined,
    config,
  }).setColor(TWITCH_PURPLE);
  return { content, embeds: [embed] };
}

// mensaje de prueba desde el dashboard, con datos de ejemplo
async function sendTestAlert(client, config, item) {
  if (item.platform === 'twitch') {
    return postAlert(
      client,
      item,
      twitchPayload(config, item, {
        title: '(prueba) Transmisión de ejemplo',
        game_name: 'Minecraft',
        viewer_count: 123,
        user_name: item.name,
        thumbnail_url: null,
      }),
    );
  }
  return postAlert(client, item, { content: youtubeContent(item, { id: 'dQw4w9WgXcQ', title: '(prueba) Video de ejemplo' }), embeds: [] });
}

// --- chequeo periodico ---

async function checkYoutubeItem(client, config, item) {
  const feed = await fetchYoutubeFeed(item.target);
  const known = new Set(item.seenIds || []);

  // primer chequeo sin historial: solo se anota lo que ya existe, sin avisar
  const fresh = known.size
    ? feed.entries
        .filter((entry) => !known.has(entry.id) && (!entry.published || Date.now() - Date.parse(entry.published) < FRESH_VIDEO_WINDOW_MS))
        .reverse()
        .slice(-3)
    : [];

  for (const entry of fresh) {
    await postAlert(client, item, { content: youtubeContent(item, entry), embeds: [] });
  }

  const merged = [...new Set([...feed.entries.map((entry) => entry.id), ...known])].slice(0, MAX_SEEN_IDS);
  if (merged.length !== known.size || merged.some((id) => !known.has(id))) {
    item.seenIds = merged;
    await db.updateAlertState(config.guildId, item.id, { seenIds: merged });
  }
}

async function checkTwitchItems(client, config, items) {
  const live = await fetchTwitchStreams(items.map((item) => item.target));
  for (const item of items) {
    const stream = live.get(String(item.target).toLowerCase());
    if (!stream || stream.id === item.lastStreamId) continue;
    item.lastStreamId = stream.id;
    await db.updateAlertState(config.guildId, item.id, { lastStreamId: stream.id });
    await postAlert(client, item, twitchPayload(config, item, stream));
  }
}

async function checkGuildAlerts(client, config) {
  const items = config?.alerts?.items || [];
  if (!config?.alerts?.enabled || !items.length) return;

  for (const item of items.filter((candidate) => candidate.platform === 'youtube')) {
    try {
      await checkYoutubeItem(client, config, item);
    } catch (err) {
      console.error(`Alertas: no se pudo revisar YouTube "${item.name}":`, err.message);
    }
  }

  const twitchItems = items.filter((candidate) => candidate.platform === 'twitch');
  if (twitchItems.length && twitchConfigured()) {
    try {
      await checkTwitchItems(client, config, twitchItems);
    } catch (err) {
      console.error('Alertas: no se pudo revisar Twitch:', err.message);
    }
  }
}

async function checkAllAlerts(client, configByGuild) {
  for (const config of configByGuild.values()) {
    await checkGuildAlerts(client, config);
  }
}

module.exports = {
  MAX_ITEMS_PER_GUILD,
  DEFAULT_MESSAGES,
  renderTemplate,
  parseYoutubeFeed,
  resolveYoutubeChannel,
  resolveTwitchChannel,
  twitchConfigured,
  sendTestAlert,
  checkAllAlerts,
};
