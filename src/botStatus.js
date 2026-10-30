const { ActivityType } = require('discord.js');
const botStats = require('./botStats');

// estado del bot (el globito junto a su foto de perfil): va rotando entre lo
// que hace y datos reales sacados de Discord y de la base, nunca numeros
// inventados. Cada numero solo aparece si de verdad hay algo que contar.

const MIN_INTERVAL_MS = 15 * 1000; // Discord limita cuantas veces se puede cambiar la presencia
const DEFAULT_INTERVAL_MS = 30 * 1000;
const MAX_STATE_LENGTH = 128;

const numberFormat = new Intl.NumberFormat('es');

function count(amount, one, many) {
  return `${numberFormat.format(amount)} ${amount === 1 ? one : many}`;
}

function buildStatusMessages({ guilds, members, games, commands }) {
  const messages = [];
  if (games > 0) messages.push(`¡${count(games, 'partida jugada', 'partidas jugadas')}!`);
  messages.push(`Cuidando ${count(guilds, 'servidor', 'servidores')}`);
  messages.push('Tickets, niveles, economía y moderación');
  if (members > 0) messages.push(`${count(members, 'miembro', 'miembros')} en la comunidad`);
  messages.push('Prueba /juego con tus amigos');
  if (commands > 0) messages.push(`¡${count(commands, 'comando usado', 'comandos usados')}!`);
  messages.push('¿Dudas? Abre un /ticket');
  return messages;
}

// "Custom" es el estado personalizado: el texto va en `state` y `name` es solo un relleno
function applyStatus(client, text) {
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: text.slice(0, MAX_STATE_LENGTH) }],
  });
}

function startBotStatus(client, { intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let index = 0;

  const update = () => {
    if (!client.user) return;
    const stats = botStats.getBotStatsTotals();
    const members = client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount || 0), 0);
    const messages = buildStatusMessages({
      guilds: client.guilds.cache.size,
      members,
      games: stats.gamesPlayed,
      commands: stats.commandsUsed,
    });

    try {
      applyStatus(client, messages[index % messages.length]);
    } catch (err) {
      console.error('No se pudo actualizar el estado del bot:', err);
    }
    index += 1;
  };

  update();
  return setInterval(update, Math.max(MIN_INTERVAL_MS, intervalMs));
}

module.exports = { buildStatusMessages, startBotStatus, MIN_INTERVAL_MS };
