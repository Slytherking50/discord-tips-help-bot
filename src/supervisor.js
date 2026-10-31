// arranque supervisado: lanza src/index.js como proceso hijo y, si no llega a abrir el panel (Discord que no contesta en el primer
// arranque de un despliegue), lo vuelve a lanzar dentro del mismo servidor en vez de salir con error. Para el hosting un proceso que
// sale durante el despliegue es un despliegue fallido, y la instancia anterior se queda sirviendo la version vieja aunque el reinicio
// siguiente si conectara. Cuando el panel abre su puerto el hijo avisa "listening" y desde ahi el supervisor no interviene: si el hijo se
// cierra sale con su mismo codigo y el hosting reinicia el servicio como siempre.

const { fork } = require('child_process');
const path = require('path');
const { RATE_LIMITED_EXIT_CODE } = require('./restLimits');

function supervise(options = {}) {
  const {
    script = path.join(__dirname, 'index.js'),
    maxBootFailures = 6,
    retryDelaysMs = [0, 5000, 10000, 15000, 20000],
    bootGiveUpSeconds = 60,
    bootTimeoutMs = 240000,
    killGraceMs = 5000,
    forkFn = fork,
    log = console,
    exit = process.exit,
    proc = process,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;

  let child = null;
  let booted = false;
  let failures = 0;
  let stopping = false;

  const describe = (code, signal) => (signal ? `señal ${signal}` : `código ${code}`);

  function launch() {
    if (stopping) return;
    booted = false;
    log.info?.(`Lanzando el bot (intento ${failures + 1}, Node ${proc.version}).`);
    // el hijo vigila su propia conexion a Discord (src/bootWatch.js) con este tope y sale si no llega
    const mine = forkFn(script, [], { env: { ...proc.env, BOOT_GIVE_UP_SECONDS: String(bootGiveUpSeconds) } });
    child = mine;

    // por si el hijo queda vivo pero sin abrir el panel (la base que no contesta, por ejemplo)
    const bootTimer = setTimeoutFn(() => {
      if (child === mine && !booted) {
        log.warn(`El bot no abrió el panel en ${Math.round(bootTimeoutMs / 1000)} s: lo cierro para lanzarlo de nuevo.`);
        mine.kill('SIGKILL');
      }
    }, bootTimeoutMs);
    bootTimer?.unref?.();

    mine.on('message', (message) => {
      if (message !== 'listening' || child !== mine) return;
      booted = true;
      failures = 0;
      clearTimeoutFn(bootTimer);
    });
    mine.on('error', (err) => {
      log.error(`No se pudo lanzar el bot: ${err?.message || err}`);
      if (!mine.pid) {
        clearTimeoutFn(bootTimer);
        exit(1);
      }
    });
    mine.on('exit', (code, signal) => {
      clearTimeoutFn(bootTimer);
      if (child === mine) child = null;
      if (stopping) {
        exit(typeof code === 'number' ? code : 0);
        return;
      }
      if (booted) {
        log.error(`El bot se cerró (${describe(code, signal)}) con el panel ya abierto: salgo para que el hosting lo reinicie.`);
        exit(typeof code === 'number' && code !== 0 ? code : 1);
        return;
      }
      // Discord limita la IP de este servidor: repetir aca no sirve (seguiria limitada) y cada pedido alarga el bloqueo; al salir, el hosting
      // lo levanta en otra instancia
      if (code === RATE_LIMITED_EXIT_CODE) {
        log.error('El bot no pudo iniciar porque Discord está limitando la IP de este servidor: no lo relanzo aquí, salgo para que el hosting lo mueva a otra instancia.');
        exit(1);
        return;
      }
      failures += 1;
      if (failures >= maxBootFailures) {
        log.error(`El bot no logró arrancar en ${failures} intentos (último: ${describe(code, signal)}): salgo para que el hosting lo reinicie.`);
        exit(1);
        return;
      }
      const delay = retryDelaysMs[Math.min(failures - 1, retryDelaysMs.length - 1)];
      log.warn(`El bot no logró arrancar (intento ${failures} de ${maxBootFailures}, ${describe(code, signal)}): lo lanzo de nuevo ${delay ? `en ${Math.round(delay / 1000)} s` : 'ahora'}.`);
      // este temporizador es lo unico que mantiene vivo al supervisor mientras espera: no puede ser "unref"
      setTimeoutFn(launch, delay);
    });
  }

  // el hosting avisa con SIGTERM antes de reemplazar el servicio: se lo paso al bot (que guarda sus contadores) y espero a que cierre
  for (const signal of ['SIGTERM', 'SIGINT']) {
    proc.on(signal, () => {
      stopping = true;
      if (!child) {
        exit(0);
        return;
      }
      child.kill(signal);
      const grace = setTimeoutFn(() => {
        child?.kill('SIGKILL');
        exit(0);
      }, killGraceMs);
      grace?.unref?.();
    });
  }

  launch();
  return { get child() { return child; }, get failures() { return failures; }, get booted() { return booted; } };
}

if (require.main === module) supervise();

module.exports = { supervise };
