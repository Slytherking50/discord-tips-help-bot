require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { ActivityTracker } = require('./activityTracker');
const { buildEmbed } = require('./embedStyle');
const { buildResponder, NEEDS_FALLBACK } = require('./helpResponder');
const aiHelper = require('./aiHelper');
const announceCommand = require('./announceCommand');
const ticketCommand = require('./ticketCommand');
const textCommands = require('./textCommands');
const levelCommands = require('./levelCommands');
const moderationCommands = require('./moderationCommands');
const reactionRoles = require('./reactionRoles');
const selectRoles = require('./selectRoles');
const starboard = require('./starboard');
const renderFeedback = require('./renderFeedback');
const logging = require('./logging');
const housesCommand = require('./housesCommand');
const customCommands = require('./customCommands');
const commandRegistry = require('./commandRegistry');
const economyCommands = require('./economyCommands');
const casinoCommands = require('./casinoCommands');
const marriageCommands = require('./marriageCommands');
const petCommands = require('./petCommands');
const triviaCommand = require('./triviaCommand');
const memeCommand = require('./memeCommand');
const miniEvents = require('./miniEvents');
const serverGuide = require('./serverGuide');
const debugCommand = require('./debugCommand');
const giveawayCommand = require('./giveawayCommand');
const pollCommand = require('./pollCommand');
const suggestionBox = require('./suggestionBox');
const afkCommand = require('./afkCommand');
const birthdayCommand = require('./birthdayCommand');
const inviteCommand = require('./inviteCommand');
const inviteTracker = require('./inviteTracker');
const sayCommand = require('./sayCommand');
const serverInfoCommand = require('./serverInfoCommand');
const portfolioCommand = require('./portfolioCommand');
const skillsCommand = require('./skillsCommand');
const contestCommand = require('./contestCommand');
const socialCommands = require('./socialCommands');
const miniGames = require('./miniGames');
const alerts = require('./alerts');
const welcomeCard = require('./welcomeCard');
const richMessage = require('./richMessage');
const botStats = require('./botStats');
const botStatus = require('./botStatus');
const conversationMode = require('./conversationMode');
const { pickTipChannelId } = require('./tipChannel');
const voiceXp = require('./voiceXp');
const errorReporter = require('./errorReporter');
const { isDirectedAtAnotherUser } = require('./messageDirection');
const db = require('./db');
const { createApp } = require('./web/app');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

// el creador/programador del bot: siempre puede pedirle acciones de
// moderacion por chat, ademas de quien este en config.ai.staffUserIds por
// server. Se identifica por ID real de Discord (no por nombre, que se puede
// cambiar o falsificar) — si no esta seteada, nadie tiene este acceso extra
const CREATOR_USER_ID = process.env.CREATOR_USER_ID || null;

function isCreatorUser(userId) {
  return Boolean(CREATOR_USER_ID) && userId === CREATOR_USER_ID;
}

const CONFIG_REFRESH_MS = 60 * 1000;
const GIVEAWAY_CHECK_MS = 30 * 1000;
const SCHEDULED_ANNOUNCEMENT_CHECK_MS = 60 * 1000;
const MEMBER_COUNTER_INTERVAL_MS = 10 * 60 * 1000;
const BIRTHDAY_CHECK_MS = 60 * 60 * 1000;
const AI_DIGEST_CHECK_MS = 60 * 60 * 1000;
const ALERTS_CHECK_MS = 3 * 60 * 1000;
const BOT_STATS_FLUSH_MS = 60 * 1000;
const WHITELIST = (process.env.TIPS_CHANNEL_WHITELIST || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// estado por servidor: cada guild tiene su propia config, su propio buscador
// de respuestas de ayuda, su propio tracker de actividad y su propio timer de tips
const configByGuild = new Map();
const findHelpResponseByGuild = new Map();
const trackerByGuild = new Map();
const tipTimerByGuild = new Map();
const miniEventTimerByGuild = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

// red de contención final: cualquier rechazo/excepción que se escape de los
// handlers de arriba (por ejemplo un evento nuevo sin try/catch) se loguea
// en vez de tirar abajo el proceso entero
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

function getTracker(guildId) {
  if (!trackerByGuild.has(guildId)) {
    trackerByGuild.set(guildId, new ActivityTracker());
  }
  return trackerByGuild.get(guildId);
}

async function applyBotNickname(guildId, config) {
  const nickname = config?.branding?.nickname;
  if (!nickname) return;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const me = guild.members.me || (await guild.members.fetchMe());
    if (me.nickname !== nickname) {
      await me.setNickname(nickname);
    }
  } catch (err) {
    console.error(`No se pudo cambiar el apodo del bot en el server ${guildId}:`, err);
  }
}

async function updateMemberCounter(guildId, config) {
  const counter = config?.memberCounter;
  if (!counter?.enabled || !counter.channelId) return;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = await guild.channels.fetch(counter.channelId).catch(() => null);
    if (!channel) return;

    const name = counter.template.replace(/\{count\}/g, String(guild.memberCount)).slice(0, 100);
    if (channel.name !== name) {
      await channel.setName(name);
    }
  } catch (err) {
    console.error(`No se pudo actualizar el contador de miembros en el server ${guildId}:`, err);
  }
}

async function updateAllMemberCounters() {
  await Promise.all(
    Array.from(client.guilds.cache.keys()).map((guildId) => updateMemberCounter(guildId, configByGuild.get(guildId))),
  );
}

async function refreshGuildConfig(guildId) {
  try {
    const config = await db.getGuildConfig(guildId);
    configByGuild.set(guildId, config);
    findHelpResponseByGuild.set(guildId, buildResponder(config.helpResponses));
    await applyBotNickname(guildId, config);
  } catch (err) {
    console.error(`No se pudo refrescar la configuración del server ${guildId}:`, err);
  }
}

async function refreshAllConfigs() {
  await Promise.all(Array.from(client.guilds.cache.keys()).map((guildId) => refreshGuildConfig(guildId)));
}

const CARD_FILE_NAME = 'welcome.png';

// genera la tarjeta de imagen de bienvenida/despedida; si falla (fondo caido,
// avatar inaccesible...) devuelve null y el mensaje sale igual, sin tarjeta
async function buildCardAttachment(cardSettings, member, defaults) {
  if (!cardSettings?.enabled) return null;
  try {
    const buffer = await welcomeCard.generateWelcomeCard(
      cardSettings,
      {
        username: member.user.username,
        server: member.guild.name,
        membercount: member.guild.memberCount,
        avatarURL: member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      },
      defaults,
    );
    return new AttachmentBuilder(buffer, { name: CARD_FILE_NAME });
  } catch (err) {
    console.error('No se pudo generar la tarjeta de bienvenida/despedida:', err);
    return null;
  }
}

function formatTemplate(template, member) {
  // member.joinedAt puede venir null si el miembro ya no esta en cache (ej.
  // en la despedida, si el evento llega sin el dato) — se cae a la fecha
  // actual en vez de romper el reemplazo
  const joinDate = (member.joinedAt || new Date()).toLocaleDateString('es-AR');
  return template
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user.username)
    .replace(/\{server\}/g, member.guild.name)
    .replace(/\{membercount\}/g, String(member.guild.memberCount))
    .replace(/\{joindate\}/g, joinDate);
}

function startTipLoop(guildId) {
  async function scheduleTip() {
    await sendTipToMostActiveChannel(guildId);
    // si el bot ya no esta en este server (se fue mientras esta llamada estaba
    // en vuelo), no volvemos a armar el timer: evita que el loop quede corriendo
    // para siempre reintentando contra un server al que ya no tenemos acceso
    if (!client.guilds.cache.has(guildId)) return;
    const config = configByGuild.get(guildId);
    const delayMs = Math.max(1, config?.tipsIntervalMinutes || 20) * 60 * 1000;
    tipTimerByGuild.set(guildId, setTimeout(scheduleTip, delayMs));
  }
  scheduleTip();
}

function stopTipLoop(guildId) {
  const timer = tipTimerByGuild.get(guildId);
  if (timer) clearTimeout(timer);
  tipTimerByGuild.delete(guildId);
}

function startMiniEventLoop(guildId) {
  async function scheduleEvent() {
    const config = configByGuild.get(guildId);
    if (config?.miniEvents?.enabled) {
      await miniEvents.postEvent(client, guildId, config);
    }
    if (!client.guilds.cache.has(guildId)) return;
    const delayMs = Math.max(5, config?.miniEvents?.intervalMinutes || 120) * 60 * 1000;
    miniEventTimerByGuild.set(guildId, setTimeout(scheduleEvent, delayMs));
  }
  scheduleEvent();
}

function stopMiniEventLoop(guildId) {
  const timer = miniEventTimerByGuild.get(guildId);
  if (timer) clearTimeout(timer);
  miniEventTimerByGuild.delete(guildId);
}

async function sendTipToMostActiveChannel(guildId) {
  const tracker = getTracker(guildId);
  const rankedChannelIds = tracker.getRankedChannelIds();
  tracker.reset();

  const config = configByGuild.get(guildId);
  if (!rankedChannelIds.length || !config || !config.tips.length) return;

  // un canal fijo si el server eligio uno; si no, el mas activo que no este
  // excluido (ej. staff, tickets, bots) — ver tipChannel.js
  const channelId = pickTipChannelId(config, rankedChannelIds);
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const tip = config.tips[Math.floor(Math.random() * config.tips.length)];
    await channel.send(tip);
  } catch (err) {
    console.error('No se pudo mandar el tip:', err);
  }
}

function containsInviteLink(content) {
  return /(discord\.gg|discord(app)?\.com\/invite)\/\S+/i.test(content);
}

async function deleteWithWarning(message, reason) {
  try {
    await message.delete();
    const warning = await message.channel.send(`⚠️ <@${message.author.id}>, tu mensaje se borró por: ${reason}.`);
    setTimeout(() => warning.delete().catch(() => {}), 6000);
  } catch (err) {
    console.error('No se pudo aplicar automoderación:', err);
  }
}

// si el server eligio uno o varios canales exclusivos para la IA, solo
// responde ahi (ni por mencion ni como respaldo de ayuda); sin canal elegido,
// funciona en todos los canales como antes. Esto NO afecta comandos,
// respuestas pre-guardadas de ayuda, tips ni advertencias de automoderacion
// — nada de eso pasa por la IA
function isAiChannelAllowed(config, channelId) {
  const allowedChannels = config?.ai?.channelIds?.length
    ? config.ai.channelIds
    : config?.ai?.channelId
      ? [config.ai.channelId] // config vieja, un solo canal (legacy)
      : [];
  return !allowedChannels.length || allowedChannels.includes(channelId);
}

// reemplaza las menciones de OTROS usuarios por su nombre visible (para que
// la IA entienda "hablale a Juan" en vez de ver un id crudo) y saca la
// mencion al propio bot, que ya se maneja aparte
function prepareAiText(message) {
  let content = message.content;
  for (const [id, user] of message.mentions.users) {
    if (id === client.user.id) continue;
    const name = message.mentions.members?.get(id)?.displayName || user.username;
    content = content.split(`<@${id}>`).join(name).split(`<@!${id}>`).join(name);
  }
  return content.replace(/<@!?\d+>/g, '').trim();
}

