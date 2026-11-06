const { setTimeout: sleep } = require('timers/promises');
const { findImageAttachments } = require('./imageAttachments');

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
// llamarlo por su nombre ("planet?", "hey planetbot", "gracias planet") cuenta como hablarle a el,
// aunque lo escriban mal ("plnet", "plannet", "planetvot", "planet bot"). En un mensaje corto el
// nombre completo ("planetbot") cuenta en cualquier parte; en uno largo, solo al principio o al final
// ("planet, mira, estoy haciendo un render de..."), donde casi siempre es a el a quien le hablan
const NAME_CALL_MAX_WORDS = 12;
const NAME_EDGE_MAX_WORDS = 40;
// el nombre con el que se conoce al bot ademas de su usuario de Discord: en el server del dueño el
// usuario es "CreatorBot" y el apodo "PlanetBot", y asi le dice la gente ("planet", "planetbot"). Se
// reconoce siempre, aunque el apodo falte o cambie (otro server, alguien se lo quita), para que no
// deje de responder cuando lo llaman por el nombre del proyecto
const BRAND_NAME = 'PlanetBot';
// el primer pedazo del apodo ("planet") es una palabra comun: solo cuenta entre las primeras o las
// ultimas palabras del mensaje, sea corto o largo
const NAME_EDGE_WORDS = 3;
// frases donde "planet" NO es el bot: el nombre del server y sitios o juegos conocidos
const NOT_THE_BOT = /\bplanet\s*(?:of creators?|minecraft|zoo|coaster|earth|fitness|hollywood|express)\b/g;
// un "hey" / "hola" / "?" suelto de la misma persona que le acaba de hablar al bot es un
// "¿me oyes?": cuenta como hablarle a el durante un rato
const PING_WORD = /^(?:he+y+|e+y+|e+h+|oye+|hola+|holi+|ola+|alo+|bot|ps+t+|\?+)$/;
const PING_WINDOW_MS = 2 * 60 * 1000;
const REPLY_MAX = 500;
const TECHNICAL_REPLY_MAX = 800; // pasos de una respuesta tecnica
// una opinion sobre un trabajo (impresion + consejos) necesita mas lugar que un comentario de chat
const OPINION_REPLY_MAX = 1200;
const OPINION_TRANSCRIPT_LINES = 6; // lineas de la charla que acompanan a la imagen (cada una suma tokens)
const MAX_SESSIONS_PER_GUILD = 3;
const BASE_CONTEXT_TTL_MS = 5 * 60 * 1000;

// "que opinan de mi render?", "feedback?", "como quedo?": piden la opinion de quien lea. Con una
// imagen adjunta cuenta como hablarle al bot aunque no lo nombren (se evalua sobre texto sin tildes)
const OPINION_REQUEST = /\b(opin\w*|feedback|criticas?|consejos?|mejorar|calific\w*|evalu\w*|que (?:les? |te )?parece|que (?:piensan|piensas|dicen|dices|tal)|como (?:quedo|queda|se ve|esta|lo ven)|(?:les?|te) gusto)\b/;
// de que habla la pregunta: sirve para buscar la imagen reciente cuando no adjuntaron ninguna
const WORK_REFERENCE = /\b(render\w*|animacion\w*|trabajo\w*|imagen\w*|foto\w*|dibujo\w*|skin\w*|edicion\w*|miniatura\w*|thumbnail\w*|banner\w*|logo\w*|build\w*|construccion\w*|escena\w*|captura\w*|screenshot\w*|resultado|esto|eso|esta|este)\b/;
const RECENT_IMAGE_MS = 15 * 60 * 1000; // la imagen de la misma persona
const RECENT_OTHERS_IMAGE_MS = 2 * 60 * 1000; // la de otra persona solo si fue hace un momento
// preguntas que piden razonar o dar pasos ("como hago...", "por que no..."): el modelo gasta mas razonamiento
const TECHNICAL_QUESTION = /\b(como (?:hago|puedo|se (?:hace|usa|pone|activa|arregla|instala)|logro|consigo|mejoro|arreglo|instalo|configuro|animo|renderizo|exporto|importo)|por que (?:no|me|se|sale)|que (?:hago|puedo hacer)|no (?:me )?(?:funciona|sirve|abre|carga|renderiza|guarda|sale|deja)|(?:tengo|me sale|me da|me aparece) (?:un )?(?:error|problema)|paso a paso|explicame|diferencia entre|conviene|recomiendas)\b/;
// entre dos pedidos de opinion con imagen de la misma persona (sin mencionar al bot) tiene que pasar este tiempo
const OPINION_COOLDOWN_MS = 20 * 1000;

