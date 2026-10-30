const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  OverwriteType,
} = require('discord.js');
const db = require('./db');
const { resolveColor, buildEmbed } = require('./embedStyle');

const TICKETS_CATEGORY_NAME = 'Tickets';
const CLOSE_BUTTON_ID = 'close-ticket';
const CLAIM_BUTTON_ID = 'claim-ticket';
const CATEGORY_SELECT_ID = 'ticket-category-select';
const OPEN_BUTTON_PREFIX = 'ticket-open-btn';
const RATE_PREFIX = 'ticket-rate:';

const definition = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Abre un canal privado para recibir ayuda del staff');

function slugify(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'usuario'
  );
}

async function findOrCreateTicketsCategory(guild) {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === TICKETS_CATEGORY_NAME,
  );
  if (existing) return existing;
  return guild.channels.create({ name: TICKETS_CATEGORY_NAME, type: ChannelType.GuildCategory });
}

// si el panel desde el que se abrio el ticket tiene una categoria de Discord
// elegida se usa esa; si no existe mas (borrada), no eligio ninguna, o el
// ticket se abrio por /ticket (sin panel), se cae al comportamiento original
// de buscar/crear una categoria llamada "Tickets"
async function resolveTicketParentCategory(guild, panel) {
  const categoryChannelId = panel?.categoryChannelId;
  if (categoryChannelId) {
    const chosen = await guild.channels.fetch(categoryChannelId).catch(() => null);
    if (chosen && chosen.type === ChannelType.GuildCategory) return chosen;
  }
  return findOrCreateTicketsCategory(guild);
}

function staffRoles(guild) {
  return guild.roles.cache.filter(
    (role) =>
      role.permissions.has(PermissionFlagsBits.ManageGuild) || role.permissions.has(PermissionFlagsBits.Administrator),
  );
}

