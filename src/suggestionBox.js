const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

// buzon de sugerencias. Conviven dos generaciones de tarjetas:
//  - las nuevas (Components V2): votos con barra de porcentaje, "Mi voto", un menu para que el staff cambie el estado (pendiente, en revision,
//    aprobada, rechazada, implementada) y, si el servidor lo activa, un hilo para conversar y el mensaje fijado mientras esta abierta;
//  - las viejas (embed con 4 botones), que siguen funcionando con sus botones de siempre.
// El canal elegido puede ser de texto (el mensaje se convierte en tarjeta) o un FORO (cada publicacion nueva recibe su tarjeta debajo del mensaje de
// quien sugiere, y las etiquetas de estado del foro, como "Aceptada" o "Rechazada", se mantienen al dia con el menu).

// ids de las tarjetas viejas: no cambiar, hay mensajes publicados con ellos
const VOTE_UP_ID = 'suggestion-vote-up';
const VOTE_DOWN_ID = 'suggestion-vote-down';
const APPROVE_ID = 'suggestion-approve';
const REJECT_ID = 'suggestion-reject';

// ids de las tarjetas nuevas
const UP_ID = 'sug:up';
const DOWN_ID = 'sug:down';
const MINE_ID = 'sug:me';
const STATUS_ID = 'sug:status';

const STATUS_LABEL = { pending: '🟡 Pendiente', approved: '✅ Aprobada', rejected: '❌ Rechazada' };

// "open": se puede votar. Al aprobar, rechazar o implementar se cierra la votacion; el staff puede reabrirla con el menu
const STATUSES = {
  pending: { label: 'Pendiente', emoji: '⏳', color: 0xec7b2c, open: true },
  review: { label: 'En revisión', emoji: '🔎', color: 0x5865f2, open: true },
  approved: { label: 'Aprobada', emoji: '✅', color: 0x3ba55d, open: false },
  rejected: { label: 'Rechazada', emoji: '❌', color: 0xed4245, open: false },
  implemented: { label: 'Implementada', emoji: '🚀', color: 0x9b59b6, open: false },
};
const statusOf = (status) => STATUSES[status] || STATUSES.pending;
const isOpen = (status) => statusOf(status).open;

const MAX_CONTENT = 1500; // letras de la sugerencia que se muestran en la tarjeta (una tarjeta de Discord admite 4000 en total)
const BAR_SIZE = 10;

function tally(votes) {
  const values = Object.values(votes || {});
  return {
    up: values.filter((v) => v === 1).length,
    down: values.filter((v) => v === -1).length,
  };
}

// votos a favor y en contra, porcentaje a favor y la barra (10 segmentos)
function voteSummary(votes) {
  const { up, down } = tally(votes);
  const total = up + down;
  const percent = total ? Math.round((up / total) * 100) : 0;
  const filled = total ? Math.round((up / total) * BAR_SIZE) : 0;
  return { up, down, total, percent, bar: '▰'.repeat(filled) + '▱'.repeat(BAR_SIZE - filled) };
}

function canDecide(member, config) {
  const approvalRoleIds = config?.suggestions?.approvalRoleIds || [];
  if (!approvalRoleIds.length) return member.permissions.has(PermissionFlagsBits.ManageGuild);
  return member.roles.cache.some((role) => approvalRoleIds.includes(role.id));
}

// --- tarjetas nuevas (Components V2) ---

const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const text = (content) => new TextDisplayBuilder().setContent(content);

// cada linea va como cita: asi un "# titulo" o una lista escrita por quien sugiere no desarma la tarjeta
function quote(content) {
  const clipped = content.length > MAX_CONTENT ? `${content.slice(0, MAX_CONTENT - 1).trimEnd()}…` : content;
  return clipped.split('\n').map((line) => `> ${line}`).join('\n');
}

