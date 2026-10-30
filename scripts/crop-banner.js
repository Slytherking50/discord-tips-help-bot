// Recorta una imagen ya terminada (con su propio fondo) a la proporcion de los
// banners de perfil de Discord (17:6; se guarda en 1360x480).
//
//   node scripts/crop-banner.js <imagen-de-entrada> <imagen-de-salida> [foco]
//
// "foco" es a que altura de la imagen esta el centro de lo importante (el logo),
// de 0 (arriba) a 1 (abajo); por defecto 0.48. La imagen se usa a todo su ancho
// y se recorta solo por arriba y por abajo.

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const WIDTH = 1360;
const HEIGHT = 480;

async function main() {
  const [inputPath, outputPath, focusArg] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Uso: node scripts/crop-banner.js <imagen-de-entrada> <imagen-de-salida> [foco 0-1]');
    process.exit(1);
  }

  const focus = Math.min(1, Math.max(0, focusArg === undefined ? 0.48 : Number(focusArg)));
  const image = await loadImage(fs.readFileSync(path.resolve(inputPath)));

  // altura de la franja que cabe a todo el ancho con la proporcion del banner
  const cropHeight = Math.min(image.height, (image.width * HEIGHT) / WIDTH);
  const cropWidth = (cropHeight * WIDTH) / HEIGHT;
  const sourceX = (image.width - cropWidth) / 2;
  const sourceY = Math.min(image.height - cropHeight, Math.max(0, image.height * focus - cropHeight / 2));

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, WIDTH, HEIGHT);

  fs.writeFileSync(path.resolve(outputPath), canvas.toBuffer('image/png'));
  console.log(`Banner guardado en ${outputPath} (${WIDTH}x${HEIGHT}); franja usada: y=${Math.round(sourceY)}..${Math.round(sourceY + cropHeight)} de ${image.height}`);
}

main().catch((err) => {
  console.error('No se pudo recortar el banner:', err);
  process.exit(1);
});
