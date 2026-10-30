const { setTimeout: sleep } = require('timers/promises');

// modo conversacion: cuando alguien menciona al bot en un canal, el bot lee lo
// que se venia hablando y se queda un rato participando como un integrante
// mas de la charla (mensajes cortos, sin responder a todo). Cuando nadie
// escribe por un rato, la sesion se cierra sola y el bot se calla: nunca habla
// por su cuenta si no hay gente conversando.
//
// Una "sesion" vive en memoria por canal. El bot solo evalua si contestar
// cuando llega un mensaje de una persona, y la IA puede decidir no decir nada
// (devuelve <silencio>).

const HISTORY_LIMIT = 30; // mensajes que se leen del canal al empezar
const HISTORY_MAX_AGE_MS = 30 * 60 * 1000; // lo mas viejo que eso ya no es "la conversacion"
const TRANSCRIPT_MAX = 20; // mensajes que se recuerdan por sesion (cada uno cuesta tokens en cada respuesta)
const PROMPT_MESSAGES = 16; // cuantos de esos se mandan a la IA
const LINE_MAX = 240;
// llamarlo por su nombre ("planet?", "hey planetbot", "gracias planet") cuenta como hablarle a el
const NAME_CALL_GREETINGS = ['hey', 'hola', 'oye', 'ey', 'ok', 'che', 'buenas', 'epa'];
const NAME_CALL_MAX_WORDS = 12;
// un "hey" / "hola" / "?" suelto de la misma persona que le acaba de hablar al bot es un
// "¿me oyes?": cuenta como hablarle a el durante un rato
const PING_WORD = /^(?:he+y+|e+y+|e+h+|oye+|hola+|holi+|ola+|alo+|bot|ps+t+|\?+)$/;
const PING_WINDOW_MS = 2 * 60 * 1000;
const REPLY_MAX = 500;
const MAX_SESSIONS_PER_GUILD = 3;
const BASE_CONTEXT_TTL_MS = 5 * 60 * 1000;

const SILENCE_TOKEN = /<\s*silencio\s*>/i;
const STOP_PHRASE = /\b(c[aá]llate|callate|silencio|dej[aá]s? de hablar|par[aá]s? de hablar|no hables(?: m[aá]s)?|chau bot|adi[oó]s bot)\b/i;
const STOP_ACKNOWLEDGEMENTS = ['Ok, me callo 🤐', 'Listo, los dejo seguir', 'Va, me quedo en silencio'];

// probabilidad de CONSIDERAR contestar a un mensaje que no iba dirigido al bot
// (si pasa el filtro, igual la IA decide si tiene algo que aportar). Filtrar
// antes de llamar a la IA tambien cuida la cuota gratis de Groq
const CHATTINESS = { calmada: 0.3, normal: 0.55, habladora: 0.85 };

const DEFAULT_SETTINGS = {
  idleMinutes: 4,
  maxMinutes: 20,
  maxReplies: 25,
  minSecondsBetweenReplies: 10,
  chattiness: 'normal',
};

// esperas cortas a proposito: la IA ya tarda ~0,5 s y la gente espera una respuesta
// rapida. Solo se deja un margen para leer mensajes seguidos antes de intervenir
const DEFAULT_TIMING = {
  addressedDelayMs: 250, // si le hablaron directo, casi inmediato
  passiveDelayMs: 1500, // espera base antes de intervenir por su cuenta
  passiveJitterMs: 1200,
  msPerChar: 12, // "tipeo": cuanto tarda en escribir segun el largo
  minTypingMs: 300,
  maxTypingMs: 1500,
};

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function settingsFor(config) {
  const raw = config?.ai?.conversation || {};
  return {
    idleMinutes: clampNumber(raw.idleMinutes, 0.05, 30, DEFAULT_SETTINGS.idleMinutes),
    maxMinutes: clampNumber(raw.maxMinutes, 0.1, 120, DEFAULT_SETTINGS.maxMinutes),
    maxReplies: Math.floor(clampNumber(raw.maxReplies, 1, 100, DEFAULT_SETTINGS.maxReplies)),
    minSecondsBetweenReplies: clampNumber(raw.minSecondsBetweenReplies, 0, 120, DEFAULT_SETTINGS.minSecondsBetweenReplies),
    chattiness: CHATTINESS[raw.chattiness] !== undefined ? raw.chattiness : DEFAULT_SETTINGS.chattiness,
  };
}

