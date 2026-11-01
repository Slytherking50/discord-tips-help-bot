// vigila el arranque del bot. Si Discord no responde, lo deja escrito en el log (antes pasaban minutos de silencio y el hosting
// solo decia "no open ports detected"): los ultimos avisos de Discord, una prueba de red desde este servidor y, pasado un tope, cierra
// el proceso para que lo reinicien (src/supervisor.js o el hosting) en vez de dejarlo colgado sin abrir el puerto del panel.
// Tambien deja a la vista los errores de conexion y los limites largos de Discord.

const dns = require('dns');
const net = require('net');
const discordApi = require('./discordApi');

const READY_EVENTS = ['clientReady', 'ready'];
const RECENT_LIMIT = 30;

// el token nunca debe quedar en el log: se tapa el exacto y cualquier cosa con su forma (tambien la que discord.js ya tapo a medias)
function redact(text) {
  let clean = String(text).replace(/[\w-]{20,}\.[\w-]{5,}\.(?:[\w-]{20,}|\*{4,})/g, '[token]');
  const token = process.env.DISCORD_TOKEN;
  if (token) clean = clean.split(token).join('[token]');
  return clean;
}

// cada prueba devuelve una linea; la tarea puede devolver un texto (todo bien) o { problem: true, detail } (contesto, pero mal)
function timed(label, task, limitMs, onTimeout) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve(`${label}: sin respuesta en ${limitMs} ms`);
    }, limitMs);
  });
  return Promise.race([
    Promise.resolve().then(task).then((result) => {
      const { detail, problem } = result && typeof result === 'object' ? result : { detail: result };
      return `${label}: ${problem ? 'PROBLEMA' : 'ok'}${detail ? ` (${detail})` : ''}, ${elapsed()} ms`;
    }),
    limit,
  ])
    .catch((err) => `${label}: falló (${err?.code || err?.message || err}), ${elapsed()} ms`)
    .finally(() => clearTimeout(timer));
}

// prueba capa por capa si este servidor llega a Discord: nombre, pedido HTTPS (sin token) y conexion directa al gateway
// (el pedido HTTPS va por donde salen los pedidos del bot: discord.com o, con DISCORD_API_URL, su proxy; el gateway siempre es directo)
function probeNetwork(limitMs = 8000, { apiUrl = discordApi.url('/gateway'), gatewayHost = 'gateway.discord.gg', gatewayPort = 443, gatewayUrl = 'wss://gateway.discord.gg/?v=10&encoding=json' } = {}) {
  const host = new URL(apiUrl).hostname;
  let gatewaySocket = null;
  return Promise.all([
    timed(`DNS ${host}`, async () => (await dns.promises.lookup(host, { all: true })).map((a) => a.address).join(' '), limitMs),
    timed(`HTTPS ${host}${new URL(apiUrl).pathname}`, async () => {
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(limitMs), headers: discordApi.proxyHeaders() });
      if (res.ok) return `HTTP ${res.status}`;
      // un 429 sin token es el limite por IP de Discord/Cloudflare: se deja a la vista con lo que sirve para entenderlo
      const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
      const header = (name) => res.headers.get(name) ?? '-';
      const meaning = res.status === 429 ? ' = límite de Discord/Cloudflare para la IP de este servidor' : '';
      return { problem: true, detail: `HTTP ${res.status}${meaning}; retry-after: ${header('retry-after')}; x-ratelimit-global: ${header('x-ratelimit-global')}; server: ${header('server')}; cf-ray: ${header('cf-ray')}; cuerpo: "${body}"` };
    }, limitMs),
    timed(`TCP ${gatewayHost}:${gatewayPort}`, () => new Promise((resolve, reject) => {
      const socket = net.connect({ host: gatewayHost, port: gatewayPort });
      socket.setTimeout(limitMs, () => socket.destroy(new Error('sin conexión')));
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', reject);
    }), limitMs),
    // el saludo real del gateway (WebSocket): dice si el bloqueo por IP tambien alcanza a la conexion en vivo o solo a la API
    timed(`WebSocket ${new URL(gatewayUrl).host}`, () => new Promise((resolve, reject) => {
      const WebSocket = require('ws');
      const socket = new WebSocket(gatewayUrl, { handshakeTimeout: limitMs });
      gatewaySocket = socket;
      const done = (result) => { socket.terminate(); resolve(result); };
      socket.once('message', (data) => {
        let op = null;
        try { op = JSON.parse(String(data)).op; } catch { /* no era JSON */ }
        done(op === 10 ? 'saludo HELLO recibido' : { problem: true, detail: `respondió algo inesperado (op ${op})` });
      });
      socket.once('unexpected-response', (req, res) => done({ problem: true, detail: `HTTP ${res.statusCode} en el handshake; retry-after: ${res.headers['retry-after'] ?? '-'}; server: ${res.headers.server ?? '-'}` }));
      socket.once('error', reject);
    }), limitMs, () => gatewaySocket?.terminate()),
  ]);
}

