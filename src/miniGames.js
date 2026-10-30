const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('./db');
const botStats = require('./botStats');
const { buildEmbed, errorEmbed, successEmbed, warningEmbed } = require('./embedStyle');

// minijuegos (/juego). Todo el estado vive en memoria mientras dura la partida
// y se maneja con collectors sobre el mismo mensaje, asi no hace falta
// enrutar botones en index.js. Si el bot se reinicia a mitad de una partida
// esa partida se pierde (y una apuesta ya cobrada tambien: por eso hay tope).

const definition = new SlashCommandBuilder()
  .setName('juego')
  .setDescription('Minijuegos para jugar con el server')
  .addSubcommand((sub) =>
    sub
      .setName('tresenraya')
      .setDescription('Tres en raya contra otro miembro')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Tu rival').setRequired(true))
      .addIntegerOption((opt) => opt.setName('apuesta').setDescription('Monedas que pone cada uno (opcional)').setMinValue(1).setMaxValue(1000000)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('conecta4')
      .setDescription('Conecta 4 contra otro miembro')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Tu rival').setRequired(true))
      .addIntegerOption((opt) => opt.setName('apuesta').setDescription('Monedas que pone cada uno (opcional)').setMinValue(1).setMaxValue(1000000)),
  )
  .addSubcommand((sub) => sub.setName('ahorcado').setDescription('Ahorcado: adivinen la palabra entre todos'))
  .addSubcommand((sub) => sub.setName('adivina').setDescription('Adivina el número del 1 al 100 antes que los demás'))
  .addSubcommand((sub) => sub.setName('matematica').setDescription('El primero en resolver la cuenta gana'));

const busyUsers = new Set();
const busyChannels = new Set();

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[randomBetween(0, list.length - 1)];
}

function normalizeGuess(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '')
    .toUpperCase()
    .trim();
}

function rewardsOn(config) {
  return Boolean(config?.economy?.enabled) && (config?.games?.rewardAmount || 0) > 0;
}

function currencyLabel(config) {
  return `${config.economy.currencySymbol}${config.economy.currencyName}`;
}

async function giveReward(config, guildId, userId) {
  if (!rewardsOn(config)) return 0;
  const amount = config.games.rewardAmount;
  await db.addBalance(guildId, userId, amount);
  return amount;
}

async function replyEphemeral(interaction, content) {
  await interaction.reply({ content, ephemeral: true });
}

// --- partidas de dos: tres en raya y conecta 4 ---

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const tresEnRaya = {
  id: 'ttt',
  title: '⭕ Tres en raya',
  symbols: ['❌', '⭕'],
  initialState: () => Array(9).fill(null),
  applyMove(state, playerIndex, arg) {
    const cell = Number(arg);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || state[cell] !== null) {
      return { ok: false, reason: '❌ Esa casilla ya está ocupada.' };
    }
    const next = state.slice();
    next[cell] = playerIndex;
    const line = TTT_LINES.find((cells) => cells.every((index) => next[index] === playerIndex));
    if (line) return { ok: true, state: next, result: { winnerIndex: playerIndex, line } };
    if (next.every((value) => value !== null)) return { ok: true, state: next, result: { draw: true } };
    return { ok: true, state: next, result: null };
  },
  boardText: () => '',
  components(state, finished, result) {
    const rows = [];
    for (let r = 0; r < 3; r++) {
      const row = new ActionRowBuilder();
      for (let c = 0; c < 3; c++) {
        const index = r * 3 + c;
        const owner = state[index];
        const button = new ButtonBuilder().setCustomId(`ttt:${index}`);
        if (owner === null) button.setLabel('​').setStyle(ButtonStyle.Secondary);
        else button.setEmoji(owner === 0 ? '❌' : '⭕').setStyle(result?.line?.includes(index) ? ButtonStyle.Success : owner === 0 ? ButtonStyle.Danger : ButtonStyle.Primary);
        button.setDisabled(finished || owner !== null);
        row.addComponents(button);
      }
      rows.push(row);
    }
    return rows;
  },
};

