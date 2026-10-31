// el bot en los canales de voz: se une, habla con TTS (/voz decir) y lee en voz alta el chat de texto de quienes estan en el
// mismo canal de voz. Una sesion por servidor, con cola de mensajes, salida automatica por inactividad o si se queda solo,
// y la voz de cada persona. Texto -> audio: ttsProviders.js; limpieza del texto: speechText.js.

const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
// @discordjs/voice (con su modulo nativo del cifrado DAVE) se carga la primera vez que se usa la voz, no al arrancar el bot: asi el
// arranque no depende de el, y si algun dia falla solo falla /voz
let loadedVoice = null;
function loadVoice() {
  if (!loadedVoice) loadedVoice = require('@discordjs/voice');
  return loadedVoice;
}
const { Readable } = require('stream');
const ttsProviders = require('./ttsProviders');
const { prepareSpeech } = require('./speechText');

const MAX_QUEUE = 8;
const JOIN_TIMEOUT_MS = 20000;
const RECONNECT_WAIT_MS = 5000;
const ALONE_LEAVE_MS = 30000;
const ANNOUNCE_AGAIN_MS = 45000;
const PLAY_SAFETY_MS = 8000;
const ERROR_NOTICE_MS = 60000;
const PREF_CACHE_MS = 5 * 60 * 1000;
const NO_MENTIONS = { parse: [] };

const voiceChoices = ttsProviders.VOICES.map((voice) => ({ name: voice.label, value: voice.id }));

