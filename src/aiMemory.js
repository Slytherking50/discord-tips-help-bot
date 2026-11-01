// memoria corta de lo que cada persona hablo con la IA, para seguir el hilo: despues de "donde subo mis renders", un "y como lo hago?"
// se entiende aunque en el canal hayan hablado otras diez personas en el medio. Vive en memoria (no se guarda): se olvida a los
// 15 minutos o al reiniciar, y solo guarda las ultimas tres vueltas recortadas.

const TTL_MS = 15 * 60 * 1000;
const MAX_EXCHANGES = 3;
const MAX_THREADS = 300;
const MAX_QUESTION = 220;
const MAX_ANSWER = 360;

const threads = new Map();

function keyOf(guildId, userId) {
  return `${guildId}:${userId}`;
}

function flat(text, max) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function prune(now) {
  for (const [key, thread] of threads) if (now - thread.at > TTL_MS) threads.delete(key);
  // si aun asi hay demasiadas conversaciones se van las mas viejas
  while (threads.size > MAX_THREADS) threads.delete(threads.keys().next().value);
}

function remember(guildId, userId, question, answer, now = Date.now()) {
  const q = flat(question, MAX_QUESTION);
  const a = flat(answer, MAX_ANSWER);
  if (!q || !a) return;
  const key = keyOf(guildId, userId);
  const previous = threads.get(key);
  const exchanges = previous && now - previous.at <= TTL_MS ? previous.exchanges : [];
  exchanges.push({ q, a });
  threads.delete(key);
  threads.set(key, { at: now, exchanges: exchanges.slice(-MAX_EXCHANGES) });
  prune(now);
}

// "Persona: ...\nTú: ..." de las ultimas vueltas, o '' si no hay nada reciente
function recall(guildId, userId, now = Date.now()) {
  const thread = threads.get(keyOf(guildId, userId));
  if (!thread || now - thread.at > TTL_MS) return '';
  return thread.exchanges.map(({ q, a }) => `Persona: ${q}\nTú: ${a}`).join('\n');
}

function forget(guildId, userId) {
  threads.delete(keyOf(guildId, userId));
}

function clear() {
  threads.clear();
}

module.exports = { remember, recall, forget, clear, TTL_MS, MAX_EXCHANGES, MAX_THREADS };