const NO_VISION_NOTICE = 'Ahora mismo no puedo ver imágenes, así que prefiero no opinar a ciegas. Inténtalo de nuevo en un rato o cuéntame cómo la hiciste y te doy ideas.';
const BAD_IMAGE_NOTICE = 'No pude abrir esa imagen (puede pesar demasiado o tener un formato raro). Prueba subiéndola de nuevo como PNG o JPG.';
const FAILED_NOTICE = '🤖 No pude pensar una respuesta ahora, inténtalo de nuevo en un rato.';
// Groq (gratis) deja un cupo de tokens por minuto: con muchos mensajes seguidos se acaba y hay que esperar unos segundos
const RATE_LIMITED_NOTICE = '🤖 Me escribieron muchos mensajes seguidos y me quedé sin cupo un momento. Inténtalo de nuevo en unos segundos.';
const failureNotice = (result) => (result?.rateLimited ? RATE_LIMITED_NOTICE : FAILED_NOTICE);

// el modelo a veces lo escribe en ingles ("<silence>") o cerrado ("<silencio/>"): tambien cuenta, para que nunca llegue al chat como texto
const SILENCE_TOKEN = /<\s*\/?\s*(?:silencio|silence)\s*\/?\s*>/i;
const STOP_PHRASE = /\b(c[aá]llate|callate|silencio|dej[aá]s? de hablar|par[aá]s? de hablar|no hables(?: m[aá]s)?|chau bot|adi[oó]s bot)\b/i;
const STOP_ACKNOWLEDGEMENTS = ['Ok, me callo 🤐', 'Listo, los dejo seguir', 'Va, me quedo en silencio'];

// un acuse de recibo ("ok", "listo", "jaja", "👍") no pide respuesta: contestarlo ("A su servicio.") arma un bucle de cortesias
const ACK_WORDS = new Set(['ok', 'okey', 'okay', 'oki', 'okis', 'k', 'vale', 'listo', 'lista', 'dale', 'bueno', 'bien', 'genial', 'perfecto', 'excelente', 'entendido', 'claro', 'ya', 'ah', 'aja', 'aha', 'mm', 'mmm', 'mhm', 'si', 'sip', 'sipi', 'nice', 'cool', 'ta']);
const LAUGH_WORD = /^(?:[jh][aeiou]){2,}[jh]?$|^x+d+$|^lol+$/;
const ACK_MAX_WORDS = 4;
// una frase corta que ya dijo hace poco no se repite cuando lo que le escribieron no es una pregunta; una respuesta larga repetida es la misma respuesta a la misma pregunta
const REPEAT_LINES = 4; // cuantos mensajes suyos recientes se comparan
const REPEAT_MAX_WORDS = 7;
const REPEAT_OPENING_WORDS = 3;

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

// --- reconocer su nombre aunque este mal escrito ---
// Se perdonan los errores de tipeo de verdad (letra que falta, tecla vecina, dos letras al reves,
// letra repetida) pero NO palabras parecidas que existen: "planes", "planea" o "planeta" no son
// "planet" con un error, son otras palabras. Por eso el cambio por una letra cualquiera cuesta el
// doble que el cambio por una tecla vecina, y una letra de mas solo se perdona si queda junto a una vecina.

// teclado QWERTY; "offset" es lo que se corre cada fila hacia la derecha (por eso las teclas de
// filas distintas quedan "entre" dos de la otra fila)
const KEYBOARD_ROWS = [
  { keys: 'qwertyuiop', offset: 0 },
  { keys: 'asdfghjkl', offset: 0.25 },
  { keys: 'zxcvbnm', offset: 0.75 },
];
const KEY_POSITION = new Map();
KEYBOARD_ROWS.forEach((row, rowIndex) => [...row.keys].forEach((key, column) => KEY_POSITION.set(key, { row: rowIndex, x: column + row.offset })));
const VOWELS = 'aeiou';
const DIGIT_TO_LETTER = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

function areNeighborKeys(a, b) {
  const first = KEY_POSITION.get(a);
  const second = KEY_POSITION.get(b);
  if (!first || !second || a === b) return false;
  const rows = Math.abs(first.row - second.row);
  const distance = Math.abs(first.x - second.x);
  return rows === 0 ? distance <= 1 : rows === 1 && distance < 1;
}

