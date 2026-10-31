// detectores de la automoderacion avanzada. Solo logica (sin Discord ni base de datos), para poder probarla entera:
//  - estafas y phishing: links que imitan a Discord/Steam/etc., y los "nitro gratis" de siempre
//  - spam: flood, mensajes repetidos, el mismo mensaje en varios canales (cuenta robada), mayusculas y emojis de mas
//  - raids: muchas cuentas entrando de golpe
//  - escalado: a cuantas advertencias le toca que castigo

// ------------------------------------------------------------------ texto

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function levenshtein(a, b, limit = 3) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const table = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) table[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) table[i][j] = Math.min(table[i][j], table[i - 2][j - 2] + 1);
    }
  }
  return table[a.length][b.length];
}

// ------------------------------------------------------------------ links

// dominios de verdad: nunca se tocan, y sirven de modelo para detectar a los que los imitan
const OFFICIAL_DOMAINS = new Set(
  `discord.com discord.gg discordapp.com discordapp.net discord.media discord.new discord.gift discordstatus.com steamcommunity.com steampowered.com
  steamstatic.com roblox.com epicgames.com minecraft.net mojang.com microsoft.com xbox.com live.com google.com youtube.com youtu.be googleusercontent.com
  gstatic.com twitch.tv twitter.com x.com t.co instagram.com tiktok.com facebook.com fb.com github.com githubusercontent.com reddit.com redd.it spotify.com
  paypal.com amazon.com apple.com curseforge.com modrinth.com blender.org planetminecraft.com imgur.com tenor.com giphy.com wikipedia.org dropbox.com
  mediafire.com mega.nz wetransfer.com artstation.com deviantart.com pinterest.com behance.net sketchfab.com patreon.com ko-fi.com linktr.ee twimg.com
  tumblr.com vimeo.com soundcloud.com bsky.app threads.net whatsapp.com telegram.org t.me zoom.us notion.so canva.com figma.com adobe.com photopea.com
  mine-imator.com chunky-dev.org minecraft.wiki fandom.com github.io gitlab.io itch.io notion.site carrd.co`
    .split(/\s+/)
    .filter(Boolean),
);