function watchLogin({ client, log = console, exit = process.exit, noticeMs = 30000, giveUpMs = 180000, longLimitMs = 5000, now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval, probe = probeNetwork }) {
  const startedAt = now();
  const seconds = (ms) => Math.round(ms / 1000);
  const recent = [];
  let stopped = false;
  let probed = false;
  let lastNoticeAt = startedAt;

  // estos avisos se quedan toda la vida del proceso: sin un "error" escuchado, Node tira el proceso con una excepcion
  client.on('error', (err) => log.warn(`Discord: error del cliente: ${err?.message || err}`));
  client.on('shardError', (err, shardId) => log.warn(`Discord: error de conexión (shard ${shardId}): ${err?.message || err}`));
  client.on('shardDisconnect', (event, shardId) => log.warn(`Discord: conexión cerrada (shard ${shardId}, código ${event?.code ?? '?'})`));
  client.rest?.on?.('rateLimited', (info) => {
    if (info?.timeToReset >= longLimitMs) log.warn(`Discord: pedido limitado (${info.method} ${info.route}), esperando ${seconds(info.timeToReset)} s`);
  });

  // los avisos internos de discord.js y de su REST se guardan (sin escribirlos) hasta que haya conexion: si algo se traba, se ve en que paso.
  // Los del REST se sueltan al conectar (con uno escuchando, discord.js copia cada respuesta que recibe)
  const remember = (line) => {
    if (stopped) return;
    recent.push({ at: now(), line: redact(String(line).replace(/\s+/g, ' ').slice(0, 300)) });
    if (recent.length > RECENT_LIMIT) recent.shift();
  };
  const onDebug = (line) => remember(line);
  const onRestDebug = (line) => remember(`REST: ${line}`);
  const onRestResponse = (request, response) => {
    const retryAfter = response?.headers?.get?.('retry-after');
    remember(`REST ${String(request?.method).toUpperCase()} ${request?.path} -> HTTP ${response?.status}${retryAfter ? ` (retry-after ${retryAfter})` : ''}`);
  };
  client.on('debug', onDebug);
  client.rest?.on?.('restDebug', onRestDebug);
  client.rest?.on?.('response', onRestResponse);

  const lastLine = () => {
    const last = recent.at(-1);
    return last ? `Último aviso de Discord hace ${seconds(now() - last.at)} s: ${last.line}` : 'Todavía no llegó ningún aviso de Discord.';
  };

  const tickMs = Math.min(noticeMs, giveUpMs);
  const timer = setIntervalFn(() => {
    if (stopped) return;
    const waited = now() - startedAt;
    if (waited >= giveUpMs) {
      const trace = recent.map((entry) => `  ${seconds(entry.at - startedAt)} s ${entry.line}`).join('\n');
      log.error(`Discord no respondió en ${seconds(waited)} s: cierro el proceso para que lo reinicien.${trace ? `\nÚltimos avisos de Discord:\n${trace}` : ''}`);
      stop();
      exit(1);
      return;
    }
    if (now() - lastNoticeAt < noticeMs) return;
    lastNoticeAt = now();
    log.warn(`Todavía esperando a Discord (${seconds(waited)} s sin conexión lista). ${lastLine()}`);
    if (!probed) {
      probed = true;
      Promise.resolve()
        .then(() => probe())
        .then((lines) => log.warn(`Prueba de red desde este servidor:\n${lines.map((line) => `  ${line}`).join('\n')}`))
        .catch((err) => log.warn(`No se pudo hacer la prueba de red: ${err?.message || err}`));
    }
  }, tickMs);
  timer.unref?.();

  function stop() {
    stopped = true;
    clearIntervalFn(timer);
    client.off?.('debug', onDebug);
    client.rest?.off?.('restDebug', onRestDebug);
    client.rest?.off?.('response', onRestResponse);
  }
  for (const event of READY_EVENTS) client.once(event, stop);
  return stop;
}

module.exports = { watchLogin, probeNetwork, redact };