// sin panelId (comando /ticket) usa el customId base; publicado desde un
// panel especifico le suma el id del panel para que handleCategorySelect
// sepa despues cual eligio (y con eso, que categoria de Discord usar)
function categorySelectRow(categories, panelId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(panelId ? `${CATEGORY_SELECT_ID}:${panelId}` : CATEGORY_SELECT_ID)
    .setPlaceholder('Elige un tipo de ticket')
    .addOptions(
      categories.slice(0, 25).map((cat) => ({
        label: cat.label.slice(0, 100),
        value: cat.id,
        description: (cat.description || '').slice(0, 100) || undefined,
        emoji: cat.emoji || undefined,
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

// misma idea que categorySelectRow pero como botones en vez de menu
// desplegable (algunos admins lo prefieren, ej. un solo boton "Enviar
// Portafolio"). Mismo limite que el select: 25 opciones (5 filas x 5)
function categoryButtonRows(categories, panelId) {
  const rows = [];
  for (let i = 0; i < categories.length && i < 25; i += 5) {
    const chunk = categories.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        chunk.map((cat) =>
          new ButtonBuilder()
            .setCustomId(`${OPEN_BUTTON_PREFIX}:${panelId}:${cat.id}`)
            .setLabel(cat.label.slice(0, 80))
            .setEmoji(cat.emoji || undefined)
            .setStyle(ButtonStyle.Primary),
        ),
      ),
    );
  }
  return rows;
}

function categoriesForPanel(config, panel) {
  if (!panel.categoryIds || !panel.categoryIds.length) return config.ticketCategories;
  return config.ticketCategories.filter((c) => panel.categoryIds.includes(c.id));
}

async function publishPanel(guild, config, panelId) {
  const panel = (config.ticketPanels || []).find((p) => p.id === panelId);
  if (!panel) throw new Error('Ese panel ya no existe');
  if (!panel.channelId) throw new Error('No hay canal configurado para este panel');

  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Canal inválido');

  if (panel.messageId) {
    try {
      const old = await channel.messages.fetch(panel.messageId);
      await old.delete();
    } catch {
      // ya no existe, sin problema
    }
  }

  const categories = categoriesForPanel(config, panel);
  if (!categories.length) throw new Error('Este panel no tiene ninguna categoría disponible');

  const embed = buildEmbed({
    type: 'brand',
    title: panel.title,
    description: panel.description,
    fields: [
      {
        name: '¿Cómo funciona?',
        value: '1️⃣ Elige el tipo de ticket\n2️⃣ Se crea un canal privado solo para ti y el staff\n3️⃣ Cuéntanos qué necesitas y te respondemos ahí',
      },
    ],
    thumbnail: guild.iconURL() || undefined,
    timestamp: false,
    config,
  });
  const components =
    panel.style === 'button' ? categoryButtonRows(categories, panel.id) : [categorySelectRow(categories, panel.id)];

  const message = await channel.send({ embeds: [embed], components });
  return message.id;
}

async function createTicketChannel(interaction, config, categoryId, panel) {
  const category = config.ticketCategories.find((c) => c.id === categoryId);
  if (!category) {
    await interaction.reply({ content: '⚠️ Esa categoría ya no existe.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const existingTickets = await db.listTickets(guild.id, 'open');
  // el limite es un ticket abierto por categoria, no uno solo en total: un
  // usuario puede tener a la vez un ticket de "Soporte" y otro de "Facturación"
  const alreadyOpen = existingTickets.find((t) => t.userId === interaction.user.id && t.categoryId === categoryId);

  if (alreadyOpen) {
    await interaction.reply({
      content: `⚠️ Ya tienes un ticket abierto de esta categoría: <#${alreadyOpen.channelId}>`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const parent = await resolveTicketParentCategory(guild, panel);
  const categoryStaffRoleIds = category.staffRoleIds && category.staffRoleIds.length ? category.staffRoleIds : staffRoles(guild).map((r) => r.id);
  // los roles de staff "default" (config.ticketDefaultStaffRoleIds) ven TODOS
  // los tickets sin importar la categoria, ademas de los especificos de arriba
  const configuredStaffRoleIds = [...new Set([...categoryStaffRoleIds, ...(config.ticketDefaultStaffRoleIds || [])])];

  // discord.js resuelve los overwrites SIN "type" buscando el id en el cache de
  // roles/usuarios y tira "Supplied parameter is not a cached User or Role" si
  // no esta (un rol de staff borrado del server, un usuario fuera de cache).
  // Con "type" explicito no depende del cache, y los roles que ya no existen
  // se descartan en vez de romper la creacion del ticket
  await guild.roles.fetch().catch(() => null);
  const staffRoleIds = configuredStaffRoleIds.filter((roleId) => guild.roles.cache.has(roleId));
  const missingRoleIds = configuredStaffRoleIds.filter((roleId) => !guild.roles.cache.has(roleId));
  if (missingRoleIds.length) {
    console.warn(`Tickets: roles de staff que ya no existen en ${guild.id}, se ignoran: ${missingRoleIds.join(', ')}`);
  }

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: guild.client.user.id,
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
    },
    ...staffRoleIds.map((roleId) => ({
      id: roleId,
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  const number = await db.getNextTicketNumber(guild.id);
  const paddedNumber = String(number).padStart(4, '0');

  const channel = await guild.channels.create({
    name: `ticket-${paddedNumber}-${slugify(interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites,
  });

  const created = await db.createTicket({
    guildId: guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    categoryId: category.id,
    categoryLabel: category.label,
    number,
  });

  if (!created) {
    // otra invocacion casi simultanea ya le abrio un ticket a este usuario;
    // borramos el canal huerfano que acabamos de crear en vez de duplicar
    await channel.delete().catch((err) => console.error('No se pudo borrar el canal de ticket duplicado:', err));
    await interaction.editReply({ content: '⚠️ Ya tienes un ticket abierto.' });
    return;
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CLAIM_BUTTON_ID).setLabel('Reclamar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Cerrar ticket').setStyle(ButtonStyle.Danger),
  );

  const embed = buildEmbed({
    type: 'brand',
    title: `${category.emoji || '🎫'} Ticket #${paddedNumber}`,
    description: category.description || 'Cuéntanos con detalle qué necesitas; un miembro del staff te responderá pronto.',
    fields: [
      { name: 'Categoría', value: category.label, inline: true },
      { name: 'Abierto por', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Estado', value: '🟢 Abierto', inline: true },
    ],
    thumbnail: interaction.user.displayAvatarURL(),
    footer: 'Usa «Reclamar» para atender el ticket y «Cerrar ticket» cuando termine.',
    config,
  });

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [buttons] });
  await interaction.editReply({ content: `✅ Ticket creado: ${channel}` });
}

async function handleTicketCommand(interaction, config) {
  const categories = config.ticketCategories || [];
  if (!categories.length) {
    await interaction.reply({ content: '⚠️ No hay categorías de tickets configuradas.', ephemeral: true });
    return;
  }

  if (categories.length === 1) {
    await createTicketChannel(interaction, config, categories[0].id, null);
    return;
  }

  await interaction.reply({ components: [categorySelectRow(categories)], ephemeral: true });
}

async function handleCategorySelect(interaction, config) {
  if (!interaction.customId.startsWith(CATEGORY_SELECT_ID)) return;
  const [, panelId] = interaction.customId.split(':');
  const panel = panelId ? (config.ticketPanels || []).find((p) => p.id === panelId) : null;
  await createTicketChannel(interaction, config, interaction.values[0], panel);
}

async function handleOpenButton(interaction, config) {
  if (!interaction.customId.startsWith(`${OPEN_BUTTON_PREFIX}:`)) return;
  const [, panelId, categoryId] = interaction.customId.split(':');
  const panel = (config.ticketPanels || []).find((p) => p.id === panelId);
  await createTicketChannel(interaction, config, categoryId, panel);
}

async function handleClaimButton(interaction) {
  if (interaction.customId !== CLAIM_BUTTON_ID) return;

  const ticket = await db.getTicketByChannelId(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ No encontré este ticket en la base de datos.', ephemeral: true });
    return;
  }
  if (ticket.claimedBy) {
    await interaction.reply({ content: `⚠️ Ya lo reclamó <@${ticket.claimedBy}>.`, ephemeral: true });
    return;
  }

  await db.claimTicket({ channelId: interaction.channel.id, claimedBy: interaction.user.id });
  await interaction.reply(`🙋 <@${interaction.user.id}> reclamó este ticket.`);
}

async function buildTranscript(channel) {
  let allMessages = [];
  let before;

  for (let i = 0; i < 5; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    allMessages = allMessages.concat(Array.from(batch.values()));
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = allMessages.map((m) => {
    const time = new Date(m.createdTimestamp).toLocaleString('es-AR');
    const attachments = m.attachments.size ? ` [${m.attachments.size} archivo(s) adjunto(s)]` : '';
    return `[${time}] ${m.author.tag || m.author.username}: ${m.content}${attachments}`;
  });

  return lines.join('\n') || '(sin mensajes)';
}

async function handleCloseButton(interaction, config) {
  await interaction.reply({ content: '🔒 Cerrando el ticket en 5 segundos...' });

  const transcriptText = await buildTranscript(interaction.channel).catch(() => '(no se pudo generar la transcripción)');
  const ticket = await db.closeTicket({ channelId: interaction.channel.id, closedBy: interaction.user.id });

  if (config?.ticketTranscripts?.enabled && config.ticketTranscripts.channelId) {
    try {
      const logChannel = await interaction.client.channels.fetch(config.ticketTranscripts.channelId);
      if (logChannel && logChannel.isTextBased()) {
        const attachment = new AttachmentBuilder(Buffer.from(transcriptText, 'utf8'), {
          name: `ticket-${ticket ? String(ticket.number).padStart(4, '0') : interaction.channel.name}.txt`,
        });
        const embed = new EmbedBuilder()
          .setColor(resolveColor(config, 'brand'))
          .setTitle(`📄 Transcripción — ${interaction.channel.name}`)
          .addFields(
            { name: 'Usuario', value: ticket ? `<@${ticket.userId}>` : 'Desconocido', inline: true },
            { name: 'Cerrado por', value: `<@${interaction.user.id}>`, inline: true },
          );
        await logChannel.send({ embeds: [embed], files: [attachment] });
      }
    } catch (err) {
      console.error('No se pudo mandar la transcripción:', err);
    }
  }

  if (config?.ticketFeedback?.enabled && ticket) {
    try {
      const user = await interaction.client.users.fetch(ticket.userId);
      const stars = new ActionRowBuilder().addComponents(
        [1, 2, 3, 4, 5].map((n) =>
          new ButtonBuilder().setCustomId(`${RATE_PREFIX}${ticket._id}:${n}`).setLabel('⭐'.repeat(n)).setStyle(ButtonStyle.Secondary),
        ),
      );
      await user.send({ content: '¿Cómo calificarías la atención que recibiste en tu ticket?', components: [stars] });
    } catch (err) {
      console.error('No se pudo mandar la encuesta de satisfacción:', err.message);
    }
  }

  setTimeout(() => {
    interaction.channel.delete().catch((err) => console.error('No se pudo borrar el canal del ticket:', err));
  }, 5000);
}

async function handleRatingButton(interaction) {
  if (!interaction.customId.startsWith(RATE_PREFIX)) return;

  const [, ticketId, stars] = interaction.customId.split(':');
  await db.rateTicket(ticketId, Number(stars));
  await interaction.update({ content: `¡Gracias por tu calificación! ${'⭐'.repeat(Number(stars))}`, components: [] });
}

module.exports = {
  definition,
  publishPanel,
  handleTicketCommand,
  handleCategorySelect,
  handleOpenButton,
  handleClaimButton,
  handleCloseButton,
  handleRatingButton,
  CLOSE_BUTTON_ID,
  CLAIM_BUTTON_ID,
  CATEGORY_SELECT_ID,
  OPEN_BUTTON_PREFIX,
  RATE_PREFIX,
  resolveTicketParentCategory,
};
