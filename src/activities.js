// /actividad: inicia una actividad de Discord (juegos y videos que se juegan dentro de un canal de voz), como el bot "Activities".
// Funciona creando una invitacion al canal de voz dirigida a la aplicacion de la actividad (target_type 2 = aplicacion
// incrustada): quien la abre entra directo a la actividad. Los IDs son de las actividades de Discord; si alguna deja de
// existir, Discord rechaza la invitacion y se avisa con un mensaje claro.

const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, InviteTargetType } = require('discord.js');

// verificadas contra la API de Discord el 2026-10-31 (todas crearon su invitacion)
const ACTIVITIES = [
  { id: 'youtube', name: 'Watch Together', applicationId: '880218394199220334', description: 'Miren videos de YouTube juntos, sincronizados' },
  { id: 'ajedrez', name: 'Chess In The Park', applicationId: '832012774040141894', description: 'Ajedrez 1 contra 1, con espectadores' },
  { id: 'damas', name: 'Checkers In The Park', applicationId: '832013003968348200', description: 'Damas 1 contra 1' },
  { id: 'poker', name: 'Poker Night', applicationId: '755827207812677713', description: 'Póker para varios jugadores' },
  { id: 'blazing8s', name: 'Blazing 8s', applicationId: '832025144389533716', description: 'Juego de cartas tipo UNO' },
  { id: 'letter-league', name: 'Letter League', applicationId: '879863686565621790', description: 'Juego de palabras por turnos con fichas de letras' },
  { id: 'sketch-heads', name: 'Sketch Heads', applicationId: '902271654783242291', description: 'Dibuja y adivina lo que dibujan' },
  { id: 'spellcast', name: 'SpellCast', applicationId: '852509694341283871', description: 'Busca palabras en una cuadrícula mágica' },
  { id: 'land-io', name: 'Land-io', applicationId: '903769130790969345', description: 'Rodea territorio y evita las estelas rivales' },
  { id: 'bobble-league', name: 'Bobble League', applicationId: '947957217959759964', description: 'Fútbol arcade con chapas' },
  { id: 'ask-away', name: 'Ask Away', applicationId: '976052223358406656', description: 'Preguntas para romper el hielo' },
  { id: 'bash-out', name: 'Bash Out', applicationId: '1006584476094177371', description: 'Minijuegos multijugador caóticos' },
  { id: 'chef-showdown', name: 'Chef Showdown', applicationId: '1037680572660727838', description: 'Cocinen contra el reloj entre amigos' },
  { id: 'fishington', name: 'Fishington.io', applicationId: '814288819477020702', description: 'Pesca con amigos' },
  { id: 'betrayal', name: 'Betrayal.io', applicationId: '773336526917861400', description: 'Deducción social: encuentra al traidor' },
];

const INVITE_MAX_AGE_SECONDS = 2 * 60 * 60;
const COOLDOWN_MS = 15 * 1000;
const GUILD_HOURLY_LIMIT = 30;
const CUSTOM_ID = /^\d{17,20}$/;

const definition = new SlashCommandBuilder()
  .setName('actividad')
  .setDescription('Inicia una actividad de Discord (juegos y videos) en un canal de voz')
  .addStringOption((opt) => opt.setName('actividad').setDescription('Cuál actividad (también puedes pegar el ID de una aplicación)').setRequired(true).setAutocomplete(true))
  .addChannelOption((opt) => opt.setName('canal').setDescription('Canal de voz (por defecto, el tuyo)').addChannelTypes(ChannelType.GuildVoice));

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// una actividad por su clave ("ajedrez"), su nombre ("Chess In The Park") o el ID de su aplicacion
function findActivity(query) {
  const text = String(query || '').trim();
  if (!text) return null;
  const wanted = normalize(text);
  const known = ACTIVITIES.find((activity) => activity.id === wanted || normalize(activity.name) === wanted || activity.applicationId === text);
  if (known) return known;
  if (CUSTOM_ID.test(text)) return { id: text, name: 'Actividad personalizada', applicationId: text, description: 'Aplicación con ID ' + text, custom: true };
  return null;
}

