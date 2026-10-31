// emojis de PIXEL ART propios (16x16, dibujados aqui, sin texturas de ningun juego). El selector del dashboard
// los muestra; cuando alguien elige uno, el bot lo sube al server como emoji personalizado "px_<id>" (los
// emojis personalizados son la unica forma de tener emojis de pixeles en Discord). Se suben solo los que se
// eligen, no todo el pack: un server gratis tiene 50 lugares y no conviene llenarlos.
//
// Cada sprite se dibuja SIN contorno (el contorno oscuro de 1 px se agrega solo) dentro de 14x14: filas de
// texto donde "." es transparente y cada letra es un color de la paleta del sprite. Los simetricos se dibujan
// por la mitad (half) y se espejan: en la mitad derecha los tonos claros pasan a su sombra, asi se ve luz desde
// la izquierda.

const SIZE = 16;
const INNER = 14;
const OUTLINE = '#241a2e';

// --- ayudas de dibujo ---

function half(rows, left = {}, right = {}) {
  return rows.map((row) => {
    const l = [...row].map((ch) => left[ch] ?? ch).join('');
    const r = [...row].reverse().map((ch) => right[ch] ?? left[ch] ?? ch).join('');
    return l + r;
  });
}

function blank(w = INNER, h = INNER) {
  return Array.from({ length: h }, () => Array(w).fill('.'));
}
const toRows = (canvas) => canvas.map((row) => row.join(''));
const put = (canvas, x, y, ch) => {
  if (y >= 0 && y < canvas.length && x >= 0 && x < canvas[0].length) canvas[y][x] = ch;
};
function rect(canvas, x, y, w, h, ch) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(canvas, i, j, ch);
}
// disco de pixeles: paint(dx, dy, dist, r) devuelve la letra de cada pixel (o '.' para dejarlo vacio)
function disk(canvas, cx, cy, r, paint) {
  for (let y = 0; y < canvas.length; y++) {
    for (let x = 0; x < canvas[0].length; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= r) put(canvas, x, y, paint(dx, dy, dist, r));
    }
  }
}
function polygon(canvas, points, paint) {
  const inside = (px, py) => {
    let result = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) result = !result;
    }
    return result;
  };
  for (let y = 0; y < canvas.length; y++) for (let x = 0; x < canvas[0].length; x++) if (inside(x + 0.5, y + 0.5)) put(canvas, x, y, paint(x, y));
}
function line(canvas, x0, y0, x1, y1, ch, thickness = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let a = 0; a < thickness; a++) for (let b = 0; b < thickness; b++) put(canvas, x + a, y + b, ch);
  }
}
function rotate90(rows) {
  const h = rows.length;
  const w = rows[0].length;
  return Array.from({ length: w }, (_, y) => [...Array(h)].map((__, x) => rows[h - 1 - x][y]).join(''));
}

// --- paletas ---
const GOLD = { y: '#ffd23f', Y: '#d99a14', h: '#fff1a6', o: '#f2a31b' };
const GEMS = {
  azul: { c: '#8ff0ff', b: '#37c7e0', a: '#1a8aa6', w: '#ffffff' },
  verde: { c: '#a6f0b4', b: '#46c46a', a: '#2c8f4a', w: '#ffffff' },
  roja: { c: '#ff9aa8', b: '#e3354f', a: '#a8182f', w: '#ffffff' },
  morada: { c: '#d6b0ff', b: '#9a5ae0', a: '#6a2fb0', w: '#ffffff' },
};
const LIQUIDS = {
  roja: { l: '#e8344f', L: '#a8182f' },
  azul: { l: '#3aa7ff', L: '#1f6fc7' },
  verde: { l: '#46c46a', L: '#2c8f4a' },
};
const BLADES = {
  diamante: { b: '#8ff0ff', B: '#37c7e0', g: '#ffd23f', G: '#d99a14', w: '#b07a4b', W: '#80532f', p: '#ffd23f', P: '#d99a14' },
  hierro: { b: '#f2f6fa', B: '#a8b3bf', g: '#ffd23f', G: '#d99a14', w: '#b07a4b', W: '#80532f', p: '#ffd23f', P: '#d99a14' },
  oro: { b: '#fff1a6', B: '#ffd23f', g: '#cfd7df', G: '#8a95a1', w: '#b07a4b', W: '#80532f', p: '#cfd7df', P: '#8a95a1' },
};

