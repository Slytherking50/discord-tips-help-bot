const dns = require('dns');
const https = require('https');
const net = require('net');

// descargas de URLs que escribe un usuario del dashboard (ej. fondo de la
// tarjeta de bienvenida). Como la peticion sale desde el servidor del bot,
// hay que impedir que apunte a la red interna del hosting (SSRF): solo https,
// nunca IPs privadas/loopback, sin seguir redirecciones a ciegas, con tope de
// tamaño y de tiempo.

const MAX_REDIRECTS = 3;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

// se valida la IP que realmente se va a usar para conectar (no solo la que
// se resolvio antes), asi un DNS que cambia entre la comprobacion y la
// conexion tampoco abre la puerta a la red interna
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const entries = Array.isArray(address) ? address : [{ address, family }];
    if (entries.some((entry) => isPrivateIp(entry.address))) {
      return callback(new Error('La dirección de esa URL no está permitida'));
    }
    return callback(null, address, family);
  });
}

function requestOnce(url, { maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        lookup: guardedLookup,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'PlanetBot/1.0', Accept: 'image/png,image/jpeg,image/webp,image/gif,image/*;q=0.8' },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url).toString() });
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`La imagen respondió ${res.statusCode}`));
        }
        const type = String(res.headers['content-type'] || '').toLowerCase();
        if (!type.startsWith('image/') || type.includes('svg')) {
          res.resume();
          return reject(new Error('La URL no es una imagen (PNG, JPG, WEBP o GIF)'));
        }
        const declared = Number(res.headers['content-length']);
        if (declared && declared > maxBytes) {
          res.resume();
          return reject(new Error('La imagen pesa demasiado'));
        }

        const chunks = [];
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy(new Error('La imagen pesa demasiado'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('La imagen tardó demasiado en responder')));
    req.on('error', reject);
  });
}

async function fetchImageBuffer(rawUrl, { maxBytes = 5 * 1024 * 1024, timeoutMs = 6000 } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('La URL de la imagen no es válida');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:') throw new Error('La imagen tiene que ser una URL https://');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) throw new Error('La dirección de esa URL no está permitida');

    const result = await requestOnce(url, { maxBytes, timeoutMs });
    if (result.buffer) return result.buffer;
    url = new URL(result.redirect);
  }
  throw new Error('La URL de la imagen redirige demasiadas veces');
}

module.exports = { fetchImageBuffer, isPrivateIp };