// nombres que los estafadores imitan
const BRAND_LABELS = ['discord', 'discordapp', 'steamcommunity', 'steampowered', 'roblox', 'epicgames', 'minecraft', 'mojang', 'youtube', 'twitch', 'paypal', 'tiktok', 'instagram', 'curseforge', 'modrinth', 'google', 'facebook', 'twitter', 'github', 'spotify', 'amazon', 'microsoft'];
// los que mas se imitan para robar cuentas: solo con estos se sospecha de "discord.otra-cosa" o "discord.com.sitio-malo.xyz"
const SENSITIVE_BRANDS = new Set(['discord', 'discordapp', 'steamcommunity', 'steampowered', 'paypal', 'roblox', 'epicgames']);
const SCAM_WORDS = /(gift|nitro|free|gratis|claim|promo|airdrop|giveaway|drop|reward|bonus|verify|verif|login|auth|secure|security|support|help|moderator|staff|partner|event|prize|premio|regalo)/;
const SUSPICIOUS_TLDS = new Set(['xyz', 'click', 'top', 'tk', 'ml', 'ga', 'cf', 'gq', 'icu', 'cyou', 'link', 'pw', 'live', 'site', 'online', 'shop', 'store', 'win', 'vip', 'club', 'monster', 'buzz', 'rest', 'cam', 'quest', 'sbs', 'lol']);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rb.gy', 'shorturl.at', 't.ly', 'rebrand.ly', 'ow.ly', 'goo.gl', 'lnkd.in', 's.id', 'tiny.cc', 'bit.do', 'v.gd', 'clck.ru', 'shorte.st']);
const TWO_LEVEL_TLDS = new Set(['co.uk', 'com.br', 'com.ar', 'com.mx', 'com.au', 'com.co', 'com.pe', 'com.cl', 'com.ve', 'com.es', 'co.jp', 'co.nz', 'co.za', 'org.uk', 'com.tr']);

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|gift|gifts|xyz|click|top|ru|info|tk|ml|ga|cf|gq|link|site|online|live|pw|cc|shop|store|win|cyou|icu|vip|club|monster|buzz|rest|cam|quest|sbs|lol)\b(?:\/[^\s<>"')\]]*)?/gi;

function registrableDomain(host) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  return TWO_LEVEL_TLDS.has(labels.slice(-2).join('.')) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

// 1 -> l / i, 0 -> o... para que "d1scord" y "disc0rd" se parezcan a "discord"
function leetVariants(label) {
  const base = label.replace(/0/g, 'o').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/\$/g, 's');
  return [...new Set([base.replace(/1/g, 'l'), base.replace(/1/g, 'i')])];
}

// { host, domain, official, flags: [{ id, points, why }] } de un link
function analyzeUrl(raw) {
  const text = String(raw).replace(/[.,;:!?]+$/, '');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const domain = registrableDomain(host);
  const result = { host, domain, official: OFFICIAL_DOMAINS.has(domain) && !url.username, flags: [] };
  const add = (id, points, why) => result.flags.push({ id, points, why });

  // https://discord.com@sitio-malo.com/: lo que parece el dominio es en realidad el usuario
  if (url.username) add('userinfo', 65, 'el link esconde su destino real detrás de un "@"');
  if (OFFICIAL_DOMAINS.has(domain) && !url.username) return result;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) add('ip', 30, 'apunta a una dirección IP');
  if (host.split('.').some((label) => label.startsWith('xn--'))) add('punycode', 45, 'usa letras que imitan a otras (dominio con punycode)');

  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  const name = (TWO_LEVEL_TLDS.has(labels.slice(-2).join('.')) ? labels[labels.length - 3] : labels[labels.length - 2]) || labels[0];
  const readable = (name || '').replace(/-/g, '');
  const variants = leetVariants(readable);

  for (const brand of BRAND_LABELS) {
    if (readable === brand) {
      if (SENSITIVE_BRANDS.has(brand)) add('brand-tld', 40, `usa el nombre de ${brand} con otro dominio`);
      break;
    }
    const near = brand.length >= 8 ? 2 : 1;
    // "youtuber.com" o "discordservers.com" empiezan o terminan con la marca: eso no es una imitacion
    const extendsBrand = readable.startsWith(brand) || readable.endsWith(brand);
    if (!extendsBrand && readable.length >= 5) {
      const distance = Math.min(...variants.map((variant) => levenshtein(variant, brand, 2)));
      if (distance <= near) {
        add('typosquat', 70, `imita a ${brand}`);
        break;
      }
      // a dos letras de distancia ("discorcl"): sospechoso, pero con palabras comunes ("discard") no se borra solo
      if (brand.length >= 7 && distance === 2) {
        add('typosquat-near', 50, `se parece a ${brand}`);
        break;
      }
    }
    if (readable.includes(brand) && SCAM_WORDS.test(readable.replace(brand, ''))) {
      add('brand-scam', 70, `mezcla ${brand} con una palabra de estafa`);
      break;
    }
  }

  // discord.com.sitio-malo.xyz: la marca va de subdominio para que el link parezca de verdad
  const subdomains = host.slice(0, host.length - domain.length).split('.').filter(Boolean).join('').replace(/-/g, '');
  if (subdomains && [...SENSITIVE_BRANDS].some((brand) => subdomains.includes(brand))) add('brand-subdomain', 50, 'pone el nombre de Discord/Steam como subdominio de otro sitio');

  if (SUSPICIOUS_TLDS.has(tld)) add('tld', 15, `termina en .${tld}`);
  if (SHORTENERS.has(domain)) add('shortener', 12, 'es un acortador: esconde el destino');
  if ((domain.match(/-/g) || []).length >= 3) add('hyphens', 10, 'dominio con muchos guiones');
  return result;
}

function extractUrls(text) {
  const found = new Set();
  const urls = [];
  for (const match of String(text ?? '').matchAll(URL_PATTERN)) {
    const parsed = analyzeUrl(match[0]);
    if (!parsed || found.has(parsed.host)) continue;
    found.add(parsed.host);
    urls.push(parsed);
  }
  return urls;
}

// ------------------------------------------------------------------ estafas

// frases de estafa. needsLink: solo cuentan si el mensaje trae un link que NO es de un sitio conocido
const TEXT_SIGNALS = [
  { id: 'nitro', points: 30, needsLink: true, why: 'ofrece nitro/regalos', test: /\b(nitro|gift|regalo)\b.{0,60}\b(free|gratis|gratuito|claim|reclama\w*|giveaway|promo\w*|months?|meses|mes)\b|\b(free|gratis|gratuito|claim|reclama\w*|giveaway|promo\w*)\b.{0,60}\b(nitro|gift|regalo)\b/ },
  { id: 'steam', points: 25, needsLink: true, why: 'habla de regalos o trades de Steam', test: /\bsteam\b.{0,60}\b(gift|regalo|trade|skins?|cs2?|case|knife|cuchillo|inventario|inventory)\b|\b(cs2?|csgo|skins?|knife|cuchillo)\b.{0,40}\b(trade|intercambio|gratis|free)\b/ },
  { id: 'money', points: 25, needsLink: true, why: 'promete ganar dinero o criptomonedas', test: /\b(invierte|invierta|inversion|invertir|ganancias?|gana(r|s)? (dinero|plata)|ingresos pasivos|bitcoin|btc|usdt|crypto|cripto|forex|trading|airdrop|withdraw|make money|passive income|earn \$)\b/ },
  { id: 'photo', points: 35, needsLink: true, why: 'el gancho de "¿eres tú en esta foto?"', test: /\b(is this you|who is this|esta eres tu|eres tu en|te grabaron|te filmaron|mira esta foto|mira este video|que haces en esta|viste esto|check this out|look at this)\b/ },
  { id: 'everyone', points: 25, needsLink: true, why: 'menciona a todos con un link raro', test: /@(everyone|here)/ },
];
const DM_INVITE = /\b(dm me|hablame al (privado|md|dm)|mandame (md|dm|un mensaje)|escribeme (al )?(privado|md|dm)|text me|contactame por privado|message me)\b/;
const NEWCOMER_BONUS = 10;
const SCAM_THRESHOLD = 65;
const SUSPECT_THRESHOLD = 30;