// --- sprites ---
// cada uno: { id, label, keywords, rows, palette } + opciones { raw, group }:
//   raw: las filas ya son la imagen final de 16x16 (con su contorno), no se centra ni se le agrega otro
//   group: en que grupo del selector aparece (por defecto 'juego'; las marcas y flechas van en 'marcas')

const SPRITES = [];
const add = (id, label, keywords, rows, palette, options = {}) => SPRITES.push({ id, label, keywords, rows, palette, ...options });

// redes sociales: arte pixel del dueño (16x16 exacto). Ya trae su propio contorno, por eso no se le agrega otro (raw)
add('youtube', 'YouTube', 'youtube video canal redes sociales', [
  '................',
  '................',
  '.aaaaaaaaaaaaaa.',
  'aabccccccccccbaa',
  'abccccccccccccba',
  'accccccdccccccca',
  'accccccddcccccca',
  'abcccccdddccccba',
  'ebbbbbbffbbbbbbe',
  'ebbbbbbfbbbbbbbe',
  'ebcbbbbbbbbbbcbe',
  'egbccccccccccbge',
  'eeggggggggggggee',
  '.eeeeeeeeeeeeee.',
  '................',
  '................',
], { a: '#470a0a', b: '#dc2727', c: '#ff3b3b', d: '#ffffff', e: '#3b0606', f: '#ffeded', g: '#911414' }, { raw: true, group: 'redes' });

add('discord', 'Discord', 'discord servidor comunidad chat redes sociales', [
  '................',
  '................',
  '..aaaaa..aaaaa..',
  '.aabbcaaaacbbaa.',
  '.abbbbbbbbbbbba.',
  'aabddddddddddbaa',
  'acddddddddddddca',
  'abddbeecceebddba',
  'ecbbceecceecbbce',
  'ecccccbbbbccccce',
  'ebcccffffffcccbe',
  'efbbbceeeecbbbfe',
  'eeffffe..effffee',
  '.eeeeee..eeeeee.',
  '................',
  '................',
], { a: '#293479', b: '#8495ff', c: '#6b80ff', d: '#9ab1ff', e: '#202a61', f: '#4456c4' }, { raw: true, group: 'redes' });

add('tiktok', 'TikTok', 'tiktok video corto redes sociales', [
  '......aaaaa.....',
  '......abbbaa....',
  '......abccbaaaa.',
  '......abcccbbba.',
  '......abcccccde.',
  '...aaaabcccccde.',
  '..aabbbbccdddde.',
  '.aabcccbccdeeee.',
  '.abccccbffde....',
  '.abcccghffge....',
  '.ihffgihffge....',
  '.ihfffhfffge....',
  '.ihfffffffge....',
  '.iihfffffgee....',
  '..iegdddgee.....',
  '...eeeeeee......',
], { a: '#16575e', b: '#67faff', c: '#252e38', d: '#ff3e8b', e: '#21060e', f: '#181d23', g: '#e5275f', h: '#22cad7', i: '#052023' }, { raw: true, group: 'redes' });

add('x', 'X (Twitter)', 'x twitter tuit redes sociales', [
  '................',
  '.aaaaa.....aaaa.',
  '.abbbaa...aabba.',
  '.abccbaa.aabbda.',
  '.adbccbaaabbdaa.',
  '.aadbccbabbdaa..',
  '..aadbccbbdaa...',
  '...eefdggdfe....',
  '....eeddggdee...',
  '...eeddfdggdee..',
  '..eeddfefdggdee.',
  '.eeddfeeefdggde.',
  '.eddfee.eefddde.',
  '.effee...eefffe.',
  '.eeee.....eeeee.',
  '................',
], { a: '#1c2022', b: '#54575f', c: '#ffffff', d: '#353a40', e: '#141414', f: '#1e2022', g: '#d0d4de' }, { raw: true, group: 'redes' });

