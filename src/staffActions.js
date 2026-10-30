// deteccion (por palabras clave, SIN IA) de pedidos de moderacion por chat:
// "baneá a @x", "silenciá a @x 10 min", "saca el mute a @x"...
//
// Lo mas importante de este archivo: NO confundir un pedido de DESHACER con el
// pedido original. "saca el mute" contiene la palabra "mute", y "quitale el ban"
// contiene "ban": antes se leian como silenciar y banear (lo contrario de lo que
// se pedia). Por eso los pedidos de deshacer se detectan primero, y los que no
// se pueden hacer por chat (desbanear, quitar advertencias) responden eso en vez
// de ejecutar la accion contraria.

// fin de palabra que entiende las vocales con tilde: \b de JavaScript solo conoce
// ASCII, asi que "baneá" o "silenciá" (terminadas en á) nunca terminaban con \b
const END = '(?![\\wáéíóúñ])';
const word = (source) => new RegExp(`\\b(?:${source})${END}`, 'i');

// verbos de quitar/deshacer, con o sin tilde y con pronombres pegados ("sacale", "quitá", "sácale")
const REMOVE_VERB = /\b(?:sac[aáeo]\w*|s[aá]c[aá]\w*|qu[ií]t[aáeo]\w*|levant[aáeo]\w*|remuev\w*|elimin\w*|borr[aáeo]\w*|termin[aáeo]\w*|anul[aáeo]\w*)/i;

const UNMUTE_DIRECT = word('desmute\\w*|desilenci[aá]\\w*|unmute\\w*|destimeout\\w*');
const MUTE_WORD = word('mute|silencio|silenciad[oa]|timeout|castigo');

const UNBAN_DIRECT = word('desban\\w*|unban\\w*');
const BAN_WORD = word('ban|baneo|baneado|baneada');

const UNWARN_DIRECT = word('desadvi\\w*|unwarn\\w*');
const WARN_WORD = word('warn|warns|advertencias?');

// devuelve un "match" ({0: texto encontrado}) si el mensaje es un pedido de quitar/deshacer
function matchUndo(content, directPattern, wordPattern) {
  const direct = content.match(directPattern);
  if (direct) return direct;
  if (REMOVE_VERB.test(content)) return content.match(wordPattern);
  return null;
}

// el ORDEN importa: los pedidos de deshacer van antes que los originales
const STAFF_ACTIONS = [
  {
    type: 'unmute',
    label: 'quitar el silencio',
    test: (content) => matchUndo(content, UNMUTE_DIRECT, MUTE_WORD),
    askTarget: 'Menciona a la persona (@usuario) a la que quieres quitarle el silencio.',
    confirm: false,
  },
  {
    type: 'unban',
    label: 'desbanear',
    test: (content) => matchUndo(content, UNBAN_DIRECT, BAN_WORD),
    // alguien baneado ya no esta en el server: no se lo puede mencionar ni buscar desde el chat
    unsupportedReply: 'Para quitar un ban no puedo ayudarte por chat (la persona ya no está en el server). Hazlo desde Ajustes del servidor → Baneos.',
  },
  {
    type: 'unwarn',
    label: 'quitar la advertencia',
    test: (content) => matchUndo(content, UNWARN_DIRECT, WARN_WORD),
    unsupportedReply: 'Todavía no puedo quitar advertencias por chat.',
  },
  { type: 'ban', label: 'banear', pattern: word('ban(?:e[aá]|ear)(?:lo|la)?|ban'), confirm: true },
  { type: 'kick', label: 'expulsar', pattern: word('expuls[aá](?:lo|la)?|expulsar|ech[aá](?:lo|la)?|echar|kick(?:ealo|e[aá])?'), confirm: true },
  { type: 'mute', label: 'silenciar', pattern: word('silenci[aá](?:lo|la)?|silenciar|mute[aá](?:lo|la)?|mutear|mute|timeout'), confirm: true },
  { type: 'warn', label: 'advertir', pattern: word('advi[eé]rte(?:le)?|advertir|advert[ií]|amonest[aá](?:lo|la)?|amonestar|warn(?:ealo)?'), confirm: false },
];

function detectStaffAction(content) {
  for (const action of STAFF_ACTIONS) {
    const match = action.test ? action.test(content) : content.match(action.pattern);
    if (match) return { ...action, matchedText: match[0] };
  }
  return null;
}

// Discord solo permite timeouts de hasta 28 dias (40320 min), igual que el
// maximo de /mute
const MAX_MUTE_MINUTES = 40320;

function extractMuteMinutes(content) {
  const match = content.match(/(\d+)\s*(minutos?|min\b|horas?|hs\b|hrs?\b)/i);
  if (!match) return 10;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const minutes = unit.startsWith('hora') || unit.startsWith('hs') || unit.startsWith('hr') ? amount * 60 : amount;
  return Math.min(MAX_MUTE_MINUTES, Math.max(1, minutes));
}

module.exports = { STAFF_ACTIONS, detectStaffAction, extractMuteMinutes, MAX_MUTE_MINUTES };