function votingRow(open) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(UP_ID).setLabel('A favor').setEmoji('👍').setStyle(ButtonStyle.Success).setDisabled(!open),
    new ButtonBuilder().setCustomId(DOWN_ID).setLabel('En contra').setEmoji('👎').setStyle(ButtonStyle.Danger).setDisabled(!open),
    new ButtonBuilder().setCustomId(MINE_ID).setLabel('Mi voto').setEmoji('🧾').setStyle(ButtonStyle.Secondary),
  );
}

// el menu lo ve todo el mundo (Discord no puede esconderlo), pero solo lo puede usar el staff
function statusRow(current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(STATUS_ID)
      .setPlaceholder('Cambiar estado (solo el staff)')
      .addOptions(Object.entries(STATUSES).map(([value, status]) => ({ label: status.label, value, emoji: status.emoji, default: value === current }))),
  );
}

// el mensaje completo de una sugerencia (sirve para publicarla y para editarla). allowedMentions vacio: nunca avisa a nadie, ni a quien sugiere
function buildSuggestionMessage(suggestion, config) {
  const status = statusOf(suggestion.status);
  const anonymous = !suggestion.forum && (suggestion.anonymous ?? Boolean(config?.suggestions?.anonymous));
  const { up, down, total, percent, bar } = voteSummary(suggestion.votes);
  const by = suggestion.status !== 'pending' && suggestion.staffId ? ` · por <@${suggestion.staffId}>` : '';
  const body = [suggestion.content ? quote(suggestion.content) : '', suggestion.hasFiles ? '📎 *Con archivos adjuntos en el mensaje de arriba.*' : ''].filter(Boolean).join('\n\n');

  const container = new ContainerBuilder().setAccentColor(status.color);
  container.addTextDisplayComponents(text(anonymous ? '## 💡 Sugerencia anónima' : `## 💡 Sugerencia de <@${suggestion.authorId}>`), text(`${status.emoji} **${status.label}**${by}`));
  container.addSeparatorComponents(divider());
  // en un foro el texto ya esta en la publicacion, justo arriba: no se repite
  if (!suggestion.forum) {
    container.addTextDisplayComponents(text(body || '*(sin texto)*'));
    container.addSeparatorComponents(divider());
  }
  container.addTextDisplayComponents(text(`👍 **${up}** a favor · 👎 **${down}** en contra`), text(total ? `${bar}  **${percent} %** a favor` : `${bar}  Aún sin votos`));
  container.addActionRowComponents(votingRow(status.open), statusRow(suggestion.status));
  container.addTextDisplayComponents(text(status.open ? '-# Vota con los botones. Toca tu voto otra vez para quitarlo.' : '-# La votación está cerrada. El staff puede reabrirla cambiando el estado.'));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function threadName(content) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  return `Sugerencia: ${flat || 'sin texto'}`.slice(0, 100);
}

// hilo para conversar y mensaje fijado: opcionales y a prueba de permisos que falten (no deben impedir que la sugerencia se publique)
async function addExtras(posted, message, draft, suggestions) {
  if (suggestions.pin) await posted.pin().catch((err) => console.error('No se pudo fijar la sugerencia:', err.message));
  if (!suggestions.thread) return;
  try {
    const thread = await posted.startThread({ name: threadName(draft.content), autoArchiveDuration: 1440 });
    await db.setSuggestionThread(posted.id, thread.id);
    // quien sugiere queda "siguiendo" el hilo (salvo que sea anonima)
    if (!draft.anonymous) await thread.members.add(message.author.id).catch(() => {});
  } catch (err) {
    console.error('No se pudo abrir el hilo de la sugerencia:', err.message);
  }
}

// --- foros ---