// corazones
const HEART_HALF = ['..rrrr.', '.ehhrrr', 'ehrrrrr', 'errrrrr', 'errrrrr', '.errrrr', '..errrr', '...errr', '....err', '.....er', '......e'];
for (const [id, label, colors] of [
  ['corazon', 'Corazón', { r: '#e8344f', R: '#b01e3a', h: '#ff9aa8' }],
  ['corazon_azul', 'Corazón azul', { r: '#3aa7ff', R: '#1f6fc7', h: '#b5e0ff' }],
  ['corazon_verde', 'Corazón verde', { r: '#46c46a', R: '#2c8f4a', h: '#b5f0c2' }],
]) {
  add(id, label, 'corazon amor vida', half(HEART_HALF, { e: 'r' }, { e: 'R', h: 'r' }), colors);
}

// estrella
add('estrella', 'Estrella', 'estrella favorito destacado', half(['......y', '......y', '.....yy', 'eyyyyyy', '.eyyhyy', '..eyyyy', '...eyyy', '...eyyy', '..eyyyy', '..eyyy.', '.eyyy..', '.eyy...'], { e: 'y' }, { e: 'Y', h: 'y' }), GOLD);

// gemas
const GEM_HALF = ['...cwcb', '..ccbbb', '.ccbbbb', 'cccbbbb', '.cbbbbb', '..cbbbb', '...cbbb', '....cbb', '.....cb', '......b'];
for (const [id, name] of [['azul', 'azul (diamante)'], ['verde', 'verde (esmeralda)'], ['roja', 'roja (rubí)'], ['morada', 'morada (amatista)']]) {
  add(`gema_${id}`, `Gema ${name}`, 'gema diamante esmeralda rubi amatista joya cristal', half(GEM_HALF, {}, { c: 'b', w: 'b', b: 'a' }), GEMS[id]);
}

// pociones
const POTION_HALF = ['....ccc', '....ccc', '.....gg', '.....gg', '....ggg', '...gggg', '..gllll', '.ghllll', '.glllll', '.glllll', '.glllll', '..gllll', '...llll', '....lll'];
for (const [id, name] of [['roja', 'roja'], ['azul', 'azul'], ['verde', 'verde']]) {
  add(`pocion_${id}`, `Poción ${name}`, 'pocion frasco magia vida mana veneno', half(POTION_HALF, {}, { g: 'G', l: 'L', h: 'l', c: 'C' }), { g: '#dff2fb', G: '#a9cbe0', h: '#ffffff', c: '#c68b59', C: '#8d5a33', ...LIQUIDS[id] });
}

// espadas (verticales)
const SWORD_HALF = ['......b', '.....bb', '.....bb', '.....bb', '.....bb', '.....bb', '.....bb', '.....bb', '.gggggg', '.....ww', '.....ww', '.....ww', '....ppp'];
for (const [id, name] of [['diamante', 'de diamante'], ['hierro', 'de hierro'], ['oro', 'de oro']]) {
  add(`espada_${id}`, `Espada ${name}`, 'espada arma batalla pvp ataque', half(SWORD_HALF, {}, { b: 'B', g: 'G', w: 'W', p: 'P' }), BLADES[id]);
}

// picos
const PICK_HALF = ['..sssss', '.ssssss', 'ssss..w', 'sss...w', 'ss....w', 's.....w', '......w', '......w', '......w', '......w', '......w', '......w', '......w'];
for (const [id, label, colors] of [
  ['diamante', 'Pico de diamante', { s: '#8ff0ff', S: '#37c7e0', w: '#b07a4b', W: '#80532f' }],
  ['hierro', 'Pico de hierro', { s: '#f2f6fa', S: '#a8b3bf', w: '#b07a4b', W: '#80532f' }],
]) {
  add(`pico_${id}`, label, 'pico minar mineria herramienta', half(PICK_HALF, {}, { s: 'S', w: 'W' }), colors);
}

