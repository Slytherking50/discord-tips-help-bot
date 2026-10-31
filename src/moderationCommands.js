const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { resolveColor, buildEmbed } = require('./embedStyle');

// respuesta publica de una accion de moderacion: misma forma para ban, kick,
// mute y warn (quien, quien lo hizo, motivo), con la foto del afectado
function moderationReplyEmbed(config, interaction, { type = 'error', title, user, reason, extraFields = [] }) {
  return buildEmbed({
    type,
    title,
    description: `<@${user.id}> (${user.username})`,
    fields: [
      { name: 'Motivo', value: String(reason).slice(0, 1000) },
      ...extraFields,
      { name: 'Moderador', value: `<@${interaction.user.id}>`, inline: true },
    ],
    thumbnail: user.displayAvatarURL(),
    config,
  });
}

const banDefinition = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Banea a un usuario del server')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a banear').setRequired(true))
  .addStringOption((opt) => opt.setName('razon').setDescription('Motivo (opcional)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

const kickDefinition = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Expulsa a un usuario del server')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a expulsar').setRequired(true))
  .addStringOption((opt) => opt.setName('razon').setDescription('Motivo (opcional)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

const muteDefinition = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Silencia temporalmente a un usuario (timeout)')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a silenciar').setRequired(true))
  .addIntegerOption((opt) =>
    opt.setName('minutos').setDescription('Duración en minutos').setRequired(true).setMinValue(1).setMaxValue(40320),
  )
  .addStringOption((opt) => opt.setName('razon').setDescription('Motivo (opcional)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const unmuteDefinition = new SlashCommandBuilder()
  .setName('unmute')
  .setDescription('Quita el silencio (timeout) a un usuario')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario al que quitarle el silencio').setRequired(true))
  .addStringOption((opt) => opt.setName('razon').setDescription('Motivo (opcional)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const warnDefinition = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Registra una advertencia para un usuario')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a advertir').setRequired(true))
  .addStringOption((opt) => opt.setName('razon').setDescription('Motivo').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const warningsDefinition = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription('Muestra el historial de advertencias de un usuario')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

// discord solo compara la jerarquia del ROL DEL BOT contra el objetivo, nunca
// la del moderador que ejecuta el comando; sin este chequeo, un staff de rango
// bajo con permiso de Ban/Kick/ModerateMembers podria moderar a un superior
function canModerate(interaction, targetMember) {
  if (!targetMember) return true;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  return interaction.member.roles.highest.position > targetMember.roles.highest.position;
}

// castigo automatico al llegar a cierta cantidad de advertencias: lo pone index.js (usa el motor de automoderacion)
let escalationHook = null;
function setEscalationHook(hook) {
  escalationHook = hook;
}

// deja el caso en el historial de la persona (/historial); un fallo de la base no frena la accion de moderacion
async function recordCase(interaction, type, user, reason, details = null) {
  try {
    return await db.addCase({ guildId: interaction.guild.id, type, userId: user.id, moderatorId: interaction.user.id, reason, details });
  } catch (err) {
    console.error('No se pudo guardar el caso de moderación:', err.message);
    return null;
  }
}

async function logModerationAction(client, config, { action, moderator, target, reason }) {
  const logging = config?.logging;
  if (!logging || !logging.enabled || !logging.logModeration || !logging.channelId) return;

  try {
    const channel = await client.channels.fetch(logging.channelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(resolveColor(config, 'error'))
      .setTitle(`🛡️ ${action}`)
      .addFields(
        { name: 'Usuario', value: `<@${target.id}> (${target.tag || target.username})`, inline: true },
        { name: 'Moderador', value: `<@${moderator.id}>`, inline: true },
        { name: 'Motivo', value: reason || 'Sin especificar' },
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo mandar el log de moderación:', err);
  }
}

async function handleBanCommand(interaction, config) {
  const user = interaction.options.getUser('usuario', true);
  const reason = interaction.options.getString('razon') || 'Sin especificar';

  const existingMember = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!canModerate(interaction, existingMember)) {
    await interaction.reply({ content: '❌ No puedes moderar a alguien con un rol igual o superior al tuyo.', ephemeral: true });
    return;
  }

  try {
    await interaction.guild.members.ban(user.id, { reason });
    await recordCase(interaction, 'ban', user, reason);
    await interaction.reply({ embeds: [moderationReplyEmbed(config, interaction, { title: '🔨 Usuario baneado', user, reason })], allowedMentions: { parse: [] } });
    await logModerationAction(interaction.client, config, { action: 'Ban', moderator: interaction.user, target: user, reason });
  } catch (err) {
    await interaction.reply({ content: `❌ No pude banear a ese usuario: ${err.message}`, ephemeral: true });
  }
}

async function handleKickCommand(interaction, config) {
  const user = interaction.options.getUser('usuario', true);
  const reason = interaction.options.getString('razon') || 'Sin especificar';

  try {
    const member = await interaction.guild.members.fetch(user.id);
    if (!canModerate(interaction, member)) {
      await interaction.reply({ content: '❌ No puedes moderar a alguien con un rol igual o superior al tuyo.', ephemeral: true });
      return;
    }
    await member.kick(reason);
    await recordCase(interaction, 'kick', user, reason);
    await interaction.reply({ embeds: [moderationReplyEmbed(config, interaction, { type: 'warning', title: '👢 Usuario expulsado', user, reason })], allowedMentions: { parse: [] } });
    await logModerationAction(interaction.client, config, { action: 'Kick', moderator: interaction.user, target: user, reason });
  } catch (err) {
    await interaction.reply({ content: `❌ No pude expulsar a ese usuario: ${err.message}`, ephemeral: true });
  }
}

async function handleMuteCommand(interaction, config) {
  const user = interaction.options.getUser('usuario', true);
  const minutes = interaction.options.getInteger('minutos', true);
  const reason = interaction.options.getString('razon') || 'Sin especificar';

  try {
    const member = await interaction.guild.members.fetch(user.id);
    if (!canModerate(interaction, member)) {
      await interaction.reply({ content: '❌ No puedes moderar a alguien con un rol igual o superior al tuyo.', ephemeral: true });
      return;
    }
    await member.timeout(minutes * 60 * 1000, reason);
    await recordCase(interaction, 'mute', user, reason, { minutes });
    await interaction.reply({
      embeds: [
        moderationReplyEmbed(config, interaction, {
          type: 'warning',
          title: '🔇 Usuario silenciado',
          user,
          reason,
          extraFields: [{ name: 'Duración', value: `${minutes} min`, inline: true }],
        }),
      ],
      allowedMentions: { parse: [] },
    });
    await logModerationAction(interaction.client, config, {
      action: `Mute (${minutes} min)`,
      moderator: interaction.user,
      target: user,
      reason,
    });
  } catch (err) {
    await interaction.reply({ content: `❌ No pude silenciar a ese usuario: ${err.message}`, ephemeral: true });
  }
}

async function handleUnmuteCommand(interaction, config) {
  const user = interaction.options.getUser('usuario', true);
  const reason = interaction.options.getString('razon') || 'Sin especificar';

  try {
    const member = await interaction.guild.members.fetch(user.id);
    if (!canModerate(interaction, member)) {
      await interaction.reply({ content: '❌ No puedes moderar a alguien con un rol igual o superior al tuyo.', ephemeral: true });
      return;
    }

    const mutedUntil = member.communicationDisabledUntilTimestamp;
    if (!mutedUntil || mutedUntil <= Date.now()) {
      await interaction.reply({ content: `ℹ️ <@${user.id}> no está silenciado ahora mismo.`, allowedMentions: { parse: [] } });
      return;
    }

    await member.timeout(null, reason);
    await recordCase(interaction, 'unmute', user, reason);
    await interaction.reply({
      embeds: [moderationReplyEmbed(config, interaction, { type: 'success', title: '🔊 Silencio retirado', user, reason })],
      allowedMentions: { parse: [] },
    });
    await logModerationAction(interaction.client, config, { action: 'Unmute', moderator: interaction.user, target: user, reason });
  } catch (err) {
    await interaction.reply({ content: `❌ No pude quitarle el silencio a ese usuario: ${err.message}`, ephemeral: true });
  }
}

async function handleWarnCommand(interaction, config) {
  const user = interaction.options.getUser('usuario', true);
  const reason = interaction.options.getString('razon', true);

  await db.addWarning({ guildId: interaction.guild.id, userId: user.id, moderatorId: interaction.user.id, reason });
  await recordCase(interaction, 'warn', user, reason);
  const totalWarnings = (await db.listWarnings(interaction.guild.id, user.id)).length;

  // si el server activo el escalado, esta advertencia puede traer un castigo automatico (silencio, expulsion, ban)
  let escalation = null;
  if (escalationHook) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    escalation = await escalationHook(interaction.guild, member, config).catch(() => null);
  }
  const escalationFields = escalation?.count
    ? [
        { name: 'Faltas vigentes', value: String(escalation.count), inline: true },
        ...(escalation.action ? [{ name: 'Castigo automático', value: escalation.action, inline: true }] : []),
      ]
    : [];

  await interaction.reply({
    embeds: [
      moderationReplyEmbed(config, interaction, {
        type: 'warning',
        title: '⚠️ Usuario advertido',
        user,
        reason,
        extraFields: [{ name: 'Advertencias', value: String(totalWarnings), inline: true }, ...escalationFields],
      }),
    ],
    allowedMentions: { parse: [] },
  });
  await logModerationAction(interaction.client, config, { action: 'Warn', moderator: interaction.user, target: user, reason });
}

async function handleWarningsCommand(interaction, config) {
  const user = interaction.options.getUser('usuario', true);
  const warnings = await db.listWarnings(interaction.guild.id, user.id);

  if (!warnings.length) {
    await interaction.reply({ content: `<@${user.id}> no tiene advertencias.`, ephemeral: true });
    return;
  }

  const lines = warnings.map((w, i) => `**${i + 1}.** ${w.reason} — <t:${Math.floor(w.createdAt.getTime() / 1000)}:R>`);
  const embed = new EmbedBuilder()
    .setColor(resolveColor(config, 'warning'))
    .setTitle(`Advertencias de ${user.username}`)
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
  banDefinition,
  kickDefinition,
  muteDefinition,
  unmuteDefinition,
  warnDefinition,
  warningsDefinition,
  handleBanCommand,
  handleKickCommand,
  handleMuteCommand,
  handleUnmuteCommand,
  handleWarnCommand,
  handleWarningsCommand,
  logModerationAction,
  setEscalationHook,
};