// guild.members.cache / role.members solo reflejan a los miembros que el
// bot ya tiene en cache (los que estuvieron activos desde que arranco el
// proceso) — sin este fetch, cualquier lista/conteo/ranking por TODOS los
// miembros del server queda incompleta (o le faltan nombres reales) y en la
// practica terminaba mostrando casi siempre solo a quien le hablaba al bot.
// El fetch completo es una llamada pesada a la API de Discord, asi que se
// cachea por server: si ya se hizo hace poco, no se repite (evita pegarle a
// la API en cada pregunta de ranking/staff en servers activos)
const MEMBER_FETCH_CACHE_MS = 5 * 60 * 1000;
const lastMemberFetchByGuild = new Map();

async function ensureFullMemberCache(guild) {
  const last = lastMemberFetchByGuild.get(guild.id) || 0;
  if (Date.now() - last < MEMBER_FETCH_CACHE_MS) return;
  try {
    await guild.members.fetch();
    lastMemberFetchByGuild.set(guild.id, Date.now());
  } catch (err) {
    console.error('No se pudo traer la lista completa de miembros del server:', err.message);
  }
}

// nombre del server, nombre del bot, nombre de quien escribe, y los ultimos
// mensajes del canal (para que la IA tenga contexto de la conversacion en
// vez de responder cada mensaje como si fuera la primera vez que le hablan)
// arma un directorio de "quien es quien" a partir de los roles etiquetados
// en el dashboard (Owner/CEO, Staff, Helper, etc). Los nombres se resuelven
// EN VIVO desde el cache de miembros del server — nunca se guardan nombres
// en la config, asi nunca queda desactualizado si alguien entra/sale del rol
async function buildStaffDirectory(guild, config) {
  const tags = config?.ai?.staffRoleTags || [];
  if (!tags.length) return '';

  await ensureFullMemberCache(guild);

  return tags
    .map((tag) => {
      const role = guild.roles.cache.get(tag.roleId);
      if (!role) return `- ${tag.label}: (el rol ya no existe en el server)`;
      const memberNames = role.members.map((m) => m.displayName).slice(0, 20);
      return `- ${tag.label} (rol @${role.name}): ${memberNames.length ? memberNames.join(', ') : 'nadie tiene este rol actualmente'}`;
    })
    .join('\n');
}

// datos basicos y reales del server (para preguntas tipo "cuantos somos" o
// "hace cuanto existe el server"), siempre presentes sin depender de keywords
function buildServerFacts(guild) {
  return `Miembros totales: ${guild.memberCount}. Server creado el: ${guild.createdAt.toLocaleDateString('es-AR')}.`;
}

async function buildAiContext(message, config) {
  let recentMessages = '';
  try {
    const recent = await message.channel.messages.fetch({ limit: 6 });
    recentMessages = [...recent.values()]
      .filter((m) => m.id !== message.id)
      .reverse()
      .slice(-5)
      .map((m) => `${m.member?.displayName || m.author.username}: ${m.content}`.replace(/\s+/g, ' ').slice(0, 200))
      .join('\n');
  } catch (err) {
    console.error('No se pudo traer contexto reciente para la IA:', err.message);
  }

  return {
    ...(await buildBaseAiContext(message.guild, message.member, message.author, config)),
    recentMessages,
  };
}

// parte del contexto de la IA que solo depende del guild/quien escribe, sin
// necesitar un mensaje puntual — la reusan tanto el flujo por mencion
// (buildAiContext de arriba, que le suma el historial reciente del canal)
// como los comandos de barra (/preguntar), que no tienen un canal del que
// sacar contexto reciente de la misma forma
async function buildBaseAiContext(guild, member, user, config) {
  // nombres de roles y canales de texto (limitados a 30 c/u para no inflar
  // demasiado el prompt en servers grandes), asi la IA puede mencionarlos con
  // propiedad si le preguntan "que canales hay" o "que roles hay"
  const roleNames = guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed)
    .map((role) => role.name)
    .slice(0, 30)
    .join(', ');

  const channelNames = guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildText)
    .map((channel) => `#${channel.name}`)
    .slice(0, 30)
    .join(', ');

  return {
    serverName: guild.name,
    botName: config?.branding?.nickname || guild.members.me?.displayName || client.user.username,
    userName: member?.displayName || user.username,
    roleNames,
    channelNames,
    tone: config?.ai?.tone,
    customPersonality: config?.ai?.customPersonality,
    forbiddenTopics: config?.ai?.forbiddenTopics,
    staffDirectory: await buildStaffDirectory(guild, config),
    serverFacts: buildServerFacts(guild),
    isCreator: isCreatorUser(user.id),
  };
}

const DEFAULT_AI_COOLDOWN_MS = 8000;
const lastAiReplyByUser = new Map();

// evita que un usuario spamee menciones a la IA (cuida el limite gratis de
// Groq y evita abuso); un solo Map global de userId alcanza porque el
// cooldown es "por usuario", no por servidor ni por canal. cooldownMs es
// configurable por server (config.ai.cooldownSeconds), con el default de
// arriba como respaldo si no esta seteado
function canUseAiNow(userId, cooldownMs = DEFAULT_AI_COOLDOWN_MS) {
  const now = Date.now();
  const last = lastAiReplyByUser.get(userId) || 0;
  if (now - last < cooldownMs) return false;
  lastAiReplyByUser.set(userId, now);
  return true;
}