// escudo
add('escudo', 'Escudo', 'escudo defensa proteccion', half(['eeeeeee', 'ebbbbby', 'ebbbbby', 'eyyyyyy', 'ebbbbby', 'ebbbbby', '.ebbbby', '.ebbbby', '..ebbby', '...ebby', '....eby', '.....ey', '......e'], { e: 's' }, { e: 'S', b: 'B' }), { s: '#d5dbe3', S: '#8a95a1', b: '#3aa7ff', B: '#1f6fc7', y: '#ffd23f' });

// corona
add('corona', 'Corona', 'corona rey reina vip premium', half(['.y....y', '.yy...y', '.yyy.yy', '.hyyyyy', '.hyyyyy', '.yyryyb', '.yyyyyy', '.YYYYYY', '.YYYYYY'], {}, { h: 'y' }), { ...GOLD, r: '#e8344f', b: '#3aa7ff' });

// trofeo
add('trofeo', 'Trofeo', 'trofeo copa premio ganador campeon', half(['..yyyyy', 'yyhyyyy', 'y.hyyyy', 'y.yyyyy', 'yyyyyyy', '.yyyyyy', '..yyyyy', '.....yy', '.....yy', '....yyy', '..eeeee', '..eeeee'], {}, { h: 'y', y: 'Y' }), { ...GOLD, e: '#8a5a33' });

// libro
add('libro', 'Libro', 'libro leer reglas guia wiki', ['BBbbbbbbbbbbp', 'BBbbbbbbbbbbp', 'BBbbbbyybbbbp', 'BBbbbyyyybbbp', 'BBbbbbyybbbbp', 'BBbbbbbbbbbbp', 'BBbbbbbbbbbbp', 'BBbbbbbbbbbbp', 'BBbbbbbbbbbbp', 'BBbbbbbbbbbbp', 'ppppppppppppp'], { B: '#7a2fb0', b: '#9a5ae0', y: '#ffd23f', p: '#f6ecd0' });

// mapa
add('mapa', 'Mapa', 'mapa tesoro ruta explorar mundo', ['MMMMMMMMMMMMM', 'MmmmmmmmmmmmM', 'MmrmmrmmmbbmM', 'MmmrrmmmbbmmM', 'MmmrrmmbbmmmM', 'MmrmmrmbbmmmM', 'MmmmmmbbmmmmM', 'MmmmmmbbmmgmM', 'MmmmmbbmmmmmM', 'MmmmmmmmmmmmM', 'MMMMMMMMMMMMM'], { M: '#b8934f', m: '#f1dfb2', r: '#e8344f', b: '#3aa7ff', g: '#46c46a' });

// llave
add('llave', 'Llave', 'llave acceso candado clave', ['..yyyy........', '.yhyyyy.......', 'yy..yyyyyyyyyy', 'yy..yyyyyyyyyy', '.yyyyyy..y.y.y', '..yyyy....y.y.'], GOLD);

// cofre
add('cofre', 'Cofre', 'cofre tesoro botin caja', ['..wwwwwwwwww..', '.wwwwwwwwwwww.', 'wwwwwwyywwwwww', 'yyyyyyyyyyyyyy', 'wwwwwyyyywwwww', 'wwwwwyykywwwww', 'wwwwwyyyywwwww', 'WWWWWWWWWWWWWW', 'WWWWWWWWWWWWWW'], { w: '#b8814f', W: '#8a5a33', y: '#ffd23f', k: '#3a2a12' });

// llama
add('fuego', 'Llama', 'fuego llama caliente hot popular', half(['......r', '.....rr', '....rrr', '...rrro', '...rroo', '..rrooo', '..rroyy', '.rrooyy', '.rrooyy', '.rroyyy', '..rooyy', '...ooyy', '....oyy'], {}, {}), { r: '#e8503a', o: '#ff9a2e', y: '#ffe066' });

