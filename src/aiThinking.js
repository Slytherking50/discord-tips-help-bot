// ordena el pensamiento de la IA ANTES de escribir. Sin llamar a ningun modelo (gratis y sin demora) decide:
//  - que tipo de pregunta es (un dato, una guia de pasos, una lista, una pregunta tecnica, varias preguntas juntas, charla)
//  - en cuantas partes se divide, para buscar la informacion de CADA parte y contestarlas en orden
//  - cuanto debe razonar el modelo (los gpt-oss razonan antes de escribir; 'medium' para lo que lo pide, 'low' para lo simple) y cuanto
//    margen de tokens necesita (el razonamiento cuenta dentro de max_tokens, y Groq limita los tokens por minuto de la cuenta gratis)
//  - como debe verse la respuesta: respuesta directa primero, pasos numerados, una vineta por elemento...

// herramientas y tecnicas de render/edicion ("renders" a secas no cuenta: en este server es la palabra de siempre, como en "donde subo mis renders")
const RENDER_WORDS = /\b(blender|cycles|eevee|photoshop|ibis\s?paint|affinity|photopea|animaci[oó]n|animar|textura\w*|iluminaci[oó]n|mineways|chunky|jmc2obj|mine-?imator|blockbench|denois\w*|renderizar)\b/i;
const QUESTION_START = '(?:c[oó]mo|d[oó]nde|qu[eé]|cu[aá]l(?:es)?|qui[eé]n(?:es)?|cu[aá]ndo|cu[aá]nt[oa]s?|por qu[eé]|puedo|hay|se puede)';
const SPLIT_ON_AND = new RegExp(`\\s+(?:y|e|adem[aá]s|tambi[eé]n)\\s+(?=${QUESTION_START}\\b)`, 'i');

function plain(text) {
  return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// saludos y cortesias: si al quitarlos no queda casi nada, es un saludo ("hola, como estas?"); si queda una pregunta ("hola, donde subo mis renders?") no
const SOCIAL = /\b(?:hola+|holi+|buenas(?: tardes| noches| dias)?|buenos dias|hey|ey|ola|saludos|gracias|muchas gracias|como estas|como andas|como te va|que tal|ok|vale|genial|jaja+|jeje+)\b/g;
const SERVER_WORDS = /\b(canal(?:es)?|rol(?:es)?|regla(?:s)?|staff|moderador(?:es)?|admin\w*|ticket\w*|comando\w*|server|servidor|house|houses|casa|casas|nivel(?:es)?|monedas|economia|sorteo\w*|evento\w*|bot|boost\w*|alianza\w*)\b/;
const WHERE_TO = /\bdonde (?:subo|publico|puedo|pongo|envio|mando|veo|encuentro|hablo|pregunto)\b/;
const LIST_WORDS = /\b(canales?|roles?|comandos?|categorias?|reglas?|staff|moderadores?|admins?|administradores|funciones|sistemas|eventos|secciones)\b/;
const LIST_ASK = /\b(que|cuales|cuantos?|lista|todos|todas|dime|dame|muestrame)\b/;
const HOWTO = /\b(como|donde|para que|pasos|tutorial|puedo|se puede|hay que|que hago|que debo|necesito|quiero|ayuda con)\b/;
const OPINION = /\b(opinas?|piensas?|crees?|recomiendas?|prefieres?|te gusta|que te parece)\b/;
const FACT = /\b(quien|quienes|cuanto|cuantos|cuantas|cuando|cual|que es|que son|hay|existe)\b/;

// "que canales hay", "lista de canales", "todos los canales del server": el mapa del server ya es la respuesta completa y exacta, asi que se contesta con el
// (sin modelo: pasada por el modelo la lista se resumia a medias o se inventaba). Tiene que ser TODO el mensaje: "que canales hay para promocionar" no entra
const CHANNEL_LIST = /^(?:(?:que|cuales|cuantos)\s+(?:son\s+)?(?:todos\s+)?(?:los\s+)?canales(?:\s+(?:hay|tiene|tienen|existen|son))?|(?:lista(?:me)?\s+(?:de\s+)?|(?:dime|dame|muestrame|muestra|pasame)\s+)?(?:todos\s+)?(?:los\s+)?canales)(?:\s+(?:del?|en|hay\s+en)\s+(?:el\s+|este\s+|tu\s+)?(?:server|servidor))?$/;

const DEPTH_BY_KIND = { saludo: 'breve', charla: 'breve', dato: 'breve', ubicacion: 'breve', opinion: 'normal', guia: 'normal', lista: 'detallada', tecnica: 'detallada', multi: 'detallada' };
// cuanta informacion del server se busca para armar el prompt: una pregunta simple no necesita lo que una lista de reglas (cada token cuenta: Groq limita
// los tokens por minuto de la cuenta gratis)
const KNOWLEDGE_BY_DEPTH = { breve: { budget: 1800, limit: 3 }, normal: { budget: 2800, limit: 4 }, detallada: { budget: 3800, limit: 6 } };
const MAX_CHARS = { breve: 350, normal: 700, detallada: 1100 };
const BASE_TOKENS = { breve: 320, normal: 520, detallada: 760 };
const THINKS_MORE = new Set(['multi', 'tecnica', 'guia', 'lista']);

// las partes de una pregunta: "donde subo mis renders y como pido un rol? y cuantos somos" -> tres
function splitParts(text) {
  const parts = [];
  for (const piece of String(text ?? '').split(/[?!.;\n]+/)) {
    for (const sub of piece.split(SPLIT_ON_AND)) {
      const cleaned = sub.replace(/^[\s¿¡,]+|[\s,]+$/g, '');
      const words = cleaned.split(/\s+/).filter(Boolean).length;
      // lo que queda al quitar saludos y cortesias ("ok vale", "gracias") tiene que ser algo de verdad
      const meaningful = plain(cleaned).replace(SOCIAL, ' ').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean).length;
      if (words >= 2 && meaningful >= 2) parts.push(cleaned);
    }
  }
  return [...new Set(parts)].slice(0, 4);
}

