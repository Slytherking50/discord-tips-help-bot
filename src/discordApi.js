// por donde el bot habla con la API de Discord. Por defecto es discord.com directo. Si el hosting tiene la IP bloqueada por Discord/Cloudflare
// (HTTP 429 con una pagina HTML, "error 1015"), los pedidos se pueden mandar por un proxy propio (un Cloudflare Worker, ver proxy/ y el README):
//  - DISCORD_API_URL: la direccion del proxy SIN version, por ejemplo https://mi-proxy.workers.dev/api
//  - DISCORD_PROXY_KEY: la clave que el proxy exige en la cabecera X-Proxy-Key (para que nadie mas lo use)
// Solo cambia el trafico REST (mensajes, comandos, el login del panel): la conexion en vivo (gateway) sigue siendo directa.

const DEFAULT_BASE = 'https://discord.com/api';

// la direccion base, sin barra final; si DISCORD_API_URL falta o no es una direccion http(s), se usa discord.com
function baseUrl(env = process.env) {
  const raw = String(env.DISCORD_API_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(raw) ? raw : DEFAULT_BASE;
}

function usingProxy(env = process.env) {
  return baseUrl(env) !== DEFAULT_BASE;
}

// la clave solo viaja hacia el proxy, nunca hacia discord.com
function proxyHeaders(env = process.env) {
  const key = String(env.DISCORD_PROXY_KEY || '').trim();
  return usingProxy(env) && key ? { 'X-Proxy-Key': key } : {};
}

// lo que se le pasa al cliente de discord.js (opciones `rest`): sin proxy es exactamente lo que discord.js ya usa
function restOptions(env = process.env) {
  return { api: baseUrl(env), headers: proxyHeaders(env) };
}

// direccion completa de una ruta de la API (v10); `path` empieza con "/"
function url(path, env = process.env) {
  return `${baseUrl(env)}/v10${path}`;
}

// una linea para el log de arranque (nunca la clave); null si no hay nada que avisar
function startupNotice(env = process.env) {
  if (usingProxy(env)) {
    const key = proxyHeaders(env)['X-Proxy-Key'];
    return `Discord: los pedidos a la API salen por el proxy ${new URL(baseUrl(env)).host} (DISCORD_API_URL)${key ? '' : '. Ojo: falta DISCORD_PROXY_KEY, el proxy va a rechazar los pedidos'}.`;
  }
  if (String(env.DISCORD_API_URL || '').trim()) return 'Discord: DISCORD_API_URL no es una dirección válida (tiene que empezar con https://); uso discord.com directo.';
  return null;
}

module.exports = { DEFAULT_BASE, baseUrl, usingProxy, proxyHeaders, restOptions, url, startupNotice };