// rayo
add('rayo', 'Rayo', 'rayo energia velocidad electricidad', ['......yyyyyy..', '.....yyyyyy...', '....yyyyyy....', '...yyyyyyyyyy.', '..yyyyyyyyyy..', '......yyyyy...', '.....yyyyy....', '....yyyyy.....', '...yyyy.......', '..yyy.........', '.yy...........'], { y: '#ffd23f' });

// moneda
{
  const c = blank(12, 12);
  disk(c, 6, 6, 6, (dx, dy, dist, r) => (dist > r - 1.1 ? 'Y' : dx + dy < -r * 0.8 && dist < r - 1.3 ? 'h' : Math.abs(dx) < 1.1 && Math.abs(dy) < 3 ? 'Y' : 'y'));
  add('moneda', 'Moneda', 'moneda dinero oro economia', toRows(c), GOLD);
}

// sol
{
  const c = blank(14, 14);
  disk(c, 7, 7, 3.9, (dx, dy, dist, r) => (dist > r - 1 ? 'o' : dx + dy < -2 ? 'h' : 'y'));
  for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
    const diagonal = dx !== 0 && dy !== 0;
    const start = diagonal ? 4 : 5;
    for (let i = start; i < start + (diagonal ? 2 : 2); i++) put(c, Math.floor(7 + dx * i - (dx < 0 ? 0 : 0)), Math.floor(7 + dy * i), 'y');
  }
  // rayos rectos de 2 px de ancho para que no queden como puntitos sueltos
  for (const [x, y] of [[6, 0], [7, 0], [6, 1], [7, 1], [6, 12], [7, 12], [6, 13], [7, 13], [0, 6], [0, 7], [1, 6], [1, 7], [12, 6], [12, 7], [13, 6], [13, 7]]) put(c, x, y, 'y');
  add('sol', 'Sol', 'sol dia calor luz', toRows(c), GOLD);
}

// luna
{
  const c = blank(13, 13);
  for (let y = 0; y < 13; y++) {
    for (let x = 0; x < 13; x++) {
      const a = Math.hypot(x + 0.5 - 6.5, y + 0.5 - 6.5);
      const b = Math.hypot(x + 0.5 - 9.5, y + 0.5 - 4.5);
      if (a <= 6.2 && b > 5) put(c, x, y, a > 5 ? 'Y' : x + y < 9 ? 'h' : 'y');
    }
  }
  add('luna', 'Luna', 'luna noche dormir', toRows(c), { y: '#ffe9a0', Y: '#d9b85c', h: '#fff8d6' });
}

// nube
add('nube', 'Nube', 'nube clima cielo', ['....ww..www...', '...wwwwwwwww..', '..wwwwwwwwwwww', '.wwwwwwwwwwwww', 'wwwwwwwwwwwwww', 'wwwwwwwwwwwwww', 'gwwwwwwwwwwwwg', '.gggggggggggg.'], { w: '#ffffff', g: '#cfdbe6' });

// manzana
{
  const rows = half(['......w', '......w', '..rrrr.', '.rhhrrr', 'rrhrrrr', 'errrrrr', 'errrrrr', 'errrrrr', 'errrrrr', '.errrrr', '.errrrr', '..errrr', '...rrrr'], { e: 'r' }, { e: 'R', h: 'r', w: 'w' });
  for (const [x, y] of [[8, 1], [9, 1], [9, 0], [10, 0], [10, 1]]) rows[y] = rows[y].slice(0, x) + 'g' + rows[y].slice(x + 1);
  add('manzana', 'Manzana', 'manzana fruta comida vida', rows, { r: '#e8344f', R: '#b01e3a', h: '#ff9aa8', w: '#8a5a33', g: '#46c46a' });
}

