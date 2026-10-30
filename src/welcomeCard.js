const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { fetchImageBuffer } = require('./safeFetch');

// fuentes embebidas: Render no trae fuentes del sistema
GlobalFonts.registerFromPath(path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Regular.ttf'), 'WelcomeSans');
GlobalFonts.registerFromPath(path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Bold.ttf'), 'WelcomeSansBold');

const WIDTH = 1000;
const HEIGHT = 360;

const CARD_STYLES = ['center', 'left'];
const AVATAR_SHAPES = ['circle', 'rounded', 'square'];

const DEFAULT_CARD = {
  enabled: false,
  style: 'center',
  title: '¡Bienvenido/a, {username}!',
  subtitle: 'Eres el miembro #{membercount} de {server}',
  backgroundColor: '#1d1b18',
  accentColor: '#ec7b2c',
  textColor: '#ffffff',
  backgroundImageUrl: null,
  overlayOpacity: 45,
  avatarShape: 'circle',
};

const DEFAULT_GOODBYE_CARD = {
  ...DEFAULT_CARD,
  title: '{username} se fue',
  subtitle: 'Ahora somos {membercount} en {server}',
  backgroundColor: '#1d1b18',
  accentColor: '#c4553f',
};

function safeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

// la fuente de la tarjeta no tiene emojis (saldrian como cuadrados), asi que
// se sacan del texto en vez de dibujar caracteres rotos
function stripUnrenderable(text) {
  return String(text || '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function fillCardText(template, { username, server, membercount }) {
  return stripUnrenderable(
    String(template || '')
      .split('{username}').join(username)
      .split('{user}').join(username)
      .split('{server}').join(server)
      .split('{membercount}').join(String(membercount)),
  );
}

// normaliza lo que llega del dashboard (o de la base) a valores seguros
function sanitizeCardSettings(raw, defaults = DEFAULT_CARD) {
  const input = raw || {};
  return {
    enabled: input.enabled === true || input.enabled === 'on',
    style: CARD_STYLES.includes(input.style) ? input.style : defaults.style,
    title: String(input.title ?? defaults.title).slice(0, 60),
    subtitle: String(input.subtitle ?? defaults.subtitle).slice(0, 100),
    backgroundColor: safeHex(input.backgroundColor, defaults.backgroundColor),
    accentColor: safeHex(input.accentColor, defaults.accentColor),
    textColor: safeHex(input.textColor, defaults.textColor),
    backgroundImageUrl: /^https:\/\//i.test(String(input.backgroundImageUrl || '').trim())
      ? String(input.backgroundImageUrl).trim().slice(0, 500)
      : null,
    overlayOpacity: clampNumber(input.overlayOpacity, 0, 90, defaults.overlayOpacity),
    avatarShape: AVATAR_SHAPES.includes(input.avatarShape) ? input.avatarShape : defaults.avatarShape,
  };
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel) => Math.round(amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// achica la letra hasta que entre; si aun asi no entra, corta con "…"
function fitText(ctx, text, maxWidth, { fontName, startSize, minSize }) {
  let size = startSize;
  ctx.font = `${size}px ${fontName}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${size}px ${fontName}`;
  }
  let fitted = text;
  while (fitted.length > 1 && ctx.measureText(fitted).width > maxWidth) fitted = fitted.slice(0, -1);
  return fitted === text ? text : `${fitted.trimEnd()}…`;
}

function avatarPath(ctx, shape, x, y, size) {
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
  } else if (shape === 'rounded') {
    roundRectPath(ctx, x, y, size, size, size * 0.22);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.closePath();
  }
}

async function drawBackground(ctx, settings) {
  if (settings.backgroundImageUrl) {
    try {
      const image = await loadImage(await fetchImageBuffer(settings.backgroundImageUrl));
      // "cover": llena toda la tarjeta sin deformar la imagen
      const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      ctx.fillStyle = `rgba(0, 0, 0, ${settings.overlayOpacity / 100})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      return;
    } catch (err) {
      console.error('No se pudo cargar el fondo de la tarjeta de bienvenida:', err.message);
    }
  }

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, shade(settings.backgroundColor, 0.12));
  gradient.addColorStop(1, shade(settings.backgroundColor, -0.4));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // brillos suaves del color de acento para que no quede un fondo plano
  const glowA = ctx.createRadialGradient(WIDTH * 0.85, HEIGHT * 0.1, 0, WIDTH * 0.85, HEIGHT * 0.1, 320);
  glowA.addColorStop(0, rgba(settings.accentColor, 0.35));
  glowA.addColorStop(1, rgba(settings.accentColor, 0));
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glowB = ctx.createRadialGradient(WIDTH * 0.08, HEIGHT * 0.95, 0, WIDTH * 0.08, HEIGHT * 0.95, 260);
  glowB.addColorStop(0, rgba(settings.accentColor, 0.22));
  glowB.addColorStop(1, rgba(settings.accentColor, 0));
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

async function drawAvatar(ctx, settings, avatarURL, x, y, size) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  avatarPath(ctx, settings.avatarShape, x - 6, y - 6, size + 12);
  ctx.fillStyle = settings.accentColor;
  ctx.fill();
  ctx.restore();

  ctx.save();
  avatarPath(ctx, settings.avatarShape, x, y, size);
  ctx.clip();
  try {
    const image = await loadImage(await fetchImageBuffer(avatarURL, { maxBytes: 2 * 1024 * 1024 }));
    ctx.drawImage(image, x, y, size, size);
  } catch (err) {
    console.error('No se pudo cargar el avatar para la tarjeta de bienvenida:', err.message);
    ctx.fillStyle = shade(settings.accentColor, -0.2);
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

// settings: lo que devuelve sanitizeCardSettings. sample: datos ya resueltos
// del miembro ({username, server, membercount, avatarURL})
async function generateWelcomeCard(rawSettings, sample, defaults = DEFAULT_CARD) {
  const settings = sanitizeCardSettings(rawSettings, defaults);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.save();
  roundRectPath(ctx, 0, 0, WIDTH, HEIGHT, 28);
  ctx.clip();

  await drawBackground(ctx, settings);

  // barra de acento abajo
  ctx.fillStyle = settings.accentColor;
  ctx.fillRect(0, HEIGHT - 8, WIDTH, 8);

  const title = fillCardText(settings.title, sample) || sample.username;
  const subtitle = fillCardText(settings.subtitle, sample);

  ctx.textBaseline = 'alphabetic';

  if (settings.style === 'left') {
    const avatarSize = 200;
    const avatarX = 70;
    const avatarY = (HEIGHT - 8 - avatarSize) / 2;
    await drawAvatar(ctx, settings, sample.avatarURL, avatarX, avatarY, avatarSize);

    const textX = avatarX + avatarSize + 60;
    const maxWidth = WIDTH - textX - 60;
    ctx.textAlign = 'left';

    ctx.fillStyle = settings.textColor;
    const fittedTitle = fitText(ctx, title, maxWidth, { fontName: 'WelcomeSansBold', startSize: 56, minSize: 28 });
    ctx.fillText(fittedTitle, textX, HEIGHT / 2 - 6);

    if (subtitle) {
      ctx.fillStyle = rgba(settings.textColor, 0.8);
      const fittedSubtitle = fitText(ctx, subtitle, maxWidth, { fontName: 'WelcomeSans', startSize: 30, minSize: 20 });
      ctx.fillText(fittedSubtitle, textX, HEIGHT / 2 + 44);
    }

    ctx.fillStyle = settings.accentColor;
    roundRectPath(ctx, textX, HEIGHT / 2 + 68, 90, 6, 3);
    ctx.fill();
  } else {
    const avatarSize = 150;
    await drawAvatar(ctx, settings, sample.avatarURL, (WIDTH - avatarSize) / 2, 32, avatarSize);

    const maxWidth = WIDTH - 120;
    ctx.textAlign = 'center';

    ctx.fillStyle = settings.textColor;
    const fittedTitle = fitText(ctx, title, maxWidth, { fontName: 'WelcomeSansBold', startSize: 52, minSize: 28 });
    ctx.fillText(fittedTitle, WIDTH / 2, 268);

    if (subtitle) {
      ctx.fillStyle = rgba(settings.textColor, 0.8);
      const fittedSubtitle = fitText(ctx, subtitle, maxWidth, { fontName: 'WelcomeSans', startSize: 28, minSize: 18 });
      ctx.fillText(fittedSubtitle, WIDTH / 2, 312);
    }
  }

  ctx.restore();
  return canvas.toBuffer('image/png');
}

module.exports = {
  generateWelcomeCard,
  sanitizeCardSettings,
  fillCardText,
  DEFAULT_CARD,
  DEFAULT_GOODBYE_CARD,
  CARD_STYLES,
  AVATAR_SHAPES,
};
