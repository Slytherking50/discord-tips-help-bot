const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('./embedStyle');

// perfiles de miembros (diseño en PERFILES-DISENO.md, fase 1): el bot crea un perfil por cada miembro (los que ya estan y los que van
// entrando) con sus datos de Discord y unos contadores de actividad. NUNCA guarda el texto de los mensajes. Cada persona puede verlo con
// /perfil ver y borrarlo con /perfil olvidar; el staff lo ve en la pagina "Perfiles" del panel.

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_DAYS = 30; // ventana de "mensajes del ultimo mes"
const MAX_ROLES = 15; // roles que se guardan por perfil (los de mas arriba)
const BULK_CHUNK = 500; // perfiles por operacion cuando se crean todos de golpe
const FLUSH_MS = 60 * 1000; // cada cuanto se guardan los contadores de mensajes acumulados en memoria
const MAINTENANCE_MS = 6 * 60 * 60 * 1000; // borrado de perfiles de quien se fue y limpieza de dias viejos
const BACKFILL_DELAY_MS = 20 * 1000; // la creacion masiva espera un poco tras arrancar para no competir con el arranque
const OLD_DAY_KEYS = 7; // dias que acaban de salir de la ventana, que se limpian en cada mantenimiento
const RETENTION_CHOICES = [7, 30, 90];
const SHOWN_ROLES = 10; // roles que muestra /perfil ver

const DEFAULT_SETTINGS = { enabled: true, trackActivity: true, excludedRoleIds: [], retentionDays: 30, backfilledAt: null };

function settingsFor(config) {
  const raw = config?.profiles || {};
  const retention = Number(raw.retentionDays);
  return {
    enabled: raw.enabled !== false,
    trackActivity: raw.trackActivity !== false,
    excludedRoleIds: Array.isArray(raw.excludedRoleIds) ? raw.excludedRoleIds.map(String) : [],
    retentionDays: Number.isFinite(retention) ? Math.min(365, Math.max(1, Math.round(retention))) : DEFAULT_SETTINGS.retentionDays,
    backfilledAt: raw.backfilledAt || null,
  };
}

const definition = new SlashCommandBuilder()
  .setName('perfil')
  .setDescription('Tu perfil en el servidor: lo que el bot guarda de ti')
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Mira tu perfil (solo tú lo ves)')
      .addUserOption((opt) => opt.setName('miembro').setDescription('Otro miembro (solo para el staff)')),
  )
  .addSubcommand((sub) => sub.setName('info').setDescription('Qué guarda el bot y cómo borrarlo'))
  .addSubcommand((sub) => sub.setName('olvidar').setDescription('Borra tu perfil y deja de registrar tu actividad'))
  .addSubcommand((sub) => sub.setName('activar').setDescription('Vuelve a tener perfil si antes pediste olvidarlo'));

// --- utilidades puras ---

// "2026-11-06": el dia (en UTC) de una fecha; sirve de clave para contar mensajes por dia
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const unix = (date) => Math.floor(new Date(date).getTime() / 1000);