// lo que escribe la IA va directo al chat: se limpia para que nunca ping-ee a
// nadie, ni firme con su nombre, ni se pase de largo
function sanitizeReply(text, botName) {
  let out = String(text || '').replace(SILENCE_TOKEN, '').trim();
  if (botName) out = out.replace(new RegExp(`^(?:\\*\\*)?${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*\\(vos\\))?(?:\\*\\*)?\\s*:\\s*`, 'i'), '');
  out = out.replace(/^["“](.*)["”]$/s, '$1');
  out = out.replace(/<@[!&]?\d+>/g, '').replace(/@(everyone|here)/gi, '$1');
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (out.length > REPLY_MAX) {
    const cut = out.slice(0, REPLY_MAX);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    out = (lastStop > REPLY_MAX * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
  }
  return out;
}

function create({
  client,
  aiHelper,
  buildBaseAiContext,
  isCreatorUser,
  matchForbiddenTopic,
  buildRealDataForQuery = null,
  trackAiUsage = () => {},
  now = () => Date.now(),
  random = Math.random,
  minutesToMs = (minutes) => minutes * 60 * 1000,
  timing = {},
}) {
  const pace = { ...DEFAULT_TIMING, ...timing };
  const sessions = new Map();

  function botDisplayName(guild) {
    return guild?.members?.me?.displayName || client.user.username;
  }

  function isEnabledFor(config, channelId) {
    const ai = config?.ai;
    if (!ai?.enabled || !ai.conversation?.enabled) return false;
    if (!aiHelper.isConfigured(config)) return false;
    // el bot solo conversa en UN canal elegido; sin canal elegido no conversa en
    // ninguno. Ese canal vale por si mismo: no depende de la lista "Canales
    // permitidos" de la IA (que limita las respuestas por mencion y de ayuda)
    return Boolean(ai.conversation.channelId) && ai.conversation.channelId === channelId;
  }

  function isActive(channelId) {
    const session = sessions.get(channelId);
    return Boolean(session && !session.ended);
  }

  // nombres por los que lo pueden llamar: el apodo en el server ("PlanetBot"), el
  // nombre de usuario, y el primer pedazo del apodo en camelCase ("Planet")
  function nameTokens(guild) {
    const names = new Set();
    for (const raw of [botDisplayName(guild), client.user.username]) {
      const full = normalizeText(raw).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (full) names.add(full);
      const firstChunk = String(raw || '').match(/^[A-Z]?[a-z0-9]+/)?.[0];
      if (firstChunk) names.add(normalizeText(firstChunk));
    }
    return [...names].filter((name) => name.length >= 4);
  }

  // "planet?", "hey planetbot", "planet ayudame", "gracias planet": el nombre va al
  // principio o al final de un mensaje corto. Un mensaje largo que solo contiene
  // la palabra (o el nombre del server, "Planet of Creators") no cuenta
  function isCalledByName(message) {
    const text = normalizeText(message.content)
      .replace(/planet of creators/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = text.split(' ').filter(Boolean);
    if (!words.length || words.length > NAME_CALL_MAX_WORDS) return false;

    const first = NAME_CALL_GREETINGS.includes(words[0]) && words.length > 1 ? words[1] : words[0];
    const last = words[words.length - 1];
    return nameTokens(message.guild).some((name) => first === name || last === name || text === name);
  }

  function isFollowUpPing(message, session) {
    const last = session?.lastAddressed;
    if (!last || last.userId !== message.author.id || now() - last.at > PING_WINDOW_MS) return false;
    return PING_WORD.test(normalizeText(message.content).replace(/[^a-z0-9?]/g, ''));
  }

  function isAddressed(message, session = null) {
    return (
      message.mentions.has(client.user.id, { ignoreEveryone: true, ignoreRoles: true }) ||
      message.mentions.repliedUser?.id === client.user.id ||
      isCalledByName(message) ||
      isFollowUpPing(message, session)
    );
  }

  // sin sesion abierta: ¿esta persona lo llamo por su nombre en el canal de conversacion?
  function wantsToJoin(message, config) {
    return !message.author.bot && isEnabledFor(config, message.channel.id) && isCalledByName(message);
  }

  // texto de un mensaje tal como lo va a "leer" la IA: menciones con nombre
  // legible, sin saltos raros, y los temas prohibidos tapados
  function describe(message, config) {
    let text = message.content || '';
    const botName = botDisplayName(message.guild);
    for (const [id, user] of message.mentions?.users || []) {
      const name = id === client.user.id ? botName : message.mentions.members?.get(id)?.displayName || user.username;
      text = text.split(`<@${id}>`).join(`@${name}`).split(`<@!${id}>`).join(`@${name}`);
    }
    text = text.replace(/<@&\d+>/g, '@rol').replace(/<#\d+>/g, '#canal').replace(/\s+/g, ' ').trim();

    if (!isCreatorUser(message.author.id) && matchForbiddenTopic(text, config?.ai?.forbiddenTopics)) return '[mensaje omitido]';
    if (message.attachments?.size) text = text ? `${text} [con adjunto]` : '[mandó una imagen o archivo]';
    return text.slice(0, LINE_MAX);
  }

  function remember(session, entry) {
    session.transcript.push(entry);
    if (session.transcript.length > TRANSCRIPT_MAX) session.transcript.splice(0, session.transcript.length - TRANSCRIPT_MAX);
  }

  function endSession(session, reason) {
    if (session.ended) return;
    session.ended = true;
    session.reason = reason;
    clearTimeout(session.idleTimer);
    clearTimeout(session.maxTimer);
    clearTimeout(session.debounceTimer);
    if (sessions.get(session.channelId) === session) sessions.delete(session.channelId);
  }

  // cada mensaje de una persona reinicia el reloj: si nadie escribe en
  // idleMinutes, la sesion termina sin que el bot diga nada
  function touch(session, settings) {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => endSession(session, 'idle'), minutesToMs(settings.idleMinutes));
    session.idleTimer.unref?.();
  }

  async function loadHistory(message, config) {
    const fetched = await message.channel.messages.fetch({ limit: HISTORY_LIMIT, before: message.id }).catch(() => null);
    if (!fetched) return [];
    const cutoff = now() - HISTORY_MAX_AGE_MS;
    return [...fetched.values()]
      .filter((m) => m.createdTimestamp === undefined || m.createdTimestamp >= cutoff)
      .reverse()
      .filter((m) => (m.author.id === client.user.id || !m.author.bot) && !m.system)
      .map((m) => ({
        id: m.id,
        authorId: m.author.id,
        name: m.member?.displayName || m.author.username,
        text: m.author.id === client.user.id ? String(m.content || '[mensaje del bot]').replace(/\s+/g, ' ').slice(0, LINE_MAX) : describe(m, config),
        bot: m.author.id === client.user.id,
      }))
      .filter((entry) => entry.text);
  }

  function guildSessionCount(guildId) {
    let count = 0;
    for (const session of sessions.values()) if (!session.ended && session.guildId === guildId) count += 1;
    return count;
  }

  async function createSession(message, config) {
    const settings = settingsFor(config);
    const session = {
      channelId: message.channel.id,
      guildId: message.guild.id,
      channel: message.channel,
      startedAt: now(),
      replies: 0,
      lastBotAt: 0,
      transcript: [],
      ended: false,
      config,
      pending: null,
      chain: Promise.resolve(),
      baseContext: null,
      baseContextAt: 0,
    };
    sessions.set(session.channelId, session);
    session.maxTimer = setTimeout(() => endSession(session, 'max-duration'), minutesToMs(settings.maxMinutes));
    session.maxTimer.unref?.();

    // el historial y el contexto del server (roles, quien es quien) se piden a la
    // vez: antes se hacian uno detras del otro y la primera respuesta tardaba mas
    const [history, base] = await Promise.all([
      loadHistory(message, config),
      buildBaseAiContext(message.guild, message.member, message.author, config).catch(() => null),
    ]);
    session.transcript = history;
    session.baseContext = base;
    session.baseContextAt = now();
    touch(session, settings);
    return session;
  }

  async function getBaseContext(session, message, config) {
    if (session.baseContext && now() - session.baseContextAt < BASE_CONTEXT_TTL_MS) return session.baseContext;
    session.baseContext = await buildBaseAiContext(message.guild, message.member, message.author, config);
    session.baseContextAt = now();
    return session.baseContext;
  }

  function transcriptText(session, botName) {
    return session.transcript
      .slice(-PROMPT_MESSAGES)
      .map((entry) => `${entry.bot ? `${botName} (vos)` : entry.name}: ${entry.text}`)
      .join('\n');
  }

  // muestra "PlanetBot esta escribiendo..." mientras la IA piensa
  function showTyping(session) {
    session.channel.sendTyping?.().catch(() => {});
  }

  // pide la respuesta a la IA. Devuelve { text } (text vacio = se queda callado)
  // o { failed: true } si la IA no respondio
  async function generate(session, message, config, addressed) {
    const settings = settingsFor(config);
    const botName = botDisplayName(message.guild);
    const base = await getBaseContext(session, message, config);
    // datos reales (roles, nivel, balance...) de quien pregunta, solo cuando le hablan a el
    const realData = addressed && buildRealDataForQuery ? await buildRealDataForQuery(message).catch(() => '') : '';
    const raw = await aiHelper.conversationReply(client, config, {
      ...base,
      botName,
      // el contexto del server se guarda por sesion, pero QUIEN pregunta cambia en cada mensaje
      userName: addressed ? message.member?.displayName || message.author.username : null,
      realData,
      transcript: transcriptText(session, botName),
      addressed,
      chattiness: settings.chattiness,
      // las excepciones de "creador" solo valen cuando es el creador quien le habla directo
      isCreator: addressed && isCreatorUser(message.author.id),
    });
    trackAiUsage(session.guildId, raw !== null && raw !== undefined);
    if (raw === null || raw === undefined) return { failed: true };
    if (SILENCE_TOKEN.test(raw) && !addressed) return { text: '' };
    return { text: sanitizeReply(raw, botName) };
  }

  async function send(session, message, text, { addressed, thinking }) {
    if (thinking) {
      const sent = await thinking.stop({ content: text, embeds: [], allowedMentions: { parse: [] } });
      return sent;
    }
    await session.channel.sendTyping?.().catch(() => {});
    await sleep(Math.min(pace.maxTypingMs, Math.max(pace.minTypingMs, text.length * pace.msPerChar)));
    if (session.ended) return null;
    return session.channel.send({
      content: text,
      allowedMentions: { parse: [], repliedUser: false },
      ...(addressed ? { reply: { messageReference: message.id, failIfNotExists: false } } : {}),
    });
  }

  function recordBotMessage(session, sent, text) {
    session.replies += 1;
    session.lastBotAt = now();
    remember(session, { id: sent?.id || `bot-${session.replies}`, authorId: client.user.id, name: botDisplayName(null), text, bot: true });
  }

  // evalua si contestar al mensaje pendiente (se ejecuta de a uno por sesion)
  async function evaluate(session) {
    const pending = session.pending;
    session.pending = null;
    if (!pending || session.ended) return;

    const config = session.config;
    const settings = settingsFor(config);
    if (!isEnabledFor(config, session.channelId)) return endSession(session, 'disabled');
    if (session.replies >= settings.maxReplies) return endSession(session, 'reply-limit');

    const { message, addressed } = pending;
    if (!addressed) {
      if (now() - session.lastBotAt < settings.minSecondsBetweenReplies * 1000) return;
      if (random() > CHATTINESS[settings.chattiness]) return;
    }

    const lengthBefore = session.transcript.length;
    if (addressed) showTyping(session);
    const result = await generate(session, message, config, addressed);
    if (session.ended || result.failed || !result.text) return;

    // si mientras la IA pensaba la charla siguio avanzando, una intervencion
    // espontanea ya quedo vieja: mejor no mandarla
    if (!addressed && session.transcript.length - lengthBefore >= 2) return;

    const sent = await send(session, message, result.text, { addressed, thinking: null });
    if (sent !== null) recordBotMessage(session, sent, result.text);
  }

  function enqueue(session) {
    session.chain = session.chain
      .then(() => evaluate(session))
      .catch((err) => console.error('Error en el modo conversación:', err));
    return session.chain;
  }

  function schedule(session, message, addressed) {
    if (session.ended) return;
    clearTimeout(session.debounceTimer);
    session.pending = { message, addressed: addressed || Boolean(session.pending?.addressed) };
    const wait = addressed ? pace.addressedDelayMs : pace.passiveDelayMs + random() * pace.passiveJitterMs;
    session.debounceTimer = setTimeout(() => enqueue(session), wait);
    session.debounceTimer.unref?.();
  }

  async function acknowledgeStop(session, message) {
    endSession(session, 'stopped');
    const text = STOP_ACKNOWLEDGEMENTS[Math.floor(random() * STOP_ACKNOWLEDGEMENTS.length)];
    await message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }

  // --- API publica ---

  // se llama con CADA mensaje de una persona: si hay sesion en el canal, lo
  // suma a lo que el bot "escucha" y reinicia el reloj de inactividad
  function observe(message, config) {
    const session = sessions.get(message.channel.id);
    if (!session || session.ended || message.author.bot) return;
    session.config = config;
    remember(session, {
      id: message.id,
      authorId: message.author.id,
      name: message.member?.displayName || message.author.username,
      text: describe(message, config),
      bot: false,
    });
    touch(session, settingsFor(config));
  }

  // mensaje de una persona que NO fue contestado por otra funcion del bot y no
  // iba dirigido a otro usuario: el bot puede intervenir en la charla
  async function maybeReply(message, config) {
    let session = sessions.get(message.channel.id);
    // sin sesion abierta, llamarlo por su nombre en el canal de conversacion
    // ("planet?") tambien lo mete en la charla, igual que mencionarlo
    if ((!session || session.ended) && wantsToJoin(message, config)) {
      return engage(message, config);
    }
    if (!session || session.ended || message.author.bot) return false;
    if (!isEnabledFor(config, session.channelId)) {
      endSession(session, 'disabled');
      return false;
    }
    session.config = config;

    const addressed = isAddressed(message, session);
    if (addressed) session.lastAddressed = { userId: message.author.id, at: now() };
    if (addressed && STOP_PHRASE.test(message.content || '')) {
      await acknowledgeStop(session, message);
      return true;
    }
    schedule(session, message, addressed);
    return true;
  }

  // lo mencionaron directo y el mensaje no era un pedido especial (meme,
  // resumen...): empieza la sesion si no hay una, y contesta ya. `thinking`
  // es el mensaje "Pensando..." que ya mando index.js; se convierte en la respuesta.
  // Devuelve false si no pudo encargarse (apagado, limite de sesiones...) para
  // que index.js use la charla de siempre
  async function engage(message, config, { thinking = null } = {}) {
    if (!isEnabledFor(config, message.channel.id)) return false;

    let session = sessions.get(message.channel.id);
    if (!session || session.ended) {
      if (guildSessionCount(message.guild.id) >= MAX_SESSIONS_PER_GUILD) return false;
      session = await createSession(message, config);
      // el mensaje que lo menciono es el ultimo de lo que lee (index.js ya lo
      // paso por observe() solo si habia sesion antes)
      remember(session, {
        id: message.id,
        authorId: message.author.id,
        name: message.member?.displayName || message.author.username,
        text: describe(message, config),
        bot: false,
      });
    }
    session.config = config;
    session.lastAddressed = { userId: message.author.id, at: now() };
    touch(session, settingsFor(config));

    if (STOP_PHRASE.test(message.content || '')) {
      if (thinking) await thinking.stop({ content: STOP_ACKNOWLEDGEMENTS[0], embeds: [] });
      else await message.channel.send({ content: STOP_ACKNOWLEDGEMENTS[0], allowedMentions: { parse: [] } }).catch(() => {});
      endSession(session, 'stopped');
      return true;
    }

    // se serializa con cualquier evaluacion en curso para no contestar dos veces a la vez
    const task = session.chain.then(async () => {
      if (session.ended) return;
      clearTimeout(session.debounceTimer);
      session.pending = null;
      // con el "Pensando..." animado no hace falta el indicador de escribiendo
      if (!thinking) showTyping(session);
      const result = await generate(session, message, config, true);
      if (session.ended && !thinking) return;

      if (result.failed || !result.text) {
        if (thinking) await thinking.stop('🤖 No pude pensar una respuesta ahora, mencioname de nuevo en un rato.');
        return;
      }
      const sent = await send(session, message, result.text, { addressed: true, thinking });
      recordBotMessage(session, sent, result.text);
    });
    session.chain = task.catch((err) => console.error('Error en el modo conversación:', err));
    await task;
    return true;
  }

  return { isEnabledFor, isActive, isCalledByName, wantsToJoin, observe, maybeReply, engage, sessions };
}

module.exports = { create, settingsFor, sanitizeReply, CHATTINESS, DEFAULT_SETTINGS, MAX_SESSIONS_PER_GUILD, STOP_PHRASE, SILENCE_TOKEN };
