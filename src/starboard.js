const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');
const { resolveColor } = require('./embedStyle');
const { reactionMatches } = require('./emojiUtil');

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

async function countReactions(reaction, authorId) {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return 0;
    }
  }

  const users = await reaction.users.fetch();
  return users.filter((u) => !u.bot && u.id !== authorId).size;
}

function buildStarboardEmbed(message, count, config) {
  const embed = new EmbedBuilder()
    .setColor(resolveColor(config, 'warning'))
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setDescription(message.content || '*(sin texto)*')
    .setFooter({ text: `ID: ${message.id}` })
    .setTimestamp(message.createdTimestamp);

  const imageAttachment = message.attachments.find((a) => IMAGE_EXTENSIONS.test(a.name || a.url));
  if (imageAttachment) embed.setImage(imageAttachment.url);

  const linkButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Ir al mensaje original').setStyle(ButtonStyle.Link).setURL(message.url).setEmoji('🔗'),
  );

  return {
    content: `${config.starboard.emoji} **${count}** | <#${message.channel.id}>`,
    embeds: [embed],
    components: [linkButton],
  };
}

async function handleStarboardReaction(reaction, config) {
  const starboard = config?.starboard;
  if (!starboard || !starboard.enabled || !starboard.channelId) return;
  // sirve para emojis de Unicode (con o sin selector de variacion) y para los personalizados del server
  if (!reactionMatches(starboard.emoji, reaction.emoji)) return;

  const message = reaction.message;
  if (message.partial) {
    try {
      await message.fetch();
    } catch {
      return;
    }
  }
  if (message.author.bot) return;

  const count = await countReactions(reaction, message.author.id);
  const guildId = message.guild.id;
  const existing = await db.getStarboardPost(guildId, message.id);

  if (!existing) {
    if (count < starboard.threshold) return;

    try {
      const channel = await message.client.channels.fetch(starboard.channelId);
      if (!channel || !channel.isTextBased()) return;

      const payload = buildStarboardEmbed(message, count, config);
      const posted = await channel.send(payload);

      await db.createStarboardPost({
        guildId,
        originalMessageId: message.id,
        originalChannelId: message.channel.id,
        starboardMessageId: posted.id,
        authorId: message.author.id,
        starCount: count,
      });
    } catch (err) {
      console.error('No se pudo publicar en el starboard:', err);
    }
    return;
  }

  if (existing.starCount === count) return;

  try {
    const channel = await message.client.channels.fetch(starboard.channelId);
    if (!channel || !channel.isTextBased()) return;

    const starboardMessage = await channel.messages.fetch(existing.starboardMessageId);
    await starboardMessage.edit({ content: `${starboard.emoji} **${count}** | <#${message.channel.id}>` });
    await db.updateStarboardPostCount(guildId, message.id, count);
  } catch (err) {
    console.error('No se pudo actualizar el starboard:', err);
  }
}

module.exports = { handleStarboardReaction };