// puntaje 0-100 de que un mensaje sea una estafa, con los motivos. context: { accountAgeDays, memberAgeDays }
// level: 'scam' (borrar) | 'suspect' (que lo mire la IA o el staff) | 'ok'
function scamScore(text, context = {}) {
  const content = String(text ?? '');
  const reasons = [];
  let score = 0;
  const urls = extractUrls(content);
  const external = urls.filter((url) => !url.official || url.flags.length);

  for (const url of urls) {
    for (const flag of url.flags) {
      score += flag.points;
      reasons.push(`${url.host}: ${flag.why}`);
    }
  }

  const plain = normalize(content);
  let textPoints = 0;
  for (const signal of TEXT_SIGNALS) {
    if (signal.needsLink && !external.length) continue;
    if (signal.test.test(plain)) {
      textPoints += signal.points;
      reasons.push(signal.why);
    }
  }
  if (textPoints && DM_INVITE.test(plain)) {
    textPoints += 20;
    reasons.push('pide hablar por privado');
  }
  score += Math.min(60, textPoints);

  const isNew = (Number.isFinite(context.accountAgeDays) && context.accountAgeDays < 7) || (Number.isFinite(context.memberAgeDays) && context.memberAgeDays < 3);
  if (score >= 20 && isNew) {
    score += NEWCOMER_BONUS;
    reasons.push('cuenta o ingreso muy reciente');
  }

  score = Math.min(100, score);
  return { score, level: score >= SCAM_THRESHOLD ? 'scam' : score >= SUSPECT_THRESHOLD ? 'suspect' : 'ok', reasons, urls };
}

// ------------------------------------------------------------------ insultos y amenazas (solo para decidir a que mensajes mira la IA)

const JUDGE_LEXICON = new RegExp(
  `\\b(${[
    'idiota', 'imbecil', 'estupid[oa]', 'inutil', 'basura', 'mierda', 'puta', 'puto', 'pendej[oa]', 'gilipollas', 'cabron', 'maricon', 'retrasad[oa]', 'subnormal',
    'zorra', 'culiao', 'conchetumare', 'hijo de puta', 'hdp', 'ctm', 'matate', 'suicidate', 'te voy a matar', 'ojala te mueras', 'kys', 'kill yourself',
    'fuck you', 'retard', 'stupid', 'loser', 'shut up', 'cierra la boca', 'callate',
  ].join('|')})\\b`,
  'i',
);

function needsJudge(text) {
  // las palabras dentro de un link ("cat-looking-very-stupid") no son del mensaje
  return JUDGE_LEXICON.test(normalize(String(text ?? '').replace(/https?:\/\/\S+/gi, ' ')));
}

// ------------------------------------------------------------------ spam

function capsRatio(text, minLetters = 15) {
  const letters = String(text ?? '').replace(/[^\p{L}]/gu, '');
  if (letters.length < minLetters) return 0;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length;
}

function countEmojis(text) {
  const value = String(text ?? '');
  const custom = (value.match(/<a?:\w+:\d+>/g) || []).length;
  const unicode = (value.replace(/<a?:\w+:\d+>/g, '').match(/\p{Extended_Pictographic}/gu) || []).length;
  return custom + unicode;
}

// la "huella" de un mensaje para detectar repetidos: sin mayusculas, espacios ni signos
function signature(text) {
  return normalize(text).replace(/https?:\/\/(www\.)?/g, '').replace(/[^a-z0-9/.@]+/g, '').slice(0, 200);
}

const KEEP_MS = 5 * 60 * 1000;
const MAX_TRACKED_USERS = 5000;
const MAX_ENTRIES_PER_USER = 40;

// lo ultimo que escribio cada persona, en memoria, para detectar flood y repetidos entre canales
class SpamTracker {
  constructor() {
    this.users = new Map();
  }

