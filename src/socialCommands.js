const crypto = require('crypto');
const { SlashCommandBuilder } = require('discord.js');
const db = require('./db');
const { buildEmbed, errorEmbed, successEmbed, warningEmbed, progressBar } = require('./embedStyle');

// --- /accion: abrazos, besos, etc. con gif (nekos.best, gratis y sin clave) ---

// {a} = quien lo hace, {b} = a quien. `solo` es el texto cuando no hay objetivo
// (null = esta accion siempre necesita a alguien)
const ACTIONS = {
  abrazar: { endpoint: 'hug', emoji: '🤗', text: '{a} abraza a {b}', solo: null },
  besar: { endpoint: 'kiss', emoji: '💋', text: '{a} besa a {b}', solo: null },
  acariciar: { endpoint: 'pat', emoji: '🫶', text: '{a} acaricia a {b}', solo: null },
  mimar: { endpoint: 'cuddle', emoji: '🥰', text: '{a} mima a {b}', solo: null },
  tomarmano: { endpoint: 'handhold', emoji: '🤝', text: '{a} toma de la mano a {b}', solo: null },
  chocar5: { endpoint: 'highfive', emoji: '🙌', text: '{a} choca los cinco con {b}', solo: null },
  molestar: { endpoint: 'poke', emoji: '👉', text: '{a} molesta a {b}', solo: null },
  cosquillas: { endpoint: 'tickle', emoji: '🤭', text: '{a} le hace cosquillas a {b}', solo: null },
  morder: { endpoint: 'bite', emoji: '😬', text: '{a} muerde a {b}', solo: null },
  abofetear: { endpoint: 'slap', emoji: '🖐️', text: '{a} le da una cachetada a {b}', solo: null },
  golpear: { endpoint: 'punch', emoji: '👊', text: '{a} golpea a {b}', solo: null },
  patear: { endpoint: 'kick', emoji: '🦵', text: '{a} patea a {b}', solo: null },
  saludar: { endpoint: 'wave', emoji: '👋', text: '{a} saluda a {b}', solo: '{a} saluda a todos' },
  bailar: { endpoint: 'dance', emoji: '💃', text: '{a} baila con {b}', solo: '{a} se pone a bailar' },
  llorar: { endpoint: 'cry', emoji: '😭', text: '{a} llora por culpa de {b}', solo: '{a} se pone a llorar' },
  sonrojarse: { endpoint: 'blush', emoji: '😳', text: '{a} se sonroja por {b}', solo: '{a} se sonroja' },
  reir: { endpoint: 'laugh', emoji: '😂', text: '{a} se ríe de {b}', solo: '{a} se ríe a carcajadas' },
  sonreir: { endpoint: 'smile', emoji: '😊', text: '{a} le sonríe a {b}', solo: '{a} sonríe' },
  guinar: { endpoint: 'wink', emoji: '😉', text: '{a} le guiña el ojo a {b}', solo: '{a} guiña el ojo' },
  dormir: { endpoint: 'sleep', emoji: '😴', text: '{a} se duerme junto a {b}', solo: '{a} se va a dormir' },
  berrinche: { endpoint: 'pout', emoji: '😤', text: '{a} hace un berrinche por {b}', solo: '{a} hace un berrinche' },
  facepalm: { endpoint: 'facepalm', emoji: '🤦', text: '{a} se hace un facepalm por {b}', solo: '{a} se hace un facepalm' },
};

const accionDefinition = new SlashCommandBuilder()
  .setName('accion')
  .setDescription('Interactúa con alguien usando un gif (abrazar, besar, bailar...)')
  .addStringOption((opt) =>
    opt
      .setName('accion')
      .setDescription('Qué quieres hacer')
      .setRequired(true)
      .addChoices(...Object.keys(ACTIONS).map((key) => ({ name: key, value: key }))),
  )
  .addUserOption((opt) => opt.setName('usuario').setDescription('Con quién (opcional en algunas acciones)'));