// las etiquetas de estado de un foro se reconocen por su nombre (sin emojis, mayusculas ni tildes): "Aceptada", "❌RECHAZADA", "Bug solucionado"...
const STATUS_TAG_WORDS = {
  pending: ['pendiente'],
  review: ['revision', 'revisando'],
  approved: ['aceptad', 'aprobad'],
  rejected: ['rechazad'],
  implemented: ['implementad', 'solucionad'],
};
const plain = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// a que estado corresponde una etiqueta (o null si no es de estado: "Eventos", "Roles"...)
function statusOfTag(tag) {
  const name = plain(tag?.name);
  return Object.keys(STATUS_TAG_WORDS).find((status) => STATUS_TAG_WORDS[status].some((word) => name.includes(word))) || null;
}

// las etiquetas que quedan: se conservan las que no son de estado, se quitan las de estado y se pone la del nuevo estado (si el foro la tiene)
function tagsForStatus(availableTags, appliedTagIds, status) {
  const statusTagIds = new Set(availableTags.filter((tag) => statusOfTag(tag)).map((tag) => tag.id));
  const wanted = availableTags.find((tag) => statusOfTag(tag) === status);
  const kept = appliedTagIds.filter((id) => !statusTagIds.has(id));
  return (wanted ? [...kept, wanted.id] : kept).slice(0, 5);
}

async function syncStatusTags(thread, status) {
  const available = thread?.parent?.availableTags;
  if (!Array.isArray(available) || !available.length || typeof thread.setAppliedTags !== 'function') return;
  const applied = thread.appliedTags || [];
  const next = tagsForStatus(available, applied, status);
  if (next.length === applied.length && next.every((id) => applied.includes(id))) return;
  await thread.setAppliedTags(next, 'Estado de la sugerencia');
}

// el mensaje de quien sugiere (es el primero de la publicacion) puede tardar un instante en estar disponible
const STARTER_TRIES = 4;
const STARTER_RETRY_MS = 400;
async function fetchStarter(thread) {
  for (let attempt = 0; attempt < STARTER_TRIES; attempt += 1) {
    const message = await thread.fetchStarterMessage?.().catch(() => null);
    if (message) return message;
    if (attempt < STARTER_TRIES - 1) await new Promise((resolve) => setTimeout(resolve, STARTER_RETRY_MS * (attempt + 1)));
  }
  return null;
}

// publicacion nueva en el foro de sugerencias: la tarjeta de votacion se publica dentro de la publicacion
async function handleForumPost(thread, config) {
  const suggestions = config?.suggestions;
  if (!suggestions?.enabled || !suggestions.channelId || thread.parentId !== suggestions.channelId) return false;
  if (thread.parent && thread.parent.type !== ChannelType.GuildForum) return false;

  const starter = await fetchStarter(thread);
  const author = starter?.author;
  const authorId = author?.id || thread.ownerId;
  if (!authorId || author?.bot || authorId === thread.client?.user?.id) return false;

  const draft = { content: '', forum: true, status: 'pending', votes: {}, authorId, anonymous: false };
  try {
    const posted = await thread.send(buildSuggestionMessage(draft, config));
    await db.createSuggestion({
      guildId: thread.guildId || thread.guild?.id,
      channelId: thread.id,
      messageId: posted.id,
      authorId,
      authorTag: author?.username || 'desconocido',
      authorAvatar: author?.displayAvatarURL?.() || undefined,
      content: String(starter?.content || '').trim(),
      title: thread.name,
      forum: true,
      threadId: thread.id,
      anonymous: false,
      hasFiles: (starter?.attachments?.size || 0) > 0,
      version: 2,
    });
    if (suggestions.pin) await posted.pin().catch((err) => console.error('No se pudo fijar la tarjeta de la sugerencia:', err.message));
  } catch (err) {
    console.error('No se pudo publicar la tarjeta en el foro de sugerencias:', err.message);
  }
  return true;
}

