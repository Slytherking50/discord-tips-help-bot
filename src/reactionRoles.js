const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const { resolveColor } = require('./embedStyle');
const { reactionMatches } = require('./emojiUtil');

async function postReactionRoleMessage(guild, { channelId, title, description, pairs, config }) {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Canal inválido');
  }

  const lines = pairs.map((pair) => `${pair.emoji} — <@&${pair.roleId}>${pair.label ? ` (${pair.label})` : ''}`);
  const embed = new EmbedBuilder()
    .setColor(resolveColor(config, 'brand'))
    .setTitle(title || 'Elegí tus roles')
    .setDescription(`${description ? `${description}\n\n` : ''}${lines.join('\n')}`);

  const message = await channel.send({ embeds: [embed] });

  for (const pair of pairs) {
    try {
      await message.react(pair.emoji);
    } catch (err) {
      console.error(`No se pudo reaccionar con ${pair.emoji}:`, err.message);
    }
  }

  await db.createReactionRoleSet({ guildId: guild.id, channelId, messageId: message.id, pairs });
  return message;
}

async function deleteReactionRoleSet(guild, messageId) {
  const set = await db.getReactionRoleSet(messageId);
  if (!set) return;

  try {
    const channel = await guild.channels.fetch(set.channelId);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
    }
  } catch (err) {
    console.error('No se pudo borrar el mensaje de roles por reacción:', err.message);
  }

  await db.deleteReactionRoleSet(messageId);
}

async function handleReactionChange(reaction, user, action) {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      return;
    }
  }

  const set = await db.getReactionRoleSet(reaction.message.id);
  if (!set) return;

  // el emoji guardado puede ser de Unicode ("🎨"), personalizado ("<:nombre:id>") o, en configs viejas, un id suelto
  const pair = set.pairs.find((p) => reactionMatches(p.emoji, reaction.emoji));
  if (!pair) return;

  try {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    if (action === 'add') {
      await member.roles.add(pair.roleId);
    } else {
      await member.roles.remove(pair.roleId);
    }
  } catch (err) {
    console.error('No se pudo actualizar el rol por reacción:', err.message);
  }
}

module.exports = {
  postReactionRoleMessage,
  deleteReactionRoleSet,
  handleReactionChange,
};