const C4_ROWS = 6;
const C4_COLS = 7;

function c4WinningCells(board, row, col, playerIndex) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS && board[r * C4_COLS + c] === playerIndex) {
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

const conecta4 = {
  id: 'c4',
  title: '🔴 Conecta 4',
  symbols: ['🔴', '🟡'],
  initialState: () => Array(C4_ROWS * C4_COLS).fill(null),
  applyMove(state, playerIndex, arg) {
    const col = Number(arg);
    if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) return { ok: false, reason: '❌ Esa columna no existe.' };
    let row = -1;
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (state[r * C4_COLS + col] === null) {
        row = r;
        break;
      }
    }
    if (row === -1) return { ok: false, reason: '❌ Esa columna está llena.' };

    const next = state.slice();
    next[row * C4_COLS + col] = playerIndex;
    const winning = c4WinningCells(next, row, col, playerIndex);
    if (winning) return { ok: true, state: next, result: { winnerIndex: playerIndex, cells: winning } };
    if (next.slice(0, C4_COLS).every((value) => value !== null)) return { ok: true, state: next, result: { draw: true } };
    return { ok: true, state: next, result: null };
  },
  boardText(state, result) {
    const winning = new Set((result?.cells || []).map(([r, c]) => r * C4_COLS + c));
    const lines = ['1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣'];
    for (let r = 0; r < C4_ROWS; r++) {
      let line = '';
      for (let c = 0; c < C4_COLS; c++) {
        const index = r * C4_COLS + c;
        const owner = state[index];
        if (owner === null) line += '⚫';
        else if (winning.size && !winning.has(index)) line += owner === 0 ? '🟥' : '🟨';
        else line += owner === 0 ? '🔴' : '🟡';
      }
      lines.push(line);
    }
    return lines.join('\n');
  },
  components(state, finished) {
    const buttons = [];
    for (let c = 0; c < C4_COLS; c++) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`c4:${c}`)
          .setLabel(String(c + 1))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(finished || state[c] !== null),
      );
    }
    return [new ActionRowBuilder().addComponents(buttons.slice(0, 4)), new ActionRowBuilder().addComponents(buttons.slice(4))];
  },
};