function aiCooldownMs(config) {
  const seconds = Number(config?.ai?.cooldownSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_AI_COOLDOWN_MS;
}

// saca tildes/diacriticos para que "politica" matchee "política" (la gente
// suele escribir sin tildes en el chat)
function normalizeForMatch(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// bloqueo REAL de temas prohibidos: pasa ANTES de llamar a Groq, asi no
// depende de que el modelo respete la instruccion del prompt (esa es solo
// una capa extra). Si el mensaje contiene alguna de las palabras/temas
// configurados, ni siquiera se gasta la llamada a la IA
function matchForbiddenTopic(content, forbiddenTopics) {
  if (!forbiddenTopics?.length || !content) return null;
  const normalizedContent = normalizeForMatch(content);
  return forbiddenTopics.find((topic) => topic && normalizedContent.includes(normalizeForMatch(topic))) || null;
}

const AI_EMBED_MIN_LENGTH = 150;

// las respuestas cortas van como texto plano (mas livianas en el chat); las
// largas se envuelven en embed con la marca para que se lean mejor
// arma el payload (texto plano o embed) segun el largo, sin mandarlo — lo
// reusan tanto sendAiReply (manda un mensaje nuevo) como la animacion de
// "pensando" (edita el mensaje placeholder)
function buildAiReplyPayload(config, text) {
  if (text.length >= AI_EMBED_MIN_LENGTH) {
    return { embeds: [buildEmbed({ type: 'brand', description: text, config })] };
  }
  return { content: text, embeds: [] };
}

async function sendAiReply(message, config, text) {
  await message.reply(buildAiReplyPayload(config, text));
}

// reemplaza la vieja reaccion "🤔" por un mensaje que se anima solo
// (Pensando. / Pensando.. / Pensando...) mientras la IA procesa, y despues
// se convierte en la respuesta final editando ese mismo mensaje — mas visible
// y prolijo que una reaccion que aparece y desaparece
const THINKING_FRAMES = ['🤔 Pensando.', '🤔 Pensando..', '🤔 Pensando...'];
const THINKING_FRAME_MS = 650;

async function startThinking(message) {
  const placeholder = await message.reply(THINKING_FRAMES[0]).catch(() => null);
  if (!placeholder) return null;

  let frame = 0;
  const interval = setInterval(() => {
    frame = (frame + 1) % THINKING_FRAMES.length;
    placeholder.edit(THINKING_FRAMES[frame]).catch(() => {});
  }, THINKING_FRAME_MS);

  let stopped = false;
  return {
    message: placeholder,
    // convierte el placeholder en la respuesta final. payload puede ser un
    // string, o un objeto { content, embeds } como el que arma buildAiReplyPayload
    stop: async (payload) => {
      if (stopped) return placeholder;
      stopped = true;
      clearInterval(interval);
      try {
        await placeholder.edit(payload);
      } catch (err) {
        console.error('No se pudo editar el mensaje de "pensando":', err.message);
      }
      return placeholder;
    },
  };
}

function trackAiUsage(guildId, success) {
  db.incrementAiUsage(guildId, success).catch((err) => console.error('No se pudo registrar uso de IA:', err.message));
}

// charla libre en UN canal: ver conversationMode.js
const conversation = conversationMode.create({
  client,
  aiHelper,
  buildBaseAiContext,
  isCreatorUser,
  matchForbiddenTopic,
  isAiChannelAllowed,
  trackAiUsage,
});

// si el mensaje pregunta por nivel/balance/roles/etc, busca el dato REAL en
// la base (o en el propio member de discord) para el que escribe y para
// cualquier usuario mencionado, asi la IA contesta con el dato real en vez
// de inventarlo
const BIRTHDAY_MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

async function buildRealDataForQuery(message) {
  const wantsStats = /\b(nivel|balance|monedas|plata|perfil|experiencia|xp)\b/i.test(message.content);
  const wantsRoles = /\b(rol|roles|permiso|permisos)\b/i.test(message.content);
  const wantsBirthday = /\bcumplea[nñ]os\b|\bcumple\b/i.test(message.content);
  const wantsAfk = /\bafk\b/i.test(message.content);
  const wantsPareja = /\bpareja\b|\bcasad[oa]\b|\besposx?\b|\besposa\b|\besposo\b/i.test(message.content);
  const wantsPet = /\bmascota\b/i.test(message.content);
  const wantsTicketCount = /\btickets?\b/i.test(message.content);
  if (!wantsStats && !wantsRoles && !wantsBirthday && !wantsAfk && !wantsPareja && !wantsPet && !wantsTicketCount) return '';

  const targets = [{ id: message.author.id, name: message.member?.displayName || message.author.username, member: message.member }];
  for (const [id, user] of message.mentions.users) {
    if (id === client.user.id) continue;
    const member = message.mentions.members?.get(id);
    targets.push({ id, name: member?.displayName || user.username, member });
  }

  const lines = [];
  for (const target of targets) {
    const parts = [];
    if (wantsStats) {
      try {
        const [levelInfo, account] = await Promise.all([
          db.getUserLevel(message.guild.id, target.id),
          db.getEconomyAccount(message.guild.id, target.id),
        ]);
        parts.push(`nivel ${levelInfo.level} (${levelInfo.xp} XP total), balance ${account.balance}`);
      } catch (err) {
        console.error('No se pudo traer datos reales para la IA:', err.message);
      }
    }
    if (wantsRoles) {
      const roleNames = target.member?.roles.cache
        .filter((role) => role.id !== message.guild.id)
        .map((role) => role.name)
        .join(', ');
      parts.push(`roles: ${roleNames || '(sin roles)'}`);
    }
    if (wantsBirthday) {
      try {
        const birthday = await db.getBirthday(message.guild.id, target.id);
        parts.push(`cumpleaños: ${birthday ? `${birthday.day} de ${BIRTHDAY_MONTH_NAMES[birthday.month - 1]}` : 'no cargado'}`);
      } catch (err) {
        console.error('No se pudo traer el cumpleaños para la IA:', err.message);
      }
    }
    if (wantsAfk) {
      try {
        const afk = await db.getAfk(message.guild.id, target.id);
        parts.push(`afk: ${afk ? `sí, motivo: ${afk.reason}` : 'no'}`);
      } catch (err) {
        console.error('No se pudo traer el estado AFK para la IA:', err.message);
      }
    }
    if (wantsPareja) {
      try {
        const marriage = await db.getMarriage(message.guild.id, target.id);
        if (marriage) {
          const partnerId = marriage.user1Id === target.id ? marriage.user2Id : marriage.user1Id;
          const partnerMember = message.guild.members.cache.get(partnerId);
          parts.push(`pareja: ${partnerMember?.displayName || `<@${partnerId}>`}`);
        } else {
          parts.push('pareja: no está casado/a');
        }
      } catch (err) {
        console.error('No se pudo traer la pareja para la IA:', err.message);
      }
    }
    if (wantsPet) {
      try {
        const pet = await db.getPet(message.guild.id, target.id);
        parts.push(`mascota: ${pet ? `${pet.name} (${pet.species}, nivel ${db.petLevelInfoFromXp(pet.xp).level})` : 'no tiene'}`);
      } catch (err) {
        console.error('No se pudo traer la mascota para la IA:', err.message);
      }
    }
    if (wantsTicketCount) {
      try {
        const count = await db.countUserTickets(message.guild.id, target.id);
        parts.push(`tickets abiertos históricamente: ${count}`);
      } catch (err) {
        console.error('No se pudo traer el conteo de tickets para la IA:', err.message);
      }
    }
    if (parts.length) lines.push(`- ${target.name}: ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

// tarjeta de perfil prolija (embed) con datos 100% reales — igual que el
// resto de los triggers deterministicos (meme/trivia), no pasa por la IA
async function buildProfileEmbed(message, config) {
  const target = message.mentions.members?.find((m) => m.id !== client.user.id) || message.member;

  const [levelInfo, account] = await Promise.all([
    db.getUserLevel(message.guild.id, target.id),
    db.getEconomyAccount(message.guild.id, target.id),
  ]);

  const roleNames =
    target.roles.cache
      .filter((role) => role.id !== message.guild.id)
      .map((role) => role.name)
      .join(', ') || 'Sin roles';

  return buildEmbed({
    type: 'brand',
    title: `Perfil de ${target.displayName}`,
    thumbnail: target.user.displayAvatarURL(),
    fields: [
      { name: 'Nivel', value: `${levelInfo.level} (${levelInfo.xp} XP)`, inline: true },
      { name: 'Balance', value: `${account.balance}`, inline: true },
      {
        name: 'Se unió',
        value: target.joinedAt ? `<t:${Math.floor(target.joinedAt.getTime() / 1000)}:D>` : 'Desconocido',
        inline: true,
      },
      { name: 'Roles', value: roleNames.slice(0, 1000) },
    ],
    config,
  });
}

// pregunta por CUANTOS/QUIENES tienen un rol (distinto de "que roles tiene
// fulano", que ya cubre buildRealDataForQuery). Necesita el nombre del rol
// real, matcheado contra los roles reales del server — si no encuentra
// ninguno, no dispara nada (cae al chat normal)
const ROLE_MEMBERS_TRIGGER = /\b(cuant[oa]s?|list(a|ado)?|quien(es)?(\s+tienen?)?|usuarios?\s+con)\b.*\brol/i;

function findMentionedRoleByName(guild, content) {
  const normalizedContent = normalizeForMatch(content);
  const roles = [...guild.roles.cache.filter((role) => role.id !== guild.id && !role.managed).values()];
  // el nombre de rol mas largo que matchea gana (evita que "VIP" gane sobre "VIP Plus" si ambos aparecen)
  return roles
    .filter((role) => role.name && normalizedContent.includes(normalizeForMatch(role.name)))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
}

// cuenta/lista real de quienes tienen un rol — nunca pasa por la IA (asi no
// se inventa un numero ni nombres). role.members solo refleja a los
// miembros que el bot ya tiene en cache (los que estuvieron activos desde
// que arrancó el proceso) — sin este fetch, el conteo da bajo en servers
// con miembros inactivos que igual tienen el rol
async function buildRoleMembersReply(role) {
  await ensureFullMemberCache(role.guild);

  const memberNames = role.members.map((m) => m.displayName);
  const count = memberNames.length;
  const MAX_LISTED = 40;
  const listText = count
    ? memberNames.slice(0, MAX_LISTED).join(', ') + (count > MAX_LISTED ? `, y ${count - MAX_LISTED} más` : '')
    : '(nadie tiene este rol actualmente)';
  return `**${role.name}** — ${count} usuario${count === 1 ? '' : 's'}:\n${listText}`;
}

// las tres funciones de abajo conectan la IA a sistemas del bot que antes
// no conocia (tickets, tienda, houses) — todas 100% datos reales, nunca
// pasan por la IA para decidir el numero/lista, mismo patron que roles
const TICKETS_INFO_WORDS = '(cuant[oa]s?|categor[ií]as?|categoria|abiert[oa]s?|cerrad[oa]s?|estado)';
const TICKETS_INFO_TRIGGER = new RegExp(`\\btickets?\\b.*\\b${TICKETS_INFO_WORDS}\\b|\\b${TICKETS_INFO_WORDS}\\b.*\\btickets?\\b`, 'i');

async function buildTicketsInfoReply(message, config) {
  const stats = await db.getStats(message.guild.id);
  const categories = config?.ticketCategories || [];
  const categoriesText = categories.length
    ? categories.map((c) => `${c.emoji || '🎫'} ${c.label}`).join(', ')
    : '(sin categorías configuradas)';

  const lines = [`Tickets abiertos: ${stats.openTickets} — cerrados: ${stats.closedTickets}`, `Categorías disponibles: ${categoriesText}`];

  const currentTicket = await db.getTicketByChannelId(message.channel.id).catch(() => null);
  if (currentTicket) {
    lines.push(
      `Este canal es el ticket #${currentTicket.number} (categoría: ${currentTicket.categoryLabel || 'sin categoría'}, estado: ${currentTicket.status}).`,
    );
  }

  return lines.join('\n');
}

const SHOP_TRIGGER = /\btienda\b/i;

function buildShopReply(config) {
  const items = config?.economy?.shopItems || [];
  if (!items.length) return 'La tienda todavía no tiene items.';
  const currencySymbol = config?.economy?.currencySymbol || '';
  const currencyName = config?.economy?.currencyName || 'monedas';
  return items
    .map((item) => `**${item.name}** — ${item.price} ${currencySymbol}${currencyName}${item.description ? `\n${item.description}` : ''}`)
    .join('\n\n');
}

const HOUSES_INFO_WORDS = '(cuant[oa]s?|que|cual|informaci[oó]n|info)';
const HOUSES_INFO_TRIGGER = new RegExp(`\\bhouses?\\b.*\\b${HOUSES_INFO_WORDS}\\b|\\b${HOUSES_INFO_WORDS}\\b.*\\bhouses?\\b`, 'i');

async function buildHousesInfoReply(message, config) {
  if (!config?.houses?.enabled) return 'Este server no tiene el sistema de Houses activado.';
  const stats = await db.getHouseApplicationStats(message.guild.id);
  return `Este server tiene un programa de Houses por solicitud (no son roles separados, es un formulario que revisa el staff): "${config.houses.requestTitle || 'Solicitud de House'}".\nSolicitudes: ${stats.pending} pendientes, ${stats.accepted} aceptadas, ${stats.rejected} rechazadas.`;
}

const LEVEL_RANK_WORDS = '(ranking|top|mejores)';
const LEVEL_TOPIC_WORDS = '(nivel(es)?|xp|experiencia)';
const LEVELS_LEADERBOARD_TRIGGER = new RegExp(
  `\\b${LEVEL_RANK_WORDS}\\b.*\\b${LEVEL_TOPIC_WORDS}\\b|\\b${LEVEL_TOPIC_WORDS}\\b.*\\b${LEVEL_RANK_WORDS}\\b`,
  'i',
);

async function buildLevelsLeaderboardReply(message) {
  const entries = await db.getLeaderboard(message.guild.id, 10);
  if (!entries.length) return 'Todavía nadie tiene experiencia registrada.';
  await ensureFullMemberCache(message.guild);
  const lines = entries.map((entry, i) => {
    const info = db.levelInfoFromXp(entry.xp);
    const name = message.guild.members.cache.get(entry.userId)?.displayName || `Usuario ${entry.userId}`;
    return `${i + 1}. ${name} — nivel ${info.level} (${entry.xp} XP)`;
  });
  return `**Ranking de niveles**\n${lines.join('\n')}`;
}

const ECONOMY_RANK_WORDS = '(ranking|top|mas)';
const ECONOMY_TOPIC_WORDS = '(plata|dinero|ric[oa]|economia|econom[ií]a|monedas?)';
const ECONOMY_LEADERBOARD_TRIGGER = new RegExp(
  `\\b${ECONOMY_RANK_WORDS}\\b.*\\b${ECONOMY_TOPIC_WORDS}\\b|\\b${ECONOMY_TOPIC_WORDS}\\b.*\\b${ECONOMY_RANK_WORDS}\\b`,
  'i',
);

async function buildEconomyLeaderboardReply(message, config) {
  const entries = await db.getEconomyLeaderboard(message.guild.id, 10);
  if (!entries.length) return 'Todavía nadie tiene balance registrado.';
  await ensureFullMemberCache(message.guild);
  const currencySymbol = config?.economy?.currencySymbol || '';
  const currencyName = config?.economy?.currencyName || 'monedas';
  const lines = entries.map((entry, i) => {
    const name = message.guild.members.cache.get(entry.userId)?.displayName || `Usuario ${entry.userId}`;
    return `${i + 1}. ${name} — ${entry.balance} ${currencySymbol}${currencyName}`;
  });
  return `**Ranking de economía**\n${lines.join('\n')}`;
}

const GIVEAWAYS_WORDS = '(activ[oa]s?|hay|cuant[oa]s?|cual|que)';
const GIVEAWAYS_TRIGGER = new RegExp(`\\bsorteos?\\b.*\\b${GIVEAWAYS_WORDS}\\b|\\b${GIVEAWAYS_WORDS}\\b.*\\bsorteos?\\b`, 'i');

async function buildGiveawaysReply(message) {
  const giveaways = await db.listActiveGiveaways(message.guild.id);
  if (!giveaways.length) return 'No hay ningún sorteo activo ahora mismo.';
  return giveaways
    .map((g) => {
      const endsAt = Math.floor(new Date(g.endsAt).getTime() / 1000);
      return `🎉 **${g.prize}** — ${g.winnerCount} ganador(es), ${g.entries?.length || 0} participante(s), termina <t:${endsAt}:R>`;
    })
    .join('\n');
}

const POLLS_WORDS = '(activ[oa]s?|hay|cuant[oa]s?|cual|que)';
const POLLS_TRIGGER = new RegExp(`\\bencuestas?\\b.*\\b${POLLS_WORDS}\\b|\\b${POLLS_WORDS}\\b.*\\bencuestas?\\b`, 'i');

async function buildPollsReply(message) {
  const polls = await db.listRecentPolls(message.guild.id, 5);
  if (!polls.length) return 'Todavía no se creó ninguna encuesta en este server.';
  const lines = polls.map((p) => {
    const totalVotes = Object.keys(p.votes || {}).length;
    return `📊 **${p.question}** — ${p.options.length} opciones, ${totalVotes} voto(s) hasta ahora`;
  });
  // las encuestas de este bot no tienen fecha de cierre ni estado (quedan
  // publicadas para siempre) — se lo aclaramos a la IA para que no invente
  // que "terminaron" o "siguen activas" como si tuvieran plazo
  return `Encuestas más recientes de este server (no tienen fecha de cierre, quedan abiertas para votar indefinidamente):\n${lines.join('\n')}`;
}

const COMMANDS_LIST_WORDS = '(que|cuales|cu[aá]les|cual|lista(do)?|todos)';
const COMMANDS_LIST_TRIGGER = new RegExp(`\\bcomandos?\\b.*\\b${COMMANDS_LIST_WORDS}\\b|\\b${COMMANDS_LIST_WORDS}\\b.*\\bcomandos?\\b`, 'i');

function buildCommandsListReply(config) {
  const staticNames = commandRegistry.STATIC_DEFINITIONS.map((d) => `/${d.name}`);
  const customNames = (config?.customCommands || []).map((c) => `/${c.name}`);
  const all = [...new Set([...staticNames, ...customNames])].sort();
  return `Comandos disponibles en este server (${all.length}): ${all.join(', ')}`;
}

const SERVER_STATS_TRIGGER = /\b(estadisticas?|stats)\b|\bmensajes\s+totales\b|\bcanal\s+mas\s+activo\b/i;

async function buildServerStatsReply(message) {
  const stats = await db.getStats(message.guild.id);
  const channelCounts = stats.channelMessageCounts || {};
  const topEntry = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0];
  const topChannelText = topEntry
    ? `#${message.guild.channels.cache.get(topEntry[0])?.name || topEntry[0]} (${topEntry[1]} mensajes)`
    : '(sin datos todavía)';
  return `Miembros: ${message.guild.memberCount}\nMensajes totales registrados: ${stats.totalMessages}\nCanal más activo: ${topChannelText}`;
}

const SUGGESTIONS_WORDS = '(pendientes?|cuant[oa]s?|hay)';
const SUGGESTIONS_TRIGGER = new RegExp(`\\bsugerencias?\\b.*\\b${SUGGESTIONS_WORDS}\\b|\\b${SUGGESTIONS_WORDS}\\b.*\\bsugerencias?\\b`, 'i');

async function buildSuggestionsReply(message) {
  const pending = await db.getPendingSuggestionsCount(message.guild.id);
  return `Sugerencias pendientes de revisión: ${pending}.`;
}

const STARBOARD_TOP_TRIGGER = /\bmensaje\s+m[aá]s\s+destacado\b|\bdestacados?\b|\bstarboard\b/i;

async function buildStarboardTopReply(message, config) {
  const top = await db.getTopStarredPost(message.guild.id);
  if (!top) return 'Todavía no hay ningún mensaje destacado en el starboard.';
  const emoji = config?.starboard?.emoji || '⭐';
  const jumpLink = `https://discord.com/channels/${message.guild.id}/${top.originalChannelId}/${top.originalMessageId}`;
  const author = message.guild.members.cache.get(top.authorId)?.displayName || `<@${top.authorId}>`;
  return `El mensaje más destacado tiene ${emoji} **${top.starCount}** y es de ${author}: ${jumpLink}`;
}

// quien esta conectado AHORA a un canal de voz puntual — esto no depende del
// cache general de miembros (VoiceState de discord.js siempre esta al dia),
// asi que no necesita ensureFullMemberCache
const VOICE_WORDS = '(quien(es)?|cuant[oa]s?|hay)';
const VOICE_MEMBERS_TRIGGER = new RegExp(`\\bvoz\\b.*\\b${VOICE_WORDS}\\b|\\b${VOICE_WORDS}\\b.*\\bvoz\\b`, 'i');

function findMentionedVoiceChannelByName(guild, content) {
  const normalizedContent = normalizeForMatch(content);
  const channels = [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).values()];
  return channels.filter((c) => c.name && normalizedContent.includes(normalizeForMatch(c.name))).sort((a, b) => b.name.length - a.name.length)[0] || null;
}

