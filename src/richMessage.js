const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { normalizeEmoji } = require('./emojiUtil');

// mensajes avanzados (Components V2 de Discord): tarjetas ("contenedores") con
// texto en markdown, secciones con imagen a un lado, separadores, imagenes y
// filas de botones con link. El mensaje se guarda como JSON simple y aca se
// valida y se convierte en componentes de discord.js.
//
//   { containers: [ { accent: '#ec7b2c' | null, items: [ ...bloques ] } ] }
//
//   { type: 'text',      content }
//   { type: 'section',   content, thumbnail }          (thumbnail: https://, {avatar} o {servericon})
//   { type: 'separator', divider: true, spacing: 'small' | 'large' }
//   { type: 'buttons',   buttons: [ { label, url, emoji } ] }
//   { type: 'gallery',   urls: [ https://... ] }

const LIMITS = {
  containers: 5,
  itemsPerContainer: 12,
  // tope de Discord para todos los componentes de un mensaje, contando los anidados
  components: 40,
  // Discord permite 4000 caracteres de texto en total; se deja margen para las variables
  totalText: 3800,
  textLength: 2000,
  buttonsPerRow: 5,
  galleryItems: 4,
  buttonLabel: 80,
};

const HEX = /^#[0-9a-f]{6}$/i;
const URL_RE = /^https?:\/\/[^\s<>"]{3,}$/i;
const THUMBNAIL_RE = /^(https?:\/\/[^\s<>"]{3,}|\{avatar\}|\{servericon\})$/i;
const VARIABLE_RE = /\{(user|username|server|membercount|joindate|avatar|servericon)\}/g;

function clean(value, max) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function fail(error) {
  return { ok: false, error };
}

function sanitizeItem(item, where, counters) {
  switch (item?.type) {
    case 'text': {
      const content = clean(item.content, LIMITS.textLength);
      if (!content) return fail(`${where}: el texto está vacío.`);
      counters.components += 1;
      counters.text += content.length;
      return { ok: true, value: { type: 'text', content } };
    }

    case 'section': {
      const content = clean(item.content, LIMITS.textLength);
      if (!content) return fail(`${where}: el texto de la sección está vacío.`);
      const thumbnail = clean(item.thumbnail, 500);
      if (thumbnail && !THUMBNAIL_RE.test(thumbnail)) {
        return fail(`${where}: la imagen tiene que ser un link que empiece con https:// (o {avatar} / {servericon}).`);
      }
      // sin imagen una seccion es solo texto; con imagen son 3 componentes (seccion, texto, miniatura)
      counters.components += thumbnail ? 3 : 1;
      counters.text += content.length;
      return { ok: true, value: { type: 'section', content, thumbnail } };
    }

    case 'separator': {
      counters.components += 1;
      return { ok: true, value: { type: 'separator', divider: item.divider !== false, spacing: item.spacing === 'large' ? 'large' : 'small' } };
    }

    case 'buttons': {
      const rows = (Array.isArray(item.buttons) ? item.buttons : []).filter((b) => clean(b?.label, 80) || clean(b?.url, 500));
      if (!rows.length) return fail(`${where}: agrega al menos un botón.`);
      if (rows.length > LIMITS.buttonsPerRow) return fail(`${where}: máximo ${LIMITS.buttonsPerRow} botones por fila.`);

      const buttons = [];
      for (const raw of rows) {
        const label = clean(raw.label, LIMITS.buttonLabel);
        const url = clean(raw.url, 500);
        if (!label) return fail(`${where}: hay un botón sin texto.`);
        if (!URL_RE.test(url)) return fail(`${where}: el botón «${label}» necesita un link que empiece con https://`);
        // un emoji que no lo es de verdad haria que Discord rechace el mensaje entero
        const typedEmoji = clean(raw.emoji, 64);
        const emoji = typedEmoji ? normalizeEmoji(typedEmoji) : '';
        if (typedEmoji && !emoji) return fail(`${where}: el emoji del botón «${label}» no es válido; elígelo con el selector o déjalo vacío.`);
        buttons.push({ label, url, emoji: emoji || '' });
      }
      counters.components += 1 + buttons.length;
      return { ok: true, value: { type: 'buttons', buttons } };
    }

    case 'gallery': {
      const source = Array.isArray(item.urls) ? item.urls : String(item.urls ?? '').split('\n');
      const urls = source.map((url) => clean(url, 500)).filter(Boolean);
      if (!urls.length) return fail(`${where}: agrega al menos un link de imagen.`);
      if (urls.length > LIMITS.galleryItems) return fail(`${where}: máximo ${LIMITS.galleryItems} imágenes por bloque.`);
      if (urls.some((url) => !URL_RE.test(url))) return fail(`${where}: todos los links de imagen tienen que empezar con https://`);
      counters.components += 1 + urls.length;
      return { ok: true, value: { type: 'gallery', urls } };
    }

    default:
      return fail(`${where}: tipo de bloque desconocido.`);
  }
}

// normaliza lo que llega del dashboard (o de la base) y revisa los limites de
// Discord antes de intentar mandar nada
function sanitizeRichMessage(raw) {
  if (!raw || !Array.isArray(raw.containers) || !raw.containers.length) return fail('Agrega al menos una tarjeta.');
  if (raw.containers.length > LIMITS.containers) return fail(`Máximo ${LIMITS.containers} tarjetas por mensaje.`);

  const counters = { components: 0, text: 0 };
  const containers = [];

  for (const [ci, rawContainer] of raw.containers.entries()) {
    const label = `Tarjeta ${ci + 1}`;
    const rawItems = Array.isArray(rawContainer?.items) ? rawContainer.items : [];
    if (!rawItems.length) return fail(`${label} está vacía.`);
    if (rawItems.length > LIMITS.itemsPerContainer) return fail(`${label}: máximo ${LIMITS.itemsPerContainer} bloques.`);

    counters.components += 1;
    const items = [];
    for (const [ii, rawItem] of rawItems.entries()) {
      const result = sanitizeItem(rawItem, `${label}, bloque ${ii + 1}`, counters);
      if (!result.ok) return result;
      items.push(result.value);
    }
    containers.push({ accent: HEX.test(rawContainer.accent || '') ? rawContainer.accent : null, items });
  }

  if (counters.components > LIMITS.components) {
    return fail(`El mensaje es demasiado grande (${counters.components} de ${LIMITS.components} componentes). Quita bloques o botones.`);
  }
  if (counters.text > LIMITS.totalText) {
    return fail(`Hay demasiado texto en total (${counters.text} de ${LIMITS.totalText} caracteres).`);
  }
  return { ok: true, value: { containers } };
}

// {user}, {username}, {server}, {membercount}, {joindate}, {avatar}, {servericon};
// lo que no tenga valor se deja tal cual para que se note en el mensaje
function fillVariables(text, vars = {}) {
  return String(text).replace(VARIABLE_RE, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match));
}

function buildButtonRow(buttons) {
  const row = new ActionRowBuilder();
  for (const raw of buttons) {
    const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(raw.url).setLabel(raw.label);
    if (raw.emoji) {
      try {
        button.setEmoji(raw.emoji);
      } catch {
        // un emoji que Discord no reconoce no tiene que tirar abajo el mensaje entero
      }
    }
    row.addComponents(button);
  }
  return row;
}

function buildContainer(container, vars) {
  const built = new ContainerBuilder();
  if (container.accent) built.setAccentColor(parseInt(container.accent.slice(1), 16));

  for (const item of container.items) {
    if (item.type === 'text') {
      built.addTextDisplayComponents(new TextDisplayBuilder().setContent(fillVariables(item.content, vars)));
    } else if (item.type === 'section') {
      const text = new TextDisplayBuilder().setContent(fillVariables(item.content, vars));
      const thumbnailUrl = item.thumbnail ? fillVariables(item.thumbnail, vars) : '';
      // una seccion necesita su miniatura: si no hay (o la variable quedo vacia,
      // ej. un server sin icono) se manda como texto simple
      if (URL_RE.test(thumbnailUrl)) {
        built.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl)));
      } else {
        built.addTextDisplayComponents(text);
      }
    } else if (item.type === 'separator') {
      built.addSeparatorComponents(
        new SeparatorBuilder().setDivider(item.divider).setSpacing(item.spacing === 'large' ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small),
      );
    } else if (item.type === 'buttons') {
      built.addActionRowComponents(buildButtonRow(item.buttons));
    } else if (item.type === 'gallery') {
      built.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item.urls.map((url) => new MediaGalleryItemBuilder().setURL(url))));
    }
  }
  return built;
}

