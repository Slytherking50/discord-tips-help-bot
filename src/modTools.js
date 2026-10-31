// herramientas de moderacion del dia a dia: /purge, /slowmode, /lock, /unlock e /historial (el historial de casos de alguien)

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('./db');
const logging = require('./logging');
const { resolveColor } = require('./embedStyle');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const MAX_SLOWMODE_SECONDS = 21600;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

const purgeDefinition = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Borra los últimos mensajes de este canal')
  .addIntegerOption((opt) => opt.setName('cantidad').setDescription('Cuántos mensajes borrar (1 a 100)').setRequired(true).setMinValue(1).setMaxValue(100))
  .addUserOption((opt) => opt.setName('usuario').setDescription('Borrar solo los mensajes de esta persona'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

const slowmodeDefinition = new SlashCommandBuilder()
  .setName('slowmode')
  .setDescription('Pone o quita el modo lento de un canal')
  .addIntegerOption((opt) => opt.setName('segundos').setDescription('Espera entre mensajes (0 lo quita, máximo 21600)').setRequired(true).setMinValue(0).setMaxValue(MAX_SLOWMODE_SECONDS))
  .addChannelOption((opt) => opt.setName('canal').setDescription('Otro canal (por defecto, este)').addChannelTypes(...TEXT_CHANNELS))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const lockDefinition = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Bloquea un canal: nadie puede escribir hasta que lo desbloquees')
  .addChannelOption((opt) => opt.setName('canal').setDescription('Otro canal (por defecto, este)').addChannelTypes(...TEXT_CHANNELS))
  .addStringOption((opt) => opt.setName('razon').setDescription('Motivo (se muestra en el canal)').setMaxLength(200))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const unlockDefinition = new SlashCommandBuilder()
  .setName('unlock')
  .setDescription('Desbloquea un canal que bloqueaste con /lock')
  .addChannelOption((opt) => opt.setName('canal').setDescription('Otro canal (por defecto, este)').addChannelTypes(...TEXT_CHANNELS))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const historialDefinition = new SlashCommandBuilder()
  .setName('historial')
  .setDescription('Muestra el historial de moderación de una persona (advertencias, silencios, automoderación...)')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Persona a consultar').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const definitions = [purgeDefinition, slowmodeDefinition, lockDefinition, unlockDefinition, historialDefinition];

const TYPE_LABELS = {
  warn: 'Advertencia',
  automod: 'Automoderación',
  mute: 'Silencio',
  unmute: 'Silencio retirado',
  kick: 'Expulsión',
  ban: 'Ban',
  purge: 'Limpieza',
  raid: 'Raid',
  note: 'Nota',
};

function hasPermission(interaction, permission) {
  return Boolean(interaction.memberPermissions?.has(permission));
}

function targetChannel(interaction) {
  return interaction.options.getChannel('canal') || interaction.channel;
}

// el bot necesita el permiso en ese canal para poder hacerlo: si no, se dice cual falta
function botLacks(channel, permission) {
  const me = channel.guild?.members?.me;
  return !me || !channel.permissionsFor(me)?.has(permission);
}

async function handlePurgeCommand(interaction, config) {
  if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: '❌ Necesitas el permiso «Gestionar mensajes» para borrar mensajes.', ephemeral: true });
    return;
  }
  const channel = interaction.channel;
  if (!channel?.bulkDelete || botLacks(channel, PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: '❌ Yo no tengo el permiso «Gestionar mensajes» en este canal.', ephemeral: true });
    return;
  }

  const amount = interaction.options.getInteger('cantidad', true);
  const user = interaction.options.getUser('usuario');
  await interaction.deferReply({ ephemeral: true });

  try {
    // con un filtro por persona se revisan los ultimos 100 y se borran hasta `amount` de ella
    const fetched = await channel.messages.fetch({ limit: user ? 100 : amount });
    const now = Date.now();
    const candidates = [...fetched.values()].filter((message) => (!user || message.author.id === user.id) && !message.pinned).slice(0, amount);
    const recent = candidates.filter((message) => now - message.createdTimestamp < TWO_WEEKS_MS);
    const deleted = recent.length ? await channel.bulkDelete(recent, true) : { size: 0 };
    const skippedOld = candidates.length - recent.length;

    await db.addCase({ guildId: interaction.guild.id, type: 'purge', userId: user?.id || null, moderatorId: interaction.user.id, reason: `${deleted.size} mensajes en #${channel.name}`, details: { channelId: channel.id, count: deleted.size } }).catch(() => {});
    await logging.sendLog(interaction.client, config, {
      type: 'warning',
      title: '🧹 Limpieza de mensajes',
      fields: [
        { name: 'Moderador', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Canal', value: `<#${channel.id}>`, inline: true },
        { name: 'Borrados', value: `${deleted.size}${user ? ` de <@${user.id}>` : ''}`, inline: true },
      ],
    });
    const notes = [skippedOld ? `${skippedOld} tenían más de 14 días y Discord no deja borrarlos en bloque.` : '', !deleted.size && !skippedOld ? 'No encontré mensajes que borrar.' : ''].filter(Boolean).join(' ');
    await interaction.editReply(`🧹 Borré **${deleted.size}** mensaje(s)${user ? ` de ${user.username}` : ''}. ${notes}`.trim());
  } catch (err) {
    await interaction.editReply(`❌ No pude borrar los mensajes: ${err.message}`);
  }
}