// letras repetidas seguidas cuentan como una: "plannet", "planeeet" -> "planet"
function squash(word) {
  return word.replace(/(.)\1+/g, '$1');
}

// "pl4n3t" -> "planet" (los numeros solo se leen como letras si la palabra mezcla las dos cosas)
function readableWord(word) {
  const letters = /[a-z]/.test(word) && /\d/.test(word) ? word.replace(/\d/g, (digit) => DIGIT_TO_LETTER[digit] || digit) : word;
  return squash(letters);
}

function substitutionCost(typed, expected) {
  if (typed === expected) return 0;
  if (areNeighborKeys(typed, expected) || (VOWELS.includes(typed) && VOWELS.includes(expected))) return 1;
  return 2;
}

function extraLetterCost(word, index) {
  const neighbors = [word[index - 1], word[index + 1]].filter(Boolean);
  return neighbors.some((other) => areNeighborKeys(word[index], other)) ? 1 : 2;
}

// distancia entre lo que escribieron y el nombre, contando solo errores de tipeo (ver arriba).
// Infinity si ni siquiera arranca con la misma letra (casi nadie se equivoca en la primera) o si
// el largo difiere mas de lo que se perdona
function typoDistance(typed, expected, limit) {
  if (typed[0] !== expected[0] || Math.abs(typed.length - expected.length) > limit) return Infinity;
  const rows = typed.length + 1;
  const columns = expected.length + 1;
  const table = Array.from({ length: rows }, () => new Array(columns).fill(Infinity));
  table[0][0] = 0;
  for (let i = 1; i < rows; i++) table[i][0] = table[i - 1][0] + extraLetterCost(typed, i - 1);
  for (let j = 1; j < columns; j++) table[0][j] = table[0][j - 1] + 1;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      table[i][j] = Math.min(
        table[i - 1][j] + extraLetterCost(typed, i - 1), // letra de mas
        table[i][j - 1] + 1, // letra que falta
        table[i - 1][j - 1] + substitutionCost(typed[i - 1], expected[j - 1]),
      );
      const swapped = i > 1 && j > 1 && typed[i - 1] === expected[j - 2] && typed[i - 2] === expected[j - 1];
      if (swapped) table[i][j] = Math.min(table[i][j], table[i - 2][j - 2] + 1); // dos letras al reves
    }
  }
  return table[rows - 1][columns - 1];
}

// errores que se perdonan segun el largo del nombre: en nombres cortos ninguno (con 4 o 5 letras un
// "error" ya es otra palabra), 1 en los de 6 a 8 ("planet") y 2 en los largos ("planetbot")
function typoLimit(name) {
  if (name.length <= 5) return 0;
  return name.length <= 8 ? 1 : 2;
}