async function runTwoPlayerGame(interaction, config, game) {
  const guildId = interaction.guild.id;
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('usuario', true);
  const bet = interaction.options.getInteger('apuesta') || 0;

  if (!config?.games?.enabled) return replyEphemeral(interaction, '⚠️ Los minijuegos no están habilitados en este server.');
  if (opponent.bot) return replyEphemeral(interaction, '❌ Los bots no saben jugar (todavía).');
  if (opponent.id === challenger.id) return replyEphemeral(interaction, '❌ No puedes jugar contra ti mismo/a.');
  if (busyUsers.has(challenger.id) || busyUsers.has(opponent.id)) {
    return replyEphemeral(interaction, '⏳ Alguno de los dos ya está en una partida. Esperen a que termine.');
  }
  if (bet > 0) {
    if (!config.economy?.enabled) return replyEphemeral(interaction, '❌ Las apuestas necesitan la economía activada.');
    if (bet > config.games.maxBet) return replyEphemeral(interaction, `❌ La apuesta máxima es ${config.games.maxBet} ${currencyLabel(config)}.`);
  }

  busyUsers.add(challenger.id);
  busyUsers.add(opponent.id);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    busyUsers.delete(challenger.id);
    busyUsers.delete(opponent.id);
  };

  try {
    const players = [challenger, opponent];
    const betText = bet > 0 ? `\n💰 Apuesta: **${bet} ${currencyLabel(config)}** cada uno (el que gane se lleva ${bet * 2}).` : '';

    const challengeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('game-accept').setLabel('Aceptar').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('game-decline').setLabel('Rechazar').setEmoji('❌').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({
      content: `<@${opponent.id}>`,
      embeds: [
        buildEmbed({
          type: 'brand',
          title: game.title,
          description: `<@${challenger.id}> te retó a una partida.${betText}\n\nTienes 60 segundos para responder.`,
          thumbnail: challenger.displayAvatarURL(),
          config,
        }),
      ],
      components: [challengeRow],
    });
    const message = await interaction.fetchReply();

    let answer;
    try {
      answer = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i) => {
          if (i.user.id === opponent.id) return true;
          i.reply({ content: 'Este reto no es para ti.', ephemeral: true }).catch(() => {});
          return false;
        },
      });
    } catch {
      await message.edit({ content: '', embeds: [warningEmbed(config, { description: 'El reto expiró sin respuesta.' })], components: [] }).catch(() => {});
      release();
      return;
    }

    if (answer.customId === 'game-decline') {
      await answer.update({ content: '', embeds: [warningEmbed(config, { description: `<@${opponent.id}> rechazó el reto.` })], components: [] });
      release();
      return;
    }

    // las apuestas se cobran a los dos antes de empezar y se reparten al final
    if (bet > 0) {
      const challengerPaid = await db.spendBalance(guildId, challenger.id, bet);
      const opponentPaid = challengerPaid ? await db.spendBalance(guildId, opponent.id, bet) : false;
      if (!challengerPaid || !opponentPaid) {
        if (challengerPaid) await db.addBalance(guildId, challenger.id, bet);
        const broke = !challengerPaid ? challenger : opponent;
        await answer.update({ content: '', embeds: [errorEmbed(config, { description: `<@${broke.id}> no tiene saldo para la apuesta de ${bet} ${currencyLabel(config)}.` })], components: [] });
        release();
        return;
      }
    }

    const settle = async (result) => {
      if (bet <= 0) return;
      try {
        if (result.draw) {
          await Promise.all(players.map((player) => db.addBalance(guildId, player.id, bet)));
        } else {
          await db.addBalance(guildId, players[result.winnerIndex].id, bet * 2);
        }
      } catch (err) {
        console.error('No se pudo repartir una apuesta de minijuego:', err);
      }
    };

    let state = game.initialState();
    let turn = 0;

    const payload = (result) => {
      const finished = Boolean(result);
      let status;
      if (!finished) status = `${game.symbols[turn]} Turno de <@${players[turn].id}>`;
      else if (result.draw) status = '🤝 ¡Empate!';
      else status = `🏆 ¡Ganó <@${players[result.winnerIndex].id}>${bet > 0 ? ` y se lleva ${bet * 2} ${currencyLabel(config)}` : ''}!`;
      const board = game.boardText(state, result);
      return {
        content: '',
        embeds: [
          buildEmbed({
            type: finished ? (result.draw ? 'warning' : 'success') : 'brand',
            title: game.title,
            description: `${game.symbols[0]} <@${players[0].id}>  vs  ${game.symbols[1]} <@${players[1].id}>${bet > 0 ? `\n💰 Apuesta: ${bet} ${currencyLabel(config)} c/u` : ''}\n\n${status}${board ? `\n\n${board}` : ''}`,
            config,
          }),
        ],
        components: game.components(state, finished, result),
      };
    };

    await answer.update(payload(null));

    let ended = false;
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 120000, time: 15 * 60000 });

    collector.on('collect', async (i) => {
      try {
        if (!i.customId.startsWith(`${game.id}:`)) return;
        if (ended) return void i.deferUpdate().catch(() => {});
        if (!players.some((player) => player.id === i.user.id)) return void i.reply({ content: 'Solo juegan los dos retados.', ephemeral: true });
        if (i.user.id !== players[turn].id) return void i.reply({ content: '⏳ Todavía no es tu turno.', ephemeral: true });

        const move = game.applyMove(state, turn, i.customId.slice(game.id.length + 1));
        if (!move.ok) return void i.reply({ content: move.reason, ephemeral: true });

        state = move.state;
        if (move.result) {
          ended = true;
          collector.stop('finished');
          botStats.recordGame();
          await settle(move.result);
          await i.update(payload(move.result));
        } else {
          turn = 1 - turn;
          await i.update(payload(null));
        }
      } catch (err) {
        console.error('Error en una jugada de minijuego:', err);
      }
    });

    collector.on('end', async (_collected, reason) => {
      release();
      if (reason === 'finished') return;
      ended = true;
      await settle({ draw: true });
      await message
        .edit({
          content: '',
          embeds: [warningEmbed(config, { title: 'Partida cancelada', description: `Pasó demasiado tiempo sin jugadas.${bet > 0 ? ' Las apuestas se devolvieron.' : ''}` })],
          components: [],
        })
        .catch(() => {});
    });
  } catch (err) {
    release();
    throw err;
  }
}

