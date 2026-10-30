const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { MongoClient, ObjectId } = require('mongodb');
const { DEFAULT_CARD, DEFAULT_GOODBYE_CARD } = require('./welcomeCard');

// algunos routers/ISPs no resuelven bien los registros SRV que necesita
// "mongodb+srv://"; forzamos un DNS publico solo para esta resolucion
dns.setServers(['8.8.8.8', '1.1.1.1']);

let client = null;
let db = null;

const defaultTips = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tips.json'), 'utf8'));
const defaultHelpData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'helpResponses.json'), 'utf8'),
);

function defaultConfig(guildId) {
  return {
    guildId,
    language: 'es',
    tipsIntervalMinutes: 20,
    tips: defaultTips,
    // canales donde el tip automatico NUNCA se manda, aunque sean el canal
    // mas activo en ese momento (ej. canales de staff, de bots, de tickets)
    tipsExcludedChannelIds: [],
    helpResponses: defaultHelpData,
    welcome: {
      enabled: false,
      channelId: null,
      message: '👋 ¡Bienvenido/a {user} al server! Ya somos {membercount} en {server}.',
      roleId: null,
      useEmbed: false,
      // si esta activo (y la IA esta configurada), en vez del mensaje fijo de
      // arriba, la IA redacta una bienvenida distinta para cada persona. Si
      // la IA falla o no esta configurada, usa el mensaje fijo como respaldo
      aiPersonalized: false,
      embedTitle: '👋 ¡Nuevo miembro!',
      // banner grande del embed (URL de una imagen ya subida a otro lado,
      // ej. Discord CDN o Imgur) — el dashboard no tiene almacenamiento
      // persistente para guardar archivos subidos
      imageUrl: null,
      // rol que se le da a los BOTS que entran (los humanos usan roleId)
      botRoleId: null,
      // id de un mensaje avanzado (coleccion richMessages) que reemplaza al
      // texto/embed/tarjeta de arriba; null = usar el mensaje normal
      richMessageId: null,
      // tarjeta de imagen (canvas) que se manda junto al mensaje; el fondo,
      // colores, estilo y textos se editan desde el dashboard
      card: { ...DEFAULT_CARD },
    },
    goodbye: {
      enabled: false,
      channelId: null,
      message: '👋 {username} se fue de {server}.',
      useEmbed: false,
      card: { ...DEFAULT_GOODBYE_CARD },
    },
    automod: {
      enabled: false,
      bannedWords: [],
      blockInvites: false,
      mentionSpamLimit: 5,
      // si esta activo (y la IA esta configurada), cuando el filtro borra un
      // mensaje se le pide a la IA una evaluacion de contexto/severidad para
      // el canal de logs — nunca ejecuta ninguna accion, solo avisa al staff
      aiAssist: false,
    },
    leveling: {
      enabled: false,
      xpMin: 15,
      xpMax: 25,
      cooldownSeconds: 60,
      levelUpChannelId: null,
      levelRoles: [],
      voiceXpEnabled: false,
      voiceXpPerMinute: 2,
    },
    logging: {
      enabled: false,
      channelId: null,
      logDeletes: true,
      logEdits: true,
      logJoins: true,
      logModeration: true,
    },
    customCommands: [],
    // equivalente en texto de los comandos slash mas usados (ej "!balance"),
    // para servers que prefieren el estilo de prefijo clasico
    textCommands: {
      enabled: true,
      prefix: '!',
    },
    houses: {
      enabled: false,
      requestChannelId: null,
      requestTitle: "SOLICITA UNA Artist's House 🚀",
      requestDescription: 'Si querés tener tu propio espacio para mostrar tu arte, apretá el botón y completá el formulario.',
      requestMessageId: null,
      reviewChannelId: null,
      formFields: ['Nombre artístico', 'Portafolio (link)', 'Por qué querés tu house'],
      acceptMessage: '🎉 ¡Tu solicitud de House fue aceptada! El staff se va a poner en contacto para darte tu canal.',
      rejectMessage: '😕 Tu solicitud de House no fue aceptada esta vez. Podés volver a intentarlo más adelante.',
    },
    // roles reales del server que cuentan como "skill" para /skills — un
    // miembro se auto-etiqueta con estos, y otros pueden buscar quien tiene
    // cual skill. Ningun dato inventado: son roles reales de Discord
    skills: {
      enabled: false,
      roleIds: [],
    },
    economy: {
      enabled: false,
      currencyName: 'monedas',
      currencySymbol: '🪙',
      dailyAmount: 100,
      workMinAmount: 20,
      workMaxAmount: 80,
      workCooldownMinutes: 60,
      shopItems: [],
    },
    casino: {
      enabled: false,
      minBet: 10,
      maxBet: 1000,
    },
    pets: {
      enabled: false,
      feedCooldownMinutes: 120,
      playCooldownMinutes: 60,
    },
    // acciones con gif (/accion), reputacion, y los comandos de riesgo que
    // mueven monedas (/robar, /crimen), apagados por defecto
    social: {
      enabled: true,
      repEnabled: true,
      repCooldownHours: 12,
      robEnabled: false,
      robCooldownMinutes: 60,
      robMaxAmount: 500,
      robSuccessPercent: 45,
      crimeEnabled: false,
      crimeCooldownMinutes: 120,
      crimeMinAmount: 50,
      crimeMaxAmount: 250,
      crimeSuccessPercent: 50,
    },
    // minijuegos (/juego): partidas entre dos con apuesta opcional y juegos
    // colaborativos con recompensa
    games: {
      enabled: true,
      rewardAmount: 50,
      maxBet: 500,
      rewardCooldownMinutes: 2,
    },
    // alertas de YouTube/Twitch; cada item es {id, platform, target, name,
    // channelId, roleId, message, seenIds, lastStreamId}
    alerts: {
      enabled: false,
      items: [],
    },
    ticketCategories: [
      {
        id: 'general',
        label: 'Soporte general',
        emoji: '🎫',
        description: 'Cualquier duda o problema que no entre en otra categoría.',
        staffRoleIds: [],
      },
    ],
    // varios paneles independientes: cada uno se publica en su propio canal,
    // con su propio embed y su propio subconjunto de categorias (categoryIds
    // vacio = todas las categorias de ticketCategories)
    ticketPanels: [],
    // roles que ven TODOS los tickets sin importar la categoria (se suman a
    // los staffRoleIds especificos de cada categoria, no los reemplazan)
    ticketDefaultStaffRoleIds: [],
    ticketTranscripts: {
      enabled: false,
      channelId: null,
    },
    ticketFeedback: {
      enabled: false,
    },
    starboard: {
      enabled: false,
      emoji: '⭐',
      threshold: 3,
      channelId: null,
    },
    trivia: {
      enabled: false,
      rewardAmount: 50,
      questions: [
        {
          question: '¿Cuál es el planeta más grande del sistema solar?',
          options: ['Marte', 'Júpiter', 'Saturno', 'Tierra'],
          correctIndex: 1,
        },
      ],
    },
    miniEvents: {
      enabled: false,
      intervalMinutes: 120,
      reward: 30,
      channelId: null,
    },
    ai: {
      enabled: false,
      helpFallback: true,
      apiKey: '',
      // legacy: un solo canal. Se mantiene por compatibilidad con configs
      // viejas, pero el dashboard ahora escribe en channelIds (multiple).
      // Si channelIds tiene algo, channelId se ignora.
      channelId: null,
      // si tiene algo, la IA (respuesta de ayuda con IA + charla al
      // mencionarla) solo funciona en esos canales; en el resto del server
      // no responde nada de IA (los comandos, respuestas pre-guardadas, tips
      // y advertencias siguen andando en todos los canales igual). Vacio =
      // sin restriccion, responde en todos los canales
      channelIds: [],
      // amigable (default), formal o gracioso — se inyecta en el prompt
      tone: 'amigable',
      // texto libre opcional que se suma a las instrucciones de tono (ej:
      // "sos sarcastico pero nunca ofensivo", "hablá como pirata")
      customPersonality: '',
      // temas/palabras que la IA nunca debe tocar. Se bloquean ANTES de
      // llamar a Groq (no depende de que el modelo respete la instruccion)
      forbiddenTopics: [],
      // segundos de cooldown por usuario entre pedidos a la IA
      cooldownSeconds: 8,
      // roles etiquetados para que la IA sepa "quien es quien" (ej: rol de
      // Owner/CEO, rol de Staff, rol de Helper). Cada item: { roleId, label }.
      // Los miembros reales con ese rol se resuelven en vivo, no se guardan
      // nombres aca (para no desactualizarse)
      staffRoleTags: [],
      // IDs de Discord de quienes pueden pedirle a la IA por chat que
      // banee/expulse/silencie/advierta (ademas del creador del bot via
      // CREATOR_USER_ID). Vacio = nadie puede usar esto por chat todavia
      // (se sigue pudiendo moderar con los comandos normales)
      staffUserIds: [],
      // resumen automatico (diario o semanal) publicado en un canal, armado
      // con datos reales del server y redactado por la IA. lastSentAt lo
      // actualiza el bot solo, no se toca desde el dashboard
      digest: {
        enabled: false,
        channelId: null,
        frequency: 'daily', // 'daily' o 'weekly'
        lastSentAt: null,
      },
      // feedback tecnico de renders: alguien reacciona con este emoji a un
      // mensaje con imagen en uno de estos canales, y la IA (con un modelo
      // con vision, si la cuenta de Groq tiene acceso) da feedback real
      // sobre la imagen puntual
      renderFeedback: {
        enabled: false,
        channelIds: [],
        emoji: '🔍',
      },
    },
    serverGuide: {
      enabled: false,
      channelId: null,
      messageId: null,
      title: '📖 Guía del servidor',
      description: '¡Bienvenido! Elegí una categoría para ver toda la información.',
      sections: [
        { id: 'canales', label: 'Uso de canales', emoji: '✅', content: 'Contame para qué sirve cada canal de tu server.' },
        { id: 'comandos', label: 'Comandos', emoji: '🤖', content: 'Lista los comandos más importantes del bot acá.' },
        { id: 'publicar', label: 'Publicar y promocionar', emoji: '📢', content: 'Contame dónde y cómo se puede publicar o promocionar contenido en tu server.' },
        { id: 'staff', label: 'Staff', emoji: '🔴', content: 'Contame quién es el staff y cómo contactarlo.' },
      ],
    },
    debug: {
      enabled: false,
      errorChannelId: null,
    },
    // controla quien puede entrar al dashboard de este server (ademas de
    // necesitar "Administrar servidor" en Discord) y protege la pagina
    // Estado/Debug (donde se edita esto) con una contraseña aparte, guardada
    // como hash+salt (nunca en texto plano). El dueño real del server
    // (guild.ownerId) nunca queda bloqueado, para no arriesgarse a un
    // lockout por una lista mal configurada
    dashboardAccess: {
      passwordHash: '',
      passwordSalt: '',
      allowedUserIds: [],
      blockedUserIds: [],
    },
    branding: {
      colors: {
        brand: '#5865f2',
        success: '#3ba55d',
        error: '#ed4245',
        warning: '#f0b232',
        info: '#5865f2',
      },
      footerText: '',
      footerIcon: '',
      nickname: '',
    },
    suggestions: {
      enabled: false,
      channelId: null,
      approvalRoleIds: [],
      anonymous: false,
    },
    memberCounter: {
      enabled: false,
      channelId: null,
      template: '📊 Miembros: {count}',
    },
    birthdays: {
      enabled: false,
      channelId: null,
      message: '🎂 ¡Hoy es el cumpleaños de {user}! 🎉',
    },
    inviteTracker: {
      enabled: false,
      channelId: null,
    },
    updatedAt: new Date(),
  };
}