async function handleSlowmodeCommand(interaction, config) {
  if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ Necesitas el permiso «Gestionar canales».', ephemeral: true });
    return;
  }
  const channel = targetChannel(interaction);
  const seconds = interaction.options.getInteger('segundos', true);
  if (!channel?.setRateLimitPerUser || botLacks(channel, PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ Yo no tengo el permiso «Gestionar canales» en ese canal.', ephemeral: true });
    return;
  }
  try {
    await channel.setRateLimitPerUser(seconds, `Modo lento por ${interaction.user.username}`);
    await logging.sendLog(interaction.client, config, {
      type: 'warning',
      title: '🐌 Modo lento',
      fields: [
        { name: 'Moderador', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Canal', value: `<#${channel.id}>`, inline: true },
        { name: 'Espera', value: seconds ? `${seconds} s` : 'quitado', inline: true },
      ],
    });
    await interaction.reply({ content: seconds ? `🐌 Modo lento en <#${channel.id}>: **${seconds} s** entre mensajes.` : `✅ Modo lento quitado en <#${channel.id}>.`, allowedMentions: { parse: [] } });
  } catch (err) {
    await interaction.reply({ content: `❌ No pude cambiar el modo lento: ${err.message}`, ephemeral: true });
  }
}

// los permisos que se le quitan a @everyone al bloquear (y se devuelven a "heredar" al desbloquear)
const LOCK_FLAGS = { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false };
const UNLOCK_FLAGS = { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, CreatePrivateThreads: null };

async function setLocked(interaction, config, locked) {
  if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ Necesitas el permiso «Gestionar canales».', ephemeral: true });
    return;
  }
  const channel = targetChannel(interaction);
  if (!channel?.permissionOverwrites || botLacks(channel, PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: '❌ Yo no tengo permiso para cambiar los permisos de ese canal (necesito «Gestionar roles»).', ephemeral: true });
    return;
  }
  const reason = locked ? interaction.options.getString('razon') : null;
  try {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, locked ? LOCK_FLAGS : UNLOCK_FLAGS, { reason: `${locked ? 'Bloqueo' : 'Desbloqueo'} por ${interaction.user.username}` });
    await channel.send({ content: locked ? `🔒 Este canal fue bloqueado por el staff.${reason ? ` Motivo: ${reason}` : ''}` : '🔓 Este canal fue desbloqueado. Ya pueden escribir.', allowedMentions: { parse: [] } }).catch(() => {});
    await logging.sendLog(interaction.client, config, {
      type: locked ? 'error' : 'success',
      title: locked ? '🔒 Canal bloqueado' : '🔓 Canal desbloqueado',
      fields: [
        { name: 'Moderador', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Canal', value: `<#${channel.id}>`, inline: true },
        ...(reason ? [{ name: 'Motivo', value: reason }] : []),
      ],
    });
    await interaction.reply({ content: locked ? `🔒 Bloqueé <#${channel.id}>. Usa /unlock para abrirlo de nuevo.` : `🔓 Desbloqueé <#${channel.id}>.`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `❌ No pude cambiar el canal: ${err.message}`, ephemeral: true });
  }
}

const handleLockCommand = (interaction, config) => setLocked(interaction, config, true);
const handleUnlockCommand = (interaction, config) => setLocked(interaction, config, false);

function describeCase(entry) {
  const when = `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:R>`;
  const who = entry.auto ? 'automático' : entry.moderatorId ? `por <@${entry.moderatorId}>` : '';
  const reason = entry.reason ? ` — ${String(entry.reason).slice(0, 90)}` : '';
  return `**#${entry.number}** ${TYPE_LABELS[entry.type] || entry.type} ${when}${who ? ` (${who})` : ''}${reason}`;
}

async function handleHistorialCommand(interaction, config) {
  if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ content: '❌ Necesitas el permiso «Moderar miembros» para ver historiales.', ephemeral: true });
    return;
  }
  const user = interaction.options.getUser('usuario', true);
  const [cases, totals, strikes] = await Promise.all([
    db.listCases(interaction.guild.id, user.id, 12),
    db.countCasesByType(interaction.guild.id, user.id),
    db.countStrikes(interaction.guild.id, user.id, new Date(Date.now() - (config?.automod?.strikes?.windowDays || 30) * 86400000)),
  ]);

  if (!cases.length) {
    await interaction.reply({ content: `✅ ${user.username} no tiene casos en el historial.`, ephemeral: true });
    return;
  }

  const summary = Object.entries(totals)
    .map(([type, total]) => `${TYPE_LABELS[type] || type}: **${total}**`)
    .join(' · ');
  const embed = new EmbedBuilder()
    .setColor(resolveColor(config, strikes >= 3 ? 'error' : 'warning'))
    .setTitle(`Historial de ${user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .setDescription(`${summary}\nAdvertencias vigentes (últimos ${config?.automod?.strikes?.windowDays || 30} días): **${strikes}**\n\n${cases.map(describeCase).join('\n')}`.slice(0, 4000))
    .setFooter({ text: `Se muestran los ${cases.length} casos más recientes` });
  await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
}

module.exports = {
  definitions,
  purgeDefinition,
  slowmodeDefinition,
  lockDefinition,
  unlockDefinition,
  historialDefinition,
  handlePurgeCommand,
  handleSlowmodeCommand,
  handleLockCommand,
  handleUnlockCommand,
  handleHistorialCommand,
  describeCase,
  TYPE_LABELS,
};