const definition = new SlashCommandBuilder()
  .setName('voz')
  .setDescription('El bot entra a tu canal de voz, habla con TTS y lee el chat')
  .addSubcommand((sub) =>
    sub
      .setName('unir')
      .setDescription('Entra a tu canal de voz y lee en voz alta lo que escriban aquí quienes estén en él')
      .addChannelOption((opt) => opt.setName('canal').setDescription('Otro canal de voz (por defecto, el tuyo)').addChannelTypes(ChannelType.GuildVoice))
      .addBooleanOption((opt) => opt.setName('leer_chat').setDescription('Leer en voz alta el chat de este canal de texto (por defecto, sí)')),
  )
  .addSubcommand((sub) => sub.setName('salir').setDescription('Sale del canal de voz'))
  .addSubcommand((sub) =>
    sub
      .setName('decir')
      .setDescription('Dice un texto en el canal de voz')
      .addStringOption((opt) => opt.setName('texto').setDescription('Qué decir').setRequired(true).setMaxLength(300))
      .addStringOption((opt) => opt.setName('voz').setDescription('Voz o idioma (por defecto, la tuya)').addChoices(...voiceChoices)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('mi-voz')
      .setDescription('Elige la voz con la que el bot lee tus mensajes')
      .addStringOption((opt) => opt.setName('voz').setDescription('Voz o idioma').setRequired(true).addChoices(...voiceChoices)),
  )
  .addSubcommand((sub) => sub.setName('parar').setDescription('Calla al bot y vacía la cola de mensajes'))
  .addSubcommand((sub) => sub.setName('estado').setDescription('Muestra dónde estoy, qué leo y con qué voz'));

class VoiceError extends Error {
  // code: 'timeout' | 'busy'
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clamp(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

// los ajustes del panel (Voz) con sus valores por defecto: funciona sin haber tocado nada
function settingsFor(config) {
  const raw = config?.voiceChat || {};
  return {
    enabled: raw.enabled !== false,
    defaultVoice: ttsProviders.findVoice(raw.defaultVoice) ? raw.defaultVoice : ttsProviders.DEFAULT_VOICE,
    ttsChannelId: raw.ttsChannelId || null,
    announceNames: raw.announceNames !== false,
    maxChars: clamp(raw.maxChars, 40, 300, 200),
    cooldownMs: clamp(raw.cooldownSeconds, 0, 60, 4) * 1000,
    autoLeaveMs: clamp(raw.autoLeaveMinutes, 0, 120, 5) * 60000,
    allowedRoleIds: Array.isArray(raw.allowedRoleIds) ? raw.allowedRoleIds : [],
  };
}

function canUse(member, settings) {
  if (!settings.allowedRoleIds.length) return true;
  if (member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return settings.allowedRoleIds.some((id) => member?.roles?.cache?.has(id));
}

function humansIn(channel) {
  return channel?.members ? channel.members.filter((member) => !member.user.bot) : new Map();
}

// por que el bot no puede entrar a ese canal (o null si puede)
function joinProblem(channel, guild) {
  const me = guild.members?.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions) return 'No pude revisar mis permisos en ese canal.';
  if (!permissions.has(PermissionFlagsBits.ViewChannel)) return 'No puedo ver ese canal de voz.';
  if (!permissions.has(PermissionFlagsBits.Connect)) return 'No tengo el permiso «Conectar» en ese canal de voz.';
  if (!permissions.has(PermissionFlagsBits.Speak)) return 'No tengo el permiso «Hablar» en ese canal de voz.';
  if (channel.full && !permissions.has(PermissionFlagsBits.ManageChannels)) return 'Ese canal de voz está lleno.';
  return null;
}

// un nombre que se pueda leer: "𝕸𝖞𝖙𝖍𝖎𝖈" -> "Mythic", sin emojis ni adornos
function speakableName(name) {
  const plain = prepareSpeech(String(name || '').normalize('NFKC'), { maxChars: 24 }).text;
  return plain || 'alguien';
}

function create({ client, db, aiHelper, voice: voiceOverride = null, synthesize = ttsProviders.synthesize, logger = console, now = Date.now, timings = {} }) {
  const voice = new Proxy({}, { get: (target, property) => (voiceOverride || loadVoice())[property] });
  // los tiempos se pueden acortar en las pruebas
  const timing = { join: JOIN_TIMEOUT_MS, reconnect: RECONNECT_WAIT_MS, alone: ALONE_LEAVE_MS, ...timings };
  const sessions = new Map();
  const joining = new Map();
  const lastSpoke = new Map(); // `${guildId}:${userId}` -> cuando hablo por ultima vez (para la pausa entre mensajes)
  const prefCache = new Map(); // `${guildId}:${userId}` -> { voice, at }

  async function voiceFor(guildId, userId, settings) {
    const key = `${guildId}:${userId}`;
    const cached = prefCache.get(key);
    if (cached && now() - cached.at < PREF_CACHE_MS) return cached.voice || settings.defaultVoice;
    let chosen = null;
    try {
      chosen = (await db.getVoicePref(guildId, userId))?.voice || null;
    } catch (err) {
      logger.warn?.('No se pudo leer la voz elegida:', err.message);
    }
    if (!ttsProviders.findVoice(chosen)) chosen = null;
    prefCache.set(key, { voice: chosen, at: now() });
    return chosen || settings.defaultVoice;
  }

  function notify(session, text, { throttle = false } = {}) {
    if (!session.textChannelId) return;
    if (throttle) {
      if (now() - session.lastNoticeAt < ERROR_NOTICE_MS) return;
      session.lastNoticeAt = now();
    }
    const channel = client.channels.cache.get(session.textChannelId);
    channel?.send?.({ content: text, allowedMentions: NO_MENTIONS }).catch(() => {});
  }

  function clearTimers(session) {
    clearTimeout(session.idleTimer);
    clearTimeout(session.aloneTimer);
    session.idleTimer = null;
    session.aloneTimer = null;
  }

  function destroySession(guildId) {
    const session = sessions.get(guildId);
    if (!session) return false;
    sessions.delete(guildId);
    clearTimers(session);
    session.queue.length = 0;
    try {
      session.player.stop(true);
    } catch {
      // ya estaba detenido
    }
    try {
      if (session.connection.state?.status !== voice.VoiceConnectionStatus.Destroyed) session.connection.destroy();
    } catch {
      // la conexion ya estaba destruida
    }
    return true;
  }

  // la sesion sigue viva mientras haya actividad; sin ella, se va sola
  function touch(session) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
    if (!(session.idleMs > 0)) return;
    session.idleTimer = setTimeout(() => {
      if (sessions.get(session.guildId) !== session) return;
      if (session.queue.length || session.draining) return touch(session);
      notify(session, '🔇 Me fui del canal de voz por inactividad. Usa /voz unir para llamarme de nuevo.');
      destroySession(session.guildId);
      return undefined;
    }, session.idleMs);
    session.idleTimer.unref?.();
  }

  // si todos los humanos se fueron del canal, se espera un rato y se sale
  function checkAlone(session) {
    const channel = client.channels.cache.get(session.channelId);
    const alone = humansIn(channel).size === 0;
    if (!alone) {
      clearTimeout(session.aloneTimer);
      session.aloneTimer = null;
      return;
    }
    if (session.aloneTimer) return;
    session.aloneTimer = setTimeout(() => {
      session.aloneTimer = null;
      if (sessions.get(session.guildId) !== session) return;
      if (humansIn(client.channels.cache.get(session.channelId)).size > 0) return;
      notify(session, '👋 Me fui del canal de voz porque me quedé solo.');
      destroySession(session.guildId);
    }, timing.alone);
    session.aloneTimer.unref?.();
  }

  // reproduce un audio y espera a que termine (o a que falle)
  function play(session, pcm, durationMs) {
    return new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        session.player.off('stateChange', onChange);
        session.player.off('error', finish);
        resolve();
      };
      const onChange = (oldState, newState) => {
        if (newState.status === voice.AudioPlayerStatus.Idle) finish();
      };
      session.player.on('stateChange', onChange);
      session.player.on('error', finish);
      timer = setTimeout(finish, durationMs + PLAY_SAFETY_MS);
      try {
        session.player.play(voice.createAudioResource(Readable.from([pcm]), { inputType: voice.StreamType.Raw }));
      } catch (err) {
        logger.warn?.('No se pudo reproducir el audio:', err.message);
        finish();
      }
    });
  }

  async function drain(session) {
    if (session.draining) return;
    session.draining = true;
    try {
      while (session.queue.length && sessions.get(session.guildId) === session) {
        const item = session.queue.shift();
        try {
          const audio = await synthesize(item.text, { voice: item.voice, groqKey: item.groqKey });
          if (sessions.get(session.guildId) !== session) return;
          await play(session, audio.pcm, audio.durationMs);
        } catch (err) {
          logger.warn?.('No se pudo generar la voz:', err.message);
          notify(session, err.code === 'busy' ? '⏳ El servicio de voz está ocupado ahora mismo; se me saltó un mensaje.' : '⚠️ No pude generar la voz para un mensaje.', { throttle: true });
        }
      }
    } finally {
      session.draining = false;
      if (sessions.get(session.guildId) === session) touch(session);
    }
  }

  // false si la cola esta llena
  function enqueue(session, item) {
    if (session.queue.length >= MAX_QUEUE) return false;
    session.queue.push(item);
    touch(session);
    drain(session).catch((err) => logger.warn?.('Error en la cola de voz:', err.message));
    return true;
  }

  async function join(guild, channel, { textChannelId = null, reading = true, idleMs = 0 } = {}) {
    const existing = sessions.get(guild.id);
    if (existing && existing.channelId === channel.id) {
      if (textChannelId) existing.textChannelId = textChannelId;
      if (typeof reading === 'boolean') existing.reading = reading;
      existing.idleMs = idleMs;
      touch(existing);
      return { session: existing, created: false };
    }
    if (joining.has(guild.id)) throw new VoiceError('busy', 'Ya me estoy uniendo a un canal de voz');

    const attempt = (async () => {
      if (existing) destroySession(guild.id);
      const connection = voice.joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
      try {
        await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, timing.join);
      } catch {
        try {
          connection.destroy();
        } catch {
          // ya estaba destruida
        }
        throw new VoiceError('timeout', 'No pude conectarme al canal de voz a tiempo');
      }
      const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause } });
      connection.subscribe(player);
      const session = { guildId: guild.id, channelId: channel.id, textChannelId, reading, idleMs, connection, player, queue: [], draining: false, lastSpeakerId: null, lastSpokeAt: 0, idleTimer: null, aloneTimer: null, lastNoticeAt: 0 };
      sessions.set(guild.id, session);

      // si Discord mueve o corta la conexion se espera unos segundos a que se reconecte sola; si no, se cierra la sesion
      connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, timing.reconnect), voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, timing.reconnect)]);
        } catch {
          if (sessions.get(guild.id) === session) destroySession(guild.id);
        }
      });
      connection.on(voice.VoiceConnectionStatus.Destroyed, () => {
        if (sessions.get(guild.id) === session) destroySession(guild.id);
      });
      player.on('error', (err) => logger.warn?.('Error del reproductor de voz:', err.message));
      touch(session);
      checkAlone(session);
      return { session, created: true };
    })();

    joining.set(guild.id, attempt);
    try {
      return await attempt;
    } finally {
      joining.delete(guild.id);
    }
  }

  function cooldownLeft(guildId, userId, settings) {
    const last = lastSpoke.get(`${guildId}:${userId}`) || 0;
    return Math.max(0, settings.cooldownMs - (now() - last));
  }

  function speechOptions(guild, config, settings) {
    return {
      resolveUser: (id) => speakableName(guild.members?.cache?.get(id)?.displayName || client.users?.cache?.get(id)?.username),
      resolveRole: (id) => guild.roles?.cache?.get(id)?.name,
      resolveChannel: (id) => guild.channels?.cache?.get(id)?.name,
      bannedWords: config?.automod?.bannedWords || [],
      maxChars: settings.maxChars,
    };
  }

  // ---------------------------------------------------------------- /voz

  async function unir(interaction, config, settings) {
    const guild = interaction.guild;
    const requested = interaction.options.getChannel('canal');
    const channel = requested || interaction.member.voice?.channel;
    if (!channel) return interaction.reply({ content: '🎙️ Primero entra a un canal de voz (o elige uno con la opción «canal»).', ephemeral: true });
    if (channel.type !== ChannelType.GuildVoice) return interaction.reply({ content: '🎙️ Solo puedo entrar a canales de voz normales, no a escenarios.', ephemeral: true });
    if (requested && !channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.Connect)) return interaction.reply({ content: '🔒 No tienes acceso a ese canal de voz.', ephemeral: true });
    const problem = joinProblem(channel, guild);
    if (problem) return interaction.reply({ content: `⚠️ ${problem}`, ephemeral: true });

    // no se saca al bot de donde otras personas lo estan usando
    const existing = sessions.get(guild.id);
    if (existing && existing.channelId !== channel.id) {
      const current = guild.channels.cache.get(existing.channelId);
      const busy = humansIn(current).size > 0 && !interaction.member.permissions?.has(PermissionFlagsBits.MoveMembers);
      if (busy) return interaction.reply({ content: `🎙️ Ya estoy en <#${existing.channelId}> con otras personas. Cuando terminen usen /voz salir.`, ephemeral: true, allowedMentions: NO_MENTIONS });
    }

    await interaction.deferReply();
    const reading = interaction.options.getBoolean('leer_chat') !== false;
    try {
      const { created } = await join(guild, channel, { textChannelId: interaction.channelId, reading, idleMs: settings.autoLeaveMs });
      const lines = [`🔊 ${created ? 'Me uní a' : 'Ya estaba en'} <#${channel.id}>.`];
      if (reading) lines.push(`Leeré en voz alta lo que escriban en <#${interaction.channelId}> quienes estén en ese canal de voz.`);
      lines.push('Usa /voz decir para que hable, /voz mi-voz para elegir tu voz y /voz salir para que me vaya.');
      return interaction.editReply({ content: lines.join(' '), allowedMentions: NO_MENTIONS });
    } catch (err) {
      logger.warn?.('No se pudo unir al canal de voz:', err.message);
      return interaction.editReply(err.code === 'busy' ? '⏳ Ya me estoy uniendo a un canal de voz, espera un momento.' : '⚠️ No pude conectarme a ese canal de voz. Revisa mis permisos e inténtalo de nuevo.');
    }
  }

  async function salir(interaction) {
    const session = sessions.get(interaction.guild.id);
    if (!session) return interaction.reply({ content: '🔇 No estoy en ningún canal de voz.', ephemeral: true });
    const inChannel = interaction.member.voice?.channelId === session.channelId;
    const staff = interaction.member.permissions?.has(PermissionFlagsBits.MoveMembers) || interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (!inChannel && !staff) return interaction.reply({ content: `🔒 Tienes que estar en <#${session.channelId}> (o ser del staff) para sacarme.`, ephemeral: true, allowedMentions: NO_MENTIONS });
    destroySession(interaction.guild.id);
    return interaction.reply({ content: `👋 Salí de <#${session.channelId}>.`, allowedMentions: NO_MENTIONS });
  }

  async function decir(interaction, config, settings) {
    const guild = interaction.guild;
    const memberChannel = interaction.member.voice?.channel;
    let session = sessions.get(guild.id);
    if (session && interaction.member.voice?.channelId !== session.channelId) return interaction.reply({ content: `🎙️ Tienes que estar en <#${session.channelId}> para hacerme hablar.`, ephemeral: true, allowedMentions: NO_MENTIONS });
    if (!session && !memberChannel) return interaction.reply({ content: '🎙️ Entra a un canal de voz primero.', ephemeral: true });

    const wait = cooldownLeft(guild.id, interaction.user.id, settings);
    if (wait > 0) return interaction.reply({ content: `⏳ Espera ${Math.ceil(wait / 1000)} s antes de hacerme hablar de nuevo.`, ephemeral: true });

    const prepared = prepareSpeech(interaction.options.getString('texto', true), speechOptions(guild, config, settings));
    if (prepared.skipped) {
      const reasons = { banned: '🚫 Ese texto tiene palabras que no se pueden leer en este servidor.', invite: '🚫 No leo invitaciones a otros servidores.', empty: '🎙️ No hay nada que decir ahí (solo emojis, signos o enlaces).' };
      return interaction.reply({ content: reasons[prepared.skipped], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    if (!session) {
      const problem = joinProblem(memberChannel, guild);
      if (problem) return interaction.editReply(`⚠️ ${problem}`);
      try {
        ({ session } = await join(guild, memberChannel, { textChannelId: interaction.channelId, reading: false, idleMs: settings.autoLeaveMs }));
      } catch (err) {
        logger.warn?.('No se pudo unir al canal de voz:', err.message);
        return interaction.editReply('⚠️ No pude conectarme a tu canal de voz. Revisa mis permisos e inténtalo de nuevo.');
      }
    }

    const chosen = interaction.options.getString('voz') || (await voiceFor(guild.id, interaction.user.id, settings));
    lastSpoke.set(`${guild.id}:${interaction.user.id}`, now());
    const queued = enqueue(session, { text: prepared.text, voice: chosen, groqKey: aiHelper?.resolveApiKey?.(config) || null });
    if (!queued) return interaction.editReply('⏳ Hay demasiados mensajes en la cola. Espera a que termine de hablar.');
    return interaction.editReply({ content: `🗣️ Lo digo en <#${session.channelId}> con la voz «${ttsProviders.voiceLabel(chosen)}».`, allowedMentions: NO_MENTIONS });
  }

  async function miVoz(interaction, config, settings) {
    const choice = interaction.options.getString('voz', true);
    const voiceInfo = ttsProviders.findVoice(choice);
    if (!voiceInfo) return interaction.reply({ content: '⚠️ Esa voz no existe.', ephemeral: true });
    await db.setVoicePref(interaction.guild.id, interaction.user.id, choice);
    prefCache.set(`${interaction.guild.id}:${interaction.user.id}`, { voice: choice, at: now() });
    const needsKey = voiceInfo.provider === 'orpheus' && !aiHelper?.resolveApiKey?.(config);
    const note = needsKey ? ' Ojo: las voces HD usan la clave de Groq de la IA, que este servidor no tiene configurada; mientras tanto leeré con la voz de Google en inglés.' : '';
    return interaction.reply({ content: `✅ Tu voz ahora es «${voiceInfo.label}». La uso cuando el bot lee tus mensajes y en /voz decir.${note}`, ephemeral: true });
  }

  async function parar(interaction) {
    const session = sessions.get(interaction.guild.id);
    if (!session) return interaction.reply({ content: '🔇 No estoy hablando en ningún canal de voz.', ephemeral: true });
    if (interaction.member.voice?.channelId !== session.channelId && !interaction.member.permissions?.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({ content: `🔒 Tienes que estar en <#${session.channelId}> para callarme.`, ephemeral: true, allowedMentions: NO_MENTIONS });
    }
    const pending = session.queue.length;
    session.queue.length = 0;
    session.player.stop(true);
    return interaction.reply({ content: `🔇 Me callé${pending ? ` y borré ${pending} mensaje(s) de la cola` : ''}.`, allowedMentions: NO_MENTIONS });
  }

  async function estado(interaction, config, settings) {
    const session = sessions.get(interaction.guild.id);
    if (!session) return interaction.reply({ content: `🔇 No estoy en ningún canal de voz. Usa /voz unir estando en uno. Voz por defecto: «${ttsProviders.voiceLabel(settings.defaultVoice)}».`, ephemeral: true });
    const mine = await voiceFor(interaction.guild.id, interaction.user.id, settings);
    const lines = [
      `🔊 Estoy en <#${session.channelId}>.`,
      session.reading && session.textChannelId ? `Leo el chat de <#${session.textChannelId}> (solo de quienes están en el canal de voz).` : 'No estoy leyendo ningún chat (solo hablo con /voz decir).',
      `En cola: ${session.queue.length}${session.draining ? ' (hablando ahora)' : ''}.`,
      `Tu voz: «${ttsProviders.voiceLabel(mine)}». Voz por defecto del servidor: «${ttsProviders.voiceLabel(settings.defaultVoice)}».`,
      session.idleMs ? `Me voy solo tras ${Math.round(session.idleMs / 60000)} min sin hablar.` : 'No me voy solo por inactividad.',
    ];
    return interaction.reply({ content: lines.join('\n'), ephemeral: true, allowedMentions: NO_MENTIONS });
  }

  async function handleVozCommand(interaction, config) {
    const settings = settingsFor(config);
    if (!settings.enabled) return interaction.reply({ content: '🔇 Las funciones de voz están apagadas en este servidor. Un admin puede activarlas en el panel (página Voz).', ephemeral: true });
    if (!canUse(interaction.member, settings)) return interaction.reply({ content: '🔒 No tienes permiso para usar los comandos de voz en este servidor.', ephemeral: true });
    switch (interaction.options.getSubcommand()) {
      case 'unir':
        return unir(interaction, config, settings);
      case 'salir':
        return salir(interaction);
      case 'decir':
        return decir(interaction, config, settings);
      case 'mi-voz':
        return miVoz(interaction, config, settings);
      case 'parar':
        return parar(interaction);
      case 'estado':
        return estado(interaction, config, settings);
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------- lectura del chat

  // devuelve true si el mensaje se puso en la cola para leerlo
  async function handleMessage(message, config) {
    if (message.author?.bot || !message.guild || !message.content) return false;
    const settings = settingsFor(config);
    if (!settings.enabled) return false;
    const session = sessions.get(message.guild.id);
    if (!session) return false;
    const inSessionChat = session.reading && message.channel.id === session.textChannelId;
    const inFixedChat = settings.ttsChannelId && message.channel.id === settings.ttsChannelId;
    if (!inSessionChat && !inFixedChat) return false;

    const member = message.member;
    if (!member || member.voice?.channelId !== session.channelId) return false; // solo se lee a quienes estan en el canal de voz
    if (member.voice?.serverMute || member.isCommunicationDisabled?.()) return false;
    if (!canUse(member, settings)) return false;
    const content = message.content.trim();
    if (/^[/!.]/.test(content) || content.startsWith(config?.textCommands?.prefix || '!')) return false; // son comandos, no charla
    if (cooldownLeft(message.guild.id, message.author.id, settings) > 0) return false;

    const prepared = prepareSpeech(content, speechOptions(message.guild, config, settings));
    if (prepared.skipped) return false;

    let text = prepared.text;
    const changedSpeaker = session.lastSpeakerId !== message.author.id || now() - session.lastSpokeAt > ANNOUNCE_AGAIN_MS;
    if (settings.announceNames && changedSpeaker) text = `${speakableName(member.displayName)} dice: ${text}`;

    const chosen = await voiceFor(message.guild.id, message.author.id, settings);
    const queued = enqueue(session, { text, voice: chosen, groqKey: aiHelper?.resolveApiKey?.(config) || null });
    if (!queued) return false;
    session.lastSpeakerId = message.author.id;
    session.lastSpokeAt = now();
    lastSpoke.set(`${message.guild.id}:${message.author.id}`, now());
    return true;
  }

  // ---------------------------------------------------------------- estados de voz del servidor

  function handleVoiceState(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const session = sessions.get(guild.id);
    if (!session) return;
    if (newState.id === client.user?.id) {
      // al bot lo sacaron del canal (o lo movieron) desde Discord
      if (!newState.channelId) destroySession(guild.id);
      else if (newState.channelId !== session.channelId) session.channelId = newState.channelId;
      return;
    }
    if (oldState.channelId === session.channelId || newState.channelId === session.channelId) checkAlone(session);
  }

  function destroyAll() {
    for (const guildId of [...sessions.keys()]) destroySession(guildId);
  }

  return { handleVozCommand, handleMessage, handleVoiceState, destroyAll, sessions, join, enqueue };
}

module.exports = { definition, create, settingsFor, joinProblem, speakableName, VoiceError, MAX_QUEUE };