const repDefinition = new SlashCommandBuilder()
  .setName('rep')
  .setDescription('Reputación: reconoce a otros miembros')
  .addSubcommand((sub) =>
    sub
      .setName('dar')
      .setDescription('Darle un punto de reputación a alguien')
      .addUserOption((opt) => opt.setName('usuario').setDescription('A quién').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Ver la reputación tuya o de otro miembro')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar')),
  );

const robarDefinition = new SlashCommandBuilder()
  .setName('robar')
  .setDescription('Intenta robarle monedas a otro miembro (si te atrapan, pagas una multa)')
  .addUserOption((opt) => opt.setName('usuario').setDescription('A quién').setRequired(true));

const crimenDefinition = new SlashCommandBuilder()
  .setName('crimen')
  .setDescription('Arriesga monedas cometiendo un crimen: puedes ganar o pagar una multa');

const shipDefinition = new SlashCommandBuilder()
  .setName('ship')
  .setDescription('Calculadora del amor entre dos miembros')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Primera persona').setRequired(true))
  .addUserOption((opt) => opt.setName('usuario2').setDescription('Segunda persona (por defecto, tú)'));

const eightBallDefinition = new SlashCommandBuilder()
  .setName('8ball')
  .setDescription('Hazle una pregunta a la bola mágica')
  .addStringOption((opt) => opt.setName('pregunta').setDescription('Tu pregunta').setRequired(true).setMaxLength(200));

const avatarDefinition = new SlashCommandBuilder()
  .setName('avatar')
  .setDescription('Ver la foto de perfil de alguien en grande')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar'));

const mezclarDefinition = new SlashCommandBuilder()
  .setName('mezclar')
  .setDescription('Mezcla los nombres de dos miembros')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Primera persona').setRequired(true))
  .addUserOption((opt) => opt.setName('usuario2').setDescription('Segunda persona (por defecto, tú)'));

function formatMoney(amount, config) {
  return `${amount} ${config.economy.currencySymbol}${config.economy.currencyName}`;
}