// pastel
add('pastel', 'Pastel', 'pastel torta cumpleaños fiesta cake', half(['......y', '......o', '......w', '......w', '.wwwwww', '.wpwpwp', '.cccccc', '.cccccc', '.bbbbbb', '.cccccc', '.cccccc', '.wwwwww'], {}, { c: 'C', b: 'B' }), { y: '#ffd23f', o: '#ff9a2e', w: '#fff6e8', p: '#ffb3c6', c: '#ff8fb0', C: '#e06a92', b: '#8a5a33', B: '#6b4226' });

// regalo
add('regalo', 'Regalo', 'regalo sorpresa premio sorteo', half(['..yy...', '.y..y..', '.yyyyyy', 'rrrrrry', 'rrrrrry', '.rrrrry', '.rrrrry', '.rrrrry', '.rrrrry', '.rrrrry', '.rrrrry'], {}, { r: 'R' }), { r: '#e8344f', R: '#b01e3a', y: '#ffd23f' });

// calavera
add('calavera', 'Calavera', 'calavera muerte peligro pvp', half(['..wwwww', '.wwwwww', 'wwwwwww', 'wwkkkww', 'wwkkkww', 'wwwwwww', 'wwwwwwk', '.wwwwww', '..wwwww', '..wkwkw', '..wwwww'], {}, { w: 'W' }), { w: '#ffffff', W: '#d5dbe3', k: '#3b3f4a' });

// camara
{
  const c = blank(14, 11);
  rect(c, 0, 2, 14, 9, 'b');
  rect(c, 1, 0, 5, 2, 'b');
  rect(c, 9, 1, 3, 1, 'r');
  rect(c, 0, 9, 14, 2, 'B');
  disk(c, 7, 6, 3.4, (dx, dy, dist, r) => (dist > r - 1 ? 'k' : dx + dy < -1.2 ? 'h' : 'l'));
  rect(c, 11, 3, 2, 1, 'y');
  add('camara', 'Cámara', 'camara foto render screenshot captura', toRows(c), { b: '#aeb8c4', B: '#808b98', r: '#e8344f', k: '#3b3f4a', h: '#d6f2ff', l: '#3aa7ff', y: '#ffd23f' });
}

// claqueta
{
  const c = blank(14, 12);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 14; x++) put(c, x, y, (x + y) % 4 < 2 ? 'd' : 'w');
  rect(c, 0, 4, 14, 8, 'd');
  rect(c, 2, 6, 7, 1, 'w');
  rect(c, 2, 9, 10, 1, 'w');
  add('claqueta', 'Claqueta', 'claqueta cine animacion video pelicula', toRows(c), { d: '#3b3f4a', w: '#ffffff' });
}

// pincel
add('pincel', 'Pincel', 'pincel pintar arte dibujo', half(['......w', '......w', '......w', '......w', '......w', '.....ss', '.....ss', '....bbb', '...bbbb', '...bbbb', '....bbb', '.....bb', '......b'], {}, { w: 'W', s: 'S', b: 'B' }), { w: '#b07a4b', W: '#80532f', s: '#d5dbe3', S: '#8a95a1', b: '#ff6f91', B: '#d6406a' });

// paleta
add('paleta', 'Paleta de pintor', 'paleta pintura colores arte diseño', ['....wwwwww....', '..wwwwwwwwww..', '.wwrrwwwwwwww.', '.wwrrwwyywwww.', 'wwwwwwwyywwwww', 'wwbbwwwwwwwwww', 'wwbbwwwwwwgggw', '.wwwwwwwwwggg.', '..wwwwwkkwwww.', '...wwwwkkwww..', '....wwwwwww...'], { w: '#d9a46e', r: '#e8344f', y: '#ffd23f', b: '#3aa7ff', g: '#46c46a', k: '#8a5a33' });