// --- juegos colaborativos: ahorcado, adivina el numero, matematica ---

const HANGMAN_WORDS = [
  'CREEPER', 'REDSTONE', 'DIAMANTE', 'ESMERALDA', 'ESPADA', 'ZOMBI', 'ESQUELETO', 'ENDERMAN', 'ALDEANO', 'NETHER',
  'BLENDER', 'ANIMACION', 'TEXTURA', 'RENDER', 'PERSONAJE', 'ILUMINACION', 'ESCENARIO', 'CAMARA', 'PELICULA', 'DIBUJO',
  'PINCEL', 'PALETA', 'SOMBRA', 'MODELADO', 'CINEMATICA', 'FOTOGRAMA', 'PIXEL', 'PORTAL', 'OBSIDIANA', 'DRAGON',
  'CASTILLO', 'AVENTURA', 'MINERIA', 'GRANJA', 'ENCANTAMIENTO', 'POCION', 'TESORO', 'COMUNIDAD', 'CREATIVO', 'SERVIDOR',
  'ARTISTA', 'CAPITULO', 'MUNDO', 'BLOQUE', 'SUPERVIVENCIA', 'PLANETA', 'GALAXIA', 'COHETE', 'ASTRONAUTA', 'ESTRELLA',
];

const HANGMAN_STAGES = [
  ' +---+\n |   |\n     |\n     |\n     |\n     |\n=======',
  ' +---+\n |   |\n O   |\n     |\n     |\n     |\n=======',
  ' +---+\n |   |\n O   |\n |   |\n     |\n     |\n=======',
  ' +---+\n |   |\n O   |\n/|   |\n     |\n     |\n=======',
  ' +---+\n |   |\n O   |\n/|\\  |\n     |\n     |\n=======',
  ' +---+\n |   |\n O   |\n/|\\  |\n/    |\n     |\n=======',
  ' +---+\n |   |\n O   |\n/|\\  |\n/ \\  |\n     |\n=======',
];
const HANGMAN_MAX_MISTAKES = 6;

// un juego colaborativo por canal a la vez; si las recompensas estan activas,
// quien lo inicia queda en espera un rato (evita farmear monedas en bucle)
async function startSoloGame(interaction, config) {
  if (!config?.games?.enabled) {
    await replyEphemeral(interaction, '⚠️ Los minijuegos no están habilitados en este server.');
    return false;
  }
  const channelId = interaction.channel.id;
  if (busyChannels.has(channelId)) {
    await replyEphemeral(interaction, '⏳ Ya hay un juego en marcha en este canal.');
    return false;
  }

  if (rewardsOn(config)) {
    const cooldownMs = (config.games.rewardCooldownMinutes || 0) * 60 * 1000;
    if (cooldownMs > 0) {
      const claimed = await db.claimEconomyCooldown(interaction.guild.id, interaction.user.id, 'lastGame', cooldownMs, 0);
      if (!claimed) {
        await replyEphemeral(interaction, `⏳ Acabas de iniciar un juego. Espera unos minutos para iniciar otro.`);
        return false;
      }
    }
  }

  busyChannels.add(channelId);
  return true;
}