function formatRemaining(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function randomBetween(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function replyEphemeral(interaction, content) {
  await interaction.reply({ content, ephemeral: true });
}

function socialDisabled(config) {
  return !config?.social?.enabled;
}

// --- /accion ---

async function fetchActionGif(endpoint) {
  try {
    const res = await fetch(`https://nekos.best/api/v2/${endpoint}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.results?.[0];
    return result?.url ? { url: result.url, anime: result.anime_name || null } : null;
  } catch {
    return null;
  }
}

async function handleAccionCommand(interaction, config, forcedAction) {
  if (socialDisabled(config)) return replyEphemeral(interaction, '⚠️ Las acciones sociales no están habilitadas en este server.');

  const key = forcedAction || interaction.options.getString('accion', true);
  const action = ACTIONS[key];
  if (!action) return replyEphemeral(interaction, '⚠️ No conozco esa acción.');

  const target = interaction.options.getUser('usuario');
  if (!target && !action.solo) {
    return replyEphemeral(interaction, `⚠️ Para **${key}** tienes que mencionar a alguien.`);
  }

  await interaction.deferReply();

  const actor = `**${interaction.member?.displayName || interaction.user.username}**`;
  let text;
  if (!target) {
    text = action.solo.split('{a}').join(actor);
  } else if (target.id === interaction.user.id) {
    text = action.solo
      ? action.solo.split('{a}').join(actor)
      : `${actor} intenta ${key} a sí mismo/a... y la verdad es que se ve un poco solo/a 🥲`;
  } else {
    text = action.text.split('{a}').join(actor).split('{b}').join(`**${target.username}**`);
  }

  const gif = await fetchActionGif(action.endpoint);
  const embed = buildEmbed({
    type: 'brand',
    description: `${action.emoji} ${text}`,
    image: gif?.url,
    footer: gif ? (gif.anime ? `Anime: ${gif.anime} · nekos.best` : 'nekos.best') : undefined,
    config,
  });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

// --- /rep ---

async function handleRepCommand(interaction, config) {
  if (socialDisabled(config) || !config.social.repEnabled) {
    return replyEphemeral(interaction, '⚠️ La reputación no está habilitada en este server.');
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'ver') {
    const user = interaction.options.getUser('usuario') || interaction.user;
    const account = await db.getEconomyAccount(interaction.guild.id, user.id);
    const embed = buildEmbed({
      type: 'brand',
      author: { name: user.username, iconURL: user.displayAvatarURL() },
      description: `⭐ **${account.rep || 0}** puntos de reputación`,
      config,
    });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  const target = interaction.options.getUser('usuario', true);
  if (target.id === interaction.user.id) return replyEphemeral(interaction, '❌ No puedes darte reputación a ti mismo/a.');
  if (target.bot) return replyEphemeral(interaction, '❌ Los bots no acumulan reputación.');

  const cooldownMs = (config.social.repCooldownHours || 12) * 60 * 60 * 1000;
  const giver = await db.getEconomyAccount(interaction.guild.id, interaction.user.id);
  if (giver.lastRep && Date.now() - new Date(giver.lastRep).getTime() < cooldownMs) {
    const remaining = cooldownMs - (Date.now() - new Date(giver.lastRep).getTime());
    return replyEphemeral(interaction, `⏳ Ya diste reputación hace poco. Vuelve en ${formatRemaining(remaining)}.`);
  }

  const claimed = await db.claimEconomyCooldown(interaction.guild.id, interaction.user.id, 'lastRep', cooldownMs, 0);
  if (!claimed) return replyEphemeral(interaction, '⏳ Ya diste reputación hace poco.');

  const total = await db.addReputation(interaction.guild.id, target.id);
  const embed = successEmbed(config, {
    title: 'Reputación entregada',
    description: `<@${interaction.user.id}> le dio un punto de reputación a <@${target.id}>.\n⭐ Ahora tiene **${total}**.`,
    thumbnail: target.displayAvatarURL(),
  });
  await interaction.reply({ embeds: [embed] });
}

// --- /robar y /crimen (mueven monedas, apagados por defecto) ---

const CRIME_WIN_TEXTS = [
  'Vendiste renders "exclusivos" falsificados en el mercado negro',
  'Hackeaste una máquina expendedora y se escaparon las monedas',
  'Te colaste a una sala VIP y revendiste los tickets',
  'Cambiaste los precios de una tienda mientras nadie miraba',
  'Estafaste a un creeper con un trato "imperdible"',
];

const CRIME_LOSS_TEXTS = [
  'Te atrapó el guardia de seguridad',
  'Tu cómplice se quedó con el botín y te dejó la multa',
  'Una cámara grabó todo el asunto',
  'El plan se te cayó a mitad de camino',
  'Un aldeano te delató ante la policía',
];

async function handleRobarCommand(interaction, config) {
  const social = config?.social;
  if (!config?.economy?.enabled || !social?.enabled || !social.robEnabled) {
    return replyEphemeral(interaction, '⚠️ Robar no está habilitado en este server.');
  }

  const target = interaction.options.getUser('usuario', true);
  if (target.id === interaction.user.id) return replyEphemeral(interaction, '❌ No puedes robarte a ti mismo/a.');
  if (target.bot) return replyEphemeral(interaction, '❌ Los bots no llevan dinero encima.');

  const guildId = interaction.guild.id;
  const cooldownMs = (social.robCooldownMinutes || 60) * 60 * 1000;
  const [thief, victim] = await Promise.all([
    db.getEconomyAccount(guildId, interaction.user.id),
    db.getEconomyAccount(guildId, target.id),
  ]);

  if (thief.lastRob && Date.now() - new Date(thief.lastRob).getTime() < cooldownMs) {
    const remaining = cooldownMs - (Date.now() - new Date(thief.lastRob).getTime());
    return replyEphemeral(interaction, `⏳ La policía te está vigilando. Vuelve en ${formatRemaining(remaining)}.`);
  }
  if (victim.balance < 50) return replyEphemeral(interaction, '❌ Esa persona no tiene suficiente dinero para que valga la pena (mínimo 50).');
  if (thief.balance < 25) return replyEphemeral(interaction, '❌ Necesitas al menos 25 monedas para arriesgarte (si te atrapan, pagas multa).');

  const claimed = await db.claimEconomyCooldown(guildId, interaction.user.id, 'lastRob', cooldownMs, 0);
  if (!claimed) return replyEphemeral(interaction, '⏳ La policía te está vigilando.');

  const maxAmount = social.robMaxAmount || 500;
  const success = Math.random() * 100 < (social.robSuccessPercent ?? 45);

  if (success) {
    const amount = Math.max(1, Math.min(maxAmount, Math.floor(victim.balance * (randomBetween(10, 30) / 100))));
    const moved = await db.transferBalance(guildId, target.id, interaction.user.id, amount);
    if (!moved) return interaction.reply({ embeds: [warningEmbed(config, { description: `<@${target.id}> se te escapó: ya no tenía dinero encima.` })] });
    const embed = successEmbed(config, {
      title: 'Robo exitoso',
      description: `<@${interaction.user.id}> le robó **${formatMoney(amount, config)}** a <@${target.id}>.`,
    });
    return interaction.reply({ embeds: [embed] });
  }

  const fine = Math.min(thief.balance, Math.max(10, Math.min(Math.floor(maxAmount / 2), Math.floor(victim.balance * 0.1))));
  await db.transferBalance(guildId, interaction.user.id, target.id, fine);
  const embed = errorEmbed(config, {
    title: 'Te atraparon',
    description: `<@${interaction.user.id}> intentó robarle a <@${target.id}>, falló y le pagó una multa de **${formatMoney(fine, config)}**.`,
  });
  return interaction.reply({ embeds: [embed] });
}

async function handleCrimenCommand(interaction, config) {
  const social = config?.social;
  if (!config?.economy?.enabled || !social?.enabled || !social.crimeEnabled) {
    return replyEphemeral(interaction, '⚠️ Los crímenes no están habilitados en este server.');
  }

  const guildId = interaction.guild.id;
  const cooldownMs = (social.crimeCooldownMinutes || 120) * 60 * 1000;
  const account = await db.getEconomyAccount(guildId, interaction.user.id);

  if (account.lastCrime && Date.now() - new Date(account.lastCrime).getTime() < cooldownMs) {
    const remaining = cooldownMs - (Date.now() - new Date(account.lastCrime).getTime());
    return replyEphemeral(interaction, `⏳ Mejor espera a que se calme la policía. Vuelve en ${formatRemaining(remaining)}.`);
  }

  const claimed = await db.claimEconomyCooldown(guildId, interaction.user.id, 'lastCrime', cooldownMs, 0);
  if (!claimed) return replyEphemeral(interaction, '⏳ Mejor espera a que se calme la policía.');

  const min = social.crimeMinAmount || 50;
  const max = social.crimeMaxAmount || 250;
  if (Math.random() * 100 < (social.crimeSuccessPercent ?? 50)) {
    const amount = randomBetween(min, max);
    await db.addBalance(guildId, interaction.user.id, amount);
    return interaction.reply({
      embeds: [successEmbed(config, { title: 'Crimen perfecto', description: `${pick(CRIME_WIN_TEXTS)} y ganaste **${formatMoney(amount, config)}**.` })],
    });
  }

  const fine = Math.min(account.balance, randomBetween(Math.ceil(min / 2), Math.ceil(max / 2)));
  const paid = fine > 0 ? await db.spendBalance(guildId, interaction.user.id, fine) : true;
  const fineText = fine > 0 && paid ? ` y pagaste una multa de **${formatMoney(fine, config)}**` : ', pero por suerte no tenías nada que perder';
  return interaction.reply({ embeds: [errorEmbed(config, { title: 'Crimen fallido', description: `${pick(CRIME_LOSS_TEXTS)}${fineText}.` })] });
}

// --- /ship, /8ball, /avatar, /mezclar ---

// el porcentaje sale de un hash de los dos IDs (sin importar el orden): la
// misma pareja siempre obtiene el mismo resultado
function shipPercent(idA, idB) {
  const [first, second] = [idA, idB].sort();
  return crypto.createHash('sha1').update(`${first}:${second}`).digest()[0] % 101;
}

function mixNames(a, b) {
  return `${a.slice(0, Math.ceil(a.length / 2))}${b.slice(Math.floor(b.length / 2))}`;
}

async function handleShipCommand(interaction, config) {
  const first = interaction.options.getUser('usuario', true);
  const second = interaction.options.getUser('usuario2') || interaction.user;
  const percent = shipPercent(first.id, second.id);

  let verdict = '💔 Mejor como amigos...';
  if (percent >= 90) verdict = '💞 ¡Almas gemelas!';
  else if (percent >= 70) verdict = '❤️ Hay mucha química';
  else if (percent >= 50) verdict = '💛 Podría funcionar';
  else if (percent >= 25) verdict = '🧡 Hay que esforzarse un poco';

  const embed = buildEmbed({
    type: percent >= 50 ? 'success' : 'warning',
    title: `💘 ${first.username} + ${second.username}`,
    description: `**${mixNames(first.username, second.username)}**\n\n${progressBar(percent, 100, 12)} **${percent}%**\n${verdict}`,
    footer: 'El resultado es siempre el mismo para la misma pareja',
    config,
  });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

const EIGHT_BALL_ANSWERS = {
  yes: ['Sí, definitivamente.', 'Todo apunta a que sí.', 'Sin duda alguna.', 'Puedes contar con ello.', 'Las señales dicen que sí.'],
  maybe: ['Pregúntame de nuevo más tarde.', 'No puedo predecirlo ahora.', 'Concéntrate y vuelve a preguntar.', 'Mejor no decírtelo ahora.'],
  no: ['No cuentes con ello.', 'Mi respuesta es no.', 'Mis fuentes dicen que no.', 'Muy dudoso.'],
};

async function handleEightBallCommand(interaction, config) {
  const question = interaction.options.getString('pregunta', true);
  const kind = pick(['yes', 'yes', 'maybe', 'no', 'no']);
  const type = { yes: 'success', maybe: 'warning', no: 'error' }[kind];
  const embed = buildEmbed({
    type,
    title: '🎱 La bola mágica responde',
    fields: [
      { name: 'Pregunta', value: question.slice(0, 200) },
      { name: 'Respuesta', value: pick(EIGHT_BALL_ANSWERS[kind]) },
    ],
    config,
  });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleAvatarCommand(interaction, config) {
  const user = interaction.options.getUser('usuario') || interaction.user;
  const link = (extension) => user.displayAvatarURL({ extension, size: 1024, forceStatic: true });
  const embed = buildEmbed({
    type: 'brand',
    title: `Avatar de ${user.username}`,
    description: `[PNG](${link('png')}) · [JPG](${link('jpg')}) · [WEBP](${link('webp')})`,
    image: user.displayAvatarURL({ size: 1024 }),
    config,
  });
  await interaction.reply({ embeds: [embed] });
}

async function handleMezclarCommand(interaction, config) {
  const first = interaction.options.getUser('usuario', true);
  const second = interaction.options.getUser('usuario2') || interaction.user;
  const embed = buildEmbed({
    type: 'brand',
    title: '🧪 Mezcla de nombres',
    description: `**${first.username}** + **${second.username}**\n\n1️⃣ ${mixNames(first.username, second.username)}\n2️⃣ ${mixNames(second.username, first.username)}`,
    config,
  });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

module.exports = {
  ACTIONS,
  accionDefinition,
  repDefinition,
  robarDefinition,
  crimenDefinition,
  shipDefinition,
  eightBallDefinition,
  avatarDefinition,
  mezclarDefinition,
  handleAccionCommand,
  handleRepCommand,
  handleRobarCommand,
  handleCrimenCommand,
  handleShipCommand,
  handleEightBallCommand,
  handleAvatarCommand,
  handleMezclarCommand,
  shipPercent,
  mixNames,
};