async function ensureIndexes(database) {
  // el limite de "un ticket abierto" paso de ser por usuario (guildId+userId) a
  // ser por usuario+categoria (guildId+userId+categoryId), para permitir tener
  // varios tickets abiertos a la vez si son de categorias distintas. El indice
  // viejo se borra primero porque un indice con distinta clave no reemplaza al
  // anterior, solo se suma, y el viejo seguiria bloqueando el segundo ticket
  try {
    await database.collection('tickets').dropIndex('guildId_1_userId_1');
  } catch (err) {
    if (err.codeName !== 'IndexNotFound') console.error('No se pudo borrar el índice viejo de tickets:', err.message);
  }

  // indices unicos: aceleran las consultas mas frecuentes (antes escaneaban toda
  // la coleccion) y evitan documentos duplicados por condiciones de carrera
  // (dos inserts casi simultaneos del mismo guild/usuario antes de que exista el doc)
  const tasks = [
    database.collection('guildConfig').createIndex({ guildId: 1 }, { unique: true }),
    database.collection('economy').createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    database.collection('levels').createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    database.collection('pets').createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    database.collection('afk').createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    database.collection('birthdays').createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    database.collection('marriages').createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    database.collection('warnings').createIndex({ guildId: 1, userId: 1 }),
    database.collection('tickets').createIndex(
      { guildId: 1, userId: 1, categoryId: 1 },
      { unique: true, partialFilterExpression: { status: 'open' } },
    ),
    database.collection('inviteJoins').createIndex({ guildId: 1, inviterId: 1 }),
    database.collection('richMessages').createIndex({ guildId: 1, id: 1 }, { unique: true }),
  ];

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') console.error('No se pudo crear un índice de MongoDB:', result.reason.message);
  }
}