async function handleAhorcado(interaction, config) {
  if (!(await startSoloGame(interaction, config))) return;
  const channelId = interaction.channel.id;

  try {
    const word = pick(HANGMAN_WORDS);
    const guessedLetters = new Set();
    const wrongGuesses = [];
    let mistakes = 0;

    const render = ({ status, type = 'brand', reveal = false } = {}) => {
      const display = word
        .split('')
        .map((letter) => (guessedLetters.has(letter) || reveal ? letter : '＿'))
        .join(' ');
      return buildEmbed({
        type,
        title: '🪢 Ahorcado',
        description: `\`\`\`\n${HANGMAN_STAGES[mistakes]}\n\`\`\`\n**${display}**\n\n❌ Fallos: ${wrongGuesses.length ? wrongGuesses.join(' ') : '—'} (${mistakes}/${HANGMAN_MAX_MISTAKES})\n${status || 'Escriban una **letra** o la **palabra completa** en el chat.'}`,
        config,
      });
    };

    await interaction.reply({ embeds: [render()] });

    const collector = interaction.channel.createMessageCollector({
      filter: (m) => !m.author.bot,
      time: 3 * 60000,
      idle: 60000,
    });

    collector.on('collect', async (m) => {
      try {
        const guess = normalizeGuess(m.content);
        let solved = false;
        let counted = false;

        if (/^[A-Z]$/.test(guess)) {
          if (guessedLetters.has(guess) || wrongGuesses.includes(guess)) return;
          counted = true;
          if (word.includes(guess)) {
            guessedLetters.add(guess);
            solved = word.split('').every((letter) => guessedLetters.has(letter));
            await m.react('✅').catch(() => {});
          } else {
            wrongGuesses.push(guess);
            mistakes++;
            await m.react('❌').catch(() => {});
          }
        } else if (guess.length === word.length && /^[A-Z]+$/.test(guess)) {
          counted = true;
          if (guess === word) {
            solved = true;
          } else {
            mistakes++;
            wrongGuesses.push(guess);
            await m.react('❌').catch(() => {});
          }
        }
        if (!counted) return;

        if (solved) {
          collector.stop('won');
          botStats.recordGame();
          const reward = await giveReward(config, interaction.guild.id, m.author.id);
          await interaction.editReply({
            embeds: [render({ type: 'success', reveal: true, status: `🏆 <@${m.author.id}> adivinó la palabra${reward ? ` y ganó **${reward} ${currencyLabel(config)}**` : ''}.` })],
          });
        } else if (mistakes >= HANGMAN_MAX_MISTAKES) {
          collector.stop('lost');
          botStats.recordGame();
          await interaction.editReply({ embeds: [render({ type: 'error', reveal: true, status: `💀 Perdieron. La palabra era **${word}**.` })] });
        } else {
          await interaction.editReply({ embeds: [render()] });
        }
      } catch (err) {
        console.error('Error en el ahorcado:', err);
      }
    });

    collector.on('end', async (_collected, reason) => {
      busyChannels.delete(channelId);
      if (reason === 'won' || reason === 'lost') return;
      await interaction.editReply({ embeds: [render({ type: 'warning', reveal: true, status: `⌛ Se acabó el tiempo. La palabra era **${word}**.` })] }).catch(() => {});
    });
  } catch (err) {
    busyChannels.delete(channelId);
    throw err;
  }
}