function soundsLikeName(word, name) {
  if (word === name) return true;
  const limit = typoLimit(name);
  return limit > 0 && typoDistance(word, name, limit) <= limit;
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
function sanitizeReply(text, botName, maxLength = REPLY_MAX) {
  let out = String(text || '').replace(SILENCE_TOKEN, '').trim();
  if (botName) out = out.replace(new RegExp(`^(?:\\*\\*)?${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*\\((?:vos|tú)\\))?(?:\\*\\*)?\\s*:\\s*`, 'i'), '');
  out = out.replace(/^["“](.*)["”]$/s, '$1');
  out = out.replace(/<@[!&]?\d+>/g, '').replace(/@(everyone|here)/gi, '$1');
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (out.length > maxLength) {
    const cut = out.slice(0, maxLength);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    // sin dejar una mencion de canal cortada a la mitad ("<#1234")
    out = (lastStop > maxLength * 0.5 ? cut.slice(0, lastStop + 1) : cut).replace(/<#?\d*$/, '').trim();
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
  // se llama despues de mandar cada respuesta de la IA al canal ({ guild, channel, text, member }): asi se puede decir tambien en voz alta
  onReply = null,
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

  // nombres por los que lo pueden llamar, ya sin tildes, espacios ni letras repetidas.
  // `full`: el apodo en el server y el nombre de usuario completos ("planetbot"); cuentan en
  // cualquier parte de un mensaje corto. `short`: el primer pedazo del apodo en camelCase
  // ("planet"); es una palabra comun ("Planet of Creators"), asi que solo cuenta en los extremos
  function nameTokens(guild, config = null) {
    const full = new Set();
    const short = new Set();
    for (const raw of [botDisplayName(guild), client.user.username, config?.branding?.nickname, BRAND_NAME]) {
      const compact = squash(normalizeText(raw).replace(/[^a-z0-9]/g, ''));
      if (compact.length >= 4) full.add(compact);
      // primer pedazo del apodo en camelCase con al menos 4 letras ("PlanetBot" -> "planet"), aunque
      // lleve un adorno antes ("🤖 PlanetBot", "[BOT] PlanetBot")
      const chunk = [...String(raw || '').matchAll(/[A-Z]?[a-z0-9]+/g)].map((match) => squash(normalizeText(match[0]))).find((part) => part.length >= 4) || '';
      if (chunk) short.add(chunk);
    }
    return { full: [...full], short: [...short].filter((name) => !full.has(name)) };
  }

  // "planet?", "hey planetbot", "ayudame planet", "plnet ayuda", "que opinas planet bot": el nombre,
  // bien o mal escrito, en un mensaje corto. Un mensaje largo que solo contiene la palabra (o el
  // nombre del server, "Planet of Creators", o "Planet Minecraft") no cuenta
  function isCalledByName(message, config = null) {
    const text = normalizeText(message.content)
      .replace(NOT_THE_BOT, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = text.split(' ').filter(Boolean).map(readableWord);
    if (!words.length || words.length > NAME_EDGE_MAX_WORDS) return false;

    const { full, short } = nameTokens(message.guild, config);
    const isEdge = (index) => index < NAME_EDGE_WORDS || index >= words.length - NAME_EDGE_WORDS;
    const unigrams = words.map((word, index) => ({ text: word, edge: isEdge(index) }));
    // "planet bot" con espacio o con guion: tambien se prueba pegando las palabras de a dos
    const bigrams = words.slice(1).map((word, index) => ({ text: words[index] + word, edge: isEdge(index) || isEdge(index + 1) }));
    const isShortMessage = words.length <= NAME_CALL_MAX_WORDS;
    const reachable = (candidate) => isShortMessage || candidate.edge;
    if (full.some((name) => [...unigrams, ...bigrams].some((candidate) => reachable(candidate) && soundsLikeName(candidate.text, name)))) return true;

    return short.some((name) => unigrams.some((candidate) => candidate.edge && soundsLikeName(candidate.text, name)));
  }

  // saca de un texto las palabras con las que lo llamaron ("planetbot banea a @x por spam" ->
  // "banea a @x por spam"), con las mismas reglas que isCalledByName (el nombre corto solo en los extremos)
  function withoutNameCall(text, guild, config = null) {
    const { full, short } = nameTokens(guild, config);
    const tokens = String(text || '').split(/\s+/).filter(Boolean);
    const wordOf = (token) => readableWord(normalizeText(token).replace(/[^a-z0-9]/g, ''));
    const isEdge = (index) => index < NAME_EDGE_WORDS || index >= tokens.length - NAME_EDGE_WORDS;
    const dropped = new Set();
    tokens.forEach((token, index) => {
      const word = wordOf(token);
      if (!word) return;
      const isName = full.some((name) => soundsLikeName(word, name)) || (isEdge(index) && short.some((name) => soundsLikeName(word, name)));
      if (!isName) return;
      dropped.add(index);
      if (wordOf(tokens[index + 1] || '') === 'bot') dropped.add(index + 1); // "planet bot"
    });
    return tokens.filter((_, index) => !dropped.has(index)).join(' ');
  }

  function isFollowUpPing(message, session) {
    const last = session?.lastAddressed;
    if (!last || last.userId !== message.author.id || now() - last.at > PING_WINDOW_MS) return false;
    return PING_WORD.test(normalizeText(message.content).replace(/[^a-z0-9?]/g, ''));
  }

  // una imagen adjunta + "que opinan de mi render?": pide la opinion de quien lea, asi que cuenta
  // como hablarle al bot aunque no lo nombren. Una imagen sola (sin pedir nada) no
  function isOpinionRequestWithImage(message) {
    return findImageAttachments(message).length > 0 && OPINION_REQUEST.test(normalizeText(message.content));
  }

  function isDirectlyAddressed(message, session = null) {
    return (
      message.mentions.has(client.user.id, { ignoreEveryone: true, ignoreRoles: true }) ||
      message.mentions.repliedUser?.id === client.user.id ||
      isCalledByName(message, session?.config) ||
      isFollowUpPing(message, session)
    );
  }

  // sin sesion abierta: ¿esta persona lo llamo por su nombre (o pidio opinion de su trabajo)
  // en el canal de conversacion?
  function wantsToJoin(message, config) {
    return !message.author.bot && isEnabledFor(config, message.channel.id) && (isCalledByName(message, config) || isOpinionRequestWithImage(message));
  }

  // los otros nombres con los que lo conocen en el server ademas del que muestra Discord: la IA los
  // sabe para no desconcertarse cuando le dicen "planet" y su usuario es "CreatorBot"
  function aliasesFor(guild, config) {
    const main = botDisplayName(guild).toLowerCase();
    const names = [client.user.username, config?.branding?.nickname, BRAND_NAME].filter(Boolean);
    return [...new Set(names.filter((name) => name.toLowerCase() !== main))];
  }

  // texto de un mensaje tal como lo va a "leer" la IA: menciones con nombre
  // legible, sin saltos raros, y los temas prohibidos tapados
  function cleanText(message, config) {
    let text = message.content || '';
    const botName = botDisplayName(message.guild);
    for (const [id, user] of message.mentions?.users || []) {
      const name = id === client.user.id ? botName : message.mentions.members?.get(id)?.displayName || user.username;
      text = text.split(`<@${id}>`).join(`@${name}`).split(`<@!${id}>`).join(`@${name}`);
    }
    text = text.replace(/<@&\d+>/g, '@rol').replace(/<#\d+>/g, '#canal').replace(/\s+/g, ' ').trim();

    if (!isCreatorUser(message.author.id) && matchForbiddenTopic(text, config?.ai?.forbiddenTopics)) return '[mensaje omitido]';
    return text;
  }

  function describe(message, config) {
    let text = cleanText(message, config);
    if (text !== '[mensaje omitido]' && message.attachments?.size) {
      const withImage = findImageAttachments(message).length > 0;
      text = text ? `${text} ${withImage ? '[con imagen]' : '[con adjunto]'}` : withImage ? '[mandó una imagen]' : '[mandó un archivo]';
    }
    return text.slice(0, LINE_MAX);
  }

  // una linea de lo que "escucha" el bot: quien, que dijo y (si adjunto imagenes) cuales, para
  // poder opinar despues de "mi render" aunque la imagen haya llegado mensajes antes
  function transcriptEntry(message, config) {
    return {
      id: message.id,
      authorId: message.author.id,
      name: message.member?.displayName || message.author.username,
      text: describe(message, config),
      bot: false,
      images: findImageAttachments(message),
      at: message.createdTimestamp ?? now(),
    };
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
      .map((m) =>
        m.author.id === client.user.id
          ? {
              id: m.id,
              authorId: m.author.id,
              name: m.member?.displayName || m.author.username,
              text: String(m.content || '[mensaje del bot]').replace(/\s+/g, ' ').slice(0, LINE_MAX),
              bot: true,
            }
          : transcriptEntry(m, config),
      )
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

  // `exceptId`: el mensaje al que se esta contestando, cuando ya viaja aparte en el pedido.
  // `overrides`: { idDelMensaje: textoQueLeeLaIA } para cambiar lo que se ve de alguna linea
  function transcriptText(session, botName, lines = PROMPT_MESSAGES, exceptId = null, overrides = null) {
    return session.transcript
      .filter((entry) => entry.id !== exceptId)
      .slice(-lines)
      .map((entry) => `${entry.bot ? `${botName} (tú)` : entry.name}: ${overrides?.[entry.id] ?? entry.text}`)
      .join('\n');
  }

  // imagenes sobre las que hay que opinar: las que adjunto en este mensaje, las del mensaje al
  // que responde, o (si pregunta por "mi render" sin adjuntar nada) la ultima que mostro en la
  // charla — de la misma persona si hay, o de otra solo si fue hace un momento
  async function findWorkImages(session, message) {
    const own = findImageAttachments(message);
    if (own.length) return own;

    const replyTo = message.reference?.messageId;
    if (replyTo) {
      const referenced = message.channel?.messages?.cache?.get?.(replyTo) || (await message.fetchReference?.().catch(() => null));
      if (referenced && referenced.author?.id !== client.user.id) {
        const quoted = findImageAttachments(referenced);
        if (quoted.length) return quoted;
      }
    }

    const text = normalizeText(message.content);
    if (OPINION_REQUEST.test(text) && WORK_REFERENCE.test(text)) {
      const shown = session.transcript.filter((entry) => !entry.bot && entry.images?.length);
      const newerThan = (ms) => (entry) => now() - (entry.at ?? now()) <= ms;
      const pick = shown.filter((entry) => entry.authorId === message.author.id).filter(newerThan(RECENT_IMAGE_MS)).at(-1) || shown.filter(newerThan(RECENT_OTHERS_IMAGE_MS)).at(-1);
      if (pick) return pick.images;
    }
    return [];
  }

  // muestra "PlanetBot esta escribiendo..." mientras la IA piensa
  function showTyping(session) {
    session.channel.sendTyping?.().catch(() => {});
  }

  // el mensaje es solo un acuse ("ok", "vale", "jaja", "👍")? Si solo lo nombraron o hay una pregunta, no
  function isBareAcknowledgment(message, config) {
    const text = String(message.content || '').replace(/<a?:\w+:\w+>|<[@#][!&]?\w+>/g, ' ');
    const rest = withoutNameCall(text, message.guild, config).trim();
    if (!rest || /[?¿]/.test(rest)) return false;
    const words = normalizeText(rest).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return true; // solo emojis o signos
    return words.length <= ACK_MAX_WORDS && words.every((word) => ACK_WORDS.has(word) || LAUGH_WORD.test(word));
  }

  function lineWords(text) {
    return normalizeText(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  }

  // repite una frase corta suya reciente ("A su servicio.") ante algo que no era una pregunta?
  function repeatsRecentLine(session, text, message) {
    if (/[?¿]/.test(message.content || '')) return false;
    const words = lineWords(text);
    if (!words.length || words.length > REPEAT_MAX_WORDS) return false;
    const opening = words.slice(0, REPEAT_OPENING_WORDS).join(' ');
    return session.transcript.filter((entry) => entry.bot).slice(-REPEAT_LINES).some((entry) => {
      const earlier = lineWords(entry.text);
      return earlier.length <= REPEAT_MAX_WORDS && earlier.slice(0, REPEAT_OPENING_WORDS).join(' ') === opening;
    });
  }

  // lo ultimo que dijo el bot fue una pregunta? Entonces un "si" o un "ok" es la respuesta, no un acuse, y se contesta
  function botAskedLast(session) {
    const last = session.transcript.filter((entry) => entry.bot).at(-1);
    return Boolean(last && /[?¿]/.test(last.text) && session.transcript.slice(-3).includes(last));
  }

  // el "Pensando..." de index.js ya esta en el chat: si no hay nada que decir se borra en vez de dejarlo colgado
  async function dismissThinking(thinking) {
    if (!thinking) return;
    await thinking.stop('…');
    await Promise.resolve(thinking.message?.delete?.()).catch(() => {});
  }

  // pide la respuesta a la IA. Devuelve { text } (text vacio = se queda callado), { quiet: true } si
  // se calla a proposito (un acuse, repetir lo que ya dijo: no es un fallo y no se avisa de nada)
  // o { failed: true } si la IA no respondio
  async function generate(session, message, config, addressed) {
    const settings = settingsFor(config);
    const botName = botDisplayName(message.guild);
    const base = await getBaseContext(session, message, config);
    // el contexto del server se guarda por sesion, pero QUIEN pregunta cambia en cada mensaje
    const userName = addressed ? message.member?.displayName || message.author.username : null;
    // las excepciones de "creador" solo valen cuando es el creador quien le habla directo
    const isCreator = addressed && isCreatorUser(message.author.id);

    // le hablaron con una imagen (o sobre una): la mira de verdad y opina de ese trabajo
    const images = addressed ? await findWorkImages(session, message).catch(() => []) : [];
    if (images.length) return generateOpinion(session, message, config, { base, botName, userName, isCreator, images });

    // datos reales (roles, nivel, balance...) de quien pregunta, solo cuando le hablan a el
    const realData = addressed && buildRealDataForQuery ? await buildRealDataForQuery(message).catch(() => '') : '';
    // una pregunta tecnica ("como hago...", "por que no...") merece que piense un poco mas y
    // que pueda explayarse un poco mas (2-4 frases con el paso concreto)
    const deep = addressed && TECHNICAL_QUESTION.test(normalizeText(message.content));
    // si lo llamaron por su nombre ("plnet, como te llamas?"), el nombre se saca de lo que lee la IA:
    // con el nombre mal escrito se confundia y contestaba "aqui estoy" aunque hubiera una pregunta.
    // Si no queda nada ("planet?") se deja tal cual, porque ahi el nombre ES el mensaje
    const current = addressed && isCalledByName(message, config) ? session.transcript.find((entry) => entry.id === message.id) : null;
    const withoutName = current ? withoutNameCall(current.text, message.guild, config) : '';
    const overrides = /[\p{L}\p{N}]/u.test(withoutName) ? { [message.id]: withoutName } : null;
    let failure = null;
    const raw = await aiHelper.conversationReply(client, config, {
      ...base,
      botName,
      aliases: aliasesFor(message.guild, config),
      userName,
      realData,
      // lo que preguntan, sin la mencion ni el nombre: con eso se busca en la base de conocimiento del server
      knowledgeQuery: addressed ? withoutName || message.content : '',
      transcript: transcriptText(session, botName, PROMPT_MESSAGES, null, overrides),
      addressed,
      deep,
      chattiness: settings.chattiness,
      isCreator,
      onFailure: (info) => { failure = info; },
    });
    trackAiUsage(session.guildId, raw !== null && raw !== undefined);
    if (raw === null || raw === undefined) return { failed: true, rateLimited: Boolean(failure?.rateLimited) };
    const silent = SILENCE_TOKEN.test(raw);
    if (silent && !addressed) return { text: '' };
    const text = sanitizeReply(raw, botName, deep ? TECHNICAL_REPLY_MAX : REPLY_MAX);
    if (!text) {
      if (!silent) return { text: '' };
      // la IA eligio callar: ante un "ok" o alguien que copia sus palabras esta bien y no se avisa de nada, pero si le hicieron una pregunta
      // es un error del modelo y se avisa en vez de dejarlo mudo
      return /[?¿]/.test(message.content || '') ? { failed: true } : { text: '', quiet: true };
    }
    if (repeatsRecentLine(session, text, message)) return { text: '', quiet: true };
    return { text };
  }

  // opinion de un trabajo a partir de su imagen. Si no se pudo ver, se dice (no se opina a ciegas)
  async function generateOpinion(session, message, config, { base, botName, userName, isCreator, images }) {
    const request = cleanText(message, config);
    if (request === '[mensaje omitido]') return { text: 'No puedo hablar de ese tema.' };

    const result = await aiHelper.opinionOnWork(client, config, {
      ...base,
      botName,
      userName,
      isCreator,
      request: request.slice(0, 300),
      transcript: transcriptText(session, botName, OPINION_TRANSCRIPT_LINES, message.id),
      imageUrls: images.map((image) => image.url),
    });
    trackAiUsage(session.guildId, Boolean(result.ok));
    if (result.ok) return { text: sanitizeReply(result.text, botName, OPINION_REPLY_MAX) };
    if (result.reason === 'no-vision-access') return { text: NO_VISION_NOTICE };
    if (result.reason === 'bad-image') return { text: BAD_IMAGE_NOTICE };
    return { failed: true };
  }

  async function send(session, message, text, options) {
    const sent = await sendMessage(session, message, text, options);
    // el aviso de que algo fallo no se dice en voz alta; una respuesta de verdad, si
    if (sent && onReply && text !== FAILED_NOTICE && text !== RATE_LIMITED_NOTICE && text !== BAD_IMAGE_NOTICE) {
      try {
        Promise.resolve(onReply({ guild: session.channel?.guild || message?.guild, channel: session.channel, text, member: options.addressed ? message?.member : null })).catch(() => {});
      } catch { /* decir la respuesta en voz alta nunca debe romper la charla */ }
    }
    return sent;
  }

  async function sendMessage(session, message, text, { addressed, thinking }) {
    if (thinking) {
      const sent = await thinking.stop({ content: text, embeds: [], allowedMentions: { parse: [] } });
      return sent;
    }
    // cuando le hablaron directo, el "escribiendo..." ya se vio mientras la IA pensaba: no se
    // agrega otra espera. Solo cuando se suma por su cuenta simula el tipeo para no sonar a robot
    if (!addressed) {
      await session.channel.sendTyping?.().catch(() => {});
      await sleep(Math.min(pace.maxTypingMs, Math.max(pace.minTypingMs, text.length * pace.msPerChar)));
      if (session.ended) return null;
    }
    return session.channel.send({
      content: text,
      allowedMentions: { parse: [], repliedUser: false },
      ...(addressed ? { reply: { messageReference: message.id, failIfNotExists: false } } : {}),
    });
  }

  function recordBotMessage(session, sent, text) {
    session.replies += 1;
    session.lastBotAt = now();
    // se guarda recortado: una opinion larga viajaria completa en cada respuesta siguiente
    remember(session, { id: sent?.id || `bot-${session.replies}`, authorId: client.user.id, name: botDisplayName(null), text: text.slice(0, REPLY_MAX), bot: true });
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
      // una imagen suelta no se comenta si nadie lo pide: opinar sin verla seria inventar, y
      // verla en cada imagen gastaria la cuota de visión
      if (findImageAttachments(message).length) return;
      if (now() - session.lastBotAt < settings.minSecondsBetweenReplies * 1000) return;
      if (random() > CHATTINESS[settings.chattiness]) return;
    } else if (isBareAcknowledgment(message, config) && !botAskedLast(session)) {
      // "ok" o "👍" a algo que dijo el bot no pide respuesta
      return;
    }

    const lengthBefore = session.transcript.length;
    if (addressed) showTyping(session);
    const result = await generate(session, message, config, addressed);
    if (session.ended || result.quiet) return;
    if (result.failed || !result.text) {
      // si le hablaron a el, quedarse mudo parece que se colgo: se avisa en una linea
      if (addressed) await send(session, message, failureNotice(result), { addressed, thinking: null }).catch(() => {});
      return;
    }

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
    // si ya habia un mensaje dirigido a el esperando, uno comun que llegue despues no lo reemplaza
    // (antes se contestaba "a" la ultima persona que hablo, con sus datos y su nombre, en vez de a
    // quien le hablo de verdad) y se mantiene la espera corta de los mensajes directos
    const target = !addressed && session.pending?.addressed ? session.pending : { message, addressed };
    session.pending = target;
    const wait = target.addressed ? pace.addressedDelayMs : pace.passiveDelayMs + random() * pace.passiveJitterMs;
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
    remember(session, transcriptEntry(message, config));
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

    const direct = isDirectlyAddressed(message, session);
    const asksOpinion = !direct && isOpinionRequestWithImage(message);
    if (asksOpinion) {
      // pedir opinion de una imagen sin nombrar al bot esta permitido, pero no seguido: cada
      // persona puede hacerlo cada tanto para no llenar el canal (ni la cuota de visión)
      session.opinionAt ||= new Map();
      if (now() - (session.opinionAt.get(message.author.id) || 0) < OPINION_COOLDOWN_MS) return true;
      session.opinionAt.set(message.author.id, now());
    }
    const addressed = direct || asksOpinion;
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
      remember(session, transcriptEntry(message, config));
    }
    session.config = config;
    // si arranca la charla por un "que opinan de mi render?" sin nombrarlo, cuenta para el
    // descanso entre pedidos de opinion de esa persona (igual que en maybeReply)
    if (!isDirectlyAddressed(message, session) && isOpinionRequestWithImage(message)) {
      session.opinionAt ||= new Map();
      session.opinionAt.set(message.author.id, now());
    }
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
      // un acuse suelto ("ok") no pide respuesta
      if (isBareAcknowledgment(message, config) && !botAskedLast(session)) return dismissThinking(thinking);
      // con el "Pensando..." animado no hace falta el indicador de escribiendo
      if (!thinking) showTyping(session);
      const result = await generate(session, message, config, true);
      if (session.ended && !thinking) return;
      if (result.quiet) return dismissThinking(thinking);

      if (result.failed || !result.text) {
        if (thinking) await thinking.stop(failureNotice(result));
        else await session.channel.send({ content: failureNotice(result), allowedMentions: { parse: [] } }).catch(() => {});
        return;
      }
      const sent = await send(session, message, result.text, { addressed: true, thinking });
      recordBotMessage(session, sent, result.text);
    });
    session.chain = task.catch((err) => console.error('Error en el modo conversación:', err));
    await task;
    return true;
  }

  return { isEnabledFor, isActive, isCalledByName, withoutNameCall, wantsToJoin, observe, maybeReply, engage, sessions };
}

module.exports = { create, settingsFor, sanitizeReply, CHATTINESS, DEFAULT_SETTINGS, MAX_SESSIONS_PER_GUILD, STOP_PHRASE, SILENCE_TOKEN };
