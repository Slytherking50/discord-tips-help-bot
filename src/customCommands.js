const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const RESERVED_NAMES = [
  'anuncio',
  'ticket',
  'nivel',
  'ranking',
  'ban',
  'kick',
  'mute',
  'warn',
  'warnings',
  'casa',
  'economia',
  'casino',
  'casar',
  'divorciar',
  'pareja',
  'mascota',
  'trivia',
  'meme',
  'debug',
  'sorteo',
  'encuesta',
  'afk',
  'cumpleanos',
  'invitaciones',
  'decir',
  'programar',
  'resumir',
  'purge',
  'slowmode',
  'lock',
  'unlock',
  'historial',
  'voz',
  'actividad',
];
const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

const lastUse = new Map();

// sin esto, lastUse crece para siempre (una entrada por cada combinacion
// guild+usuario+comando que se haya usado alguna vez); se barre cada hora
// cualquier entrada mas vieja que el cooldown maximo razonable
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - MAX_ENTRY_AGE_MS;
  for (const [key, timestamp] of lastUse) {
    if (timestamp < cutoff) lastUse.delete(key);
  }
}, 60 * 60 * 1000);

function validateCommandName(name) {
  if (!NAME_PATTERN.test(name)) {
    return 'El nombre solo puede tener minúsculas, números, "-" y "_", sin espacios (1 a 32 caracteres).';
  }
  if (RESERVED_NAMES.includes(name)) {
    return `"${name}" ya es un comando del bot, elegí otro nombre.`;
  }
  return null;
}

function buildCustomCommandDefinition(cmd) {
  const builder = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description.slice(0, 100));
  if (cmd.adminOnly) {
    builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  }
  return builder;
}

async function registerGuildCommands(guild, config, staticDefinitions) {
  // un comando propio con el nombre de uno fijo (la lista de reservados no siempre esta al dia) haria que Discord rechace
  // TODA la lista de comandos del server: se deja afuera el propio
  const staticNames = new Set(staticDefinitions.map((definition) => definition.name));
  const customDefinitions = (config.customCommands || [])
    .filter((cmd) => !staticNames.has(cmd.name))
    .map((cmd) => buildCustomCommandDefinition(cmd).toJSON());
  return guild.commands.set([...staticDefinitions, ...customDefinitions]);
}

// crear/borrar UN comando personalizado no necesita reenviar la lista
// completa (comandos propios del bot + todos los personalizados) a Discord:
// eso pasa por el endpoint de sobreescritura masiva, que tiene un limite de
// tasa bastante estricto y puede demorar mucho si se llama seguido (cada vez
// que se crea o borra un comando desde el dashboard). Crear/editar/borrar de
// a uno usa endpoints normales, mucho mas livianos y rapidos
async function upsertGuildCommand(guild, cmd) {
  const commands = await guild.commands.fetch();
  const existing = commands.find((c) => c.name === cmd.name);
  const payload = buildCustomCommandDefinition(cmd).toJSON();
  if (existing) {
    await guild.commands.edit(existing.id, payload);
  } else {
    await guild.commands.create(payload);
  }
}

async function deleteGuildCommandByName(guild, name) {
  const commands = await guild.commands.fetch();
  const existing = commands.find((c) => c.name === name);
  if (existing) await guild.commands.delete(existing.id);
}

function findCustomCommand(config, name) {
  return (config.customCommands || []).find((cmd) => cmd.name === name);
}

function formatResponse(template, interaction) {
  return template.replace(/\{user\}/g, `<@${interaction.user.id}>`);
}

async function handleCustomCommand(interaction, config, command) {
  if (command.adminOnly) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ No tenés permiso para usar este comando.', ephemeral: true });
      return;
    }
    await interaction.reply(formatResponse(command.response, interaction));
    return;
  }

  const cooldownSeconds = Math.max(0, command.cooldownSeconds || 0);
  const key = `${interaction.guild.id}:${interaction.user.id}:${command.name}`;
  const now = Date.now();
  const cooldownMs = cooldownSeconds * 1000;

  if (lastUse.has(key) && now - lastUse.get(key) < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastUse.get(key))) / 1000);
    await interaction.reply({ content: `⏳ Esperá ${remaining}s antes de volver a usar este comando.`, ephemeral: true });
    return;
  }

  lastUse.set(key, now);
  await interaction.reply(formatResponse(command.response, interaction));
}

module.exports = {
  validateCommandName,
  buildCustomCommandDefinition,
  registerGuildCommands,
  upsertGuildCommand,
  deleteGuildCommandByName,
  findCustomCommand,
  handleCustomCommand,
};
