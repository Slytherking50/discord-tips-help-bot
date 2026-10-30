// Script de una sola vez para setear el banner del bot via la API de Discord
// (el Developer Portal no tiene esta opcion en su interfaz web).
//
// Uso:
//   node set-bot-banner.js ruta/a/tu/banner.png
//
// Requiere DISCORD_TOKEN en el .env (ya deberia estar si el bot corre normalmente).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const imagePath = process.argv[2];

if (!imagePath) {
  console.error('Uso: node set-bot-banner.js ruta/a/tu/banner.png');
  process.exit(1);
}

if (!process.env.DISCORD_TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

async function main() {
  const resolvedPath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`No encontré el archivo: ${resolvedPath}`);
    process.exit(1);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    console.error(`Extensión no soportada: ${ext}. Usá PNG, JPG, GIF o WEBP.`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(resolvedPath);
  const sizeMb = buffer.length / (1024 * 1024);
  if (sizeMb > 10) {
    console.error(`La imagen pesa ${sizeMb.toFixed(1)}MB, el máximo de Discord es 10MB.`);
    process.exit(1);
  }

  const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.patch(Routes.user(), { body: { banner: dataUri } });
    console.log('✅ Banner actualizado. Puede tardar unos minutos en verse reflejado en Discord.');
  } catch (err) {
    console.error('❌ No se pudo actualizar el banner:', err.message);
    if (err.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    process.exit(1);
  }
}

main();