async function connect() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Falta MONGODB_URI en el archivo .env');
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB_NAME || 'discordTipsBot');
  await ensureIndexes(db);
  return db;
}

async function getGuildConfig(guildId) {
  const database = await connect();
  const configs = database.collection('guildConfig');

  let config = await configs.findOne({ guildId });
  if (!config) {
    config = defaultConfig(guildId);
    await configs.insertOne(config);
  }

  // completa campos nuevos para configs guardadas antes de que existieran
  const defaults = defaultConfig(guildId);
  config.leveling = { ...defaults.leveling, ...(config.leveling || {}) };
  config.logging = { ...defaults.logging, ...(config.logging || {}) };
  config.houses = { ...defaults.houses, ...(config.houses || {}) };
  config.customCommands = config.customCommands || [];
  config.textCommands = { ...defaults.textCommands, ...(config.textCommands || {}) };
  config.tipsExcludedChannelIds = config.tipsExcludedChannelIds || [];
  config.skills = { ...defaults.skills, ...(config.skills || {}) };
  config.ticketDefaultStaffRoleIds = config.ticketDefaultStaffRoleIds || [];
  config.economy = { ...defaults.economy, ...(config.economy || {}) };
  config.casino = { ...defaults.casino, ...(config.casino || {}) };
  config.pets = { ...defaults.pets, ...(config.pets || {}) };
  config.ticketCategories = config.ticketCategories || defaults.ticketCategories;
  // migracion: guilds guardadas antes de que existieran varios paneles tenian
  // un unico "ticketPanel" (objeto); se convierte en un array de un elemento
  // la primera vez que se lee, sin perder lo que ya estaba configurado/publicado
  if (!Array.isArray(config.ticketPanels) || !config.ticketPanels.length) {
    const legacy = config.ticketPanel;
    config.ticketPanels = legacy && legacy.channelId
      ? [
          {
            id: 'panel-1',
            channelId: legacy.channelId,
            messageId: legacy.messageId || null,
            title: legacy.title || '🎫 Centro de soporte',
            description: legacy.description || 'Elegí abajo el tipo de ticket que necesitás para que el staff te ayude.',
            categoryChannelId: legacy.categoryChannelId || null,
            categoryIds: [],
            style: 'select',
          },
        ]
      : [];
  }
  config.ticketPanels = config.ticketPanels.map((p) => ({
    id: p.id,
    channelId: p.channelId || null,
    messageId: p.messageId || null,
    title: p.title || '🎫 Centro de soporte',
    description: p.description || '',
    categoryChannelId: p.categoryChannelId || null,
    categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds : [],
    style: p.style === 'button' ? 'button' : 'select',
  }));
  config.ticketTranscripts = { ...defaults.ticketTranscripts, ...(config.ticketTranscripts || {}) };
  config.ticketFeedback = { ...defaults.ticketFeedback, ...(config.ticketFeedback || {}) };
  config.starboard = { ...defaults.starboard, ...(config.starboard || {}) };
  config.trivia = { ...defaults.trivia, ...(config.trivia || {}) };
  config.miniEvents = { ...defaults.miniEvents, ...(config.miniEvents || {}) };
  config.ai = { ...defaults.ai, ...(config.ai || {}) };
  config.serverGuide = { ...defaults.serverGuide, ...(config.serverGuide || {}) };
  config.welcome = { ...defaults.welcome, ...(config.welcome || {}) };
  config.goodbye = { ...defaults.goodbye, ...(config.goodbye || {}) };
  config.welcome.card = { ...defaults.welcome.card, ...(config.welcome.card || {}) };
  config.goodbye.card = { ...defaults.goodbye.card, ...(config.goodbye.card || {}) };
  config.social = { ...defaults.social, ...(config.social || {}) };
  config.games = { ...defaults.games, ...(config.games || {}) };
  config.alerts = { ...defaults.alerts, ...(config.alerts || {}), items: Array.isArray(config.alerts?.items) ? config.alerts.items : [] };
  config.debug = { ...defaults.debug, ...(config.debug || {}) };
  config.dashboardAccess = { ...defaults.dashboardAccess, ...(config.dashboardAccess || {}) };
  config.branding = { ...defaults.branding, ...(config.branding || {}), colors: { ...defaults.branding.colors, ...(config.branding?.colors || {}) } };
  config.suggestions = { ...defaults.suggestions, ...(config.suggestions || {}) };
  config.memberCounter = { ...defaults.memberCounter, ...(config.memberCounter || {}) };
  config.birthdays = { ...defaults.birthdays, ...(config.birthdays || {}) };
  config.inviteTracker = { ...defaults.inviteTracker, ...(config.inviteTracker || {}) };

  return config;
}

async function updateGuildConfig(guildId, partialUpdate) {
  const database = await connect();
  const configs = database.collection('guildConfig');

  await configs.updateOne(
    { guildId },
    { $set: { ...partialUpdate, updatedAt: new Date() } },
    { upsert: true },
  );

  return getGuildConfig(guildId);
}

async function incrementMessageStat(guildId, channelId) {
  const database = await connect();
  await database.collection('stats').updateOne(
    { guildId },
    {
      $inc: { totalMessages: 1, [`channelMessageCounts.${channelId}`]: 1 },
      $set: { updatedAt: new Date() },
    },
    { upsert: true },
  );
}

