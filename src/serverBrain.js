// lo que la IA sabe del server sin que el staff escriba nada. Se arma solo con datos reales de Discord (canales publicos y para
// que sirven, roles, quien es staff, eventos) y con la configuracion del bot (niveles, economia, tickets, casas...). Da tres cosas:
//  - overview(): un mapa corto del server que va SIEMPRE en el prompt (nombres de todos los canales publicos por categoria), para que
//    la IA pueda ubicar "donde subo mis renders" aunque la pregunta no use las palabras del nombre del canal
//  - documents(): los detalles, que se buscan por la pregunta (src/knowledge.js) y solo se pasan si vienen al caso
//  - ground(): corrige lo que la IA escribe: "#reglas" pasa a ser una mencion clickeable y un canal inventado se detecta
// Nunca entra lo privado: solo canales que @everyone ve, y nada de claves, listas de palabras prohibidas ni canales internos del staff.

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const FORUM_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia]);
const VOICE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const STAFF_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
];
const MAX_DOC_CHARS = 1400;

function oneLine(text, max) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// corta en el limite de una palabra (o de una frase) en vez de a media palabra
function shorten(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`;
}

// "「🌎」sobre-nosotros" -> "sobre-nosotros"; "『✧: Manager :✧』" -> "Manager"; "𝖠nti-spam" -> "Anti-spam". Lo que no es letra, numero,
// guion o guion bajo (emojis, marcos, separadores) se va. spaces:true conserva los espacios (para roles y categorias)
function cleanName(name, { spaces = false } = {}) {
  const base = String(name ?? '').normalize('NFKC');
  const stripped = base.replace(/[^\p{L}\p{N}_\- ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const joined = spaces ? stripped : stripped.replace(/ /g, '-');
  return joined.replace(/^[-_ ]+|[-_ ]+$/g, '') || base.trim();
}

// ---------- foto del server ----------

// datos planos (sin objetos de discord.js): se arma una vez cada tanto y todo lo demas trabaja sobre esto
function takeSnapshot(guild, { now = Date.now() } = {}) {
  const everyone = guild.roles?.everyone || null;
  const canSee = (channel) => {
    try {
      return Boolean(channel.permissionsFor?.(everyone)?.has(PermissionFlagsBits.ViewChannel));
    } catch {
      return false;
    }
  };

  const rawChannels = [...(guild.channels?.cache?.values() || [])].filter((channel) => !channel.isThread?.());
  const categories = rawChannels.filter((c) => c.type === ChannelType.GuildCategory);
  const categoryNames = new Map(categories.map((c) => [c.id, cleanName(c.name, { spaces: true })]));
  const categoryPositions = new Map(categories.map((c) => [c.id, c.rawPosition ?? c.position ?? 0]));
  const channels = rawChannels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    clean: cleanName(channel.name),
    type: channel.type,
    parentId: channel.parentId || null,
    category: categoryNames.get(channel.parentId) || null,
    categoryPosition: categoryPositions.get(channel.parentId) ?? -1,
    topic: oneLine(channel.topic, 220),
    nsfw: Boolean(channel.nsfw),
    slowmode: channel.rateLimitPerUser || 0,
    isPublic: canSee(channel),
    position: channel.rawPosition ?? channel.position ?? 0,
  }));

  const roles = [...(guild.roles?.cache?.values() || [])]
    .filter((role) => role.id !== guild.id)
    .map((role) => ({
      id: role.id,
      name: role.name,
      clean: cleanName(role.name, { spaces: true }),
      position: role.position ?? 0,
      members: role.members?.size ?? 0,
      humans: [...(role.members?.values() || [])].filter((member) => !member.user?.bot).length,
      hoist: Boolean(role.hoist),
      managed: Boolean(role.managed),
      admin: Boolean(role.permissions?.has?.(PermissionFlagsBits.Administrator)),
      staff: STAFF_PERMISSIONS.some((permission) => role.permissions?.has?.(permission)),
      memberNames: [...(role.members?.values() || [])].filter((member) => !member.user?.bot).slice(0, 8).map((member) => member.displayName),
    }))
    .sort((a, b) => b.position - a.position);

  const events = [...(guild.scheduledEvents?.cache?.values() || [])]
    .filter((event) => event.scheduledStartTimestamp && event.scheduledStartTimestamp > now - 3 * 3600 * 1000)
    .slice(0, 8)
    .map((event) => ({ name: oneLine(event.name, 80), description: oneLine(event.description, 140), startsAt: event.scheduledStartTimestamp, where: oneLine(event.entityMetadata?.location || event.channel?.name, 60) }));

  return {
    takenAt: now,
    id: guild.id,
    name: guild.name,
    description: oneLine(guild.description, 400),
    memberCount: guild.memberCount ?? 0,
    createdAt: guild.createdAt instanceof Date ? guild.createdAt.toISOString() : null,
    ownerName: guild.members?.cache?.get?.(guild.ownerId)?.displayName || null,
    boosts: guild.premiumSubscriptionCount || 0,
    tier: guild.premiumTier || 0,
    locale: guild.preferredLocale || null,
    rulesChannelId: guild.rulesChannelId || null,
    channels,
    roles,
    events,
    emojiNames: [...(guild.emojis?.cache?.values() || [])].map((emoji) => emoji.name).slice(0, 40),
  };
}

// como se ve en Discord: primero lo que no tiene categoria, despues cada categoria en su orden y los canales dentro de ella en el suyo
function sortByPosition(list) {
  return [...list].sort((a, b) => (a.categoryPosition ?? -1) - (b.categoryPosition ?? -1) || a.position - b.position);
}

function publicChannels(snapshot) {
  return snapshot.channels.filter((channel) => channel.isPublic && channel.type !== ChannelType.GuildCategory);
}

function staffRoles(snapshot) {
  // un rol que solo tienen bots (como un rol "BOTS" con permisos) no es staff de personas
  return snapshot.roles.filter((role) => role.staff && !role.managed && role.humans > 0);
}

// ---------- el mapa corto que va siempre ----------

function overview(snapshot, { maxChars = 1500 } = {}) {
  if (!snapshot) return '';
  const lines = [`Server "${cleanDescription(snapshot.name)}": ${snapshot.memberCount} miembros.${snapshot.description ? ` ${shorten(cleanDescription(snapshot.description), 200)}` : ''}`];

  const visible = sortByPosition(publicChannels(snapshot));
  const categories = new Map();
  for (const channel of visible) {
    const key = channel.category || 'Sin categoría';
    if (!categories.has(key)) categories.set(key, { text: [], voice: [] });
    (VOICE_TYPES.has(channel.type) ? categories.get(key).voice : categories.get(key).text).push(channel);
  }
  const channelLines = [];
  for (const [category, { text, voice }] of categories) {
    const names = [...text.map((channel) => `#${channel.clean}`), ...voice.map((channel) => `🔊${channel.clean}`)];
    if (names.length) channelLines.push(`${category}: ${names.join(' ')}`);
  }
  if (channelLines.length) lines.push('Canales públicos (por categoría):', ...channelLines);

  const staff = staffRoles(snapshot).slice(0, 8).map((role) => role.clean);
  if (staff.length) lines.push(`Roles de staff: ${staff.join(', ')}.`);

  // si el server es enorme se recorta lo ultimo en vez de pasarse del tope
  let text = lines.join('\n');
  while (text.length > maxChars && channelLines.length > 3) {
    channelLines.pop();
    text = [lines[0], 'Canales públicos (por categoría):', ...channelLines, ...(staff.length ? [lines[lines.length - 1]] : [])].join('\n');
  }
  return text.slice(0, maxChars);
}