// bloque (cubo con pasto)
{
  const c = blank(14, 14);
  const dirt = (x, y) => ((x * 7 + y * 13) % 5 === 0 ? 'D' : 'd');
  polygon(c, [[7, 0], [14, 3.5], [7, 7], [0, 3.5]], (x, y) => ((x + y * 3) % 5 === 0 ? 'G' : 'g'));
  polygon(c, [[0, 3.5], [7, 7], [7, 14], [0, 10.5]], (x, y) => (y < (x < 7 ? 4.5 + x * 0.5 : 8) + 1.4 ? 'g' : dirt(x, y)));
  polygon(c, [[14, 3.5], [7, 7], [7, 14], [14, 10.5]], (x, y) => (y < 4.5 + (13 - x) * 0.5 + 1.4 ? 'G' : dirt(x, y) === 'D' ? 'E' : 'e'));
  add('bloque', 'Bloque', 'bloque cubo minecraft pasto tierra construir 3d', toRows(c), { g: '#5fcf5a', G: '#3fa63c', d: '#a5703f', D: '#8a5a30', e: '#7c5129', E: '#68431f' });
}

// lapiz
{
  const c = blank(14, 14);
  for (let i = 0; i < 11; i++) {
    const x = 1 + i;
    const y = 12 - i;
    const tone = i < 2 ? 'w' : i === 8 ? 'g' : i >= 9 ? 'p' : 'y';
    put(c, x, y, tone);
    put(c, x + 1, y, i < 2 ? 'w' : i === 8 ? 'G' : i >= 9 ? 'P' : 'Y');
    put(c, x, y - 1, i < 2 ? 'w' : i === 8 ? 'g' : i >= 9 ? 'p' : 'y');
  }
  put(c, 1, 12, 'k');
  add('lapiz', 'Lápiz', 'lapiz escribir editar nota', toRows(c), { w: '#f0c9a0', k: '#3b3f4a', y: '#ffd23f', Y: '#d99a14', g: '#d5dbe3', G: '#8a95a1', p: '#ff8fb0', P: '#e06a92' });
}

// marcas
{
  const c = blank(14, 14);
  line(c, 1, 7, 5, 11, 'g', 2);
  line(c, 5, 11, 12, 3, 'g', 2);
  add('check', 'Check', 'check listo ok correcto verificado', toRows(c), { g: '#46c46a' });
}
{
  const c = blank(14, 14);
  line(c, 2, 2, 11, 11, 'r', 2);
  line(c, 11, 2, 2, 11, 'r', 2);
  add('cruz', 'Cruz', 'cruz equis error incorrecto no', toRows(c), { r: '#e8344f' });
}
add('pregunta', 'Pregunta', 'pregunta ayuda duda faq', ['bbbbbbbbbbbbbb', 'bbbbbbbbbbbbbb', 'bbbbwwwwwwbbbb', 'bbbwwbbbbwwbbb', 'bbbbbbbbbwwbbb', 'bbbbbbbwwwbbbb', 'bbbbbbwwbbbbbb', 'bbbbbbwwbbbbbb', 'bbbbbbbbbbbbbb', 'bbbbbbwwbbbbbb', 'bbbbbbwwbbbbbb', 'bbbbbbbbbbbbbb', 'bbbbbbbbbbbbbb'], { b: '#3aa7ff', w: '#ffffff' });
add('exclamacion', 'Exclamación', 'exclamacion aviso importante atencion', ['oooooooooooooo', 'oooooooooooooo', 'ooooooWWoooooo', 'ooooooWWoooooo', 'ooooooWWoooooo', 'ooooooWWoooooo', 'ooooooWWoooooo', 'ooooooWWoooooo', 'oooooooooooooo', 'ooooooWWoooooo', 'ooooooWWoooooo', 'oooooooooooooo', 'oooooooooooooo'], { o: '#ff9a2e', W: '#ffffff' });

