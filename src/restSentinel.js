// vigila si Discord esta limitando a la IP de este servidor. Un pedido SIN token a /gateway no tiene limite por ruta ni por bot: si da
// 429 es el bloqueo por IP (Cloudflare/Discord, frecuente en hosting compartido como Render). Con el bot ya conectado ese bloqueo lo deja
// mudo sin avisar (todos sus pedidos esperan el Retry-After); aca queda escrito en el log y visible en /healthz con cuanto falta.
// Un pedido por minuto; si hay bloqueo y Discord dice cuanto dura, no se vuelve a preguntar hasta que pase (no se suma presion).

const discordApi = require('./discordApi');

const MAX_DELAY_MS = 15 * 60 * 1000;
const LOG_EVERY = 10;

// el pedido va por donde salen los pedidos del bot: discord.com o, con DISCORD_API_URL, su proxy
function create({ url = discordApi.url('/gateway'), fetchFn = (...args) => fetch(...args), intervalMs = 60000, timeoutMs = 10000, now = Date.now, log = console, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let current = { state: 'unknown', httpStatus: null, checkedAt: null, limitedSince: null, until: null, retryAfterMs: null, consecutive: 0 };
  let timer = null;
  let running = false;
  let checking = false;

  async function check() {
    if (checking) return current;
    checking = true;
    try {
      let res;
      try {
        res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: discordApi.proxyHeaders() });
      } catch {
        // sin red o sin respuesta: no es un bloqueo, se conserva lo que se sabia
        current = { ...current, checkedAt: now(), state: current.state === 'limited' ? 'limited' : 'unknown', httpStatus: null };
        return current;
      }
      const checkedAt = now();
      if (res.status === 429) {
        const retry = Number(res.headers?.get?.('retry-after'));
        const retryAfterMs = Number.isFinite(retry) && retry > 0 ? retry * 1000 : null;
        const consecutive = current.consecutive + 1;
        const limitedSince = current.limitedSince ?? checkedAt;
        if (consecutive === 1 || consecutive % LOG_EVERY === 0) {
          const wait = retryAfterMs ? `Discord pide esperar ${Math.round(retryAfterMs / 60000)} min` : 'sin tiempo de espera';
          log.warn?.(`[red] Discord está limitando la IP de este servidor (HTTP 429, ${wait}): el bot no podrá responder hasta que pase`);
        }
        current = { state: 'limited', httpStatus: 429, checkedAt, limitedSince, until: retryAfterMs ? checkedAt + retryAfterMs : null, retryAfterMs, consecutive };
      } else if (res.ok) {
        if (current.state === 'limited') log.log?.(`[red] Discord volvió a aceptar pedidos desde este servidor (estuvo limitado ${Math.round((checkedAt - current.limitedSince) / 60000)} min)`);
        current = { state: 'ok', httpStatus: res.status, checkedAt, limitedSince: null, until: null, retryAfterMs: null, consecutive: 0 };
      } else {
        current = { ...current, state: current.state === 'limited' ? 'limited' : 'unknown', httpStatus: res.status, checkedAt };
      }
      return current;
    } finally {
      checking = false;
    }
  }

  function nextDelay() {
    if (current.state === 'limited' && current.until) return Math.min(Math.max(intervalMs, current.until - now() + 5000), MAX_DELAY_MS);
    return intervalMs;
  }

  function schedule() {
    if (!running) return;
    timer = setTimeoutFn(async () => {
      await check();
      schedule();
    }, nextDelay());
    timer?.unref?.();
  }

  function start() {
    if (running) return;
    running = true;
    check().then(schedule, schedule);
  }

  function stop() {
    running = false;
    clearTimeoutFn(timer);
    timer = null;
  }

  // lo que muestra /healthz: tiempos en segundos, nunca la URL ni cabeceras
  function status() {
    const at = now();
    return {
      state: current.state,
      httpStatus: current.httpStatus,
      checkedAgoSeconds: current.checkedAt ? Math.round((at - current.checkedAt) / 1000) : null,
      limitedForSeconds: current.limitedSince ? Math.round((at - current.limitedSince) / 1000) : null,
      retryInSeconds: current.until ? Math.max(0, Math.round((current.until - at) / 1000)) : null,
    };
  }

  return { start, stop, check, status };
}

module.exports = { create };