// mismo patron que findMentionedVoiceChannelByName pero para canales de
// texto — deja que la IA "lea" un canal puntual con solo nombrarlo (ej.
// "resumime el canal de renders-eventos"), no solo el canal actual
function findMentionedTextChannelByName(guild, content) {
  const normalizedContent = normalizeForMatch(content);
  const channels = [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).values()];
  return channels.filter((c) => c.name && normalizedContent.includes(normalizeForMatch(c.name))).sort((a, b) => b.name.length - a.name.length)[0] || null;
}

// sin esto, alguien podria hacer que el bot lea/resuma un canal privado al
// que no tiene acceso con solo nombrarlo — el chequeo usa los permisos
// reales de quien pregunta, no los del bot
function memberCanViewChannel(channel, member) {
  return channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

function buildVoiceChannelReply(channel) {
  const memberNames = [...channel.members.values()].map((m) => m.displayName);
  return memberNames.length
    ? `**${channel.name}** — ${memberNames.length} conectado(s): ${memberNames.join(', ')}`
    : `**${channel.name}** está vacío ahora mismo.`;
}

// quienes se unieron al server recientemente — necesita el cache completo
// de miembros (mismo motivo que el resto de las consultas por "todos")
const RECENT_JOINS_TRIGGER = /\bse\s+unier?on\b|\bmiembros?\s+nuevos?\b|\bnuevos?\s+miembros?\b/i;

async function buildRecentJoinsReply(guild) {
  await ensureFullMemberCache(guild);
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = [...guild.members.cache.values()]
    .filter((m) => m.joinedAt && m.joinedAt.getTime() >= sevenDaysAgoMs && !m.user.bot)
    .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
    .slice(0, 30);
  if (!recent.length) return 'Nadie se unió al server en los últimos 7 días.';
  const lines = recent.map((m) => `${m.displayName} (<t:${Math.floor(m.joinedAt.getTime() / 1000)}:R>)`);
  return `Miembros nuevos en los últimos 7 días (${recent.length}): ${lines.join(', ')}`;
}

// arma el "insumo" real del resumen automatico reusando las mismas
// funciones deterministicas ya probadas (stats/tickets/sorteos/sugerencias)
// — un objeto "message" sintetico les alcanza porque solo usan message.guild
// (y message.channel.id, que solo importa para saber si SE ESTA preguntando
// desde dentro de un ticket puntual, algo que no aplica aca)
async function buildDigestRealData(guild, config) {
  const fauxMessage = { guild, channel: { id: 'digest' } };
  const [stats, tickets, giveaways, suggestions] = await Promise.all([
    buildServerStatsReply(fauxMessage).catch(() => ''),
    buildTicketsInfoReply(fauxMessage, config).catch(() => ''),
    buildGiveawaysReply(fauxMessage).catch(() => ''),
    buildSuggestionsReply(fauxMessage).catch(() => ''),
  ]);
  return [stats, tickets, giveaways, suggestions].filter(Boolean).join('\n\n');
}

async function sendAiDigest(guildId, config) {
  const digest = config?.ai?.digest;
  const guild = client.guilds.cache.get(guildId);
  if (!guild || !digest?.channelId) return;

  const channel = await guild.channels.fetch(digest.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const realData = await buildDigestRealData(guild, config);

  let content = realData;
  if (aiHelper.isConfigured(config)) {
    const narrated = await aiHelper.buildDailyDigest(client, config, realData, {
      serverName: guild.name,
      botName: config?.branding?.nickname || guild.members.me?.displayName || client.user.username,
      tone: config?.ai?.tone,
      customPersonality: config?.ai?.customPersonality,
      frequency: digest.frequency,
    });
    trackAiUsage(guildId, Boolean(narrated));
    if (narrated) content = narrated;
  }

  const embed = buildEmbed({
    type: 'brand',
    title: `📋 Resumen ${digest.frequency === 'weekly' ? 'semanal' : 'diario'}`,
    description: content,
    config,
  });
  await channel.send({ embeds: [embed] });

  await db.updateGuildConfig(guildId, { ai: { ...config.ai, digest: { ...digest, lastSentAt: new Date().toISOString() } } });
}

// revisa, server por server, si ya paso el intervalo configurado (diario o
// semanal) desde el ultimo resumen mandado — no depende de una hora fija,
// solo de cuanto paso desde la ultima vez
async function checkAiDigests() {
  for (const [guildId, config] of configByGuild) {
    const digest = config?.ai?.digest;
    if (!digest?.enabled || !digest.channelId) continue;

    const intervalMs = digest.frequency === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const last = digest.lastSentAt ? new Date(digest.lastSentAt).getTime() : 0;
    if (Date.now() - last < intervalMs) continue;

    await sendAiDigest(guildId, config).catch((err) => {
      console.error('No se pudo mandar el resumen automático:', err.message);
      errorReporter.reportError(client, config, 'checkAiDigests', err);
    });
  }
}

async function buildChannelSummaryTranscript(message, targetChannel) {
  const channel = targetChannel || message.channel;
  const recent = await channel.messages.fetch({ limit: 25 });
  return [...recent.values()]
    .filter((m) => m.id !== message.id && !m.author.bot)
    .reverse()
    .map((m) => `${m.member?.displayName || m.author.username}: ${m.content}`.replace(/\s+/g, ' ').slice(0, 200))
    .join('\n');
}

// cuenta REAL de quien mando mas mensajes en un canal puntual (ultimos 100
// reales, sin bots) — es lo mas cerca que el bot puede llegar a contestar
// "quien es el mejor/mas activo compartiendo en tal canal" sin inventar un
// juicio de calidad: solo cuenta actividad real (cantidad de mensajes),
// nunca opina sobre que tan bueno es el contenido
async function buildTopPostersReply(channel) {
  const recent = await channel.messages.fetch({ limit: 100 });
  const counts = new Map();
  for (const m of recent.values()) {
    if (m.author.bot) continue;
    const name = m.member?.displayName || m.author.username;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!ranked.length) return `No encontré mensajes recientes de nadie en <#${channel.id}> para contar.`;
  const listText = ranked.map(([name, count], i) => `${i + 1}. ${name} (${count} mensaje${count === 1 ? '' : 's'})`).join('\n');
  return `Según los últimos ${recent.size} mensajes reales de <#${channel.id}>, quiénes más postearon:\n${listText}\n\n(Esto es solo actividad — cantidad de mensajes — no una evaluación de calidad.)`;
}

const TOP_POSTERS_TRIGGER = /qui[eé]n(es)?\s+(m[aá]s\s+(postea|comparte|sube|publica)|son\s+los?\s+mejores?)/i;

// ==== acciones de moderacion por chat con la IA ====
//
// IMPORTANTE: la IA (Groq) NUNCA participa en decidir ni ejecutar estas
// acciones. Todo esto es deteccion por palabra clave (regex) + validacion de
// permisos en código, exactamente igual al patron ya usado para /meme y
// /trivia por chat. Esto es a proposito: como no hay ningun LLM en el medio,
// no existe ningun prompt/injection posible que pueda "convencer" al bot de
// banear a alguien — la unica forma de que esto se ejecute es que un ID de
// Discord real y autorizado escriba un mensaje que matchee el patron, con
// una mencion real (@usuario) como objetivo.
const STAFF_ACTIONS = [
  { type: 'ban', label: 'banear', pattern: /\b(banea(lo|la)?|banear|ban)\b/i, confirm: true },
  { type: 'kick', label: 'expulsar', pattern: /\b(expulsa(lo|la)?|expulsar|echa(lo|la)?|echar|kick(ealo)?)\b/i, confirm: true },
  { type: 'mute', label: 'silenciar', pattern: /\b(silencia(lo|la)?|silenciar|mutea(lo|la)?|mutear|mute|timeout)\b/i, confirm: true },
  { type: 'warn', label: 'advertir', pattern: /\b(advi(e|é)rte(le)?|advertir|amonesta(lo|la)?|amonestar|warn(ealo)?)\b/i, confirm: false },
];

function detectStaffAction(content) {
  for (const action of STAFF_ACTIONS) {
    const match = content.match(action.pattern);
    if (match) return { ...action, matchedText: match[0] };
  }
  return null;
}

// solo el creador del bot (CREATOR_USER_ID) o quien este explicitamente en
// config.ai.staffUserIds de ESE server puede pedir esto por chat — no se usa
// el rol/permiso de discord de quien escribe, es una lista aparte a
// proposito (asi el dueño del bot controla esto independiente de quien sea
// mod en cada server)
function isAiStaffAuthorized(config, userId) {
  if (CREATOR_USER_ID && userId === CREATOR_USER_ID) return true;
  return (config?.ai?.staffUserIds || []).includes(userId);
}

// el objetivo SIEMPRE tiene que ser una mencion real de discord (@usuario),
// nunca se adivina un nombre desde el texto libre — asi no hay forma de que
// la IA (ni nadie por texto) apunte a la persona equivocada
function extractStaffActionTarget(message) {
  return message.mentions.members?.find((member) => member.id !== client.user.id) || null;
}

function extractStaffActionReason(message, targetId, matchedText) {
  let text = message.content;
  text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '');
  text = text.replace(new RegExp(`<@!?${targetId}>`, 'g'), '');
  text = text.replace(matchedText, '');
  text = text.replace(/^\s*((a|al|le|por|que)\s+)+/i, '').trim();
  return text || 'Sin especificar';
}

// permiso de Discord que hace falta (ademas de estar autorizado) por tipo de accion
const STAFF_ACTION_PERMISSIONS = {
  ban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  warn: PermissionFlagsBits.ModerateMembers,
};

// Discord solo permite timeouts de hasta 28 dias (40320 min), igual que el
// maximo de /mute
const MAX_MUTE_MINUTES = 40320;

function extractMuteMinutes(content) {
  const match = content.match(/(\d+)\s*(minutos?|min\b|horas?|hs\b|hrs?\b)/i);
  if (!match) return 10;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const minutes = unit.startsWith('hora') || unit.startsWith('hs') || unit.startsWith('hr') ? amount * 60 : amount;
  return Math.min(MAX_MUTE_MINUTES, Math.max(1, minutes));
}

// shim minimo de "interaction" para reusar los handlers REALES de
// moderationCommands.js sin duplicar su logica (mismos chequeos de rol
// protegido y jerarquia que ya tienen /ban /kick /mute /warn)
function buildModerationShim(message, target, reason, minutes) {
  return {
    guild: message.guild,
    user: message.author,
    member: message.member,
    client,
    options: {
      getUser: () => target.user,
      getString: () => reason,
      getInteger: () => minutes,
    },
    reply: (payload) => message.reply(payload),
  };
}

// pide confirmacion con reacciones antes de ejecutar acciones destructivas;
// solo cuenta la reaccion del mismo usuario que pidio la accion
async function requestModerationConfirmation(message, description) {
  const confirmMsg = await message.reply(`${description}\n\nReaccioná con ✅ para confirmar o ❌ para cancelar (15s).`);
  await confirmMsg.react('✅').catch(() => {});
  await confirmMsg.react('❌').catch(() => {});
  try {
    const collected = await confirmMsg.awaitReactions({
      filter: (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === message.author.id,
      max: 1,
      time: 15000,
      errors: ['time'],
    });
    return collected.first().emoji.name === '✅';
  } catch {
    await message.reply('⏳ Se venció el tiempo para confirmar, cancelado.').catch(() => {});
    return false;
  }
}

// devuelve true si el mensaje matcheaba una accion de staff (autorizada,
// rechazada o cancelada) — en ese caso el caller no debe seguir con el resto
// del flujo de IA para este mensaje. Devuelve false si no era este tipo de
// pedido, y el mensaje sigue su curso normal (ayuda / charla / etc)
async function handleStaffActionRequest(message, config) {
  const action = detectStaffAction(message.content);
  if (!action) return false;

  if (!isAiStaffAuthorized(config, message.author.id)) {
    await message.reply('❌ No tenés permiso para pedirme acciones de moderación por chat.');
    return true;
  }

  // la lista de IDs autoriza a pedir la accion por chat, pero no regala el
  // poder de Discord: quien no es el creador tiene que tener ademas el permiso
  // real (Ban/Kick/Moderar miembros), si no "Gestionar servidor" bastaria para
  // darse poder de moderacion agregando su propio ID a la lista del dashboard
  const requiredPermission = STAFF_ACTION_PERMISSIONS[action.type];
  if (!isCreatorUser(message.author.id) && requiredPermission && !message.member?.permissions.has(requiredPermission)) {
    await message.reply('❌ Además de estar autorizado, necesitas el permiso de Discord correspondiente para esa acción.');
    return true;
  }

  if (!canUseAiNow(message.author.id, aiCooldownMs(config))) {
    await message.reply('⏳ Esperá unos segundos antes de pedirme otra acción.');
    return true;
  }

  const target = extractStaffActionTarget(message);
  if (!target) {
    await message.reply(`Mencioná a la persona (@usuario) para poder ${action.label}la/o.`);
    return true;
  }

  const reason = extractStaffActionReason(message, target.id, action.matchedText);

  try {
    if (action.type === 'mute') {
      const minutes = extractMuteMinutes(message.content);
      if (action.confirm) {
        const ok = await requestModerationConfirmation(message, `🔇 Vas a **silenciar** a <@${target.id}> por ${minutes} min. Motivo: ${reason}`);
        if (!ok) {
          await message.reply('❌ Cancelado.');
          return true;
        }
      }
      await moderationCommands.handleMuteCommand(buildModerationShim(message, target, reason, minutes), config);
      return true;
    }

    if (action.type === 'warn') {
      await moderationCommands.handleWarnCommand(buildModerationShim(message, target, reason, null), config);
      return true;
    }

    const emoji = action.type === 'ban' ? '🔨' : '👢';
    const verb = action.type === 'ban' ? 'banear' : 'expulsar';
    const ok = await requestModerationConfirmation(message, `${emoji} Vas a **${verb}** a <@${target.id}>. Motivo: ${reason}`);
    if (!ok) {
      await message.reply('❌ Cancelado.');
      return true;
    }
    if (action.type === 'ban') {
      await moderationCommands.handleBanCommand(buildModerationShim(message, target, reason, null), config);
    } else {
      await moderationCommands.handleKickCommand(buildModerationShim(message, target, reason, null), config);
    }
    return true;
  } catch (err) {
    console.error('Error ejecutando acción de moderación por IA:', err);
    await errorReporter.reportError(client, config, 'handleStaffActionRequest', err);
    await message.reply('⚠️ Algo falló al ejecutar esa acción.').catch(() => {});
    return true;
  }
}

// /preguntar: version privada (efimera) de charlar con la IA, sin tener que
// mencionarla en publico. Comparte las mismas protecciones (canal permitido,
// cooldown, temas prohibidos) que el resto de los caminos de IA
async function handlePreguntarCommand(interaction, config) {
  if (!config?.ai?.enabled || !aiHelper.isConfigured(config)) {
    await interaction.reply({ content: '⚠️ La IA no está activada en este server.', ephemeral: true });
    return;
  }
  if (!isAiChannelAllowed(config, interaction.channel.id)) {
    await interaction.reply({ content: '⚠️ La IA no responde en este canal.', ephemeral: true });
    return;
  }
  if (!canUseAiNow(interaction.user.id, aiCooldownMs(config))) {
    await interaction.reply({ content: '⏳ Esperá unos segundos antes de preguntar de nuevo.', ephemeral: true });
    return;
  }

  const question = interaction.options.getString('pregunta', true);
  if (!isCreatorUser(interaction.user.id) && matchForbiddenTopic(question, config?.ai?.forbiddenTopics)) {
    await interaction.reply({ content: 'No puedo hablar de ese tema.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const aiContext = await buildBaseAiContext(interaction.guild, interaction.member, interaction.user, config);
  const reply = await aiHelper.chatReply(interaction.client, config, question, aiContext);
  trackAiUsage(interaction.guild.id, Boolean(reply));
  if (reply) await interaction.editReply(buildAiReplyPayload(config, reply));
  else await interaction.editReply('🤖 No pude pensar una respuesta ahora, probá de nuevo en un rato.');
}

// /explicar: la IA redacta una explicacion a partir de datos REALES del
// comando (nombre/descripcion/opciones tal cual estan registrados, o de
// config.customCommands) — nunca inventa un comando que no existe
async function handleExplicarCommand(interaction, config) {
  const commandName = interaction.options
    .getString('comando', true)
    .trim()
    .replace(/^\//, '')
    .toLowerCase();

  const staticDef = commandRegistry.STATIC_DEFINITIONS.find((d) => d.name === commandName);
  const customDef = config ? (config.customCommands || []).find((c) => c.name === commandName) : null;

  if (!staticDef && !customDef) {
    await interaction.reply({ content: `⚠️ No encontré ningún comando llamado "${commandName}".`, ephemeral: true });
    return;
  }

  const commandInfo = staticDef
    ? `Nombre: /${staticDef.name}\nDescripción real: ${staticDef.description}\nOpciones: ${
        (staticDef.options || []).map((o) => `${o.name} (${o.required ? 'obligatoria' : 'opcional'}): ${o.description}`).join('; ') ||
        'ninguna'
      }`
    : `Nombre: /${customDef.name} (comando personalizado creado en este server)\nDescripción real: ${customDef.description}\nEste comando responde siempre el mismo texto configurado${customDef.adminOnly ? ', y solo lo pueden usar administradores' : ''}.`;

  const fallback = staticDef ? `**/${staticDef.name}** — ${staticDef.description}` : `**/${customDef.name}** — ${customDef.description}`;

  if (!config?.ai?.enabled || !aiHelper.isConfigured(config)) {
    // sin IA configurada igual mostramos la info real, solo que sin redactar
    await interaction.reply({ content: fallback, ephemeral: true });
    return;
  }
  if (!canUseAiNow(interaction.user.id, aiCooldownMs(config))) {
    await interaction.reply({ content: '⏳ Esperá unos segundos antes de pedir otra explicación.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const aiContext = await buildBaseAiContext(interaction.guild, interaction.member, interaction.user, config);
  const explanation = await aiHelper.explainCommand(interaction.client, config, commandInfo, aiContext);
  trackAiUsage(interaction.guild.id, Boolean(explanation));
  await interaction.editReply(explanation || fallback);
}

async function applyAutomod(message, config) {
  const automod = config?.automod;

  if (automod?.enabled) {
    const lowerContent = message.content.toLowerCase();
    const hasBannedWord = automod.bannedWords.some((word) => word && lowerContent.includes(word.toLowerCase()));
    const hasInvite = automod.blockInvites && containsInviteLink(message.content);
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    const isMentionSpam = automod.mentionSpamLimit > 0 && mentionCount > automod.mentionSpamLimit;

    if (hasBannedWord || hasInvite || isMentionSpam) {
      const reason = hasBannedWord ? 'contenido no permitido' : hasInvite ? 'links de invitación' : 'demasiadas menciones';
      const originalContent = message.content;
      await deleteWithWarning(message, reason);
      // no se espera esto: el borrado ya paso (lo que importa para el
      // usuario), la nota de la IA es informativa y puede llegar unos
      // segundos despues al canal de logs sin bloquear nada
      if (automod.aiAssist) {
        assistAutomodLog(message, config, reason, originalContent).catch((err) =>
          console.error('No se pudo generar el análisis de IA para automod:', err.message),
        );
      }
      return true;
    }
  }

  return false;
}

async function assistAutomodLog(message, config, reason, originalContent) {
  if (!config?.ai?.enabled || !aiHelper.isConfigured(config)) return;
  const assessment = await aiHelper.assessAutomodFlag(client, config, originalContent, reason);
  trackAiUsage(message.guild.id, Boolean(assessment));
  if (!assessment) return;
  await logging.sendLog(client, config, {
    type: 'warning',
    title: '🤖 Análisis de IA sobre un mensaje moderado',
    description: assessment,
    fields: [
      { name: 'Usuario', value: `<@${message.author.id}>`, inline: true },
      { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Motivo automático', value: reason, inline: true },
    ],
  });
}

async function setUpGuild(guild) {
  await refreshGuildConfig(guild.id);
  try {
    await commandRegistry.registerGuildCommands(guild, configByGuild.get(guild.id));
  } catch (err) {
    console.error(`No se pudieron registrar los comandos en ${guild.name}:`, err);
  }
  startTipLoop(guild.id);
  startMiniEventLoop(guild.id);
  await updateMemberCounter(guild.id, configByGuild.get(guild.id));
  await inviteTracker.snapshotInvites(guild);
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  await db.connect();
  await botStats.loadBotStats();

  for (const guild of client.guilds.cache.values()) {
    await setUpGuild(guild);
  }

  setInterval(refreshAllConfigs, CONFIG_REFRESH_MS);
  setInterval(() => {
    giveawayCommand.checkExpiredGiveaways(client).catch((err) => {
      console.error('Error revisando sorteos vencidos:', err);
      errorReporter.reportError(client, null, 'giveawayCommand.checkExpiredGiveaways', err);
    });
  }, GIVEAWAY_CHECK_MS);
  setInterval(() => {
    contestCommand.checkExpiredContests(client).catch((err) => {
      console.error('Error revisando concursos vencidos:', err);
      errorReporter.reportError(client, null, 'contestCommand.checkExpiredContests', err);
    });
  }, GIVEAWAY_CHECK_MS);
  setInterval(() => {
    sayCommand.checkScheduledAnnouncements(client).catch((err) => {
      console.error('Error revisando anuncios programados:', err);
      errorReporter.reportError(client, null, 'sayCommand.checkScheduledAnnouncements', err);
    });
  }, SCHEDULED_ANNOUNCEMENT_CHECK_MS);
  setInterval(updateAllMemberCounters, MEMBER_COUNTER_INTERVAL_MS);
  setInterval(() => {
    birthdayCommand.checkBirthdaysToday(client, configByGuild).catch((err) => {
      console.error('Error revisando cumpleaños:', err);
      errorReporter.reportError(client, null, 'birthdayCommand.checkBirthdaysToday', err);
    });
  }, BIRTHDAY_CHECK_MS);
  birthdayCommand.checkBirthdaysToday(client, configByGuild).catch((err) => console.error('Error revisando cumpleaños al iniciar:', err));
  setInterval(() => {
    checkAiDigests().catch((err) => {
      console.error('Error revisando resúmenes automáticos:', err);
      errorReporter.reportError(client, null, 'checkAiDigests', err);
    });
  }, AI_DIGEST_CHECK_MS);
  setInterval(() => {
    alerts.checkAllAlerts(client, configByGuild).catch((err) => {
      console.error('Error revisando alertas:', err);
      errorReporter.reportError(client, null, 'alerts.checkAllAlerts', err);
    });
  }, ALERTS_CHECK_MS);

  setInterval(() => botStats.flushBotStats(), BOT_STATS_FLUSH_MS);
  // BOT_STATUS=off apaga el estado rotativo del perfil del bot
  if (String(process.env.BOT_STATUS || '').toLowerCase() !== 'off') {
    botStatus.startBotStatus(client, { intervalMs: (Number(process.env.BOT_STATUS_SECONDS) || 30) * 1000 });
  }

  const webApp = createApp({ client });
  webApp.listen(process.env.PORT || 3000, () => {
    console.log('Dashboard web arriba.');
  });
});

// Render avisa con SIGTERM antes de reemplazar el servicio en cada deploy: se
// guardan los contadores pendientes antes de salir (con un tope por si la base no responde)
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    setTimeout(() => process.exit(0), 3000).unref();
    botStats.flushBotStats().finally(() => process.exit(0));
  });
}

client.on('guildCreate', async (guild) => {
  console.log(`Bot agregado a un nuevo server: ${guild.name}`);
  await setUpGuild(guild);
});

client.on('guildDelete', (guild) => {
  configByGuild.delete(guild.id);
  findHelpResponseByGuild.delete(guild.id);
  trackerByGuild.delete(guild.id);
  stopTipLoop(guild.id);
  stopMiniEventLoop(guild.id);
});

client.on('inviteCreate', (invite) => inviteTracker.handleInviteCreate(invite));
client.on('inviteDelete', (invite) => inviteTracker.handleInviteDelete(invite));

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  const guildId = message.guild.id;
  const config = configByGuild.get(guildId);

  try {
    const wasSuggestion = await suggestionBox.handleSuggestionMessage(message, config);
    if (wasSuggestion) return;

    afkCommand.handleAfkMessage(message).catch((err) => console.error('No se pudo procesar el estado AFK:', err));

    if (WHITELIST.length === 0 || WHITELIST.includes(message.channel.id)) {
      getTracker(guildId).registerMessage(message.channel.id);
    }
    db.incrementMessageStat(guildId, message.channel.id).catch((err) =>
      console.error('No se pudo registrar la estadística del mensaje:', err),
    );

    const wasRemoved = await applyAutomod(message, config);
    if (wasRemoved) return;

    if (config) {
      const wasTextCommand = await textCommands.handleTextCommand(message, config);
      if (wasTextCommand) {
        botStats.recordCommand();
        return;
      }

      levelCommands.awardXp(message, config).catch((err) => console.error('No se pudo otorgar XP:', err));

      // si el bot esta en una charla en este canal, lo que dice la gente le
      // llega siempre (aunque despues no conteste): es lo que "escucha"
      conversation.observe(message, config);
    }

    const mentionsBot = message.mentions.has(client.user.id);
    const directedElsewhere = isDirectedAtAnotherUser({
      mentionsBot,
      repliedUserId: message.mentions.repliedUser ? message.mentions.repliedUser.id : null,
      mentionedUserIds: message.mentions.users.map((user) => user.id),
      botId: client.user.id,
    });
    if (directedElsewhere) return;

    if (mentionsBot && config?.ai?.enabled) {
      const wasStaffAction = await handleStaffActionRequest(message, config);
      if (wasStaffAction) return;
    }

    const findHelpResponse = findHelpResponseByGuild.get(guildId) || (() => null);
    const response = findHelpResponse(message.content);

    if (response === NEEDS_FALLBACK) {
      let reply = config?.helpResponses?.fallbackResponse;
      let aiGenerated = false;
      if (!isCreatorUser(message.author.id) && matchForbiddenTopic(message.content, config?.ai?.forbiddenTopics)) {
        reply = 'No puedo hablar de ese tema.';
      } else if (
        config?.ai?.enabled &&
        config.ai.helpFallback &&
        aiHelper.isConfigured(config) &&
        isAiChannelAllowed(config, message.channel.id) &&
        canUseAiNow(message.author.id, aiCooldownMs(config))
      ) {
        const aiContext = await buildAiContext(message, config);
        const aiReply = await aiHelper.answerHelpQuestion(client, config, prepareAiText(message), aiContext);
        trackAiUsage(guildId, Boolean(aiReply));
        if (aiReply) {
          reply = aiReply;
          aiGenerated = true;
        }
      }
      if (reply) {
        if (aiGenerated) await sendAiReply(message, config, reply);
        else await message.reply(reply);
      }
    } else if (response) {
      await message.reply(response);
    } else if (
      mentionsBot &&
      config?.ai?.enabled &&
      (config.ai.helpFallback || conversation.isEnabledFor(config, message.channel.id)) &&
      aiHelper.isConfigured(config) &&
      isAiChannelAllowed(config, message.channel.id)
    ) {
      // lo mencionaron directo y no matcheo ningun tema de ayuda: charla en
      // modo mas general en vez de quedarse callado
      const cleanedContent = prepareAiText(message);
      // en el canal de conversacion libre, una mencion sin texto ("@bot" a
      // secas) tambien vale: el bot lee la charla y se suma
      if (cleanedContent || conversation.isEnabledFor(config, message.channel.id)) {
        if (!canUseAiNow(message.author.id, aiCooldownMs(config))) {
          await message.reply('⏳ Esperá unos segundos antes de volver a preguntarme algo.');
        } else {
          // el placeholder "Pensando..." reemplaza la vieja reaccion 🤔: se
          // anima solo mientras la IA procesa, y termina convertido en la
          // respuesta final (o en el resultado real de meme/trivia/etc)
          const thinking = await startThinking(message);
          try {
            if (/\bmemes?\b/i.test(cleanedContent)) {
              // pidio un meme por chat: se manda un meme real (misma logica
              // que /meme) en vez de que la IA "hable" de mandarlo, que es lo
              // que generaba el link falso de imgur.com
              await memeCommand.handleMemeCommand(
                {
                  deferReply: async () => {},
                  editReply: (payload) => (thinking ? thinking.stop(payload) : message.reply(payload)),
                },
                config,
              );
            } else if (/\btrivia\b/i.test(cleanedContent)) {
              // idem, pero disparando una trivia real en vez de que la IA
              // hable de hacer una
              let sentMessage = null;
              await triviaCommand.handleTriviaCommand(
                {
                  reply: async (payload) => {
                    sentMessage = thinking ? await thinking.stop(payload) : await message.reply(payload);
                    return sentMessage;
                  },
                  fetchReply: async () => sentMessage,
                  guild: message.guild,
                },
                config,
              );
            } else if (TOP_POSTERS_TRIGGER.test(cleanedContent) && findMentionedTextChannelByName(message.guild, cleanedContent)) {
              // "quien es el mejor en renders" no tiene una respuesta real posible
              // (es una opinion, no un dato) — pero si nombran un canal real, esto
              // contesta con lo mas cercano y honesto: quien mas posteo ahi de
              // verdad, en vez de que la IA invente un nombre
              const targetChannel = findMentionedTextChannelByName(message.guild, cleanedContent);
              const payload = !memberCanViewChannel(targetChannel, message.member)
                ? '⚠️ No puedo leer ese canal.'
                : await buildTopPostersReply(targetChannel).catch((err) => {
                    console.error('No se pudo armar el ranking de actividad:', err.message);
                    return '⚠️ No pude revisar ese canal ahora, probá de nuevo en un rato.';
                  });
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (/\bresum/i.test(cleanedContent)) {
              // si nombran un canal real distinto del actual, resume ESE canal
              // (chequeando que quien pregunta lo pueda ver) — si no, sigue
              // resumiendo el canal actual como antes
              const namedChannel = findMentionedTextChannelByName(message.guild, cleanedContent);
              const targetChannel = namedChannel && namedChannel.id !== message.channel.id ? namedChannel : null;
              let payload;
              if (targetChannel && !memberCanViewChannel(targetChannel, message.member)) {
                payload = '⚠️ No puedo leer ese canal.';
              } else {
                const transcript = await buildChannelSummaryTranscript(message, targetChannel).catch((err) => {
                  console.error('No se pudo traer mensajes para el resumen:', err.message);
                  return '';
                });
                const aiContext = await buildAiContext(message, config);
                const summary = await aiHelper.summarizeChannel(client, config, transcript, aiContext);
                trackAiUsage(guildId, Boolean(summary));
                payload = summary ? buildAiReplyPayload(config, summary) : '🤖 No pude armar el resumen ahora, probá de nuevo en un rato.';
              }
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (/\bperfil\b/i.test(cleanedContent)) {
              // tarjeta de perfil: 100% datos reales de la base, sin pasar
              // por la IA — mismo patron que meme/trivia
              const embed = await buildProfileEmbed(message, config).catch((err) => {
                console.error('No se pudo armar el perfil:', err.message);
                return null;
              });
              const payload = embed ? { embeds: [embed] } : '⚠️ No pude armar el perfil ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (ROLE_MEMBERS_TRIGGER.test(cleanedContent) && findMentionedRoleByName(message.guild, cleanedContent)) {
              // "cuantos/quienes tienen el rol X": conteo y lista REAL del
              // cache de miembros, nunca por la IA (asi no se inventa un
              // numero ni nombres que no tienen ese rol)
              const role = findMentionedRoleByName(message.guild, cleanedContent);
              const roleReply = await buildRoleMembersReply(role).catch((err) => {
                console.error('No se pudo armar el conteo del rol:', err.message);
                return null;
              });
              const payload = roleReply
                ? buildAiReplyPayload(config, roleReply)
                : '⚠️ No pude contar los miembros de ese rol ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (
              TICKETS_INFO_TRIGGER.test(cleanedContent) &&
              !message.mentions.members?.find((m) => m.id !== client.user.id)
            ) {
              // si ademas mencionan a alguien ("cuantos tickets abrio @fulano"),
              // no es una pregunta general del server sino sobre esa persona
              // puntual — se deja pasar para que lo resuelva buildRealDataForQuery
              const ticketsReply = await buildTicketsInfoReply(message, config).catch((err) => {
                console.error('No se pudo armar la info de tickets:', err.message);
                return null;
              });
              const payload = ticketsReply
                ? buildAiReplyPayload(config, ticketsReply)
                : '⚠️ No pude traer la info de tickets ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (SHOP_TRIGGER.test(cleanedContent)) {
              const payload = buildAiReplyPayload(config, buildShopReply(config));
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (HOUSES_INFO_TRIGGER.test(cleanedContent)) {
              const housesReply = await buildHousesInfoReply(message, config).catch((err) => {
                console.error('No se pudo armar la info de houses:', err.message);
                return null;
              });
              const payload = housesReply
                ? buildAiReplyPayload(config, housesReply)
                : '⚠️ No pude traer la info de houses ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (LEVELS_LEADERBOARD_TRIGGER.test(cleanedContent)) {
              const levelsReply = await buildLevelsLeaderboardReply(message).catch((err) => {
                console.error('No se pudo armar el ranking de niveles:', err.message);
                return null;
              });
              const payload = levelsReply
                ? buildAiReplyPayload(config, levelsReply)
                : '⚠️ No pude traer el ranking ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (ECONOMY_LEADERBOARD_TRIGGER.test(cleanedContent)) {
              const economyReply = await buildEconomyLeaderboardReply(message, config).catch((err) => {
                console.error('No se pudo armar el ranking de economía:', err.message);
                return null;
              });
              const payload = economyReply
                ? buildAiReplyPayload(config, economyReply)
                : '⚠️ No pude traer el ranking ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (GIVEAWAYS_TRIGGER.test(cleanedContent)) {
              const giveawaysReply = await buildGiveawaysReply(message).catch((err) => {
                console.error('No se pudo armar la info de sorteos:', err.message);
                return null;
              });
              const payload = giveawaysReply
                ? buildAiReplyPayload(config, giveawaysReply)
                : '⚠️ No pude traer la info de sorteos ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (POLLS_TRIGGER.test(cleanedContent)) {
              const pollsReply = await buildPollsReply(message).catch((err) => {
                console.error('No se pudo armar la info de encuestas:', err.message);
                return null;
              });
              const payload = pollsReply
                ? buildAiReplyPayload(config, pollsReply)
                : '⚠️ No pude traer la info de encuestas ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (COMMANDS_LIST_TRIGGER.test(cleanedContent)) {
              const payload = buildAiReplyPayload(config, buildCommandsListReply(config));
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (SERVER_STATS_TRIGGER.test(cleanedContent)) {
              const statsReply = await buildServerStatsReply(message).catch((err) => {
                console.error('No se pudo armar las estadísticas del server:', err.message);
                return null;
              });
              const payload = statsReply
                ? buildAiReplyPayload(config, statsReply)
                : '⚠️ No pude traer las estadísticas ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (SUGGESTIONS_TRIGGER.test(cleanedContent)) {
              const suggestionsReply = await buildSuggestionsReply(message).catch((err) => {
                console.error('No se pudo armar la info de sugerencias:', err.message);
                return null;
              });
              const payload = suggestionsReply
                ? buildAiReplyPayload(config, suggestionsReply)
                : '⚠️ No pude traer la info de sugerencias ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (STARBOARD_TOP_TRIGGER.test(cleanedContent)) {
              const starboardReply = await buildStarboardTopReply(message, config).catch((err) => {
                console.error('No se pudo armar la info de starboard:', err.message);
                return null;
              });
              const payload = starboardReply
                ? buildAiReplyPayload(config, starboardReply)
                : '⚠️ No pude traer la info de starboard ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (VOICE_MEMBERS_TRIGGER.test(cleanedContent) && findMentionedVoiceChannelByName(message.guild, cleanedContent)) {
              const voiceChannel = findMentionedVoiceChannelByName(message.guild, cleanedContent);
              const payload = buildAiReplyPayload(config, buildVoiceChannelReply(voiceChannel));
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (RECENT_JOINS_TRIGGER.test(cleanedContent)) {
              const joinsReply = await buildRecentJoinsReply(message.guild).catch((err) => {
                console.error('No se pudo armar la lista de miembros nuevos:', err.message);
                return null;
              });
              const payload = joinsReply
                ? buildAiReplyPayload(config, joinsReply)
                : '⚠️ No pude traer la lista de miembros nuevos ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (/\btraduc/i.test(cleanedContent)) {
              const aiContext = await buildAiContext(message, config);
              const translation = await aiHelper.translateText(client, config, cleanedContent, aiContext);
              trackAiUsage(guildId, Boolean(translation));
              const payload = translation ? buildAiReplyPayload(config, translation) : '🤖 No pude traducir eso ahora, probá de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            } else if (
              /\bsuger\w*\b.*\brespuesta\b/i.test(cleanedContent) &&
              (await db.getTicketByChannelId(message.channel.id).catch(() => null))?.status === 'open'
            ) {
              // asistente de tickets: solo staff autorizado (misma lista que
              // usa la moderacion por chat) y solo dentro de un ticket
              // abierto — sugiere una respuesta, nunca la manda ni cierra nada
              if (!isAiStaffAuthorized(config, message.author.id)) {
                const payload = '❌ Solo el staff autorizado puede pedirme esto.';
                if (thinking) await thinking.stop(payload);
                else await message.reply(payload);
              } else {
                const transcript = await buildChannelSummaryTranscript(message).catch((err) => {
                  console.error('No se pudo traer mensajes del ticket:', err.message);
                  return '';
                });
                const aiContext = await buildAiContext(message, config);
                const suggestion = await aiHelper.suggestTicketReply(client, config, transcript, aiContext);
                trackAiUsage(guildId, Boolean(suggestion));
                const payload = suggestion
                  ? buildAiReplyPayload(config, suggestion)
                  : '🤖 No pude armar una sugerencia ahora, probá de nuevo en un rato.';
                if (thinking) await thinking.stop(payload);
                else await message.reply(payload);
              }
            } else if (!isCreatorUser(message.author.id) && matchForbiddenTopic(cleanedContent, config?.ai?.forbiddenTopics)) {
              if (thinking) await thinking.stop('No puedo hablar de ese tema.');
              else await message.reply('No puedo hablar de ese tema.');
            } else if (
              conversation.isEnabledFor(config, message.channel.id) &&
              !renderFeedback.findImageAttachment(message) &&
              (await conversation.engage(message, config, { thinking }))
            ) {
              // el modo conversacion se encargo: leyo la charla, contesto y
              // se queda participando hasta que la gente deje de hablar
            } else {
              const aiContext = await buildAiContext(message, config);
              aiContext.realData = await buildRealDataForQuery(message);
              // si mandaron una imagen junto con la mencion, se intenta
              // responder viendola de verdad (chatReply se degrada solo a
              // texto si la cuenta no tiene acceso a un modelo con vision)
              aiContext.imageUrl = renderFeedback.findImageAttachment(message)?.url || null;
              const chatReply = await aiHelper.chatReply(client, config, cleanedContent, aiContext);
              trackAiUsage(guildId, Boolean(chatReply));
              // si la IA falla (timeout, rate limit, etc.) igual contesta algo
              // en vez de quedarse en silencio total despues de que la mencionaron
              const payload = chatReply
                ? buildAiReplyPayload(config, chatReply)
                : '🤖 No pude pensar una respuesta ahora, mencioname de nuevo en un rato.';
              if (thinking) await thinking.stop(payload);
              else await message.reply(payload);
            }
          } catch (err) {
            if (thinking) await thinking.stop('⚠️ Ocurrió un error procesando tu pedido.');
            throw err;
          }
        }
      }
    } else if (config && conversation.isActive(message.channel.id)) {
      // el bot esta en una charla en este canal y este mensaje no lo
      // respondio ninguna otra funcion ni iba dirigido a otra persona: puede
      // sumarse (o quedarse callado, lo decide la IA)
      await conversation.maybeReply(message, config);
    }
  } catch (err) {
    console.error('Error en messageCreate:', err);
    await errorReporter.reportError(client, config, 'messageCreate', err);
  }
});

client.on('messageDelete', async (message) => {
  if (!message.guild) return;
  const config = configByGuild.get(message.guild.id);
  try {
    await logging.logMessageDelete(client, config, message);
  } catch (err) {
    console.error('Error en messageDelete:', err);
    await errorReporter.reportError(client, config, 'messageDelete', err);
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  const config = configByGuild.get(newMessage.guild.id);
  try {
    await logging.logMessageUpdate(client, config, oldMessage, newMessage);
  } catch (err) {
    console.error('Error en messageUpdate:', err);
    await errorReporter.reportError(client, config, 'messageUpdate', err);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  const config = reaction.message.guild ? configByGuild.get(reaction.message.guild.id) : null;
  try {
    await reactionRoles.handleReactionChange(reaction, user, 'add');
    await miniEvents.handleMiniEventReaction(reaction, user);
    if (config) await starboard.handleStarboardReaction(reaction, config);
    if (config) await renderFeedback.handleRenderFeedbackReaction(reaction, user, config);
  } catch (err) {
    console.error('Error en messageReactionAdd:', err);
    await errorReporter.reportError(client, config, 'messageReactionAdd', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  const config = reaction.message.guild ? configByGuild.get(reaction.message.guild.id) : null;
  try {
    await reactionRoles.handleReactionChange(reaction, user, 'remove');
    if (config) await starboard.handleStarboardReaction(reaction, config);
  } catch (err) {
    console.error('Error en messageReactionRemove:', err);
    await errorReporter.reportError(client, config, 'messageReactionRemove', err);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const config = guild ? configByGuild.get(guild.id) : null;
  try {
    await voiceXp.handleVoiceStateUpdate(oldState, newState, config);
  } catch (err) {
    console.error('Error en voiceStateUpdate:', err);
    await errorReporter.reportError(client, config, 'voiceStateUpdate', err);
  }
});

client.on('guildMemberAdd', async (member) => {
  const config = configByGuild.get(member.guild.id);
  try {
    await logging.logMemberJoin(client, config, member);
    await inviteTracker.handleMemberJoin(member, config);

    const welcome = config?.welcome;
    // los bots que entran reciben su propio rol (si hay uno configurado) en
    // vez del de los humanos, y no se les manda mensaje de bienvenida
    const autoRoleId = member.user.bot ? welcome?.botRoleId : welcome?.roleId;
    if (autoRoleId) {
      try {
        await member.roles.add(autoRoleId);
      } catch (err) {
        console.error('No se pudo asignar el autorole:', err);
      }
    }

    if (member.user.bot) return;
    if (!welcome || !welcome.enabled || !welcome.channelId) return;

    const channel = await client.channels.fetch(welcome.channelId);
    if (channel && channel.isTextBased()) {
      // un diseño de "Mensajes avanzados" reemplaza al texto/embed/tarjeta; si
      // ya no existe (se borró) se sigue con el mensaje normal de abajo
      if (welcome.richMessageId) {
        const rich = await db.getRichMessage(member.guild.id, welcome.richMessageId);
        if (rich) {
          await channel.send(
            richMessage.buildRichPayload(rich, {
              user: `<@${member.id}>`,
              username: member.user.username,
              server: member.guild.name,
              membercount: member.guild.memberCount,
              joindate: (member.joinedAt || new Date()).toLocaleDateString('es-AR'),
              avatar: member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
              servericon: member.guild.iconURL({ extension: 'png', size: 256 }) || '',
              allowedMentions: { users: [member.id] },
            }),
          );
          return;
        }
      }

      let text = formatTemplate(welcome.message, member);
      if (welcome.aiPersonalized && aiHelper.isConfigured(config)) {
        const aiText = await aiHelper.buildWelcomeMessage(client, config, {
          serverName: member.guild.name,
          botName: config?.branding?.nickname || member.guild.members.me?.displayName || client.user.username,
          memberName: `<@${member.id}>`,
          memberCount: member.guild.memberCount,
          tone: config?.ai?.tone,
          customPersonality: config?.ai?.customPersonality,
        });
        trackAiUsage(member.guild.id, Boolean(aiText));
        // si la IA falla, se sigue con el mensaje fijo de arriba en vez de
        // dejar al nuevo miembro sin ningun saludo
        if (aiText) text = aiText;
      }
      const card = await buildCardAttachment(welcome.card, member, welcomeCard.DEFAULT_CARD);
      if (welcome.useEmbed) {
        // con tarjeta, la imagen del embed es la tarjeta (ya trae el avatar)
        const embed = buildEmbed({
          type: 'success',
          title: welcome.embedTitle || '👋 ¡Nuevo miembro!',
          description: text,
          thumbnail: card ? undefined : member.user.displayAvatarURL(),
          image: card ? `attachment://${CARD_FILE_NAME}` : welcome.imageUrl || undefined,
          config,
        });
        await channel.send({ embeds: [embed], files: card ? [card] : [] });
      } else {
        await channel.send({ content: text, files: card ? [card] : [] });
      }
    }
  } catch (err) {
    console.error('No se pudo mandar el mensaje de bienvenida:', err);
    await errorReporter.reportError(client, config, 'guildMemberAdd', err);
  }
});

client.on('guildMemberRemove', async (member) => {
  const config = configByGuild.get(member.guild.id);
  try {
    await logging.logMemberLeave(client, config, member);

    const goodbye = config?.goodbye;
    if (!goodbye || !goodbye.enabled || !goodbye.channelId) return;

    const channel = await client.channels.fetch(goodbye.channelId);
    if (channel && channel.isTextBased()) {
      const text = formatTemplate(goodbye.message, member);
      const card = await buildCardAttachment(goodbye.card, member, welcomeCard.DEFAULT_GOODBYE_CARD);
      if (goodbye.useEmbed) {
        const embed = buildEmbed({
          type: 'warning',
          title: '👋 Se fue un miembro',
          description: text,
          thumbnail: card ? undefined : member.user.displayAvatarURL(),
          image: card ? `attachment://${CARD_FILE_NAME}` : undefined,
          config,
        });
        await channel.send({ embeds: [embed], files: card ? [card] : [] });
      } else {
        await channel.send({ content: text, files: card ? [card] : [] });
      }
    }
  } catch (err) {
    console.error('No se pudo mandar el mensaje de despedida:', err);
    await errorReporter.reportError(client, config, 'guildMemberRemove', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  const guildConfig = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
  if (interaction.isChatInputCommand()) botStats.recordCommand();
  try {
    await handleInteraction(interaction);
  } catch (err) {
    console.error('Error en interactionCreate:', err);
    // código 10062 = la interacción expiró antes de que pudiéramos responder (lag de Discord/hosting),
    // no es un bug del bot y reportarla cada vez solo generaría ruido en el canal de errores
    if (err.code !== 10062) {
      await errorReporter.reportError(client, guildConfig, `interactionCreate (${interaction.type})`, err);
    }
  }
});

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;

    switch (interaction.commandName) {
      case 'anuncio':
        await announceCommand.handleAnnounceCommand(interaction, config);
        break;
      case 'ticket':
        await ticketCommand.handleTicketCommand(interaction, config);
        break;
      case 'nivel':
        await levelCommands.handleNivelCommand(interaction, config);
        break;
      case 'ranking':
        await levelCommands.handleRankingCommand(interaction, config);
        break;
      case 'ban':
        await moderationCommands.handleBanCommand(interaction, config);
        break;
      case 'kick':
        await moderationCommands.handleKickCommand(interaction, config);
        break;
      case 'mute':
        await moderationCommands.handleMuteCommand(interaction, config);
        break;
      case 'warn':
        await moderationCommands.handleWarnCommand(interaction, config);
        break;
      case 'warnings':
        await moderationCommands.handleWarningsCommand(interaction, config);
        break;
      case 'casa':
        await housesCommand.handleCasaCommand(interaction, config);
        break;
      case 'economia':
        await economyCommands.handleEconomyCommand(interaction, config);
        break;
      case 'casino':
        await casinoCommands.handleCasinoCommand(interaction, config);
        break;
      case 'casar':
        await marriageCommands.handleCasarCommand(interaction);
        break;
      case 'divorciar':
        await marriageCommands.handleDivorciarCommand(interaction);
        break;
      case 'pareja':
        await marriageCommands.handleParejaCommand(interaction);
        break;
      case 'mascota':
        await petCommands.handlePetCommand(interaction, config);
        break;
      case 'trivia':
        await triviaCommand.handleTriviaCommand(interaction, config);
        break;
      case 'meme':
        await memeCommand.handleMemeCommand(interaction, config);
        break;
      case 'debug':
        await debugCommand.handleDebugCommand(interaction, config);
        break;
      case 'sorteo':
        await giveawayCommand.handleGiveawayCommand(interaction, config);
        break;
      case 'concurso':
        await contestCommand.handleContestCommand(interaction, config);
        break;
      case 'encuesta':
        await pollCommand.handlePollCommand(interaction, config);
        break;
      case 'afk':
        await afkCommand.handleAfkCommand(interaction);
        break;
      case 'cumpleanos':
        await birthdayCommand.handleBirthdayCommand(interaction);
        break;
      case 'invitaciones':
        await inviteCommand.handleInviteCommand(interaction, config);
        break;
      case 'infoserver':
        await serverInfoCommand.handleInfoServerCommand(interaction, config);
        break;
      case 'portfolio':
        await portfolioCommand.handlePortfolioCommand(interaction, config);
        break;
      case 'skills':
        await skillsCommand.handleSkillsCommand(interaction, config);
        break;
      case 'accion':
        await socialCommands.handleAccionCommand(interaction, config);
        break;
      case 'rep':
        await socialCommands.handleRepCommand(interaction, config);
        break;
      case 'robar':
        await socialCommands.handleRobarCommand(interaction, config);
        break;
      case 'crimen':
        await socialCommands.handleCrimenCommand(interaction, config);
        break;
      case 'ship':
        await socialCommands.handleShipCommand(interaction, config);
        break;
      case '8ball':
        await socialCommands.handleEightBallCommand(interaction, config);
        break;
      case 'avatar':
        await socialCommands.handleAvatarCommand(interaction, config);
        break;
      case 'mezclar':
        await socialCommands.handleMezclarCommand(interaction, config);
        break;
      case 'juego':
        await miniGames.handleJuegoCommand(interaction, config);
        break;
      case 'decir':
        await sayCommand.handleDecirCommand(interaction);
        break;
      case 'programar':
        await sayCommand.handleProgramarCommand(interaction);
        break;
      case 'preguntar':
        await handlePreguntarCommand(interaction, config);
        break;
      case 'explicar':
        await handleExplicarCommand(interaction, config);
        break;
      default: {
        const custom = config ? customCommands.findCustomCommand(config, interaction.commandName) : null;
        if (custom) await customCommands.handleCustomCommand(interaction, config, custom);
        break;
      }
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
    if (config) await housesCommand.handleModalSubmit(interaction, config);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith(ticketCommand.CATEGORY_SELECT_ID)) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await ticketCommand.handleCategorySelect(interaction, config);
    } else if (interaction.customId === selectRoles.SELECT_MENU_ID) {
      await selectRoles.handleSelectMenu(interaction);
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === ticketCommand.CLOSE_BUTTON_ID) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      await ticketCommand.handleCloseButton(interaction, config);
      return;
    }

    if (interaction.customId === ticketCommand.CLAIM_BUTTON_ID) {
      await ticketCommand.handleClaimButton(interaction);
      return;
    }

    if (interaction.customId.startsWith(`${ticketCommand.OPEN_BUTTON_PREFIX}:`)) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await ticketCommand.handleOpenButton(interaction, config);
      return;
    }

    if (interaction.customId.startsWith(ticketCommand.RATE_PREFIX)) {
      await ticketCommand.handleRatingButton(interaction);
      return;
    }

    if (interaction.customId === 'bj-hit' || interaction.customId === 'bj-stand') {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await casinoCommands.handleBlackjackButton(interaction, config);
      return;
    }

    if (interaction.customId.startsWith('trivia-opt-')) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await triviaCommand.handleTriviaButton(interaction, config);
      return;
    }

    if (interaction.customId.startsWith('marry-accept:') || interaction.customId.startsWith('marry-reject:')) {
      await marriageCommands.handleMarriageButton(interaction);
      return;
    }

    if (interaction.customId.startsWith(giveawayCommand.ENTER_BUTTON_PREFIX)) {
      await giveawayCommand.handleEnterButton(interaction, interaction.guild ? configByGuild.get(interaction.guild.id) : null);
      return;
    }

    if (interaction.customId.startsWith(pollCommand.VOTE_BUTTON_PREFIX)) {
      await pollCommand.handleVoteButton(interaction, interaction.guild ? configByGuild.get(interaction.guild.id) : null);
      return;
    }

    if (interaction.customId === suggestionBox.VOTE_UP_ID || interaction.customId === suggestionBox.VOTE_DOWN_ID) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await suggestionBox.handleVoteButton(interaction, config);
      return;
    }

    if (interaction.customId === suggestionBox.APPROVE_ID || interaction.customId === suggestionBox.REJECT_ID) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await suggestionBox.handleDecisionButton(interaction, config);
      return;
    }

    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
    if (!config) return;

    if (interaction.customId === housesCommand.OPEN_BUTTON_ID) {
      await housesCommand.handleOpenButton(interaction, config);
    } else if (interaction.customId.startsWith('house-accept:') || interaction.customId.startsWith('house-reject:')) {
      await housesCommand.handleDecisionButton(interaction, config);
    } else if (interaction.customId.startsWith(serverGuide.BUTTON_PREFIX)) {
      await serverGuide.handleGuideButton(interaction, config);
    }
  }
}

client.login(TOKEN);