// contador simple de uso de la IA (cuantas veces respondio bien vs fallo),
// para tener visibilidad en el dashboard de cuanto se usa
async function incrementAiUsage(guildId, success) {
  const database = await connect();
  await database.collection('aiUsage').updateOne(
    { guildId },
    {
      $inc: success ? { successCount: 1 } : { failCount: 1 },
      $set: { lastUsedAt: new Date() },
    },
    { upsert: true },
  );
}

async function getAiUsageStats(guildId) {
  const database = await connect();
  const stats = await database.collection('aiUsage').findOne({ guildId });
  return {
    successCount: stats?.successCount || 0,
    failCount: stats?.failCount || 0,
    lastUsedAt: stats?.lastUsedAt || null,
  };
}

async function getStats(guildId) {
  const database = await connect();
  const stats = await database.collection('stats').findOne({ guildId });
  const openTickets = await database.collection('tickets').countDocuments({ guildId, status: 'open' });
  const closedTickets = await database.collection('tickets').countDocuments({ guildId, status: 'closed' });

  return {
    totalMessages: stats ? stats.totalMessages || 0 : 0,
    channelMessageCounts: stats ? stats.channelMessageCounts || {} : {},
    openTickets,
    closedTickets,
  };
}

async function getNextTicketNumber(guildId) {
  const database = await connect();
  const result = await database
    .collection('ticketCounters')
    .findOneAndUpdate({ guildId }, { $inc: { next: 1 } }, { upsert: true, returnDocument: 'after' });
  const doc = result && result.value !== undefined ? result.value : result;
  return doc.next;
}

