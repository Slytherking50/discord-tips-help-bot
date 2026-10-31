// vigila el arranque del bot. Si Discord no responde, lo deja escrito en el log (antes pasaban minutos de silencio y el hosting
// solo decia "no open ports detected"): el ultimo aviso de Discord, una prueba de red desde este servidor y, pasado un tope, cierra
// el proceso para que lo reinicien (src/supervisor.js o el hosting) en vez de dejarlo colgado sin abrir el puerto del panel.
// Tambien deja a la vista los errores de conexion y los limites largos de Discord.

const dns = require('dns');
const net = require('net');

const READY_EVENTS = ['clientReady', 'ready'];
const RECENT_LIMIT = 30;

// el token nunca debe quedar en el log: se tapa el exacto y cualquier cosa con su forma
function redact(text) {
  let clean = String(text).replace(/[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}/g, '[token]');
  const token = process.env.DISCORD_TOKEN;
  if (token) clean = clean.split(token).join('[token]');
  return clean;
}

function timed(label, task, limitMs) {
  const started = Date.now();
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(`${label}: sin respuesta en ${limitMs} ms`), limitMs);
  });
  return Promise.race([
    Promise.resolve().then(task).then((detail) => `${label}: ok${detail ? ` (${detail})` : ''}, ${Date.now() - started} ms`),
    limit,
  ])
    .catch((err) => `${label}: falló (${err?.code || err?.message || err}), ${Date.now() - started} ms`)
    .finally(() => clearTimeout(timer));
}

// prueba capa por capa si este servidor llega a Discord: nombre, pedido HTTPS y conexion directa al gateway
function probeNetwork(limitMs = 8000) {
  return Promise.all([
    timed('DNS discord.com', async () => (await dns.promises.lookup('discord.com', { all: true })).map((a) => a.address).join(' '), limitMs),
    timed('HTTPS discord.com/api/v10/gateway', async () => `HTTP ${(await fetch('https://discord.com/api/v10/gateway', { signal: AbortSignal.timeout(limitMs) })).status}`, limitMs),
    timed('TCP gateway.discord.gg:443', () => new Promise((resolve, reject) => {
      const socket = net.connect({ host: 'gateway.discord.gg', port: 443 });
      socket.setTimeout(limitMs, () => socket.destroy(new Error('sin conexión')));
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', reject);
    }), limitMs),
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
  // los avisos internos de discord.js se guardan (sin escribirlos) hasta que haya conexion: si algo se traba, se ve en que paso
  client.on('debug', (line) => {
    if (stopped) return;
    recent.push({ at: now(), line: redact(line) });
    if (recent.length > RECENT_LIMIT) recent.shift();
  });

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
  }
  for (const event of READY_EVENTS) client.once(event, stop);
  return stop;
}

module.exports = { watchLogin, probeNetwork, redact };