async function handleAdivina(interaction, config) {
  if (!(await startSoloGame(interaction, config))) return;
  const channelId = interaction.channel.id;

  try {
    const secret = randomBetween(1, 100);
    let attempts = 0;

    await interaction.reply({
      embeds: [
        buildEmbed({
          type: 'brand',
          title: '🔢 Adivina el número',
          description: `Estoy pensando en un número del **1 al 100**. Escríbanlo en el chat: ⬆️ significa que es más alto y ⬇️ que es más bajo.\n\nTienen **90 segundos**.${rewardsOn(config) ? `\n🏆 Premio: **${config.games.rewardAmount} ${currencyLabel(config)}**` : ''}`,
          config,
        }),
      ],
    });

    const collector = interaction.channel.createMessageCollector({ filter: (m) => !m.author.bot && /^\d{1,3}$/.test(m.content.trim()), time: 90000 });

    collector.on('collect', async (m) => {
      try {
        const number = Number(m.content.trim());
        attempts++;
        if (number === secret) {
          collector.stop('won');
          botStats.recordGame();
          const reward = await giveReward(config, interaction.guild.id, m.author.id);
          await m.reply({
            embeds: [successEmbed(config, { title: '¡Lo adivinaste!', description: `<@${m.author.id}> acertó: era el **${secret}** (${attempts} intento${attempts === 1 ? '' : 's'} en total).${reward ? `\n🏆 Ganó **${reward} ${currencyLabel(config)}**.` : ''}` })],
            allowedMentions: { parse: [] },
          });
        } else {
          await m.react(number < secret ? '⬆️' : '⬇️').catch(() => {});
        }
      } catch (err) {
        console.error('Error en adivina el número:', err);
      }
    });

    collector.on('end', async (_collected, reason) => {
      busyChannels.delete(channelId);
      if (reason === 'won') return;
      await interaction.channel.send({ embeds: [warningEmbed(config, { description: `⌛ Se acabó el tiempo. El número era el **${secret}**.` })] }).catch(() => {});
    });
  } catch (err) {
    busyChannels.delete(channelId);
    throw err;
  }
}

function buildMathQuestion() {
  const op = pick(['+', '-', '×']);
  let a;
  let b;
  if (op === '×') {
    a = randomBetween(3, 15);
    b = randomBetween(3, 12);
  } else {
    a = randomBetween(20, 150);
    b = randomBetween(10, 99);
  }
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { text: `${a} ${op} ${b}`, answer };
}

async function handleMatematica(interaction, config) {
  if (!(await startSoloGame(interaction, config))) return;
  const channelId = interaction.channel.id;

  try {
    const { text, answer } = buildMathQuestion();
    await interaction.reply({
      embeds: [
        buildEmbed({
          type: 'brand',
          title: '🧮 Matemática relámpago',
          description: `¿Cuánto es **${text}**?\n\nEl primero en responder bien gana. Tienen **20 segundos**.${rewardsOn(config) ? `\n🏆 Premio: **${config.games.rewardAmount} ${currencyLabel(config)}**` : ''}`,
          config,
        }),
      ],
    });

    const collector = interaction.channel.createMessageCollector({ filter: (m) => !m.author.bot && /^-?\d{1,6}$/.test(m.content.trim()), time: 20000 });

    collector.on('collect', async (m) => {
      try {
        if (Number(m.content.trim()) !== answer) return;
        collector.stop('won');
        botStats.recordGame();
        const reward = await giveReward(config, interaction.guild.id, m.author.id);
        await m.reply({
          embeds: [successEmbed(config, { title: '¡Correcto!', description: `<@${m.author.id}> respondió primero: **${text} = ${answer}**.${reward ? `\n🏆 Ganó **${reward} ${currencyLabel(config)}**.` : ''}` })],
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        console.error('Error en matematica relampago:', err);
      }
    });

    collector.on('end', async (_collected, reason) => {
      busyChannels.delete(channelId);
      if (reason === 'won') return;
      await interaction.channel.send({ embeds: [warningEmbed(config, { description: `⌛ Nadie respondió a tiempo. **${text} = ${answer}**.` })] }).catch(() => {});
    });
  } catch (err) {
    busyChannels.delete(channelId);
    throw err;
  }
}

async function handleJuegoCommand(interaction, config) {
  switch (interaction.options.getSubcommand()) {
    case 'tresenraya':
      return runTwoPlayerGame(interaction, config, tresEnRaya);
    case 'conecta4':
      return runTwoPlayerGame(interaction, config, conecta4);
    case 'ahorcado':
      return handleAhorcado(interaction, config);
    case 'adivina':
      return handleAdivina(interaction, config);
    case 'matematica':
      return handleMatematica(interaction, config);
    default:
      return null;
  }
}

module.exports = {
  definition,
  handleJuegoCommand,
  // expuestos para las pruebas
  tresEnRaya,
  conecta4,
  buildMathQuestion,
  HANGMAN_WORDS,
};