// flechas
const ARROW_RIGHT = ['......aa......', '.......aaa....', '........aaaa..', 'aaaaaaaaaaaaaa', 'aaaaaaaaaaaaaa', '........aaaa..', '.......aaa....', '......aa......'];
const ARROW_COLORS = { a: '#3aa7ff' };
add('flecha_derecha', 'Flecha derecha', 'flecha derecha siguiente adelante', ARROW_RIGHT, ARROW_COLORS);
add('flecha_abajo', 'Flecha abajo', 'flecha abajo bajar descargar', rotate90(ARROW_RIGHT), ARROW_COLORS);
add('flecha_izquierda', 'Flecha izquierda', 'flecha izquierda atras volver', rotate90(rotate90(ARROW_RIGHT)), ARROW_COLORS);
add('flecha_arriba', 'Flecha arriba', 'flecha arriba subir', rotate90(rotate90(rotate90(ARROW_RIGHT))), ARROW_COLORS);

// --- armado (contorno + validacion) ---

function build(sprite) {
  const { id, rows, palette } = sprite;
  if (sprite.raw) {
    if (rows.length !== SIZE || rows.some((row) => row.length !== SIZE)) throw new Error(`pixel emoji ${id}: un sprite raw tiene que ser de ${SIZE}x${SIZE}`);
    return rows.map((row) => [...row].map((ch) => {
      if (ch === '.') return null;
      if (!palette[ch]) throw new Error(`pixel emoji ${id}: la letra "${ch}" no esta en la paleta`);
      return palette[ch];
    }));
  }
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  if (width > INNER || height > INNER) throw new Error(`pixel emoji ${id}: ${width}x${height} no cabe en ${INNER}x${INNER}`);
  const offsetX = Math.floor((SIZE - width) / 2);
  const offsetY = Math.floor((SIZE - height) / 2);

  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`pixel emoji ${id}: la fila ${y} mide ${row.length} y deberia medir ${width}`);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      if (!palette[ch]) throw new Error(`pixel emoji ${id}: la letra "${ch}" no esta en la paleta`);
      grid[offsetY + y][offsetX + x] = palette[ch];
    });
  });

  const filled = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && grid[y][x];
  const withOutline = grid.map((row) => row.slice());
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!grid[y][x] && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) withOutline[y][x] = OUTLINE;
    }
  }
  return withOutline;
}

// una sola ruta SVG por color (rectangulos de 1 px unidos por fila): liviano para mandar al navegador
function toSvg(grid) {
  const byColor = new Map();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const color = row[x];
      if (!color) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < row.length && row[end + 1] === color) end += 1;
      const run = `M${x} ${y}h${end - x + 1}v1h-${end - x + 1}z`;
      byColor.set(color, (byColor.get(color) || '') + run);
      x = end + 1;
    }
  });
  const paths = [...byColor.entries()].map(([color, d]) => `<path fill="${color}" d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">${paths}</svg>`;
}

// grupos del selector, en el orden en que se muestran
const GROUPS = [
  { id: 'redes', label: 'Redes sociales' },
  { id: 'juego', label: 'Objetos y juego' },
  { id: 'marcas', label: 'Marcas y flechas' },
];
const MARKS = new Set(['check', 'cruz', 'pregunta', 'exclamacion', 'flecha_derecha', 'flecha_abajo', 'flecha_izquierda', 'flecha_arriba']);

let cache = null;
function all() {
  if (!cache) {
    cache = SPRITES.map((sprite) => {
      const grid = build(sprite);
      const group = sprite.group || (MARKS.has(sprite.id) ? 'marcas' : 'juego');
      return { id: sprite.id, name: `px_${sprite.id}`, label: sprite.label, keywords: sprite.keywords, group, grid, svg: toSvg(grid) };
    });
  }
  return cache;
}

function getPixelEmoji(id) {
  return all().find((sprite) => sprite.id === id) || null;
}

// PNG de 128x128 (cada pixel de 8x8, sin suavizado) listo para subir como emoji de Discord
function renderPng(sprite, size = 128) {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const cell = size / SIZE;
  sprite.grid.forEach((row, y) => row.forEach((color, x) => {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell));
  }));
  return canvas.toBuffer('image/png');
}

module.exports = { all, getPixelEmoji, renderPng, toSvg, build, SPRITES, SIZE, GROUPS };
