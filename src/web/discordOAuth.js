// los pedidos del login del panel salen por donde salen los del bot: discord.com o, con DISCORD_API_URL, su proxy (ver src/discordApi.js).
// Las direcciones que abre el navegador de la persona (autorizar, invitar al bot) siguen yendo directo a discord.com
const discordApi = require('../discordApi');
const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;

function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(discordApi.url('/oauth2/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...discordApi.proxyHeaders() },
    body,
  });

  if (!res.ok) {
    throw new Error(`No se pudo intercambiar el codigo de OAuth (status ${res.status})`);
  }

  return res.json();
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch(discordApi.url('/users/@me'), {
    headers: { Authorization: `Bearer ${accessToken}`, ...discordApi.proxyHeaders() },
  });
  if (!res.ok) throw new Error(`No se pudo obtener el usuario (status ${res.status})`);
  return res.json();
}

async function fetchUserGuilds(accessToken) {
  const res = await fetch(discordApi.url('/users/@me/guilds'), {
    headers: { Authorization: `Bearer ${accessToken}`, ...discordApi.proxyHeaders() },
  });
  if (!res.ok) throw new Error(`No se pudo obtener los servers (status ${res.status})`);
  return res.json();
}

function hasManagePermission(permissions) {
  const bitfield = BigInt(permissions);
  return (bitfield & BigInt(MANAGE_GUILD)) !== 0n || (bitfield & BigInt(ADMINISTRATOR)) !== 0n;
}

function buildBotInviteUrl({ clientId, permissions, guildId }) {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: String(permissions),
    scope: 'bot applications.commands',
    guild_id: guildId,
    disable_guild_select: 'true',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

module.exports = {
  buildAuthorizeUrl,
  buildBotInviteUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  fetchUserGuilds,
  hasManagePermission,
};
