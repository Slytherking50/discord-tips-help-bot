const db = require('./db');

// contadores globales del bot (partidas jugadas, comandos usados) para el
// estado que se muestra en su perfil. Se acumulan en memoria y se guardan en
// MongoDB cada tanto, en vez de escribir en la base por cada comando.

let totals = { gamesPlayed: 0, commandsUsed: 0 };
let pending = { gamesPlayed: 0, commandsUsed: 0 };

async function loadBotStats() {
  try {
    const stored = await db.getBotStats();
    // lo que ya se conto antes de terminar de cargar todavia no esta en la base
    totals = { gamesPlayed: stored.gamesPlayed + pending.gamesPlayed, commandsUsed: stored.commandsUsed + pending.commandsUsed };
  } catch (err) {
    console.error('No se pudieron cargar los contadores del bot:', err);
  }
}

function recordGame() {
  pending.gamesPlayed += 1;
  totals.gamesPlayed += 1;
}

function recordCommand() {
  pending.commandsUsed += 1;
  totals.commandsUsed += 1;
}

async function flushBotStats() {
  if (!pending.gamesPlayed && !pending.commandsUsed) return;
  const delta = pending;
  pending = { gamesPlayed: 0, commandsUsed: 0 };
  try {
    await db.incrementBotStats(delta);
  } catch (err) {
    // si falla el guardado se devuelve lo pendiente para el proximo intento
    pending.gamesPlayed += delta.gamesPlayed;
    pending.commandsUsed += delta.commandsUsed;
    console.error('No se pudieron guardar los contadores del bot:', err);
  }
}

function getBotStatsTotals() {
  return { ...totals };
}

module.exports = { loadBotStats, recordGame, recordCommand, flushBotStats, getBotStatsTotals };