// la descripcion del server suele traer emojis y adornos que no ayudan a la IA
function cleanDescription(text) {
  return String(text ?? '').replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

// ---------- documentos que se buscan por la pregunta ----------

function doc(id, group, title, text, keywords = []) {
  return { id, group, title: oneLine(title, 80), text: String(text).slice(0, MAX_DOC_CHARS), keywords };
}

function typeLabel(channel) {
  if (FORUM_TYPES.has(channel.type)) return 'foro';
  if (channel.type === ChannelType.GuildAnnouncement) return 'canal de anuncios';
  if (channel.type === ChannelType.GuildStageVoice) return 'escenario';
  if (VOICE_TYPES.has(channel.type)) return 'canal de voz';
  return 'canal de texto';
}

function channelDocuments(snapshot) {
  const byCategory = new Map();
  for (const channel of sortByPosition(publicChannels(snapshot))) {
    const key = channel.category || 'Sin categoría';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(channel);
  }
  return [...byCategory].map(([category, channels]) => {
    const lines = channels.map((channel) => `#${channel.clean} (${typeLabel(channel)}${channel.topic ? `; tema: ${oneLine(cleanDescription(channel.topic), 110)}` : ''}${channel.nsfw ? '; contenido +18' : ''}${channel.slowmode ? `; modo lento ${channel.slowmode} s` : ''})`);
    return doc(`canales:${category}`, 'canales', `Canales de ${category}`, lines.join('\n'), channels.map((channel) => channel.clean));
  });
}

function roleDocuments(snapshot) {
  const docs = [];
  const staff = staffRoles(snapshot);
  if (staff.length) {
    const lines = staff.map((role) => `${role.clean}${role.admin ? ' (administrador)' : ''}: ${role.memberNames.join(', ')}${role.humans > role.memberNames.length ? ` y ${role.humans - role.memberNames.length} más` : ''}`);
    docs.push(doc('roles:staff', 'roles', 'Staff del server (quién es quién)', lines.join('\n'), ['staff', 'moderador', 'admin', 'administrador', 'owner', 'dueño', 'ceo', ...staff.map((role) => role.clean)]));
  }
  const others = snapshot.roles.filter((role) => !role.staff && !role.managed);
  if (others.length) {
    const lines = others.map((role) => `${role.clean}${role.members ? ` (${role.members})` : ''}`);
    docs.push(doc('roles:todos', 'roles', 'Roles del server', `${others.length} roles (entre paréntesis, cuántas personas lo tienen): ${lines.join(', ')}`, others.map((role) => role.clean)));
  }
  return docs;
}

function serverDocument(snapshot) {
  const created = snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleDateString('es-CL') : null;
  const parts = [
    `${cleanDescription(snapshot.name)}${snapshot.description ? `: ${oneLine(cleanDescription(snapshot.description), 300)}` : ''}`,
    `Miembros: ${snapshot.memberCount}.${created ? ` Creado el ${created}.` : ''}${snapshot.ownerName ? ` Dueño/a: ${snapshot.ownerName}.` : ''}`,
    `Mejoras (boosts): ${snapshot.boosts}${snapshot.tier ? ` (nivel ${snapshot.tier})` : ''}.`,
    snapshot.rulesChannelId ? `Las reglas están en <#${snapshot.rulesChannelId}>.` : '',
  ].filter(Boolean);
  return doc('servidor:datos', 'servidor', 'Datos del server', parts.join('\n'), ['miembros', 'somos', 'cuantos', 'boost', 'mejoras', 'creado', 'dueño', 'owner', 'descripcion', 'sobre', 'comunidad']);
}

function eventDocument(snapshot) {
  if (!snapshot.events.length) return null;
  const lines = snapshot.events.map((event) => `${event.name} — ${new Date(event.startsAt).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}${event.where ? ` en ${event.where}` : ''}${event.description ? `. ${event.description}` : ''}`);
  return doc('eventos:programados', 'eventos', 'Eventos programados', lines.join('\n'), ['evento', 'eventos', 'cuando', 'proximo', 'programado']);
}

// ---------- lo que el bot hace en este server, segun su configuracion ----------

function systemDocuments(config, snapshot) {
  if (!config) return [];
  const publicIds = new Set(publicChannels(snapshot).map((channel) => channel.id));
  const where = (id) => (id && publicIds.has(id) ? `<#${id}>` : null);
  const roleName = (id) => snapshot.roles.find((role) => role.id === id)?.clean || null;
  const docs = [];
  const onOff = (value) => (value ? 'activado' : 'desactivado');

  const lv = config.leveling;
  if (lv) {
    const rewards = (lv.levelRoles || []).map((reward) => `nivel ${reward.level} → rol ${roleName(reward.roleId) || '(rol borrado)'}`).filter(Boolean);
    docs.push(doc('sistema:niveles', 'sistemas', 'Niveles y XP', lv.enabled
      ? `El sistema de niveles está activado: se ganan entre ${lv.xpMin} y ${lv.xpMax} XP por mensaje (como mucho una vez cada ${lv.cooldownSeconds} s).${lv.voiceXpEnabled ? ` También se gana XP por estar en voz (${lv.voiceXpPerMinute} por minuto).` : ''}${rewards.length ? ` Recompensas: ${rewards.join('; ')}.` : ''} Se ve con /nivel y /ranking.`
      : 'El sistema de niveles de este bot está desactivado (el server puede tener niveles de otro bot: si no está en la información, di que no lo sabes).', ['nivel', 'niveles', 'xp', 'experiencia', 'rank', 'ranking', 'subir']));
  }

  const eco = config.economy;
  if (eco) {
    const items = (eco.shopItems || []).slice(0, 10).map((item) => `${item.name || item.label} (${item.price} ${eco.currencyName})`);
    docs.push(doc('sistema:economia', 'sistemas', 'Economía', eco.enabled
      ? `Hay economía con ${eco.currencyName} ${eco.currencySymbol}: el premio diario es de ${eco.dailyAmount}, trabajar da entre ${eco.workMinAmount} y ${eco.workMaxAmount} cada ${eco.workCooldownMinutes} min. ${items.length ? `Tienda: ${items.join(', ')}.` : 'La tienda todavía no tiene artículos.'} Se usa con el comando /economia.${config.casino?.enabled ? ' También hay casino (/casino).' : ''}${config.pets?.enabled ? ' Hay mascotas (/mascota).' : ''}`
      : 'La economía (monedas) de este bot está desactivada en este server.', ['economia', 'monedas', 'plata', 'dinero', 'daily', 'diario', 'trabajar', 'tienda', 'casino', 'mascota', eco.currencyName]));
  }

  const categories = config.ticketCategories || [];
  const panels = (config.ticketPanels || []).map((panel) => where(panel.channelId)).filter(Boolean);
  if (categories.length || panels.length) {
    docs.push(doc('sistema:tickets', 'sistemas', 'Tickets de soporte', `Para pedir ayuda al staff se abre un ticket${panels.length ? ` desde el panel en ${panels.join(' o ')}` : ' con el comando /ticket'}. Categorías: ${categories.map((category) => category.label).join(', ') || '(ninguna)'}. Abrir un ticket sin un motivo válido puede ser sancionado.`, ['ticket', 'tickets', 'soporte', 'ayuda', 'reporte', 'reportar', 'staff']));
  }

  const houses = config.houses;
  if (houses) {
    docs.push(doc('sistema:casas', 'sistemas', 'Casas (Houses)', houses.enabled
      ? `Hay un sistema de casas: se pide completando un formulario${where(houses.requestChannelId) ? ` en ${where(houses.requestChannelId)}` : ''} y el staff lo revisa (también se puede usar /house).`
      : 'El sistema de casas de este bot está desactivado.', ['casa', 'casas', 'house', 'houses', 'formulario', 'pedir']));
  }

  const features = [];
  if (config.welcome?.enabled) features.push(`Bienvenidas${where(config.welcome.channelId) ? ` en ${where(config.welcome.channelId)}` : ''}${roleName(config.welcome.roleId) ? ` (se da el rol ${roleName(config.welcome.roleId)})` : ''}`);
  if (config.starboard?.enabled) features.push(`Cuadro de honor: los mensajes con ${config.starboard.threshold} reacciones ${config.starboard.emoji} pasan a ${where(config.starboard.channelId) || 'un canal destacado'}`);
  if (config.birthdays?.enabled) features.push(`Cumpleaños: se avisa en ${where(config.birthdays.channelId) || 'un canal'} y cada quien carga el suyo con /cumpleanos`);
  if (config.suggestions?.enabled) features.push(`Sugerencias en ${where(config.suggestions.channelId) || 'un canal'}`);
  if (config.serverGuide?.enabled) features.push(`Guía del server en ${where(config.serverGuide.channelId) || 'un canal'}`);
  if (config.miniEvents?.enabled) features.push(`Mini eventos cada ${config.miniEvents.intervalMinutes} min en ${where(config.miniEvents.channelId) || 'un canal'}`);
  if (config.trivia?.enabled) features.push('Trivia (/trivia)');
  if (config.games?.enabled) features.push('Juegos con premio');
  if (config.skills?.enabled) features.push('Habilidades por rol');
  if (config.alerts?.enabled && (config.alerts.items || []).length) features.push(`Alertas de redes (${config.alerts.items.map((item) => item.platform).join(', ')})`);
  if (config.textCommands?.enabled) features.push(`Los comandos también funcionan con el prefijo ${config.textCommands.prefix || '!'}`);
  if (features.length) docs.push(doc('sistema:extras', 'sistemas', 'Otras funciones del bot en este server', features.join('. ') + '.', ['bienvenida', 'cumpleaños', 'starboard', 'sugerencias', 'guia', 'mini', 'evento', 'trivia', 'alertas', 'prefijo']));

  const mod = config.automod;
  if (mod?.enabled) {
    const rules = [mod.blockInvites ? 'bloqueo de invitaciones a otros servers' : null, mod.antiSpam?.enabled ? 'anti-spam' : null, mod.scamShield?.enabled ? 'escudo anti-estafas' : null, mod.raid?.enabled ? 'protección contra raids' : null, mod.mentionSpamLimit ? `límite de ${mod.mentionSpamLimit} menciones por mensaje` : null].filter(Boolean);
    if (rules.length) docs.push(doc('sistema:automod', 'sistemas', 'Moderación automática', `El server tiene moderación automática: ${rules.join(', ')}. Las sanciones las decide el staff.`, ['automod', 'moderacion', 'spam', 'invitaciones', 'sancion', 'castigo']));
  }

  return docs;
}

// lo que el bot sabe hacer: los comandos de barra con su descripcion
// en trozos de ~800 caracteres: asi se busca el trozo que viene al caso ("como baneo a alguien") en vez de pasar todos los comandos
function commandsDocuments(definitions = [], config) {
  const chat = definitions.filter((definition) => (definition.type ?? 1) === 1 && definition.name && definition.description);
  if (!chat.length) return [];
  const chunks = [{ lines: [], names: [], size: 0 }];
  for (const definition of chat) {
    const subs = (definition.options || []).filter((option) => option.type === 1).map((option) => option.name);
    const line = `/${definition.name}: ${oneLine(definition.description, 70)}${subs.length ? ` [${subs.slice(0, 6).join('/')}]` : ''}`;
    let chunk = chunks[chunks.length - 1];
    if (chunk.size + line.length > 800 && chunk.lines.length) {
      chunk = { lines: [], names: [], size: 0 };
      chunks.push(chunk);
    }
    chunk.lines.push(line);
    chunk.names.push(definition.name);
    chunk.size += line.length + 1;
  }
  const custom = (config?.customCommands || []).map((command) => `/${command.name}`).slice(0, 15);
  const prefix = config?.textCommands?.enabled ? `Casi todos los comandos funcionan también con "${config.textCommands.prefix || '!'}" delante.` : '';
  const extra = [custom.length ? `Comandos propios de este server: ${custom.join(' ')}` : '', prefix].filter(Boolean).join(' ');
  return chunks.map((chunk, index) => doc(`bot:comandos:${index}`, 'bot', `Comandos del bot (${index + 1}/${chunks.length})`, `${chunk.lines.join('\n')}${index === chunks.length - 1 && extra ? `\n${extra}` : ''}`, ['comando', 'comandos', ...chunk.names]));
}

function documents(snapshot, config, { commands = [] } = {}) {
  if (!snapshot) return [];
  return [serverDocument(snapshot), ...channelDocuments(snapshot), ...roleDocuments(snapshot), eventDocument(snapshot), ...systemDocuments(config, snapshot), ...commandsDocuments(commands, config)].filter(Boolean);
}

// ---------- corregir lo que escribe la IA ----------

function levenshtein(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

// "<#123>" -> "#reglas" para los canales publicos: la IA razona con nombres (una mencion sin nombre no le dice que canal es, y asi mezclaba
// el canal de una guia con otro) y ground() los vuelve mencion clickeable al contestar. Una mencion de un canal que no es publico no se
// toca: el id solo no revela el nombre
function simplify(text, snapshot) {
  if (!text || !snapshot) return text;
  const byId = new Map(publicChannels(snapshot).map((channel) => [channel.id, channel]));
  return String(text).replace(/<#([^<>\s]+)>/g, (match, id) => {
    const channel = byId.get(id);
    if (!channel) return match;
    return `${VOICE_TYPES.has(channel.type) ? '🔊' : '#'}${channel.clean}`;
  });
}

// todos los canales publicos por categoria, ya como menciones clickeables: es la respuesta a "que canales hay" (el mapa ya lo tiene todo, asi no se
// resume ni se inventa nada). Si el server es enorme se recortan las ultimas categorias y se avisa
function channelList(snapshot, { maxChars = 1700 } = {}) {
  if (!snapshot) return '';
  const categories = new Map();
  for (const channel of sortByPosition(publicChannels(snapshot))) {
    const key = channel.category || 'Sin categoría';
    if (!categories.has(key)) categories.set(key, []);
    categories.get(key).push(`<#${channel.id}>`);
  }
  const lines = [...categories].map(([category, mentions]) => ({ text: `**${category}:** ${mentions.join(' ')}`, count: mentions.length }));
  let hidden = 0;
  const length = () => lines.reduce((sum, line) => sum + line.text.length + 1, 0);
  while (length() > maxChars && lines.length > 1) hidden += lines.pop().count;
  return [...lines.map((line) => line.text), ...(hidden ? [`…y ${hidden} canales más; pregúntame por una categoría y te los muestro.`] : [])].join('\n');
}

// "#reglas" -> "<#id>" (clickeable); un nombre casi igual (a una letra) tambien. Lo que no existe se devuelve en `unknown` para que
// quien llama decida (la IA a veces inventa canales). Solo mira canales publicos: lo privado nunca se menciona
function ground(text, snapshot) {
  const channels = publicChannels(snapshot).filter((channel) => !VOICE_TYPES.has(channel.type));
  const byName = new Map(channels.map((channel) => [channel.clean.toLowerCase(), channel]));
  const unknown = [];
  // "#nombre" suelto o pegado a negrita, cursiva, comillas, parentesis o dos puntos; no cuenta si va pegado a una letra, a una barra (un link)
  // ni a "<" (una mencion que ya es clickeable)
  const grounded = String(text ?? '').replace(/(?<![<\p{L}\p{N}_/&#])()#([\p{L}\p{N}_-]{2,40})/gu, (match, lead, raw) => {
    const wanted = cleanName(raw).toLowerCase();
    let channel = byName.get(wanted);
    if (!channel && wanted.length >= 5) {
      let best = null;
      for (const [name, candidate] of byName) {
        const distance = levenshtein(wanted, name, 1);
        if (distance <= 1 && (!best || distance < best.distance)) best = { candidate, distance };
      }
      channel = best?.candidate;
    }
    if (channel) return `${lead}<#${channel.id}>`;
    // un numero o una etiqueta corta ("#1", "#top") no es un canal inventado
    if (/^\d+$/.test(raw) || raw.length < 4) return match;
    unknown.push(raw);
    return match;
  });
  // la IA a veces escribe el nombre Y la mencion ("**#tickets** <#id>", "<#id> (#tickets)"): queda una sola, y sin negrita (una mencion ya se ve resaltada)
  const merged = grounded
    .replace(/(\*\*|__|\*|_|`)(<#[^<>\s]+>)\1/g, '$2')
    .replace(/(<#([^<>\s]+)>)(?:\s*[(\[]\s*<#\2>\s*[)\]]|\s+<#\2>)/g, '$1');
  return { text: merged, unknown: [...new Set(unknown)] };
}

module.exports = { takeSnapshot, overview, documents, ground, simplify, channelList, cleanName, publicChannels, staffRoles, channelDocuments, systemDocuments, commandsDocuments, roleDocuments, serverDocument, cleanDescription };