function create({ now = Date.now, logger = console } = {}) {
  const lastUse = new Map(); // `${guildId}:${userId}` -> cuando
  const guildUses = new Map(); // guildId -> [instantes de la ultima hora]

  async function handleAutocomplete(interaction) {
    const typed = normalize(interaction.options.getFocused());
    const matches = ACTIVITIES.filter((activity) => !typed || normalize(`${activity.name} ${activity.id} ${activity.description}`).includes(typed)).slice(0, 25);
    await interaction.respond(matches.map((activity) => ({ name: `${activity.name} — ${activity.description}`.slice(0, 100), value: activity.id })));
  }

  function underGuildLimit(guildId) {
    const recent = (guildUses.get(guildId) || []).filter((at) => now() - at < 60 * 60 * 1000);
    if (recent.length >= GUILD_HOURLY_LIMIT) {
      guildUses.set(guildId, recent);
      return false;
    }
    recent.push(now());
    guildUses.set(guildId, recent);
    return true;
  }

  async function handleActividadCommand(interaction, config) {
    const activity = findActivity(interaction.options.getString('actividad', true));
    if (!activity) return interaction.reply({ content: '🎮 No conozco esa actividad. Escribe /actividad y elige una de la lista (o pega el ID de una aplicación).', ephemeral: true });

    const requested = interaction.options.getChannel('canal');
    const channel = requested || interaction.member.voice?.channel;
    if (!channel) return interaction.reply({ content: '🎙️ Entra a un canal de voz primero (o elige uno con la opción «canal»).', ephemeral: true });
    if (channel.type !== ChannelType.GuildVoice) return interaction.reply({ content: '🎙️ Las actividades solo se pueden iniciar en canales de voz normales.', ephemeral: true });

    // la persona necesita poder ver, entrar y usar actividades en ese canal; el bot, crear invitaciones
    const permissions = channel.permissionsFor(interaction.member);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) return interaction.reply({ content: '🔒 No tienes acceso a ese canal de voz.', ephemeral: true });
    if (!permissions.has(PermissionFlagsBits.UseEmbeddedActivities)) return interaction.reply({ content: '🔒 No tienes el permiso «Usar actividades» en ese canal de voz.', ephemeral: true });
    const me = interaction.guild.members?.me;
    if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite)) return interaction.reply({ content: '⚠️ No tengo el permiso «Crear invitación» en ese canal de voz.', ephemeral: true });

    const key = `${interaction.guild.id}:${interaction.user.id}`;
    const wait = COOLDOWN_MS - (now() - (lastUse.get(key) || 0));
    if (wait > 0) return interaction.reply({ content: `⏳ Espera ${Math.ceil(wait / 1000)} s antes de iniciar otra actividad.`, ephemeral: true });
    if (!underGuildLimit(interaction.guild.id)) return interaction.reply({ content: '⏳ Se iniciaron demasiadas actividades en la última hora en este servidor. Prueba más tarde.', ephemeral: true });

    await interaction.deferReply();
    try {
      const invite = await channel.createInvite({
        maxAge: INVITE_MAX_AGE_SECONDS,
        maxUses: 0,
        unique: true,
        targetType: InviteTargetType.EmbeddedApplication,
        targetApplication: activity.applicationId,
        reason: `/actividad ${activity.name} por ${interaction.user.username}`,
      });
      lastUse.set(key, now());
      const url = invite.url || `https://discord.gg/${invite.code}`;
      const button = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Unirse a ${activity.name}`.slice(0, 80)).setURL(url));
      return interaction.editReply({
        content: `🎮 **${activity.name}** en <#${channel.id}> — ${activity.description}.\nÁbrela con el botón (tienes que estar en ese canal de voz para jugar con los demás).`,
        components: [button],
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      logger.warn?.('No se pudo iniciar la actividad:', err.message);
      // 50013 = sin permisos; 50035 / 10002 / 10006 = Discord no reconoce esa aplicacion como actividad
      if (err.code === 50013) return interaction.editReply('⚠️ No tengo el permiso «Crear invitación» en ese canal de voz.');
      if ([50035, 10002, 10006].includes(err.code)) return interaction.editReply(activity.custom ? '⚠️ Discord no reconoce ese ID como una actividad (revisa el ID o prueba con otra).' : `⚠️ Discord ya no deja iniciar **${activity.name}** (la quitaron o está en mantenimiento). Prueba con otra.`);
      return interaction.editReply('⚠️ No pude iniciar la actividad ahora. Prueba de nuevo en un momento.');
    }
  }

  return { handleActividadCommand, handleAutocomplete };
}

module.exports = { definition, create, ACTIVITIES, findActivity };