function planQuestion(text, { hasImage = false } = {}) {
  const raw = String(text ?? '').trim();
  const flat = plain(raw);
  const words = flat.split(/\s+/).filter(Boolean);
  const parts = splitParts(raw);

  const rest = flat.replace(SOCIAL, ' ').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean);
  const serverish = SERVER_WORDS.test(flat) || WHERE_TO.test(flat);

  let kind;
  if (hasImage) kind = 'opinion';
  else if (words.length <= 7 && rest.length <= 1 && flat.length > 0) kind = 'saludo';
  else if (parts.length >= 2) kind = 'multi';
  else if (OPINION.test(flat)) kind = 'opinion';
  else if (LIST_WORDS.test(flat) && LIST_ASK.test(flat)) kind = 'lista';
  else if (!serverish && RENDER_WORDS.test(flat)) kind = 'tecnica';
  else if (WHERE_TO.test(flat)) kind = 'ubicacion';
  else if (HOWTO.test(flat)) kind = 'guia';
  else if (FACT.test(flat)) kind = 'dato';
  else kind = 'charla';

  let depth = DEPTH_BY_KIND[kind];
  // una pregunta larga y armada pide mas desarrollo que la misma en pocas palabras
  if (words.length >= 18 && depth === 'normal') depth = 'detallada';
  if (words.length >= 18 && depth === 'breve' && kind !== 'saludo') depth = 'normal';

  const effort = THINKS_MORE.has(kind) && !hasImage ? 'medium' : 'low';
  const maxTokens = BASE_TOKENS[depth] + (effort === 'medium' ? 300 : 0);
  const searches = kind === 'multi' ? [raw.slice(0, 300), ...parts] : [raw.slice(0, 300)];
  const listing = !hasImage && CHANNEL_LIST.test(rest.join(' ')) ? 'canales' : null;
  return { kind, parts, depth, effort, maxTokens, maxChars: MAX_CHARS[depth], knowledge: KNOWLEDGE_BY_DEPTH[depth], searches: [...new Set(searches)].slice(0, 5), listing };
}

// la respuesta se va a decir en voz alta (/voz preguntar): corta, sin listas y sin nada que no se pueda hablar
function forVoice(plan) {
  return { ...plan, depth: 'breve', effort: 'low', maxTokens: 360, maxChars: 280, knowledge: KNOWLEDGE_BY_DEPTH.normal, listing: null, voice: true };
}

// "¡Hola, Ana!", "Claro,", "Por supuesto:" al comienzo: relleno que el modelo agrega aunque se le pida ir directo. Solo cuenta con puntuacion despues
// (para no comerse el inicio de una frase de verdad, como "Genial idea para un render"), y un saludo o una charla no se tocan
const OPENER_WORDS = '(?:hola+|holi+|hey|buenas(?: tardes| noches| d[ií]as)?|buen(?:os|as) d[ií]as|claro(?: que s[ií])?|por supuesto|con gusto|desde luego|perfecto|genial|de acuerdo|entendido)';
const OPENER = new RegExp(`^\\s*[¡!]*\\s*${OPENER_WORDS}\\s*[,!.:]+\\s*`, 'iu');
const OPENER_NAMED = new RegExp(`^\\s*[¡!]*\\s*${OPENER_WORDS}[,\\s]+([\\p{L}][\\p{L}'’.-]{0,20})\\s*[,!.:]+\\s*`, 'iu');