async function handleSuggestionMessage(message, config) {
  const suggestions = config?.suggestions;
  if (!suggestions?.enabled || !suggestions.channelId || message.channel.id !== suggestions.channelId) return false;
  if (message.author.bot) return false;

  const content = String(message.content || '').trim();
  const hasFiles = (message.attachments?.size || 0) > 0;
  if (!content && !hasFiles) return false;

  const draft = { content, hasFiles, status: 'pending', votes: {}, authorId: message.author.id, anonymous: Boolean(suggestions.anonymous) };

  try {
    // con archivos adjuntos el mensaje original se queda (si se borrara, se perderian las imagenes) y la tarjeta le responde
    const posted = await message.channel.send({
      ...buildSuggestionMessage(draft, config),
      ...(hasFiles ? { reply: { messageReference: message.id, failIfNotExists: false } } : {}),
    });

    await db.createSuggestion({
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: posted.id,
      authorId: message.author.id,
      authorTag: message.author.username,
      authorAvatar: message.author.displayAvatarURL(),
      content,
      anonymous: draft.anonymous,
      hasFiles,
      version: 2,
    });

    if (!hasFiles) await message.delete().catch(() => {});
    await addExtras(posted, message, draft, suggestions);
  } catch (err) {
    console.error('No se pudo publicar la sugerencia:', err);
  }

  return true;
}

async function handleVote(interaction, config) {
  const suggestion = await db.getSuggestion(interaction.message.id);
  if (!suggestion) {
    await interaction.reply({ content: '⚠️ No encuentro esta sugerencia en mi memoria.', ephemeral: true });
    return;
  }
  if (!isOpen(suggestion.status)) {
    await interaction.reply({ content: '⚠️ La votación de esta sugerencia está cerrada.', ephemeral: true });
    return;
  }

  const value = interaction.customId === UP_ID ? 1 : -1;
  const current = suggestion.votes?.[interaction.user.id];
  const updated =
    current === value
      ? await db.removeSuggestionVote(interaction.message.id, interaction.user.id)
      : await db.setSuggestionVote(interaction.message.id, interaction.user.id, value);

  await interaction.update(buildSuggestionMessage(updated, config));
}

async function handleMyVote(interaction) {
  const suggestion = await db.getSuggestion(interaction.message.id);
  const vote = suggestion?.votes?.[interaction.user.id];
  const content = vote === 1 ? '👍 Votaste **a favor**.' : vote === -1 ? '👎 Votaste **en contra**.' : 'Todavía no has votado en esta sugerencia.';
  await interaction.reply({ content, ephemeral: true });
}

// avisos que acompanan a un cambio de estado: el mensaje fijado solo mientras esta abierta, y una linea en el hilo (con aviso a quien sugirio)
async function afterStatusChange(interaction, suggestion, config) {
  const status = statusOf(suggestion.status);
  if (config?.suggestions?.pin) {
    await (status.open ? interaction.message.pin() : interaction.message.unpin()).catch(() => {});
  }
  if (!suggestion.threadId) return;
  const thread = await interaction.client?.channels?.fetch(suggestion.threadId).catch(() => null);
  if (!thread?.isThread?.()) return;
  // en un foro, las etiquetas de estado de la publicacion ("Aceptada", "Rechazada"...) siguen al menu
  if (suggestion.forum) await syncStatusTags(thread, suggestion.status).catch((err) => console.error('No se pudieron actualizar las etiquetas de la publicacion:', err.message));
  const notify = !suggestion.anonymous && suggestion.authorId ? suggestion.authorId : null;
  await thread
    .send({ content: `${notify ? `<@${notify}> ` : ''}${status.emoji} La sugerencia pasó a **${status.label}** (por <@${interaction.user.id}>).`, allowedMentions: { users: notify ? [notify] : [] } })
    .catch((err) => console.error('No se pudo avisar en el hilo de la sugerencia:', err.message));
}

