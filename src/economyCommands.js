const { SlashCommandBuilder } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const definition = new SlashCommandBuilder()
  .setName('economia')
  .setDescription('Sistema de economía del server')
  .addSubcommand((sub) =>
    sub
      .setName('balance')
      .setDescription('Mostrar tu saldo o el de otro usuario')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar')),
  )
  .addSubcommand((sub) => sub.setName('daily').setDescription('Reclamar tu recompensa diaria'))
  .addSubcommand((sub) => sub.setName('work').setDescription('Trabajar para ganar dinero'))
  .addSubcommand((sub) =>
    sub
      .setName('pay')
      .setDescription('Transferirle dinero a otro usuario')
      .addUserOption((opt) => opt.setName('usuario').setDescription('A quién le transferís').setRequired(true))
      .addIntegerOption((opt) => opt.setName('cantidad').setDescription('Cuánto transferir').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((sub) => sub.setName('shop').setDescription('Ver la tienda del server'))
  .addSubcommand((sub) =>
    sub
      .setName('comprar')
      .setDescription('Comprar un item de la tienda')
      .addStringOption((opt) => opt.setName('item').setDescription('Nombre del item').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('inventario')
      .setDescription('Ver tu inventario o el de otro usuario')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('perfil')
      .setDescription('Ver la tarjeta de perfil')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar')),
  );

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

async function handleEconomyCommand(interaction, config) {
  if (!config?.economy?.enabled) {
    await interaction.reply({ content: '⚠️ La economía no está habilitada en este server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'balance':
      return handleBalance(interaction, config);
    case 'daily':
      return handleDaily(interaction, config);
    case 'work':
      return handleWork(interaction, config);
    case 'pay':
      return handlePay(interaction, config);
    case 'shop':
      return handleShop(interaction, config);
    case 'comprar':
      return handleBuy(interaction, config);
    case 'inventario':
      return handleInventory(interaction, config);
    case 'perfil':
      return handleProfile(interaction, config);
    default:
      return null;
  }
}

async function handleBalance(interaction, config) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const account = await db.getEconomyAccount(interaction.guild.id, target.id);
  const embed = buildEmbed({
    type: 'brand',
    author: { name: target.username, iconURL: target.displayAvatarURL() },
    description: `💰 Tiene **${formatMoney(account.balance, config)}**.`,
    config,
  });
  await interaction.reply({ embeds: [embed] });
}

async function handleDaily(interaction, config) {
  const account = await db.getEconomyAccount(interaction.guild.id, interaction.user.id);
  const now = Date.now();

  if (account.lastDaily && now - new Date(account.lastDaily).getTime() < ONE_DAY_MS) {
    const remaining = ONE_DAY_MS - (now - new Date(account.lastDaily).getTime());
    await interaction.reply({ content: `⏳ Ya reclamaste tu diario. Volvé en ${formatRemaining(remaining)}.`, ephemeral: true });
    return;
  }

  const amount = config.economy.dailyAmount;
  const claimed = await db.claimEconomyCooldown(interaction.guild.id, interaction.user.id, 'lastDaily', ONE_DAY_MS, amount);
  if (!claimed) {
    await interaction.reply({ content: '⏳ Ya reclamaste tu diario. Volvé mañana.', ephemeral: true });
    return;
  }

  const embed = buildEmbed({
    type: 'success',
    title: '🎁 Recompensa diaria',
    description: `Ganaste **+${formatMoney(amount, config)}**. Volvé mañana por más.`,
    config,
  });
  await interaction.reply({ embeds: [embed] });
}

async function handleWork(interaction, config) {
  const account = await db.getEconomyAccount(interaction.guild.id, interaction.user.id);
  const cooldownMs = config.economy.workCooldownMinutes * 60 * 1000;
  const now = Date.now();

  if (account.lastWork && now - new Date(account.lastWork).getTime() < cooldownMs) {
    const remaining = cooldownMs - (now - new Date(account.lastWork).getTime());
    await interaction.reply({ content: `⏳ Todavía estás cansado del último trabajo. Volvé en ${formatRemaining(remaining)}.`, ephemeral: true });
    return;
  }

  const min = Math.min(config.economy.workMinAmount, config.economy.workMaxAmount);
  const max = Math.max(config.economy.workMinAmount, config.economy.workMaxAmount);
  const amount = Math.floor(Math.random() * (max - min + 1)) + min;

  const claimed = await db.claimEconomyCooldown(interaction.guild.id, interaction.user.id, 'lastWork', cooldownMs, amount);
  if (!claimed) {
    await interaction.reply({ content: '⏳ Todavía estás cansado del último trabajo.', ephemeral: true });
    return;
  }

  const embed = buildEmbed({
    type: 'success',
    title: '💼 A trabajar',
    description: `Ganaste **${formatMoney(amount, config)}**.`,
    config,
  });
  await interaction.reply({ embeds: [embed] });
}

async function handlePay(interaction, config) {
  const target = interaction.options.getUser('usuario', true);
  const amount = interaction.options.getInteger('cantidad', true);

  if (!Number.isInteger(amount) || amount < 1) {
    await interaction.reply({ content: '❌ La cantidad tiene que ser un número mayor a 0.', ephemeral: true });
    return;
  }
  if (target.id === interaction.user.id) {
    await interaction.reply({ content: '❌ No podés transferirte dinero a vos mismo.', ephemeral: true });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: '❌ No podés transferirle dinero a un bot.', ephemeral: true });
    return;
  }

  const ok = await db.transferBalance(interaction.guild.id, interaction.user.id, target.id, amount);
  if (!ok) {
    await interaction.reply({ content: `❌ No tenés suficiente saldo para transferir ${formatMoney(amount, config)}.`, ephemeral: true });
    return;
  }

  const embed = buildEmbed({
    type: 'success',
    description: `✅ Le transferiste **${formatMoney(amount, config)}** a <@${target.id}>.`,
    config,
  });
  await interaction.reply({ embeds: [embed] });
}

async function handleShop(interaction, config) {
  const items = config.economy.shopItems || [];
  if (!items.length) {
    await interaction.reply({ content: 'La tienda todavía no tiene items.', ephemeral: true });
    return;
  }

  const embed = buildEmbed({
    type: 'brand',
    title: '🛒 Tienda',
    description: items
      .map((item) => `**${item.name}** — ${formatMoney(item.price, config)}${item.description ? `\n${item.description}` : ''}`)
      .join('\n\n'),
    footer: 'Comprá con /economia comprar',
    config,
  });

  await interaction.reply({ embeds: [embed] });
}

async function handleBuy(interaction, config) {
  const itemName = interaction.options.getString('item', true);
  const item = (config.economy.shopItems || []).find((i) => i.name.toLowerCase() === itemName.toLowerCase());

  if (!item) {
    await interaction.reply({ content: `❌ No encontré ese item. Mirá /economia shop para ver los disponibles.`, ephemeral: true });
    return;
  }

  const spent = await db.spendBalance(interaction.guild.id, interaction.user.id, item.price);
  if (!spent) {
    await interaction.reply({ content: `❌ Te falta plata: ${item.name} cuesta ${formatMoney(item.price, config)}.`, ephemeral: true });
    return;
  }

  await db.addInventoryItem(interaction.guild.id, interaction.user.id, { itemId: item.id, name: item.name });
  const embed = buildEmbed({
    type: 'success',
    description: `✅ Compraste **${item.name}** por ${formatMoney(item.price, config)}.`,
    config,
  });
  await interaction.reply({ embeds: [embed] });
}

async function handleInventory(interaction, config) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const account = await db.getEconomyAccount(interaction.guild.id, target.id);

  if (!account.inventory.length) {
    await interaction.reply({ content: `<@${target.id}> no tiene items todavía.`, ephemeral: true });
    return;
  }

  const lines = account.inventory.map((item) => `**${item.name}** x${item.quantity}`);
  const embed = buildEmbed({ type: 'brand', title: `🎒 Inventario de ${target.username}`, description: lines.join('\n'), config });
  await interaction.reply({ embeds: [embed] });
}

async function handleProfile(interaction, config) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const [account, levelInfo, pet] = await Promise.all([
    db.getEconomyAccount(interaction.guild.id, target.id),
    db.getUserLevel(interaction.guild.id, target.id),
    db.getPet(interaction.guild.id, target.id),
  ]);

  const embed = buildEmbed({
    type: 'brand',
    author: { name: target.username, iconURL: target.displayAvatarURL() },
    title: '🪪 Perfil',
    thumbnail: target.displayAvatarURL(),
    fields: [
      { name: 'Saldo', value: formatMoney(account.balance, config), inline: true },
      { name: 'Nivel', value: `${levelInfo.level} (${levelInfo.xp} XP)`, inline: true },
      { name: 'Items', value: String(account.inventory.length), inline: true },
    ],
    config,
  });

  if (pet) {
    embed.addFields({ name: 'Mascota', value: `${pet.name} (${pet.species}) — nivel ${db.petLevelInfoFromXp(pet.xp).level}` });
  }

  await interaction.reply({ embeds: [embed] });
}

module.exports = { definition, handleEconomyCommand };
