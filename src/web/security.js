// protecciones comunes del dashboard: cabeceras, verificacion de origen en los
// POST y limite de peticiones. Sin dependencias externas.

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // CSP "suave": no restringe scripts ni estilos (el panel usa inline y
  // Google Fonts), pero corta clickjacking, <base> inyectado, formularios
  // hacia otros dominios y plugins
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

// rechaza POST/PUT/DELETE que vengan de otro sitio. Las cookies de sesion ya
// son SameSite=Lax (el navegador no las manda en un POST cross-site), esto es
// una segunda capa. Si el navegador no manda ni Origin ni Referer se deja
// pasar (algunos modos de privacidad los omiten), porque Lax sigue protegiendo.
function sameOriginGuard(dashboardUrl) {
  let configuredHost = null;
  try {
    configuredHost = dashboardUrl ? new URL(dashboardUrl).host : null;
  } catch {
    configuredHost = null;
  }

  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const source = req.get('origin') || req.get('referer');
    if (!source) return next();

    let sourceHost;
    try {
      sourceHost = new URL(source).host;
    } catch {
      return res.status(403).type('text/plain').send('Solicitud rechazada: origen inválido.');
    }

    if (sourceHost === req.get('host') || (configuredHost && sourceHost === configuredHost)) return next();
    return res.status(403).type('text/plain').send('Solicitud rechazada: origen no permitido.');
  };
}

// ventana fija por IP, en memoria (una sola instancia del bot). Suficiente
// para frenar abuso basico sin sumar una dependencia
function createRateLimiter({ windowMs, max, message = 'Demasiadas solicitudes, espera un momento e inténtalo de nuevo.' }) {
  const hits = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  cleanup.unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).type('text/plain').send(message);
    }
    return next();
  };
}

module.exports = { securityHeaders, sameOriginGuard, createRateLimiter };