// protegido por un indice unico parcial en {guildId, userId, categoryId} con
// status:'open': si el usuario ya tiene un ticket abierto de esa misma
// categoria (por una segunda invocacion casi simultanea), el insert falla con
// codigo 11000 en vez de crear un duplicado; puede tener tickets abiertos de
// categorias distintas al mismo tiempo sin problema
async function createTicket({ guildId, channelId, userId, categoryId, categoryLabel, number }) {
  const database = await connect();
  try {
    await database.collection('tickets').insertOne({
      guildId,
      channelId,
      userId,
      categoryId: categoryId || null,
      categoryLabel: categoryLabel || null,
      number,
      status: 'open',
      claimedBy: null,
      rating: null,
      createdAt: new Date(),
      closedAt: null,
      closedBy: null,
    });
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

async function claimTicket({ channelId, claimedBy }) {
  const database = await connect();
  await database.collection('tickets').updateOne({ channelId, status: 'open' }, { $set: { claimedBy } });
}

async function closeTicket({ channelId, closedBy }) {
  const database = await connect();
  await database.collection('tickets').updateOne(
    { channelId, status: 'open' },
    { $set: { status: 'closed', closedAt: new Date(), closedBy } },
  );
  return database.collection('tickets').findOne({ channelId });
}

async function rateTicket(ticketId, rating) {
  const database = await connect();
  await database.collection('tickets').updateOne({ _id: new ObjectId(ticketId) }, { $set: { rating } });
}

async function getTicketByChannelId(channelId) {
  const database = await connect();
  return database.collection('tickets').findOne({ channelId });
}

async function listTickets(guildId, status) {
  const database = await connect();
  const query = status ? { guildId, status } : { guildId };
  return database.collection('tickets').find(query).sort({ createdAt: -1 }).limit(100).toArray();
}

async function countUserTickets(guildId, userId) {
  const database = await connect();
  return database.collection('tickets').countDocuments({ guildId, userId });
}

// --- Niveles / XP ---

// xp necesaria para pasar de "level" al siguiente
function xpRequiredForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

function levelInfoFromXp(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpRequiredForLevel(level)) {
    remaining -= xpRequiredForLevel(level);
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: xpRequiredForLevel(level) };
}

async function addXp(guildId, userId, amount) {
  const database = await connect();
  const levels = database.collection('levels');

  const before = await levels.findOne({ guildId, userId });
  const previousLevel = before ? levelInfoFromXp(before.xp || 0).level : 0;

  await levels.updateOne(
    { guildId, userId },
    { $inc: { xp: amount }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );

  const after = await levels.findOne({ guildId, userId });
  const newLevel = levelInfoFromXp(after.xp).level;

  return { xp: after.xp, level: newLevel, leveledUp: newLevel > previousLevel };
}

async function getUserLevel(guildId, userId) {
  const database = await connect();
  const doc = await database.collection('levels').findOne({ guildId, userId });
  const xp = doc ? doc.xp : 0;
  return { xp, ...levelInfoFromXp(xp) };
}

async function getLeaderboard(guildId, limit = 10) {
  const database = await connect();
  return database.collection('levels').find({ guildId }).sort({ xp: -1 }).limit(limit).toArray();
}

async function getUserRank(guildId, userId) {
  const database = await connect();
  const levels = database.collection('levels');
  const doc = await levels.findOne({ guildId, userId });
  if (!doc || !doc.xp) return null;
  const higherCount = await levels.countDocuments({ guildId, xp: { $gt: doc.xp } });
  return higherCount + 1;
}

// --- Roles por reaccion ---

async function createReactionRoleSet({ guildId, channelId, messageId, pairs }) {
  const database = await connect();
  await database.collection('reactionRoleSets').insertOne({
    guildId,
    channelId,
    messageId,
    pairs,
    createdAt: new Date(),
  });
}

async function getReactionRoleSet(messageId) {
  const database = await connect();
  return database.collection('reactionRoleSets').findOne({ messageId });
}

async function listReactionRoleSets(guildId) {
  const database = await connect();
  return database.collection('reactionRoleSets').find({ guildId }).sort({ createdAt: -1 }).toArray();
}

async function deleteReactionRoleSet(messageId) {
  const database = await connect();
  await database.collection('reactionRoleSets').deleteOne({ messageId });
}

async function createSelectRoleSet({ guildId, channelId, messageId, title, description, placeholder, options }) {
  const database = await connect();
  await database.collection('selectRoleSets').insertOne({
    guildId,
    channelId,
    messageId,
    title,
    description,
    placeholder,
    options,
    createdAt: new Date(),
  });
}

async function getSelectRoleSet(messageId) {
  const database = await connect();
  return database.collection('selectRoleSets').findOne({ messageId });
}

async function updateSelectRoleSet(messageId, fields) {
  const database = await connect();
  await database.collection('selectRoleSets').updateOne({ messageId }, { $set: fields });
}

async function listSelectRoleSets(guildId) {
  const database = await connect();
  return database.collection('selectRoleSets').find({ guildId }).sort({ createdAt: -1 }).toArray();
}

async function deleteSelectRoleSet(messageId) {
  const database = await connect();
  await database.collection('selectRoleSets').deleteOne({ messageId });
}

// --- Advertencias (warnings) ---

async function addWarning({ guildId, userId, moderatorId, reason }) {
  const database = await connect();
  await database.collection('warnings').insertOne({
    guildId,
    userId,
    moderatorId,
    reason,
    createdAt: new Date(),
  });
}

async function listWarnings(guildId, userId) {
  const database = await connect();
  return database.collection('warnings').find({ guildId, userId }).sort({ createdAt: -1 }).toArray();
}

// --- Solicitudes de House ---

async function createHouseApplication({ guildId, userId, answers }) {
  const database = await connect();
  const result = await database.collection('houseApplications').insertOne({
    guildId,
    userId,
    answers,
    status: 'pending',
    createdAt: new Date(),
    decidedAt: null,
    decidedBy: null,
  });
  return result.insertedId;
}

// solo aplica la decision si la solicitud todavia estaba pendiente; devuelve
// false si ya la habian decidido (dos miembros del staff clickeando a la vez)
async function decideHouseApplication(applicationId, { status, decidedBy }) {
  const database = await connect();
  const result = await database
    .collection('houseApplications')
    .findOneAndUpdate(
      { _id: new ObjectId(applicationId), status: 'pending' },
      { $set: { status, decidedAt: new Date(), decidedBy } },
    );
  const matched = result?.value !== undefined ? result.value : result;
  return matched !== null;
}

async function getHouseApplication(applicationId) {
  const database = await connect();
  return database.collection('houseApplications').findOne({ _id: new ObjectId(applicationId) });
}

async function getHouseApplicationStats(guildId) {
  const database = await connect();
  const collection = database.collection('houseApplications');
  const [pending, accepted, rejected] = await Promise.all([
    collection.countDocuments({ guildId, status: 'pending' }),
    collection.countDocuments({ guildId, status: 'accepted' }),
    collection.countDocuments({ guildId, status: 'rejected' }),
  ]);
  return { pending, accepted, rejected };
}

// --- Economia ---

async function getEconomyAccount(guildId, userId) {
  const database = await connect();
  const accounts = database.collection('economy');

  let account = await accounts.findOne({ guildId, userId });
  if (!account) {
    account = { guildId, userId, balance: 0, inventory: [], lastDaily: null, lastWork: null };
    try {
      await accounts.insertOne(account);
    } catch (err) {
      // otra llamada concurrente ya creo la cuenta (indice unico guildId+userId); la leemos
      if (err.code !== 11000) throw err;
      account = await accounts.findOne({ guildId, userId });
    }
  }
  return account;
}

async function addBalance(guildId, userId, amount) {
  await getEconomyAccount(guildId, userId);
  const database = await connect();
  await database.collection('economy').updateOne({ guildId, userId }, { $inc: { balance: amount } });
  const updated = await database.collection('economy').findOne({ guildId, userId });
  return updated.balance;
}

// resta `amount` solo si el saldo alcanza, de forma atomica (evita que dos
// gastos concurrentes lean el mismo saldo viejo y ambos pasen la validacion)
async function spendBalance(guildId, userId, amount) {
  // un monto negativo con $gte pasaria siempre y acreditaria saldo en vez de cobrarlo
  if (!Number.isFinite(amount) || amount < 0) return false;
  await getEconomyAccount(guildId, userId);
  const database = await connect();
  const result = await database
    .collection('economy')
    .findOneAndUpdate({ guildId, userId, balance: { $gte: amount } }, { $inc: { balance: -amount } });
  const matched = result?.value !== undefined ? result.value : result;
  return matched !== null;
}

async function setEconomyCooldown(guildId, userId, field, date) {
  const database = await connect();
  await database.collection('economy').updateOne({ guildId, userId }, { $set: { [field]: date } }, { upsert: true });
}

// reclama una recompensa de cooldown (daily/work) de forma atomica: solo si el
// campo de cooldown ya expiro, en la misma operacion que acredita el monto.
// evita el doble cobro por spam-click antes de que el primer pedido termine de escribir
async function claimEconomyCooldown(guildId, userId, field, cooldownMs, amount) {
  await getEconomyAccount(guildId, userId);
  const database = await connect();
  const cutoff = new Date(Date.now() - cooldownMs);
  const result = await database.collection('economy').findOneAndUpdate(
    { guildId, userId, $or: [{ [field]: null }, { [field]: { $lte: cutoff } }] },
    { $set: { [field]: new Date() }, $inc: { balance: amount } },
  );
  const matched = result?.value !== undefined ? result.value : result;
  return matched !== null;
}

async function transferBalance(guildId, fromUserId, toUserId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const spent = await spendBalance(guildId, fromUserId, amount);
  if (!spent) return false;
  try {
    await addBalance(guildId, toUserId, amount);
  } catch (err) {
    // si falla el abono, se devuelve lo descontado en vez de perder el dinero
    await addBalance(guildId, fromUserId, amount).catch((refundErr) => console.error('No se pudo devolver una transferencia fallida:', refundErr));
    throw err;
  }
  return true;
}

// +1 al contador si el item ya esta en el inventario, si no lo agrega; ambas
// ramas son operaciones atomicas de Mongo (antes se leia el inventario entero
// y se reescribia, y dos compras simultaneas se pisaban)
async function addInventoryItem(guildId, userId, item) {
  await getEconomyAccount(guildId, userId);
  const database = await connect();
  const accounts = database.collection('economy');

  const increment = () =>
    accounts.updateOne({ guildId, userId, 'inventory.itemId': item.itemId }, { $inc: { 'inventory.$.quantity': 1 } });

  if ((await increment()).matchedCount > 0) return;

  const pushed = await accounts.updateOne(
    { guildId, userId, 'inventory.itemId': { $ne: item.itemId } },
    { $push: { inventory: { itemId: item.itemId, name: item.name, quantity: 1 } } },
  );
  // otra compra del mismo item gano la carrera y ya lo agrego: sumamos encima
  if (pushed.matchedCount === 0) await increment();
}

async function addReputation(guildId, userId) {
  await getEconomyAccount(guildId, userId);
  const database = await connect();
  await database.collection('economy').updateOne({ guildId, userId }, { $inc: { rep: 1 } });
  const updated = await database.collection('economy').findOne({ guildId, userId });
  return updated.rep || 0;
}

// --- Mensajes avanzados (editor del dashboard) ---

const MAX_RICH_MESSAGES_PER_GUILD = 25;

async function listRichMessages(guildId) {
  const database = await connect();
  return database.collection('richMessages').find({ guildId }).sort({ updatedAt: -1 }).toArray();
}

async function getRichMessage(guildId, id) {
  const database = await connect();
  return database.collection('richMessages').findOne({ guildId, id });
}

async function countRichMessages(guildId) {
  const database = await connect();
  return database.collection('richMessages').countDocuments({ guildId });
}

// crea o actualiza; los datos de publicacion (messageId/publishedChannelId) se
// conservan al editar el diseño
async function saveRichMessage(guildId, { id, name, channelId, containers }) {
  const database = await connect();
  await database.collection('richMessages').updateOne(
    { guildId, id },
    {
      $set: { name, channelId: channelId || null, containers, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date(), messageId: null, publishedChannelId: null },
    },
    { upsert: true },
  );
}

async function setRichMessagePublished(guildId, id, publishedChannelId, messageId) {
  const database = await connect();
  await database.collection('richMessages').updateOne({ guildId, id }, { $set: { publishedChannelId, messageId, publishedAt: new Date() } });
}

async function deleteRichMessage(guildId, id) {
  const database = await connect();
  const result = await database.collection('richMessages').deleteOne({ guildId, id });
  return result.deletedCount > 0;
}

// --- Alertas (YouTube / Twitch) ---
// se tocan con operadores puntuales ($push/$pull/posicional) y no reescribiendo
// el array completo, asi lo que guarda el dashboard y lo que guarda el chequeo
// periodico (ultimo video visto) no se pisan entre si

async function addAlertItem(guildId, item) {
  const database = await connect();
  await database.collection('guildConfig').updateOne({ guildId }, { $push: { 'alerts.items': item }, $set: { updatedAt: new Date() } });
}

async function removeAlertItem(guildId, itemId) {
  const database = await connect();
  await database.collection('guildConfig').updateOne({ guildId }, { $pull: { 'alerts.items': { id: itemId } }, $set: { updatedAt: new Date() } });
}

async function updateAlertState(guildId, itemId, fields) {
  const database = await connect();
  const set = Object.fromEntries(Object.entries(fields).map(([key, value]) => [`alerts.items.$.${key}`, value]));
  await database.collection('guildConfig').updateOne({ guildId, 'alerts.items.id': itemId }, { $set: set });
}

async function getEconomyLeaderboard(guildId, limit = 10) {
  const database = await connect();
  return database.collection('economy').find({ guildId }).sort({ balance: -1 }).limit(limit).toArray();
}

// --- Matrimonios ---

// se guarda un documento por cada miembro de la pareja (userId + partnerId),
// protegido por un indice unico en {guildId, userId}: si alguno de los dos ya
// esta casado, el insert de su documento falla con codigo 11000 en vez de
// dejar pasar una doble aceptacion simultanea (dos "Aceptar" casi a la vez)
async function getMarriage(guildId, userId) {
  const database = await connect();
  const doc = await database.collection('marriages').findOne({ guildId, userId });
  if (!doc) return null;
  return { guildId, user1Id: doc.userId, user2Id: doc.partnerId, marriedAt: doc.marriedAt };
}

async function createMarriage(guildId, user1Id, user2Id) {
  const database = await connect();
  const marriages = database.collection('marriages');
  const marriedAt = new Date();

  try {
    await marriages.insertOne({ guildId, userId: user1Id, partnerId: user2Id, marriedAt });
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }

  try {
    await marriages.insertOne({ guildId, userId: user2Id, partnerId: user1Id, marriedAt });
  } catch (err) {
    // el otro lado ya quedo casado con alguien mas mientras tanto: deshacemos el primero
    await marriages.deleteOne({ guildId, userId: user1Id, partnerId: user2Id });
    if (err.code === 11000) return false;
    throw err;
  }

  return true;
}

async function deleteMarriage(guildId, userId) {
  const database = await connect();
  const doc = await database.collection('marriages').findOne({ guildId, userId });
  if (!doc) return;
  await database.collection('marriages').deleteMany({ guildId, $or: [{ userId }, { userId: doc.partnerId }] });
}

// --- Mascotas ---

function petXpRequiredForLevel(level) {
  return 3 * level * level + 30 * level + 60;
}

function petLevelInfoFromXp(totalXp) {
  let level = 1;
  let remaining = totalXp;
  while (remaining >= petXpRequiredForLevel(level)) {
    remaining -= petXpRequiredForLevel(level);
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: petXpRequiredForLevel(level) };
}

async function getPet(guildId, userId) {
  const database = await connect();
  return database.collection('pets').findOne({ guildId, userId });
}

async function createPet(guildId, userId, { name, species }) {
  const database = await connect();
  const pet = {
    guildId,
    userId,
    name,
    species,
    xp: 0,
    hunger: 100,
    happiness: 100,
    lastFed: null,
    lastPlayed: null,
    createdAt: new Date(),
  };
  await database.collection('pets').insertOne(pet);
  return pet;
}

async function updatePet(guildId, userId, partialUpdate) {
  const database = await connect();
  await database.collection('pets').updateOne({ guildId, userId }, { $set: partialUpdate });
  return getPet(guildId, userId);
}

// version atomica de "alimentar/jugar": solo aplica si el cooldown ya expiro,
// clampeando la stat a 100 en la misma operacion (evita doble-cobro por spam-click)
async function claimPetCooldown(guildId, userId, field, cooldownMs, { statField, statGain, xpGain }) {
  const database = await connect();
  const cutoff = new Date(Date.now() - cooldownMs);
  const result = await database.collection('pets').findOneAndUpdate(
    { guildId, userId, $or: [{ [field]: null }, { [field]: { $lte: cutoff } }] },
    [
      {
        $set: {
          [field]: new Date(),
          [statField]: { $min: [100, { $add: [`$${statField}`, statGain] }] },
          xp: { $add: ['$xp', xpGain] },
        },
      },
    ],
    { returnDocument: 'after' },
  );
  return result?.value !== undefined ? result.value : result;
}

// --- Starboard ---

async function getStarboardPost(guildId, originalMessageId) {
  const database = await connect();
  return database.collection('starboardPosts').findOne({ guildId, originalMessageId });
}

async function getTopStarredPost(guildId) {
  const database = await connect();
  const [top] = await database.collection('starboardPosts').find({ guildId }).sort({ starCount: -1 }).limit(1).toArray();
  return top || null;
}

// para el portfolio de artista: los posts mas destacados de UN autor puntual
// (en vez del top del server entero)
async function getTopStarredPostsByAuthor(guildId, authorId, limit = 3) {
  const database = await connect();
  return database.collection('starboardPosts').find({ guildId, authorId }).sort({ starCount: -1 }).limit(limit).toArray();
}

async function createStarboardPost({ guildId, originalMessageId, originalChannelId, starboardMessageId, authorId, starCount }) {
  const database = await connect();
  await database.collection('starboardPosts').insertOne({
    guildId,
    originalMessageId,
    originalChannelId,
    starboardMessageId,
    authorId,
    starCount,
    createdAt: new Date(),
  });
}

async function updateStarboardPostCount(guildId, originalMessageId, starCount) {
  const database = await connect();
  await database.collection('starboardPosts').updateOne({ guildId, originalMessageId }, { $set: { starCount } });
}

async function createGiveaway({ guildId, channelId, messageId, prize, winnerCount, hostId, endsAt }) {
  const database = await connect();
  await database.collection('giveaways').insertOne({
    guildId,
    channelId,
    messageId,
    prize,
    winnerCount,
    hostId,
    endsAt,
    entries: [],
    ended: false,
    createdAt: new Date(),
  });
}

async function getGiveaway(messageId) {
  const database = await connect();
  return database.collection('giveaways').findOne({ messageId });
}

async function addGiveawayEntry(messageId, userId) {
  const database = await connect();
  const giveaway = await database.collection('giveaways').findOne({ messageId });
  if (!giveaway || giveaway.ended) return null;
  if (giveaway.entries.includes(userId)) return giveaway;

  await database.collection('giveaways').updateOne({ messageId }, { $addToSet: { entries: userId } });
  return { ...giveaway, entries: [...giveaway.entries, userId] };
}

async function getExpiredGiveaways() {
  const database = await connect();
  return database.collection('giveaways').find({ ended: false, endsAt: { $lte: new Date() } }).toArray();
}

async function listActiveGiveaways(guildId) {
  const database = await connect();
  return database.collection('giveaways').find({ guildId, ended: false }).sort({ endsAt: 1 }).toArray();
}

async function endGiveaway(messageId, winnerIds) {
  const database = await connect();
  await database.collection('giveaways').updateOne({ messageId }, { $set: { ended: true, winnerIds } });
}

// --- Concursos de render (votacion por reaccion real, no sorteo al azar) ---

async function createContest({ guildId, channelId, announcementMessageId, prize, voteEmoji, winnerCount, hostId, startedAt, endsAt }) {
  const database = await connect();
  await database.collection('contests').insertOne({
    guildId,
    channelId,
    announcementMessageId,
    prize,
    voteEmoji,
    winnerCount,
    hostId,
    startedAt,
    endsAt,
    ended: false,
    winnerIds: [],
    createdAt: new Date(),
  });
}

async function getContest(announcementMessageId) {
  const database = await connect();
  return database.collection('contests').findOne({ announcementMessageId });
}

async function getExpiredContests() {
  const database = await connect();
  return database.collection('contests').find({ ended: false, endsAt: { $lte: new Date() } }).toArray();
}

async function listActiveContests(guildId) {
  const database = await connect();
  return database.collection('contests').find({ guildId, ended: false }).sort({ endsAt: 1 }).toArray();
}

async function endContest(announcementMessageId, winnerIds) {
  const database = await connect();
  await database.collection('contests').updateOne({ announcementMessageId }, { $set: { ended: true, winnerIds } });
}

async function createPoll({ guildId, channelId, messageId, question, options, hostId }) {
  const database = await connect();
  await database.collection('polls').insertOne({
    guildId,
    channelId,
    messageId,
    question,
    options,
    hostId,
    votes: {},
    createdAt: new Date(),
  });
}

async function getPoll(messageId) {
  const database = await connect();
  return database.collection('polls').findOne({ messageId });
}

// las encuestas de este bot no tienen fecha de cierre ni estado (quedan
// abiertas para siempre), asi que no hay un concepto real de "activas" —
// se devuelven las mas recientes tal cual son
async function listRecentPolls(guildId, limit = 5) {
  const database = await connect();
  return database.collection('polls').find({ guildId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

async function setPollVote(messageId, userId, optionIndex) {
  const database = await connect();
  await database.collection('polls').updateOne({ messageId }, { $set: { [`votes.${userId}`]: optionIndex } });
  return database.collection('polls').findOne({ messageId });
}

async function createSuggestion({ guildId, channelId, messageId, authorId, authorTag, authorAvatar, content }) {
  const database = await connect();
  await database.collection('suggestions').insertOne({
    guildId,
    channelId,
    messageId,
    authorId,
    authorTag,
    authorAvatar,
    content,
    status: 'pending',
    votes: {},
    createdAt: new Date(),
  });
}

async function getSuggestion(messageId) {
  const database = await connect();
  return database.collection('suggestions').findOne({ messageId });
}

async function getPendingSuggestionsCount(guildId) {
  const database = await connect();
  return database.collection('suggestions').countDocuments({ guildId, status: 'pending' });
}

async function setSuggestionVote(messageId, userId, value) {
  const database = await connect();
  await database.collection('suggestions').updateOne({ messageId }, { $set: { [`votes.${userId}`]: value } });
  return database.collection('suggestions').findOne({ messageId });
}

async function removeSuggestionVote(messageId, userId) {
  const database = await connect();
  await database.collection('suggestions').updateOne({ messageId }, { $unset: { [`votes.${userId}`]: '' } });
  return database.collection('suggestions').findOne({ messageId });
}

// solo aplica la decision si la sugerencia todavia estaba pendiente; devuelve
// null si ya la habian decidido (dos aprobadores clickeando a la vez)
async function setSuggestionStatus(messageId, status, staffId, staffTag) {
  const database = await connect();
  const result = await database
    .collection('suggestions')
    .findOneAndUpdate(
      { messageId, status: 'pending' },
      { $set: { status, staffId, staffTag } },
      { returnDocument: 'after' },
    );
  return result?.value !== undefined ? result.value : result;
}

// previousNickname solo se guarda la primera vez (setOnInsert): si el usuario
// vuelve a marcarse AFK mientras ya lo estaba (para cambiar el motivo), no
// queremos pisarlo con el apodo actual, que para entonces ya tiene el prefijo "[AFK]"
async function setAfk(guildId, userId, reason, previousNickname) {
  const database = await connect();
  await database.collection('afk').updateOne(
    { guildId, userId },
    { $set: { reason, since: new Date() }, $setOnInsert: { previousNickname: previousNickname ?? null } },
    { upsert: true },
  );
}

async function getAfk(guildId, userId) {
  const database = await connect();
  return database.collection('afk').findOne({ guildId, userId });
}

async function removeAfk(guildId, userId) {
  const database = await connect();
  const result = await database.collection('afk').findOneAndDelete({ guildId, userId });
  return result?.value !== undefined ? result.value : result;
}

async function setBirthday(guildId, userId, day, month) {
  const database = await connect();
  await database
    .collection('birthdays')
    .updateOne({ guildId, userId }, { $set: { day, month }, $unset: { lastAnnouncedYear: '' } }, { upsert: true });
}

async function getBirthday(guildId, userId) {
  const database = await connect();
  return database.collection('birthdays').findOne({ guildId, userId });
}

async function getBirthdaysForToday(day, month) {
  const database = await connect();
  return database.collection('birthdays').find({ day, month }).toArray();
}

async function markBirthdayAnnounced(guildId, userId, year) {
  const database = await connect();
  await database.collection('birthdays').updateOne({ guildId, userId }, { $set: { lastAnnouncedYear: year } });
}

async function recordInviteJoin({ guildId, userId, inviterId, code }) {
  const database = await connect();
  await database.collection('inviteJoins').insertOne({ guildId, userId, inviterId, code, joinedAt: new Date() });
}

async function countInvitesByUser(guildId, inviterId) {
  const database = await connect();
  return database.collection('inviteJoins').countDocuments({ guildId, inviterId });
}

async function getInviteLeaderboard(guildId, limit = 10) {
  const database = await connect();
  return database
    .collection('inviteJoins')
    .aggregate([
      { $match: { guildId, inviterId: { $ne: null } } },
      { $group: { _id: '$inviterId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])
    .toArray();
}

async function createScheduledAnnouncement({ guildId, channelId, message, hostId, sendAt }) {
  const database = await connect();
  await database.collection('scheduledAnnouncements').insertOne({
    guildId,
    channelId,
    message,
    hostId,
    sendAt,
    sent: false,
    createdAt: new Date(),
  });
}

async function getDueScheduledAnnouncements() {
  const database = await connect();
  return database
    .collection('scheduledAnnouncements')
    .find({ sent: false, sendAt: { $lte: new Date() } })
    .toArray();
}

async function markScheduledAnnouncementSent(id) {
  const database = await connect();
  await database.collection('scheduledAnnouncements').updateOne({ _id: id }, { $set: { sent: true } });
}

module.exports = {
  connect,
  getGuildConfig,
  updateGuildConfig,
  incrementMessageStat,
  incrementAiUsage,
  getAiUsageStats,
  getStats,
  getNextTicketNumber,
  createTicket,
  claimTicket,
  closeTicket,
  rateTicket,
  getTicketByChannelId,
  listTickets,
  countUserTickets,
  defaultConfig,
  levelInfoFromXp,
  addXp,
  getUserLevel,
  getLeaderboard,
  getUserRank,
  createReactionRoleSet,
  getReactionRoleSet,
  listReactionRoleSets,
  deleteReactionRoleSet,
  createSelectRoleSet,
  getSelectRoleSet,
  updateSelectRoleSet,
  listSelectRoleSets,
  deleteSelectRoleSet,
  addWarning,
  listWarnings,
  createHouseApplication,
  decideHouseApplication,
  getHouseApplication,
  getHouseApplicationStats,
  getEconomyAccount,
  addBalance,
  setEconomyCooldown,
  transferBalance,
  spendBalance,
  claimEconomyCooldown,
  claimPetCooldown,
  addInventoryItem,
  addReputation,
  MAX_RICH_MESSAGES_PER_GUILD,
  listRichMessages,
  getRichMessage,
  countRichMessages,
  saveRichMessage,
  setRichMessagePublished,
  deleteRichMessage,
  addAlertItem,
  removeAlertItem,
  updateAlertState,
  getEconomyLeaderboard,
  getMarriage,
  createMarriage,
  deleteMarriage,
  petLevelInfoFromXp,
  getPet,
  createPet,
  updatePet,
  getStarboardPost,
  getTopStarredPost,
  getTopStarredPostsByAuthor,
  createStarboardPost,
  updateStarboardPostCount,
  createGiveaway,
  getGiveaway,
  addGiveawayEntry,
  getExpiredGiveaways,
  listActiveGiveaways,
  endGiveaway,
  createContest,
  getContest,
  getExpiredContests,
  listActiveContests,
  endContest,
  createPoll,
  getPoll,
  listRecentPolls,
  setPollVote,
  createSuggestion,
  getSuggestion,
  getPendingSuggestionsCount,
  setSuggestionVote,
  removeSuggestionVote,
  setSuggestionStatus,
  setAfk,
  getAfk,
  removeAfk,
  setBirthday,
  getBirthday,
  getBirthdaysForToday,
  markBirthdayAnnounced,
  recordInviteJoin,
  countInvitesByUser,
  getInviteLeaderboard,
  createScheduledAnnouncement,
  getDueScheduledAnnouncements,
  markScheduledAnnouncementSent,
};