// los datos de Discord que se guardan de un miembro
function basicsFromMember(member) {
  const guildId = member.guild?.id;
  const roles = [...(member.roles?.cache?.values?.() || [])]
    .filter((role) => role.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .slice(0, MAX_ROLES)
    .map((role) => ({ id: role.id, name: String(role.name || '').slice(0, 100) }));
  return {
    username: member.user?.username || null,
    displayName: member.displayName || member.user?.globalName || member.user?.username || null,
    avatarUrl: member.displayAvatarURL?.({ size: 64 }) || member.user?.displayAvatarURL?.({ size: 64 }) || null,
    accountCreatedAt: member.user?.createdAt || null,
    joinedAt: member.joinedAt || null,
    roles,
    boosting: Boolean(member.premiumSince),
  };
}

// los bots y quienes tienen un rol excluido en el panel no tienen perfil
function isExcluded(member, settings) {
  if (member.user?.bot) return true;
  return settings.excludedRoleIds.some((roleId) => member.roles?.cache?.has?.(roleId));
}

// lo contado, listo para mostrar: mensajes del ultimo mes, dias activos, total, canales donde mas escribe y ultima vez activo
function activityOf(profile, nowDate = new Date()) {
  const activity = profile?.activity || {};
  const since = dayKey(new Date(nowDate.getTime() - (ACTIVITY_DAYS - 1) * DAY_MS));
  let messages30d = 0;
  let activeDays = 0;
  for (const [day, count] of Object.entries(activity.daily || {})) {
    if (day >= since && count > 0) {
      messages30d += count;
      activeDays += 1;
    }
  }
  const topChannels = Object.entries(activity.channels || {})
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return { messages30d, activeDays, messagesTotal: activity.messagesTotal || 0, topChannels, lastSeenAt: activity.lastSeenAt || null };
}

function profileEmbed(profile, { settings, own, config, nowDate = new Date() }) {
  const basics = profile.basics || {};
  const activity = activityOf(profile, nowDate);
  const roles = (basics.roles || []).slice(0, SHOWN_ROLES).map((role) => `<@&${role.id}>`);
  const extraRoles = (basics.roles || []).length - roles.length;
  const fields = [
    { name: 'En el servidor desde', value: basics.joinedAt ? `<t:${unix(basics.joinedAt)}:D>` : 'No lo sé', inline: true },
    { name: 'Cuenta creada', value: basics.accountCreatedAt ? `<t:${unix(basics.accountCreatedAt)}:D>` : 'No lo sé', inline: true },
    { name: 'Roles', value: roles.length ? roles.join(' ') + (extraRoles > 0 ? ` y ${extraRoles} más` : '') : 'Ninguno' },
  ];
  if (settings.trackActivity) {
    fields.push(
      { name: 'Mensajes en los últimos 30 días', value: `${activity.messages30d} (en ${activity.activeDays} ${activity.activeDays === 1 ? 'día' : 'días'})`, inline: true },
      { name: 'Mensajes en total', value: String(activity.messagesTotal), inline: true },
      { name: 'Última vez activo', value: activity.lastSeenAt ? `<t:${unix(activity.lastSeenAt)}:R>` : 'Todavía no he visto un mensaje', inline: true },
    );
    if (activity.topChannels.length) {
      fields.push({ name: 'Donde más escribe', value: activity.topChannels.slice(0, 3).map((channel) => `<#${channel.id}> (${channel.count})`).join('\n') });
    }
  }
  return buildEmbed({
    type: 'brand',
    title: `Perfil de ${basics.displayName || basics.username || 'miembro'}`,
    description: own ? 'Esto es lo que el bot guarda de ti. Nunca guarda el texto de tus mensajes.' : 'Perfil visto por el staff. El bot nunca guarda el texto de los mensajes.',
    thumbnail: basics.avatarUrl || undefined,
    fields,
    footer: own ? 'Usa /perfil info para saber más o /perfil olvidar para borrarlo.' : undefined,
    config,
  });
}

function infoText(settings) {
  return [
    '**Qué guarda el bot de cada miembro**',
    '• **Datos de Discord:** tu nombre, apodo, foto, roles, desde cuándo estás en el servidor y cuándo creaste tu cuenta.',
    settings.trackActivity
      ? '• **Actividad:** cuántos mensajes escribes, en qué canales y la última vez que te vio. **Solo números: nunca el texto de tus mensajes.**'
      : '• **Actividad:** el conteo de mensajes está apagado en este servidor.',
    '',
    '**Qué no guarda:** lo que escribes, tus mensajes privados ni nada de otros servidores.',
    '**Quién lo ve:** tú con `/perfil ver` y el staff desde el panel.',
    `**Cómo borrarlo:** \`/perfil olvidar\` borra tu perfil y deja de registrar tu actividad (con \`/perfil activar\` vuelves). Si te vas del servidor, tu perfil se borra solo a los ${settings.retentionDays} días.`,
  ].join('\n');
}

// --- ejecucion ---

// db: las funciones de src/db.js; saveBackfilled(guildId, fecha): guarda en la config que ya se crearon los perfiles de todos
function create({ client, db, saveBackfilled = async () => {}, now = () => new Date() }) {
  const buffer = new Map(); // contadores de mensajes que aun no se guardaron: guild:user -> { guildId, userId, messages, channels, daily, lastSeenAt }
  const known = new Set(); // guild:user que ya sabemos que tienen perfil
  const optedOut = new Set(); // guild:user que pidieron no tener perfil
  const pendingEnsure = new Map();
  const backfilling = new Set();
  const backfilledThisRun = new Set();
  const keyOf = (guildId, userId) => `${guildId}:${userId}`;

  // crea el perfil si no existe (o refresca sus datos de Discord). Devuelve true si la persona tiene perfil
  function ensureProfile(member, config) {
    const settings = settingsFor(config);
    if (!settings.enabled || !member?.guild || isExcluded(member, settings)) return Promise.resolve(false);
    const key = keyOf(member.guild.id, member.id);
    if (optedOut.has(key)) return Promise.resolve(false);
    if (pendingEnsure.has(key)) return pendingEnsure.get(key);
    const job = (async () => {
      const created = await db.upsertUserProfile(member.guild.id, member.id, basicsFromMember(member), now());
      if (created) known.add(key);
      else optedOut.add(key);
      return created;
    })().finally(() => pendingEnsure.delete(key));
    pendingEnsure.set(key, job);
    return job;
  }

  function countMessage(message) {
    const date = now();
    const key = keyOf(message.guild.id, message.author.id);
    const entry = buffer.get(key) || { guildId: message.guild.id, userId: message.author.id, messages: 0, channels: {}, daily: {}, lastSeenAt: null };
    const day = dayKey(date);
    entry.messages += 1;
    entry.channels[message.channel.id] = (entry.channels[message.channel.id] || 0) + 1;
    entry.daily[day] = (entry.daily[day] || 0) + 1;
    entry.lastSeenAt = date;
    buffer.set(key, entry);
  }

  // se llama con cada mensaje normal: solo suma numeros en memoria (nunca guarda lo escrito) y se guardan juntos cada minuto
  function recordMessage(message, config) {
    const settings = settingsFor(config);
    if (!settings.enabled || !settings.trackActivity || !message.guild || !message.member || message.author?.bot) return;
    const key = keyOf(message.guild.id, message.author.id);
    if (optedOut.has(key)) return;
    if (known.has(key)) return countMessage(message);
    // primer mensaje de alguien sin perfil (entro con el bot apagado, por ejemplo): se crea y recien ahi se cuenta
    ensureProfile(message.member, config)
      .then((has) => has && countMessage(message))
      .catch((err) => console.error('No se pudo crear el perfil de quien escribio:', err.message));
  }

  // guarda los contadores acumulados. Si la base falla se conservan para el proximo intento
  async function flushActivity() {
    if (!buffer.size) return 0;
    const entries = [...buffer.values()];
    buffer.clear();
    try {
      await db.applyUserActivity(entries, now());
      return entries.length;
    } catch (err) {
      for (const entry of entries) {
        const key = keyOf(entry.guildId, entry.userId);
        const current = buffer.get(key);
        if (!current) {
          buffer.set(key, entry);
          continue;
        }
        current.messages += entry.messages;
        for (const [id, count] of Object.entries(entry.channels)) current.channels[id] = (current.channels[id] || 0) + count;
        for (const [day, count] of Object.entries(entry.daily)) current.daily[day] = (current.daily[day] || 0) + count;
        if (!current.lastSeenAt || entry.lastSeenAt > current.lastSeenAt) current.lastSeenAt = entry.lastSeenAt;
      }
      console.error('No se pudieron guardar los contadores de los perfiles:', err.message);
      return 0;
    }
  }

  // crea (o refresca) el perfil de TODOS los miembros del servidor, en tandas de BULK_CHUNK. Marca como "salidos" a los que tienen perfil pero ya no estan
  async function backfillGuild(guild, config) {
    const settings = settingsFor(config);
    if (!settings.enabled) return { ok: false, reason: 'apagado' };
    if (backfilling.has(guild.id)) return { ok: false, reason: 'en-curso' };
    backfilling.add(guild.id);
    try {
      const members = await guild.members.fetch();
      const optedOutIds = new Set(await db.listOptedOutUserIds(guild.id));
      for (const userId of optedOutIds) optedOut.add(keyOf(guild.id, userId));
      const entries = [];
      for (const member of members.values()) {
        if (isExcluded(member, settings) || optedOutIds.has(member.id)) continue;
        entries.push({ userId: member.id, basics: basicsFromMember(member) });
      }
      const date = now();
      let written = 0;
      for (let index = 0; index < entries.length; index += BULK_CHUNK) {
        written += await db.bulkUpsertUserProfiles(guild.id, entries.slice(index, index + BULK_CHUNK), date);
        await new Promise((resolve) => setImmediate(resolve)); // no acaparar el proceso mientras se crean los perfiles
      }
      for (const entry of entries) known.add(keyOf(guild.id, entry.userId));
      const left = await db.markMissingUserProfilesLeft(guild.id, [...members.keys()], date);
      await saveBackfilled(guild.id, date);
      return { ok: true, total: members.size, written, skipped: members.size - entries.length, left };
    } catch (err) {
      console.error(`No se pudieron crear los perfiles de ${guild.name}:`, err.message);
      return { ok: false, reason: 'error', error: err.message };
    } finally {
      backfilling.delete(guild.id);
    }
  }

  async function onMemberAdd(member, config) {
    await ensureProfile(member, config);
  }

  // roles o apodo distintos: se refrescan los datos de Discord (solo si el perfil ya existe)
  async function onMemberUpdate(oldMember, newMember, config) {
    const settings = settingsFor(config);
    if (!settings.enabled || newMember.user?.bot) return;
    const key = keyOf(newMember.guild.id, newMember.id);
    if (!known.has(key)) return;
    if (isExcluded(newMember, settings)) {
      await db.deleteUserProfile(newMember.guild.id, newMember.id);
      known.delete(key);
      buffer.delete(key);
      return;
    }
    const same = !oldMember.partial
      && oldMember.nickname === newMember.nickname
      && oldMember.roles.cache.size === newMember.roles.cache.size
      && [...newMember.roles.cache.keys()].every((id) => oldMember.roles.cache.has(id));
    if (same) return;
    await db.updateUserProfileBasics(newMember.guild.id, newMember.id, basicsFromMember(newMember), now());
  }

  // se fue: el perfil se marca y se borra solo pasados los dias que elija el servidor
  async function onMemberRemove(member, config) {
    if (!settingsFor(config).enabled || member.user?.bot) return;
    known.delete(keyOf(member.guild.id, member.id));
    buffer.delete(keyOf(member.guild.id, member.id));
    await db.markUserProfileLeft(member.guild.id, member.id, now());
  }

  // borra los perfiles de quienes se fueron hace mas de los dias elegidos y limpia los dias que ya no cuentan
  async function runMaintenance(configFor) {
    const date = now();
    for (const guild of client.guilds.cache.values()) {
      const settings = settingsFor(configFor(guild.id));
      await db.purgeLeftUserProfiles(guild.id, new Date(date.getTime() - settings.retentionDays * DAY_MS));
      const oldDays = [];
      for (let n = ACTIVITY_DAYS; n < ACTIVITY_DAYS + OLD_DAY_KEYS; n++) oldDays.push(dayKey(new Date(date.getTime() - n * DAY_MS)));
      await db.unsetOldUserActivityDays(guild.id, oldDays);
    }
  }

  async function backfillPending(configFor) {
    for (const guild of client.guilds.cache.values()) {
      const config = configFor(guild.id);
      const settings = settingsFor(config);
      if (!settings.enabled || settings.backfilledAt || backfilledThisRun.has(guild.id)) continue;
      backfilledThisRun.add(guild.id);
      await backfillGuild(guild, config);
    }
  }

  // arranque: guarda los contadores cada minuto, hace el mantenimiento cada tantas horas y crea los perfiles de todos si aun no se hizo
  function start(configFor) {
    setInterval(() => flushActivity().catch((err) => console.error('Error guardando los contadores de perfiles:', err.message)), FLUSH_MS).unref?.();
    setInterval(() => runMaintenance(configFor).catch((err) => console.error('Error en el mantenimiento de perfiles:', err.message)), MAINTENANCE_MS).unref?.();
    setTimeout(() => backfillPending(configFor).catch((err) => console.error('Error creando los perfiles:', err.message)), BACKFILL_DELAY_MS).unref?.();
  }

  // el panel borro este perfil: se olvida lo que la memoria sabia de el (si vuelve a escribir, se crea de nuevo)
  function forget(guildId, userId) {
    known.delete(keyOf(guildId, userId));
    buffer.delete(keyOf(guildId, userId));
  }

  async function deleteAll(guildId) {
    for (const key of [...known]) if (key.startsWith(`${guildId}:`)) known.delete(key);
    for (const key of [...buffer.keys()]) if (key.startsWith(`${guildId}:`)) buffer.delete(key);
    return db.deleteAllUserProfiles(guildId);
  }

  // --- /perfil ---

  async function ver(interaction, config, settings) {
    const target = interaction.options.getUser('miembro') || interaction.user;
    const own = target.id === interaction.user.id;
    if (!own && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '🔒 Solo puedes ver tu propio perfil. Los de otras personas los ve el staff.', ephemeral: true });
    }
    if (target.bot) return interaction.reply({ content: 'Los bots no tienen perfil.', ephemeral: true });
    let profile = await db.getUserProfile(interaction.guild.id, target.id);
    if (profile?.privacy?.optOut) {
      return interaction.reply({
        content: own ? '🙈 Pediste que no se guarde nada de ti. Si quieres volver a tener perfil, usa `/perfil activar`.' : '🙈 Esa persona pidió que no se guarde nada de ella.',
        ephemeral: true,
      });
    }
    if (!profile && own && interaction.member && (await ensureProfile(interaction.member, config))) profile = await db.getUserProfile(interaction.guild.id, target.id);
    if (!profile) return interaction.reply({ content: own ? 'Todavía no tienes perfil. Escribe algo en el servidor y se crea solo.' : 'Esa persona todavía no tiene perfil.', ephemeral: true });
    return interaction.reply({ embeds: [profileEmbed(profile, { settings, own, config, nowDate: now() })], ephemeral: true });
  }

  async function olvidar(interaction) {
    const guildId = interaction.guild.id;
    const key = keyOf(guildId, interaction.user.id);
    await db.optOutUserProfile(guildId, interaction.user.id, now());
    optedOut.add(key);
    known.delete(key);
    buffer.delete(key);
    return interaction.reply({ content: '🗑️ Listo: borré tu perfil y ya no registro nada de ti. Si cambias de opinión, usa `/perfil activar`.', ephemeral: true });
  }

  async function activar(interaction, config) {
    const guildId = interaction.guild.id;
    const profile = await db.getUserProfile(guildId, interaction.user.id);
    if (!profile?.privacy?.optOut) return interaction.reply({ content: 'Ya tienes perfil: míralo con `/perfil ver`.', ephemeral: true });
    await db.clearUserProfileOptOut(guildId, interaction.user.id);
    optedOut.delete(keyOf(guildId, interaction.user.id));
    const has = interaction.member ? await ensureProfile(interaction.member, config) : false;
    return interaction.reply({ content: has ? '✅ Listo, vuelves a tener perfil. Míralo con `/perfil ver`.' : '✅ Listo: ya no estás en la lista de quienes piden olvidarse. Tu perfil se crea cuando escribas en el servidor.', ephemeral: true });
  }

  async function handleCommand(interaction, config) {
    if (!interaction.guild) return interaction.reply({ content: 'Este comando solo funciona dentro de un servidor.', ephemeral: true });
    const settings = settingsFor(config);
    if (!settings.enabled) return interaction.reply({ content: '🔒 Los perfiles están apagados en este servidor.', ephemeral: true });
    switch (interaction.options.getSubcommand()) {
      case 'ver':
        return ver(interaction, config, settings);
      case 'info':
        return interaction.reply({ content: infoText(settings), ephemeral: true });
      case 'olvidar':
        return olvidar(interaction);
      case 'activar':
        return activar(interaction, config);
      default:
        return null;
    }
  }

  return { ensureProfile, recordMessage, flushActivity, backfillGuild, onMemberAdd, onMemberUpdate, onMemberRemove, runMaintenance, backfillPending, start, forget, deleteAll, handleCommand };
}

module.exports = { definition, create, settingsFor, basicsFromMember, isExcluded, activityOf, dayKey, profileEmbed, infoText, RETENTION_CHOICES, DEFAULT_SETTINGS, ACTIVITY_DAYS };
