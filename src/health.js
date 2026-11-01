// resumen publico del estado del bot para GET /healthz: que version corre, desde cuando, si Discord esta conectado y si Discord
// limita la IP del servidor. Nada secreto: sin tokens, sin ids de usuarios, sin configuracion.

function buildHealth({ client, extras = {}, env = process.env, uptimeSeconds = Math.round(process.uptime()), nodeVersion = process.version } = {}) {
  const ready = Boolean(client?.isReady?.());
  const ping = client?.ws?.ping;
  const rest = extras.rest || { state: 'unknown' };
  return {
    ok: ready && rest.state !== 'limited',
    commit: (env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
    instance: env.RENDER_INSTANCE_ID || null,
    node: nodeVersion,
    uptimeSeconds,
    discord: {
      ready,
      pingMs: typeof ping === 'number' && ping >= 0 ? Math.round(ping) : null,
      guilds: client?.guilds?.cache?.size ?? 0,
    },
    voiceSessions: extras.voiceSessions ?? 0,
    rest,
  };
}

module.exports = { buildHealth };