async function handleStatusSelect(interaction, config) {
  if (!canDecide(interaction.member, config)) {
    await interaction.reply({ content: '❌ Solo el staff puede cambiar el estado de una sugerencia.', ephemeral: true });
    return;
  }
  const status = interaction.values?.[0];
  if (!STATUSES[status]) {
    await interaction.reply({ content: '⚠️ Ese estado no existe.', ephemeral: true });
    return;
  }

  const updated = await db.changeSuggestionStatus(interaction.message.id, status, interaction.user.id, interaction.user.username);
  if (!updated) {
    await interaction.reply({ content: '⚠️ No encuentro esta sugerencia en mi memoria.', ephemeral: true });
    return;
  }

  await interaction.update(buildSuggestionMessage(updated, config));
  await afterStatusChange(interaction, updated, config).catch((err) => console.error('No se pudo terminar el cambio de estado de la sugerencia:', err.message));
}

// --- tarjetas viejas (embed con 4 botones): siguen funcionando ---

function buildSuggestionEmbed(suggestion, config) {
  const { up, down } = tally(suggestion.votes);
  const decided = suggestion.status !== 'pending';

  return buildEmbed({
    type: suggestion.status === 'approved' ? 'success' : suggestion.status === 'rejected' ? 'error' : 'brand',
    author: config.suggestions.anonymous ? undefined : { name: suggestion.authorTag, iconURL: suggestion.authorAvatar },
    description: suggestion.content,
    fields: [
      { name: 'Estado', value: STATUS_LABEL[suggestion.status], inline: true },
      { name: 'Votos', value: `👍 ${up}  👎 ${down}`, inline: true },
    ],
    footer: decided ? `${STATUS_LABEL[suggestion.status]} por ${suggestion.staffTag}` : 'Vota con los botones de abajo',
    config,
  });
}

function buildButtons({ disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VOTE_UP_ID).setLabel('👍').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(VOTE_DOWN_ID).setLabel('👎').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(APPROVE_ID).setLabel('Aprobar').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(REJECT_ID).setLabel('Rechazar').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

async function handleVoteButton(interaction, config) {
  const value = interaction.customId === VOTE_UP_ID ? 1 : -1;
  const suggestion = await db.getSuggestion(interaction.message.id);

  if (!suggestion || suggestion.status !== 'pending') {
    await interaction.reply({ content: '⚠️ Esta sugerencia ya no está abierta a votos.', ephemeral: true });
    return;
  }

  const current = suggestion.votes?.[interaction.user.id];
  const updated =
    current === value
      ? await db.removeSuggestionVote(interaction.message.id, interaction.user.id)
      : await db.setSuggestionVote(interaction.message.id, interaction.user.id, value);

  await interaction.update({ embeds: [buildSuggestionEmbed(updated, config)] });
}

async function handleDecisionButton(interaction, config) {
  if (!canDecide(interaction.member, config)) {
    await interaction.reply({ content: '❌ No tienes permiso para decidir sobre sugerencias.', ephemeral: true });
    return;
  }

  const suggestion = await db.getSuggestion(interaction.message.id);
  if (!suggestion || suggestion.status !== 'pending') {
    await interaction.reply({ content: '⚠️ Esta sugerencia ya fue decidida.', ephemeral: true });
    return;
  }

  const status = interaction.customId === APPROVE_ID ? 'approved' : 'rejected';
  const updated = await db.setSuggestionStatus(interaction.message.id, status, interaction.user.id, interaction.user.username);
  if (!updated) {
    await interaction.reply({ content: '⚠️ Esta sugerencia ya fue decidida (otro miembro del staff se adelantó).', ephemeral: true });
    return;
  }

  await interaction.update({ embeds: [buildSuggestionEmbed(updated, config)], components: [buildButtons({ disabled: true })] });
}

module.exports = {
  VOTE_UP_ID,
  VOTE_DOWN_ID,
  APPROVE_ID,
  REJECT_ID,
  UP_ID,
  DOWN_ID,
  MINE_ID,
  STATUS_ID,
  STATUSES,
  voteSummary,
  statusOfTag,
  tagsForStatus,
  buildSuggestionMessage,
  handleForumPost,
  handleSuggestionMessage,
  handleVote,
  handleMyVote,
  handleStatusSelect,
  handleVoteButton,
  handleDecisionButton,
};