  // registra un mensaje y devuelve lo reciente de esa persona (incluido este)
  record(guildId, userId, { channelId, messageId, text }, now = Date.now()) {
    const key = `${guildId}:${userId}`;
    const entries = (this.users.get(key) || []).filter((entry) => now - entry.at <= KEEP_MS);
    entries.push({ at: now, channelId, messageId, signature: signature(text), length: String(text ?? '').trim().length });
    if (entries.length > MAX_ENTRIES_PER_USER) entries.splice(0, entries.length - MAX_ENTRIES_PER_USER);
    this.users.delete(key);
    this.users.set(key, entries);
    if (this.users.size > MAX_TRACKED_USERS) this.users.delete(this.users.keys().next().value);
    return entries;
  }

  forget(guildId, userId) {
    this.users.delete(`${guildId}:${userId}`);
  }
}

// mensajes de `entries` dentro de los ultimos `seconds`
function within(entries, seconds, now = Date.now()) {
  return entries.filter((entry) => now - entry.at <= seconds * 1000);
}

// demasiados mensajes en poco tiempo
function detectFlood(entries, { maxMessages, perSeconds }, now = Date.now()) {
  if (!(maxMessages > 0)) return null;
  const recent = within(entries, perSeconds, now);
  return recent.length > maxMessages ? { count: recent.length, entries: recent } : null;
}

// el mismo mensaje varias veces
function detectDuplicates(entries, { maxDuplicates, duplicateSeconds }, now = Date.now()) {
  if (!(maxDuplicates > 0)) return null;
  const last = entries[entries.length - 1];
  if (!last || last.signature.length < 4) return null;
  const same = within(entries, duplicateSeconds, now).filter((entry) => entry.signature === last.signature);
  return same.length >= maxDuplicates ? { count: same.length, entries: same } : null;
}

// el mismo mensaje en varios canales casi a la vez: lo que hace una cuenta robada repartiendo un link
function detectCrossChannel(entries, { channels = 3, seconds = 120 } = {}, now = Date.now()) {
  const last = entries[entries.length - 1];
  if (!last || last.signature.length < 6) return null;
  const same = within(entries, seconds, now).filter((entry) => entry.signature === last.signature);
  const distinct = new Set(same.map((entry) => entry.channelId));
  return distinct.size >= channels ? { channels: distinct.size, entries: same } : null;
}

// ------------------------------------------------------------------ raids

const RAID_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const RAID_MEMORY_MS = 10 * 60 * 1000;

// cuenta ingresos por servidor en una ventana de tiempo. Cuando se pasa del limite avisa UNA vez (y sigue marcando
// "en raid" a los que entran despues, para poder actuar sobre ellos)
class RaidTracker {
  constructor() {
    this.guilds = new Map();
  }

  // member: { id, createdTimestamp }. Devuelve { joins, young, triggered, inRaid, memberIds }
  record(guildId, member, { joins, perSeconds, youngDays = 7 }, now = Date.now()) {
    const state = this.guilds.get(guildId) || { entries: [], lastAlertAt: 0, raidUntil: 0 };
    state.entries = state.entries.filter((entry) => now - entry.at <= RAID_MEMORY_MS);
    state.entries.push({ at: now, id: member.id, created: member.createdTimestamp || 0 });
    this.guilds.set(guildId, state);

    const recent = state.entries.filter((entry) => now - entry.at <= perSeconds * 1000);
    const young = recent.filter((entry) => entry.created && now - entry.created < youngDays * 86400000).length;
    const over = joins > 0 && recent.length >= joins;
    const triggered = over && now - state.lastAlertAt > RAID_ALERT_COOLDOWN_MS;
    if (over) {
      state.raidUntil = now + RAID_ALERT_COOLDOWN_MS;
      if (triggered) state.lastAlertAt = now;
    }
    return { joins: recent.length, young, triggered, inRaid: over || now < state.raidUntil, memberIds: recent.map((entry) => entry.id) };
  }
}

// ------------------------------------------------------------------ escalado

const DEFAULT_LADDER = [
  { strikes: 3, action: 'timeout', minutes: 60 },
  { strikes: 5, action: 'kick', minutes: 0 },
  { strikes: 7, action: 'ban', minutes: 0 },
];

// el castigo que toca al llegar a `count` advertencias (el escalon exacto), o null si ese numero no tiene castigo
function pickLadderStep(ladder, count) {
  return (ladder || []).find((step) => step && step.action && step.action !== 'none' && Number(step.strikes) === count) || null;
}

module.exports = {
  normalize,
  analyzeUrl,
  extractUrls,
  scamScore,
  needsJudge,
  capsRatio,
  countEmojis,
  signature,
  SpamTracker,
  RaidTracker,
  detectFlood,
  detectDuplicates,
  detectCrossChannel,
  pickLadderStep,
  DEFAULT_LADDER,
  SCAM_THRESHOLD,
  SUSPECT_THRESHOLD,
  OFFICIAL_DOMAINS,
};