// payload listo para channel.send() / message.edit()
function buildRichPayload(message, vars = {}) {
  return {
    components: message.containers.map((container) => buildContainer(container, vars)),
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: vars.allowedMentions || { parse: [] },
  };
}

// publica el mensaje en un canal; si ya estaba publicado en ESE canal lo edita
// en lugar de mandar uno nuevo (asi el link y la posicion no cambian)
async function publishRichMessage(guild, stored, channelId, vars = {}) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') {
    throw new Error('Ese canal no existe o no admite mensajes.');
  }

  const payload = buildRichPayload(stored, vars);

  if (stored.messageId && stored.publishedChannelId === channelId) {
    const existing = await channel.messages.fetch(stored.messageId).catch(() => null);
    if (existing && existing.editable) {
      await existing.edit({ components: payload.components, flags: payload.flags });
      return { messageId: existing.id, channelId, updated: true };
    }
  }

  const sent = await channel.send(payload);
  return { messageId: sent.id, channelId, updated: false };
}

// mensaje de error entendible para los fallos mas comunes de Discord
function describePublishError(err) {
  if (err?.code === 50013 || err?.code === 50001) return 'El bot no tiene permiso para escribir en ese canal.';
  if (err?.code === 50035) return 'Discord rechazó el mensaje (revisa que los links de imágenes y botones sean válidos).';
  return err?.message || 'No se pudo publicar el mensaje.';
}

module.exports = {
  LIMITS,
  sanitizeRichMessage,
  fillVariables,
  buildRichPayload,
  publishRichMessage,
  describePublishError,
};
