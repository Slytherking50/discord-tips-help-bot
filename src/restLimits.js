// que hacer cuando Discord contesta 429 mientras el bot inicia sesion.
// Cloudflare y Discord limitan por IP, y en un hosting compartido (Render) un servidor nuevo cae a veces en una IP limitada: el 429 llega
// sin cabecera Retry-After y discord.js, en vez de esperar, repite el pedido sin pausa (unos 10 por segundo; cada uno cuenta como
// "pedido invalido" para Discord, asi que el bot alarga el bloqueo) y el inicio de sesion queda colgado sin escribir nada.
// Aca se corta ese ciclo: antes de estar conectado, un 429 sin tiempo de espera, o con uno demasiado largo para esperarlo, hace fallar
// el pedido al instante. Ya conectado todo sigue como siempre (discord.js espera los limites normales).

const LONG_WAIT_MS = 20000;
// discord.js le suma 50 ms a todo Retry-After: sin cabecera (o con "0") la espera que calcula es 0 o 50 ms, o sea, "no se cuanto esperar".
// Los limites normales de Discord (por ruta o globales) llegan siempre con mas que eso
const UNCLEAR_WAIT_MS = 50;
// "no pude iniciar por un limite de Discord a esta IP": lo entiende src/supervisor.js (reintentar en el mismo servidor no sirve)
const RATE_LIMITED_EXIT_CODE = 75;

function rejectDuringLogin(data, ready) {
  if (ready) return false;
  const wait = Number(data.retryAfter);
  return !(wait > UNCLEAR_WAIT_MS) || wait > LONG_WAIT_MS;
}

// que escribir y con que codigo salir cuando client.login() falla
function explainLoginFailure(err) {
  if (err && String(err.name).startsWith('RateLimitError')) {
    const wait = err.retryAfter > 0 ? `pide esperar ${Math.round(err.retryAfter / 1000)} s` : 'no dice cuánto esperar';
    return {
      exitCode: RATE_LIMITED_EXIT_CODE,
      message: `Discord está limitando a este servidor (HTTP 429, ${wait}) al pedir ${err.route}: no insisto para no alargar el límite, salgo para que el hosting me mueva a otra instancia.`,
    };
  }
  return { exitCode: 1, message: null };
}

module.exports = { rejectDuringLogin, explainLoginFailure, LONG_WAIT_MS, RATE_LIMITED_EXIT_CODE };
