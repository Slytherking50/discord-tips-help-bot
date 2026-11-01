// Proxy de PlanetBot hacia la API de Discord (Cloudflare Worker).
// Solo reenvía /api/... a discord.com y solo si el pedido trae la clave PROXY_KEY en la cabecera X-Proxy-Key.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return new Response('No encontrado', { status: 404 });
    if (!env.PROXY_KEY || request.headers.get('X-Proxy-Key') !== env.PROXY_KEY) return new Response('No autorizado', { status: 403 });

    const upstream = new Request(`https://discord.com${url.pathname}${url.search}`, request);
    for (const name of ['X-Proxy-Key', 'X-Forwarded-For', 'X-Real-IP', 'CF-Connecting-IP', 'True-Client-IP', 'Forwarded']) upstream.headers.delete(name);
    return fetch(upstream);
  },
};