// cuanto mide el saludo del comienzo. Lo que sigue al saludo solo es un nombre si empieza con mayuscula ("Hola, Ana!"): "Buenas noticias:" es una frase
function openerLength(answer) {
  const named = OPENER_NAMED.exec(answer);
  if (named && named[1][0] !== named[1][0].toLowerCase()) return named[0].length;
  return OPENER.exec(answer)?.[0].length || 0;
}

function tidyAnswer(text, plan) {
  let answer = String(text ?? '');
  // con el tono Jarvis la cortesia del comienzo ("Por supuesto.", "Con mucho gusto.") es parte de la personalidad: no se saca
  if (!answer || !plan || plan.kind === 'saludo' || plan.kind === 'charla' || plan.tone === 'jarvis') return answer;
  for (let pass = 0; pass < 2; pass++) {
    const length = openerLength(answer);
    const rest = answer.slice(length);
    if (!length || rest.trim().length < 8) break;
    answer = rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return answer;
}

const KIND_LINES = {
  saludo: '- Es un saludo o una frase corta: responde natural y breve, sin presentarte de nuevo.',
  charla: '- Es charla: responde natural y breve, como una persona del server.',
  dato: '- Pide un dato: dalo exacto en una frase, y una segunda frase solo si aclara algo importante.',
  ubicacion: '- Pregunta dónde está o dónde se hace algo: responde directo con el canal exacto (#nombre), sin decir en qué categoría está; si hay un segundo lugar que también sirve, dilo en una frase corta. Sin pasos numerados.',
  opinion: '- Piden tu opinión: da una postura clara con un motivo concreto, sin evadir; si no tienes cómo saberlo, dilo.',
  guia: '- Es un cómo/dónde: da pasos numerados cortos (1., 2., 3.) con el canal o comando exacto de la información de arriba; si falta un paso por no tener el dato, dilo.',
  lista: '- Piden una lista: una viñeta por elemento ("• #canal o rol: para qué sirve"), hasta 12; si hay más, di cuántos faltan y ofrece detallar uno.',
  tecnica: '- Es una pregunta técnica: da pasos concretos y un consejo extra útil; no inventes menús ni funciones que no existen.',
  multi: '- Son varias preguntas en una: respóndelas todas, cada una en su propia línea o viñeta, en el mismo orden en que las hicieron, empezando cada una por la respuesta.',
};

const VOICE_LINE = '- Tu respuesta se va a decir en voz alta: como mucho 2 o 3 frases cortas y naturales, sin listas ni viñetas, sin emojis y sin enlaces; di los nombres de los canales con palabras.';

// lo que se agrega al prompt segun el plan
function styleGuidance(plan) {
  if (!plan) return '';
  const partsList = plan.kind === 'multi' ? `\nLas partes de la pregunta son:\n${plan.parts.map((part, index) => `${index + 1}) ${part}`).join('\n')}` : '';
  return `Cómo armar tu respuesta (piensa antes de escribir, pero no muestres tu razonamiento):
- Entiende qué te piden exactamente y busca la respuesta en la información de arriba (mapa del server, canales, roles, staff, comandos, reglas).
- La primera línea es la respuesta directa; después, solo los detalles que hagan falta, ordenados.
${plan.voice ? VOICE_LINE : KIND_LINES[plan.kind]}
- Si la información de arriba no alcanza, di qué parte no sabes y dónde o a quién preguntar; nunca rellenes con datos inventados.
- Nombra los canales como #nombre-del-canal (solo el nombre, sin repetirlo ni poner el número), y solo los del mapa de arriba. Solo conoces los canales públicos: si preguntan por canales privados, internos o del staff, di que no tienes esa información y que pregunten al staff.
- Los comandos, botones y pasos van tal cual aparecen en la información de arriba: nunca inventes canales, roles, comandos, subcomandos, botones, reacciones, menús ni opciones. Si solo sabes para qué sirve algo, di eso y no cómo funciona por dentro.
- Largo: hasta unos ${plan.maxChars} caracteres, sin relleno, sin repetir lo mismo dos veces (nada de un resumen y luego lo mismo en viñetas) ni ofrecimientos genéricos al final.${plan.kind === 'saludo' || plan.kind === 'charla' ? '' : plan.tone === 'jarvis' ? '\n- No empieces con saludos: ve directo a la respuesta; si tu personalidad lo pide, abre con una fórmula breve de cortesía ("por supuesto", "con mucho gusto").' : '\n- No empieces con saludos ni muletillas ("¡Hola!", "Claro"): ve directo a la respuesta.'}${partsList}`;
}

module.exports = { planQuestion, styleGuidance, tidyAnswer, forVoice, splitParts, RENDER_WORDS };
