// vigila el arranque del bot. Si Discord no responde, lo deja escrito en el log (antes pasaban minutos de silencio y el hosting
// solo decia "no open ports detected") y, pasado un tope, cierra el proceso para que el hosting lo reinicie en vez de dejarlo
// colgado sin abrir el puerto del panel. Tambien deja a la vista los errores de conexion y los limites largos de Discord.

const READY_EVENTS = ['clientReady', 'ready'];

function watchLogin({ client, log = console, exit = process.exit, noticeMs = 30000, giveUpMs = 180000, longLimitMs = 5000, now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const startedAt = now();
  const seconds = (ms) => Math.round(ms / 1000);

  // estos avisos se quedan toda la vida del proceso: sin un "error" escuchado, Node tira el proceso con una excepcion
  client.on('error', (err) => log.warn(`Discord: error del cliente: ${err?.message || err}`));
  client.on('shardError', (err, shardId) => log.warn(`Discord: error de conexión (shard ${shardId}): ${err?.message || err}`));
  client.on('shardDisconnect', (event, shardId) => log.warn(`Discord: conexión cerrada (shard ${shardId}, código ${event?.code ?? '?'})`));
  client.rest?.on?.('rateLimited', (info) => {
    if (info?.timeToReset >= longLimitMs) log.warn(`Discord: pedido limitado (${info.method} ${info.route}), esperando ${seconds(info.timeToReset)} s`);
  });

  let stopped = false;
  const timer = setIntervalFn(() => {
    if (stopped) return;
    const waited = now() - startedAt;
    if (waited >= giveUpMs) {
      log.error(`Discord no respondió en ${seconds(waited)} s: cierro el proceso para que el hosting lo reinicie.`);
      stop();
      exit(1);
      return;
    }
    log.warn(`Todavía esperando a Discord (${seconds(waited)} s sin conexión lista)...`);
  }, noticeMs);
  timer.unref?.();

  function stop() {
    stopped = true;
    clearIntervalFn(timer);
  }
  for (const event of READY_EVENTS) client.once(event, stop);
  return stop;
}

module.exports = { watchLogin };
