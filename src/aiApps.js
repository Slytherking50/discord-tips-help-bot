// la IA como aplicaciones de Discord: opciones del clic derecho sobre un mensaje (Apps -> Opinar de este trabajo, Traducir,
// Transcribir voz), /resumir y la transcripcion automatica de mensajes de voz. Son pedidos explicitos de una persona, asi
// que la respuesta es privada (solo la ve quien lo pidio) salvo que sea su propio mensaje.

const { ContextMenuCommandBuilder, SlashCommandBuilder, ApplicationCommandType, ChannelType, PermissionFlagsBits } = require('discord.js');
const { findImageAttachments } = require('./imageAttachments');
const voiceTranscribe = require('./voiceTranscribe');

const OPINAR = 'Opinar de este trabajo';
const TRADUCIR = 'Traducir mensaje';
const TRANSCRIBIR = 'Transcribir voz';

const opinarDefinition = new ContextMenuCommandBuilder().setName(OPINAR).setType(ApplicationCommandType.Message);
const traducirDefinition = new ContextMenuCommandBuilder().setName(TRADUCIR).setType(ApplicationCommandType.Message);
const transcribirDefinition = new ContextMenuCommandBuilder().setName(TRANSCRIBIR).setType(ApplicationCommandType.Message);

const resumirDefinition = new SlashCommandBuilder()
  .setName('resumir')
  .setDescription('La IA te pone al día con lo último que se habló en un canal')
  .addIntegerOption((opt) => opt.setName('mensajes').setDescription('Cuántos mensajes revisar (10 a 100, por defecto 40)').setMinValue(10).setMaxValue(100))
  .addChannelOption((opt) =>
    opt
      .setName('canal')
      .setDescription('Otro canal (por defecto, este)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread),
  )
  .addBooleanOption((opt) => opt.setName('publico').setDescription('Mostrar el resumen a todos (por defecto solo lo ves tú)'));

const definitions = [opinarDefinition, traducirDefinition, transcribirDefinition, resumirDefinition];
const MENU_NAMES = [OPINAR, TRADUCIR, TRANSCRIBIR];

const NO_VISION_NOTICE = '👀 Ahora mismo no puedo ver imágenes (mi IA con visión no responde), así que prefiero no opinar a ciegas. Prueba de nuevo más tarde.';
const BAD_IMAGE_NOTICE = '🖼️ No pude abrir esa imagen (formato raro, muy pesada o el link venció). Prueba subiéndola otra vez.';
const GENERIC_FAILURE = '🤖 No pude hacerlo ahora, prueba de nuevo en un rato.';

const MAX_REPLY = 1900;
const SUMMARY_MAX_CHARS = 9000;
const SUMMARY_LINE_MAX = 300;
const VOICE_SUMMARY_FROM = 450;
const AUTO_VOICE_PER_DAY = 150;
const AUTO_VOICE_USER_COOLDOWN_MS = 15 * 1000;
const NO_MENTIONS = { parse: [], repliedUser: false };

function clip(text, max = MAX_REPLY) {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : value;
}

// "un mensaje" que se le muestra a la IA: sin menciones crudas (<@123>) ni markup de canales/emojis
function plainText(message) {
  return String(message?.cleanContent ?? message?.content ?? '')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessSpanish(text) {
  // para elegir el idioma de destino sin otra llamada a la IA: tildes/ñ/¿¡ o palabras muy comunes en español
  return /[áéíóúñ¿¡]|\b(el|la|los|las|que|de|y|en|un|una|es|por|para|con|no|mi|me|se|lo|su|como|pero|más|muy|hola|gracias|quiero|tengo)\b/i.test(text);
}

function create({ client, aiHelper, buildBaseAiContext, canUseAiNow, aiCooldownMs, isAiChannelAllowed, trackAiUsage, isCreatorUser, matchForbiddenTopic }) {
  const autoVoiceUsage = new Map(); // guildId -> { day, count }
  const lastAutoVoiceByUser = new Map();

  function aiReady(config) {
    return Boolean(config?.ai?.enabled && aiHelper.isConfigured(config));
  }

  // verifica que la IA este lista para esta persona y canal; si no, contesta el motivo y devuelve false
  async function guard(interaction, config) {
    if (!aiReady(config)) {
      await interaction.reply({ content: '⚠️ La IA no está activada en este server.', ephemeral: true });
      return false;
    }
    if (!isAiChannelAllowed(config, interaction.channelId)) {
      await interaction.reply({ content: '⚠️ La IA no responde en este canal.', ephemeral: true });
      return false;
    }
    if (!canUseAiNow(interaction.user.id, aiCooldownMs(config))) {
      await interaction.reply({ content: '⏳ Espera unos segundos antes de volver a pedirle algo a la IA.', ephemeral: true });
      return false;
    }
    return true;
  }

  function isForbidden(config, userId, text) {
    return !isCreatorUser(userId) && Boolean(matchForbiddenTopic(text, config?.ai?.forbiddenTopics));
  }

  // la opinion/transcripcion es publica solo si la pide la persona que escribio el mensaje
  function visibilityFor(interaction, target) {
    return { ephemeral: interaction.user.id !== target.author?.id };
  }

  async function opinar(interaction, config) {
    const target = interaction.targetMessage;
    const images = findImageAttachments(target);
    if (!images.length) {
      await interaction.reply({ content: '🖼️ Ese mensaje no tiene imágenes. Usa esta opción sobre un mensaje con un render, una animación, una skin o un dibujo.', ephemeral: true });
      return;
    }
    if (!(await guard(interaction, config))) return;

    const request = plainText(target).slice(0, 300);
    if (isForbidden(config, interaction.user.id, request)) {
      await interaction.reply({ content: 'No puedo hablar de ese tema.', ephemeral: true });
      return;
    }

    await interaction.deferReply(visibilityFor(interaction, target));
    const base = await buildBaseAiContext(interaction.guild, interaction.member, interaction.user, config);
    const result = await aiHelper.opinionOnWork(client, config, {
      ...base,
      userName: target.member?.displayName || target.author?.username || base.userName,
      isCreator: isCreatorUser(interaction.user.id),
      request,
      imageUrls: images.map((image) => image.url),
    });
    trackAiUsage(interaction.guild.id, Boolean(result.ok));

    if (result.ok) {
      const authorName = target.member?.displayName || target.author?.username;
      await interaction.editReply({ content: clip(`🎨 **Opinión sobre el trabajo de ${authorName}**\n${result.text}`), allowedMentions: NO_MENTIONS });
    } else if (result.reason === 'no-vision-access') {
      await interaction.editReply(NO_VISION_NOTICE);
    } else if (result.reason === 'bad-image') {
      await interaction.editReply(BAD_IMAGE_NOTICE);
    } else {
      await interaction.editReply(GENERIC_FAILURE);
    }
  }

  async function traducir(interaction, config) {
    const target = interaction.targetMessage;
    const text = plainText(target);
    if (!text) {
      await interaction.reply({ content: '🌐 Ese mensaje no tiene texto para traducir.', ephemeral: true });
      return;
    }
    if (!(await guard(interaction, config))) return;
    if (isForbidden(config, interaction.user.id, text)) {
      await interaction.reply({ content: 'No puedo hablar de ese tema.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const base = await buildBaseAiContext(interaction.guild, interaction.member, interaction.user, config);
    // sin idioma pedido: del español se traduce al inglés y de cualquier otro al español
    const into = guessSpanish(text) ? 'inglés' : 'español';
    const translation = await aiHelper.translateText(client, config, `Traduce al ${into} este texto, sin agregar nada más:\n${text.slice(0, 1500)}`, base);
    trackAiUsage(interaction.guild.id, Boolean(translation));
    if (!translation) {
      await interaction.editReply(GENERIC_FAILURE);
      return;
    }
    await interaction.editReply({ content: clip(`🌐 **Traducción al ${into}**\n> ${translation.replace(/\n/g, '\n> ')}`), allowedMentions: NO_MENTIONS });
  }

  // baja el audio, lo transcribe y arma el mensaje (con resumen si es largo). Devuelve { ok, content } o { ok: false, reason }
  async function buildTranscription(config, audio, authorName) {
    let buffer;
    try {
      buffer = await voiceTranscribe.downloadAudio(audio.url);
    } catch (err) {
      console.warn('No se pudo bajar el audio para transcribir:', err.message);
      return { ok: false, reason: err.code === 'too-big' ? 'too-big' : 'error' };
    }
    const result = await voiceTranscribe.transcribeAudio({
      apiKey: aiHelper.resolveApiKey(config),
      audio: buffer,
      filename: audio.name,
      contentType: audio.contentType,
    });
    if (!result.ok) return result;
    const summary = result.text.length >= VOICE_SUMMARY_FROM ? await aiHelper.summarizeVoiceMessage(client, config, result.text) : null;
    return { ok: true, content: voiceTranscribe.formatTranscript(result, { authorName, summary }) };
  }

  async function transcribir(interaction, config) {
    const target = interaction.targetMessage;
    const maxSeconds = voiceTranscribe.DEFAULT_MAX_SECONDS;
    const audio = voiceTranscribe.findAudioAttachment(target, { maxSeconds });
    if (!audio) {
      await interaction.reply({ content: '🎙️ Ese mensaje no tiene un audio. Usa esta opción sobre un mensaje de voz o un archivo de audio.', ephemeral: true });
      return;
    }
    if (audio.problem) {
      await interaction.reply({ content: voiceTranscribe.failureMessage(audio.problem), ephemeral: true });
      return;
    }
    if (!(await guard(interaction, config))) return;

    await interaction.deferReply(visibilityFor(interaction, target));
    const authorName = target.member?.displayName || target.author?.username || null;
    const built = await buildTranscription(config, audio, authorName);
    trackAiUsage(interaction.guild.id, Boolean(built.ok) || built.reason === 'no-speech');
    await interaction.editReply(built.ok ? { content: clip(built.content), allowedMentions: NO_MENTIONS } : voiceTranscribe.failureMessage(built.reason));
  }

  // los ultimos mensajes de un canal como "Nombre: texto", del mas viejo al mas nuevo, sin bots ni mensajes vacios
  async function buildTranscript(channel, limit) {
    const fetched = await channel.messages.fetch({ limit: Math.min(100, Math.max(1, limit)) });
    const lines = [];
    let total = 0;
    for (const message of [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)) {
      if (message.author?.bot) continue;
      const name = message.member?.displayName || message.author?.username || 'alguien';
      const extras = [message.attachments?.size ? `[${message.attachments.size} archivo(s)]` : '', voiceTranscribe.isVoiceMessage(message) ? '[mensaje de voz]' : ''].filter(Boolean).join(' ');
      const text = `${plainText(message)} ${extras}`.trim();
      if (!text) continue;
      const line = `${name}: ${text}`.slice(0, SUMMARY_LINE_MAX);
      if (total + line.length > SUMMARY_MAX_CHARS) break;
      lines.push(line);
      total += line.length + 1;
    }
    return { transcript: lines.join('\n'), count: lines.length };
  }

  async function resumir(interaction, config) {
    const limit = interaction.options.getInteger('mensajes') || 40;
    const channel = interaction.options.getChannel('canal') || interaction.channel;
    const isPublic = interaction.options.getBoolean('publico') === true;

    if (!channel?.isTextBased?.() || !channel.messages) {
      await interaction.reply({ content: '⚠️ No puedo leer ese canal.', ephemeral: true });
      return;
    }
    // el bot puede ver canales que quien pregunta no: nunca se resume uno que esa persona no puede leer
    const allowed = channel.permissionsFor?.(interaction.member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
    if (!allowed) {
      await interaction.reply({ content: '⚠️ No tienes permiso para leer ese canal.', ephemeral: true });
      return;
    }
    if (!(await guard(interaction, config))) return;

    await interaction.deferReply({ ephemeral: !isPublic });
    let history;
    try {
      history = await buildTranscript(channel, limit);
    } catch (err) {
      console.warn('No se pudieron leer los mensajes para /resumir:', err.message);
      await interaction.editReply('⚠️ No pude leer los mensajes de ese canal.');
      return;
    }
    if (history.count < 3) {
      await interaction.editReply('📝 Casi no hay mensajes de personas para resumir en ese canal.');
      return;
    }

    const base = await buildBaseAiContext(interaction.guild, interaction.member, interaction.user, config);
    const summary = await aiHelper.summarizeConversation(client, config, history.transcript, { ...base, channelName: channel.name, messageCount: history.count });
    trackAiUsage(interaction.guild.id, Boolean(summary));
    if (!summary) {
      await interaction.editReply(GENERIC_FAILURE);
      return;
    }
    await interaction.editReply({ content: clip(`📝 **Resumen de <#${channel.id}>** · últimos ${history.count} mensajes\n${summary}`), allowedMentions: NO_MENTIONS });
  }

  async function handleMessageContextMenu(interaction, config) {
    switch (interaction.commandName) {
      case OPINAR:
        return opinar(interaction, config);
      case TRADUCIR:
        return traducir(interaction, config);
      case TRANSCRIBIR:
        return transcribir(interaction, config);
      default:
        return undefined;
    }
  }

  // mensajes de voz en los canales elegidos (o en todos, si no se eligio ninguno): la transcripcion se publica sola
  function wantsAutoTranscription(message, config) {
    const settings = config?.ai?.voice;
    if (!settings?.enabled || !aiReady(config)) return false;
    if (!voiceTranscribe.isVoiceMessage(message)) return false;
    return !settings.channelIds?.length || settings.channelIds.includes(message.channel.id);
  }

  function underDailyCap(guildId) {
    const day = new Date().toISOString().slice(0, 10);
    const usage = autoVoiceUsage.get(guildId);
    if (!usage || usage.day !== day) {
      autoVoiceUsage.set(guildId, { day, count: 1 });
      return true;
    }
    if (usage.count >= AUTO_VOICE_PER_DAY) return false;
    usage.count += 1;
    return true;
  }

  async function autoTranscribe(message, config) {
    if (!wantsAutoTranscription(message, config)) return false;
    const audio = voiceTranscribe.findAudioAttachment(message);
    if (!audio || audio.problem) return false;

    const now = Date.now();
    if (now - (lastAutoVoiceByUser.get(message.author.id) || 0) < AUTO_VOICE_USER_COOLDOWN_MS) return false;
    if (!underDailyCap(message.guild.id)) return false;
    lastAutoVoiceByUser.set(message.author.id, now);

    const built = await buildTranscription(config, audio, message.member?.displayName || message.author.username);
    trackAiUsage(message.guild.id, Boolean(built.ok) || built.reason === 'no-speech');
    // silencio o fallo: no se escribe nada (ruido en el canal sin que nadie lo pidiera)
    if (!built.ok) return false;
    await message.reply({ content: clip(built.content), allowedMentions: NO_MENTIONS });
    return true;
  }

  return { handleMessageContextMenu, handleResumirCommand: resumir, autoTranscribe, wantsAutoTranscription, buildTranscript };
}

module.exports = { definitions, MENU_NAMES, create, plainText, guessSpanish, NO_VISION_NOTICE, BAD_IMAGE_NOTICE, GENERIC_FAILURE, AUTO_VOICE_PER_DAY };
