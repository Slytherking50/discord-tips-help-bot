// Genera el banner del bot: pone el logo (PNG con fondo transparente) sobre un
// cielo estrellado de estilo pixelado y lo guarda con la proporcion que usa
// Discord para los banners de perfil (17:6; aqui 1360x480, el doble de los 680x240
// recomendados para que se vea nitido).
//
//   node scripts/make-banner.js
//
// Despues se puede aplicar al bot con:  node set-bot-banner.js assets/banner/banner-planet-of-creators.png

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const WIDTH = 1360;
const HEIGHT = 480;
const PIXEL = 8; // todo se alinea a una grilla de 8 px para que se vea como pixel art
const MARGIN = 28;

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'banner', 'logo-planet-of-creators.png');
const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'banner', 'banner-planet-of-creators.png');

// cielo por franjas planas (sin degradado): mas claro hacia abajo, como un horizonte
const SKY_BANDS = ['#1a1e5a', '#1e2362', '#232a6b', '#283173', '#2d377b', '#323e83', '#37458b', '#3c4c93'];

const STAR_COLORS = ['#ffffff', '#ffffff', '#d6deff', '#b5c3ff', '#ffe9a8'];

// generador pseudoaleatorio con semilla: el banner sale igual cada vez que se corre
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// caja que contiene los pixeles visibles del logo (el PNG trae mucho margen transparente)
function visibleBounds(image) {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);

  let minX = image.width;
  let minY = image.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (data[(y * image.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function drawStars(ctx, random) {
  const columns = WIDTH / PIXEL;
  const rows = HEIGHT / PIXEL;

  for (let i = 0; i < 170; i++) {
    const x = Math.floor(random() * columns) * PIXEL;
    const y = Math.floor(random() * rows) * PIXEL;
    const size = random() < 0.2 ? PIXEL : PIXEL / 2;
    ctx.globalAlpha = 0.45 + random() * 0.55;
    ctx.fillStyle = STAR_COLORS[Math.floor(random() * STAR_COLORS.length)];
    ctx.fillRect(x, y, size, size);
  }

  // estrellas grandes en forma de cruz
  ctx.globalAlpha = 1;
  for (let i = 0; i < 14; i++) {
    const cx = (2 + Math.floor(random() * (columns - 4))) * PIXEL;
    const cy = (2 + Math.floor(random() * (rows - 4))) * PIXEL;
    ctx.fillStyle = random() < 0.25 ? '#ffe9a8' : '#ffffff';
    ctx.fillRect(cx, cy, PIXEL, PIXEL);
    ctx.fillRect(cx - PIXEL, cy, PIXEL, PIXEL);
    ctx.fillRect(cx + PIXEL, cy, PIXEL, PIXEL);
    ctx.fillRect(cx, cy - PIXEL, PIXEL, PIXEL);
    ctx.fillRect(cx, cy + PIXEL, PIXEL, PIXEL);
  }
  ctx.globalAlpha = 1;
}

async function main() {
  const logo = await loadImage(LOGO_PATH);
  const bounds = visibleBounds(logo);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const bandHeight = HEIGHT / SKY_BANDS.length;
  SKY_BANDS.forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, Math.floor(index * bandHeight), WIDTH, Math.ceil(bandHeight));
  });

  drawStars(ctx, mulberry32(20261030));

  // el logo se recorta a lo visible, se escala para llenar el alto y se centra
  const scale = Math.min((WIDTH - MARGIN * 2) / bounds.width, (HEIGHT - MARGIN * 2) / bounds.height);
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(logo, bounds.x, bounds.y, bounds.width, bounds.height, (WIDTH - drawWidth) / 2, (HEIGHT - drawHeight) / 2, drawWidth, drawHeight);

  fs.writeFileSync(OUTPUT_PATH, canvas.toBuffer('image/png'));
  console.log(`Banner guardado en ${path.relative(process.cwd(), OUTPUT_PATH)} (${WIDTH}x${HEIGHT}, logo ${Math.round(drawWidth)}x${Math.round(drawHeight)})`);
}

main().catch((err) => {
  console.error('No se pudo generar el banner:', err);
  process.exit(1);
});
