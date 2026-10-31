const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const crypto = require('crypto');
const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { securityHeaders, sameOriginGuard, createRateLimiter } = require('./security');
const welcomeCard = require('../welcomeCard');
const alerts = require('../alerts');
const richMessage = require('../richMessage');
const { RICH_TEMPLATES } = require('../richTemplates');
const {
  buildAuthorizeUrl,
  buildBotInviteUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  fetchUserGuilds,
  hasManagePermission,
} = require('./discordOAuth');
const views = require('./views');
const db = require('../db');
const reactionRoles = require('../reactionRoles');
const selectRoles = require('../selectRoles');
const customCommands = require('../customCommands');
const housesCommand = require('../housesCommand');
const ticketCommand = require('../ticketCommand');
const aiHelper = require('../aiHelper');
const serverGuide = require('../serverGuide');
const emojiPicker = require('../emojiPicker');
const { normalizeEmoji } = require('../emojiUtil');
const debugCommand = require('../debugCommand');
const inviteTracker = require('../inviteTracker');
const { resolveColor } = require('../embedStyle');
const pkg = require('../../package.json');

// View/Send/History/ManageMessages/ManageChannels/EmbedLinks/AddReactions/Kick/Ban/ManageRoles/ModerateMembers/ManageGuild/ManageNicknames
const BOT_INVITE_PERMISSIONS = 1099914374262;

// hash+salt para la contraseña de la pagina Estado/Debug (nunca se guarda en
// texto plano). scrypt es parte de node, no hace falta agregar una dependencia
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  if (!expectedHash) return false;
  const actualHash = hashPassword(password, salt);
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// lo que se escribe o se elige en un campo de emoji del panel: vacio, un emoji valido (ya normalizado) o algo
// que no lo es. Un emoji invalido en un boton, menu o reaccion hace que Discord rechace el mensaje entero
function readEmoji(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: '' };
  const value = normalizeEmoji(text);
  return value ? { value } : { invalid: text };
}

const invalidEmojiMessage = (text) => `«${String(text).slice(0, 20)}» no es un emoji válido: elígelo con el selector del panel o pega un emoji de verdad.`;

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// cada cuanto se vuelve a preguntarle a Discord si quien usa el panel todavia
// tiene "Gestionar servidor" (la lista de servers se guarda en la sesion al
// iniciar sesion y, sin esto, un permiso quitado seguiria valiendo semanas)
const PERMISSION_RECHECK_MS = 5 * 60 * 1000;

function createApp({ client }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(sameOriginGuard(process.env.DASHBOARD_URL));
  // extended:false = sin objetos anidados en los formularios (a[$ne]=...): los
  // handlers esperan strings o arrays simples
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));

  const postLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 90 });
  const loginLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 40 });
  const previewLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40 });
  app.use((req, res, next) => (req.method === 'POST' ? postLimiter(req, res, next) : next()));
  app.use(['/login', '/auth/callback'], loginLimiter);

  let sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    // sin esto las cookies se firmarian con un valor conocido ('change-me'); con
    // un secreto al azar el panel funciona pero las sesiones no sobreviven a un reinicio
    console.warn('⚠️ Falta SESSION_SECRET: se usa un secreto temporal y las sesiones del panel se perderán al reiniciar.');
    sessionSecret = crypto.randomBytes(32).toString('hex');
  }

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true, // cada visita renueva los 30 dias, no vence mientras se siga usando
      store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME || 'discordTipsBot',
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 30, // 30 dias, tiene que coincidir con el maxAge de la cookie
      }),
      cookie: {
        // 'auto' = segura cuando la conexion es https (detras del proxy de Render
        // con trust proxy), sin depender de que NODE_ENV este bien puesto
        secure: 'auto',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  const oauthConfig = () => ({
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: `${process.env.DASHBOARD_URL}/auth/callback`,
  });

  // las rutas /dashboard/api/* las llama el JavaScript del panel (selector de emojis): si la sesion
  // venció o no hay server activo contestan un JSON con el error en vez de redirigir a otra pagina
  const isApiRequest = (req) => req.originalUrl.startsWith('/dashboard/api/');

  function requireAuth(req, res, next) {
    if (req.session.user) return next();
    if (isApiRequest(req)) return res.status(401).json({ error: 'session' });
    res.redirect('/login');
  }

  async function requireActiveGuild(req, res, next) {
    const guildId = req.session.activeGuildId;
    const manageable = req.session.manageableGuilds || [];
    const isManageable = manageable.some((g) => g.id === guildId);

    if (!guildId || !isManageable || !client.guilds.cache.has(guildId)) {
      return isApiRequest(req) ? res.status(401).json({ error: 'guild' }) : res.redirect('/servers');
    }

    // el dueño real del server (segun Discord) nunca queda bloqueado, para
    // no arriesgarse a un lockout por una lista de acceso mal configurada
    const guild = client.guilds.cache.get(guildId);
    if (req.session.user.id !== guild.ownerId) {
      const checkedAt = req.session.permissionCheckedAt?.[guildId] || 0;
      if (Date.now() - checkedAt > PERMISSION_RECHECK_MS) {
        const member = await guild.members.fetch(req.session.user.id).catch(() => null);
        const stillManages =
          member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator));
        if (!stillManages) {
          req.session.manageableGuilds = manageable.filter((g) => g.id !== guildId);
          req.session.activeGuildId = null;
          return req.session.save(() => (isApiRequest(req) ? res.status(401).json({ error: 'guild' }) : res.redirect('/servers')));
        }
        req.session.permissionCheckedAt = { ...(req.session.permissionCheckedAt || {}), [guildId]: Date.now() };
      }

      const config = await db.getGuildConfig(guildId);
      const access = config.dashboardAccess || {};
      const blockedIds = access.blockedUserIds || [];
      const allowedIds = access.allowedUserIds || [];
      const isBlocked = blockedIds.includes(req.session.user.id);
      const hasAllowlist = allowedIds.length > 0;
      const isAllowed = !hasAllowlist || allowedIds.includes(req.session.user.id);

      if (isBlocked || !isAllowed) {
        if (isApiRequest(req)) return res.status(403).json({ error: 'forbidden' });
        return res.status(403).send(views.accessDeniedPage({ user: req.session.user, guildName: guild.name }));
      }
    }

    next();
  }

  function getGuild(req) {
    return client.guilds.cache.get(req.session.activeGuildId);
  }

  function getTextChannels(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getVoiceChannels(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildVoice)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getCategoryChannels(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getAssignableRoles(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .map((r) => ({ id: r.id, name: r.name, emoji: r.unicodeEmoji || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // best-effort: solo mira el cache de miembros ya cargado (no dispara un
  // fetch a la API por cada fila de un leaderboard), cae al ID si no esta
  function withDisplayNames(req, entries) {
    const guild = getGuild(req);
    return entries.map((entry) => ({
      ...entry,
      displayName: guild?.members.cache.get(entry.userId)?.user.username || null,
    }));
  }

  function guildName(req) {
    return getGuild(req)?.name || null;
  }

  app.get('/', (req, res) => {
    res.type('text/plain').send('Bot activo');
  });

  app.get('/terminos', (req, res) => {
    res.send(views.termsPage());
  });

  app.get('/privacidad', (req, res) => {
    res.send(views.privacyPage());
  });

  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/servers');

    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const { clientId, redirectUri } = oauthConfig();
    res.send(views.loginPage({ authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state }) }));
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return res
        .status(400)
        .send(views.loginPage({ authorizeUrl: '/login', error: 'Sesión inválida, intentá loguearte de nuevo.' }));
    }

    try {
      const { clientId, clientSecret, redirectUri } = oauthConfig();
      const token = await exchangeCodeForToken({ clientId, clientSecret, redirectUri, code });
      const [discordUser, guilds] = await Promise.all([
        fetchDiscordUser(token.access_token),
        fetchUserGuilds(token.access_token),
      ]);

      const manageableGuilds = guilds
        .filter((g) => hasManagePermission(g.permissions))
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));

      if (!manageableGuilds.length) {
        // se guarda el nuevo state en sesion para que el link de "intentar de
        // nuevo" funcione (si no, el proximo callback siempre lo rechaza)
        const retryState = crypto.randomBytes(16).toString('hex');
        req.session.oauthState = retryState;
        return res.status(403).send(
          views.loginPage({
            authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state: retryState }),
            error: 'Tu cuenta no tiene permiso de administrador en ningún server.',
          }),
        );
      }

      // se regenera el id de sesion despues de autenticar (evita session fixation:
      // un id de sesion fijado antes del login no queda autenticado despues)
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error('No se pudo regenerar la sesión tras el login:', regenErr);
          return res
            .status(500)
            .send(views.loginPage({ authorizeUrl: '/login', error: 'Ocurrió un error al iniciar sesión, probá de nuevo.' }));
        }

        req.session.user = { id: discordUser.id, username: discordUser.username, avatar: discordUser.avatar || null };
        req.session.accessToken = token.access_token;
        req.session.manageableGuilds = manageableGuilds;
        res.redirect('/servers');
      });
    } catch (err) {
      console.error('Error en OAuth callback:', err);
      res
        .status(500)
        .send(views.loginPage({ authorizeUrl: '/login', error: 'Ocurrió un error al iniciar sesión, probá de nuevo.' }));
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  app.get('/servers', requireAuth, (req, res) => {
    const manageable = req.session.manageableGuilds || [];
    const managed = [];
    const invitable = [];

    for (const g of manageable) {
      if (client.guilds.cache.has(g.id)) {
        managed.push(g);
      } else {
        invitable.push({
          ...g,
          inviteUrl: buildBotInviteUrl({ clientId: process.env.DISCORD_CLIENT_ID, permissions: BOT_INVITE_PERMISSIONS, guildId: g.id }),
        });
      }
    }

    res.send(views.serversPage({ user: req.session.user, managed, invitable }));
  });

  app.get('/servers/select/:guildId', requireAuth, (req, res) => {
    const { guildId } = req.params;
    const manageable = req.session.manageableGuilds || [];
    const allowed = manageable.some((g) => g.id === guildId) && client.guilds.cache.has(guildId);

    if (!allowed) return res.redirect('/servers');

    req.session.activeGuildId = guildId;
    res.redirect('/dashboard');
  });

  app.get('/servers/refresh', requireAuth, async (req, res) => {
    try {
      const guilds = await fetchUserGuilds(req.session.accessToken);
      req.session.manageableGuilds = guilds
        .filter((g) => hasManagePermission(g.permissions))
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
    } catch (err) {
      console.error('No se pudo refrescar la lista de servers:', err);
    }
    res.redirect('/servers');
  });

  // --- selector de emojis: lo usan todos los campos de emoji del panel (ver emojiPicker.client.js) ---
  const emojiInstallLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 15 });

  // el catalogo es el mismo para todos los servers: el navegador lo guarda una hora
  app.get('/dashboard/api/emoji-catalog', requireAuth, requireActiveGuild, (req, res) => {
    res.set('Cache-Control', 'private, max-age=3600').json(emojiPicker.catalogPayload());
  });

  // lo propio de ESTE server: sus emojis personalizados, los lugares libres y que pixeles ya estan instalados
  app.get('/dashboard/api/emojis', requireAuth, requireActiveGuild, (req, res) => {
    res.set('Cache-Control', 'no-store').json(emojiPicker.guildPayload(getGuild(req)));
  });

  // sube un emoji pixel al server (solo los del pack propio, por id, y solo si queda lugar)
  app.post('/dashboard/api/emojis/pixel/:id', requireAuth, requireActiveGuild, emojiInstallLimiter, async (req, res) => {
    const guild = getGuild(req);
    try {
      const result = await emojiPicker.installPixelEmoji(guild, req.params.id);
      res.json({ ok: true, created: result.created, emoji: result.emoji, capacity: emojiPicker.capacityFor(guild) });
    } catch (err) {
      if (err instanceof emojiPicker.InstallError) {
        const status = err.code === 'unknown' ? 404 : err.code === 'discord' ? 502 : 409;
        return res.status(status).json({ ok: false, code: err.code, error: err.message });
      }
      console.error('Error instalando un emoji píxel:', err);
      res.status(500).json({ ok: false, code: 'internal', error: 'No se pudo instalar el emoji.' });
    }
  });

  app.get('/dashboard', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(views.dashboardHomePage({ user: req.session.user, config, guildName: guildName(req) }));
  });

  app.get('/dashboard/general', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.generalPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/general', requireAuth, requireActiveGuild, async (req, res) => {
    const tipsExcludedChannelIds = Array.isArray(req.body.tipsExcludedChannelIds)
      ? req.body.tipsExcludedChannelIds
      : req.body.tipsExcludedChannelIds
        ? [req.body.tipsExcludedChannelIds]
        : [];
    await db.updateGuildConfig(req.session.activeGuildId, {
      language: req.body.language === 'en' ? 'en' : 'es',
      tipsIntervalMinutes: Math.max(1, Number(req.body.tipsIntervalMinutes) || 20),
      // solo vale un canal que exista de verdad en este server
      tipsChannelId: getTextChannels(req).find((c) => c.id === req.body.tipsChannelId)?.id || null,
      tipsExcludedChannelIds,
    });
    res.redirect('/dashboard/general?saved=1');
  });

  app.get('/dashboard/bienvenida', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.welcomePage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        richMessages: await db.listRichMessages(req.session.activeGuildId),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/bienvenida/welcome', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const imageUrl = (req.body.imageUrl || '').trim();
    await db.updateGuildConfig(req.session.activeGuildId, {
      welcome: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.welcome.message,
        useEmbed: req.body.useEmbed === 'on',
        roleId: req.body.roleId || null,
        botRoleId: req.body.botRoleId || null,
        // solo se acepta un diseño que exista de verdad en este server
        richMessageId: (await db.listRichMessages(req.session.activeGuildId)).some((m) => m.id === req.body.richMessageId)
          ? req.body.richMessageId
          : null,
        // la tarjeta tiene su propio formulario: se conserva lo ya guardado
        card: config.welcome.card,
        aiPersonalized: req.body.aiPersonalized === 'on',
        embedTitle: req.body.embedTitle || config.welcome.embedTitle,
        // solo se guarda si es una URL http(s) valida, para no dejar
        // guardado un valor que despues rompa el embed al mandarlo
        imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : null,
      },
    });
    res.redirect('/dashboard/bienvenida?saved=1');
  });

  app.post('/dashboard/bienvenida/goodbye', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      goodbye: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.goodbye.message,
        useEmbed: req.body.useEmbed === 'on',
        card: config.goodbye.card,
      },
    });
    res.redirect('/dashboard/bienvenida?saved=1');
  });

  // --- tarjetas de imagen de bienvenida / despedida ---

  const CARD_KINDS = {
    welcome: welcomeCard.DEFAULT_CARD,
    goodbye: welcomeCard.DEFAULT_GOODBYE_CARD,
  };

  function sampleAvatarUrl(user) {
    if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
    try {
      return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
    } catch {
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
  }

  // vista previa en vivo: el formulario arma esta URL con los valores actuales
  // y la imagen se renderiza con tus datos (usuario/server) como ejemplo
  app.get('/dashboard/bienvenida/card-preview.png', requireAuth, requireActiveGuild, previewLimiter, async (req, res) => {
    const defaults = CARD_KINDS[req.query.kind] || CARD_KINDS.welcome;
    try {
      const guild = getGuild(req);
      const buffer = await welcomeCard.generateWelcomeCard(
        req.query,
        {
          username: req.session.user.username,
          server: guild?.name || 'Tu Server',
          membercount: guild?.memberCount || 1,
          avatarURL: sampleAvatarUrl(req.session.user),
        },
        defaults,
      );
      res.set('Cache-Control', 'no-store').type('png').send(buffer);
    } catch (err) {
      console.error('No se pudo generar la vista previa de la tarjeta:', err);
      res.status(500).type('text/plain').send('No se pudo generar la vista previa');
    }
  });

  app.post('/dashboard/bienvenida/card', requireAuth, requireActiveGuild, async (req, res) => {
    const kind = req.body.kind === 'goodbye' ? 'goodbye' : 'welcome';
    const card = welcomeCard.sanitizeCardSettings({ ...req.body, enabled: req.body.enabled === 'on' }, CARD_KINDS[kind]);
    await db.updateGuildConfig(req.session.activeGuildId, { [`${kind}.card`]: card });
    res.redirect('/dashboard/bienvenida?saved=1');
  });

  // --- minijuegos y acciones sociales ---

  app.get('/dashboard/juegos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(views.gamesPage({ user: req.session.user, config, guildName: guildName(req), flash: req.query.saved ? 'Guardado.' : null }));
  });

  app.post('/dashboard/juegos', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      games: {
        enabled: req.body.enabled === 'on',
        rewardAmount: Math.max(0, Math.floor(Number(req.body.rewardAmount)) || 0),
        maxBet: Math.max(1, Math.floor(Number(req.body.maxBet)) || 500),
        rewardCooldownMinutes: Math.max(0, Math.floor(Number(req.body.rewardCooldownMinutes)) || 0),
      },
    });
    res.redirect('/dashboard/juegos?saved=1');
  });

  app.get('/dashboard/social', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(views.socialPage({ user: req.session.user, config, guildName: guildName(req), flash: req.query.saved ? 'Guardado.' : null }));
  });

  app.post('/dashboard/social', requireAuth, requireActiveGuild, async (req, res) => {
    const int = (value, fallback, min = 0, max = 1000000) => Math.min(max, Math.max(min, Math.floor(Number(value)) || fallback));
    await db.updateGuildConfig(req.session.activeGuildId, {
      social: {
        enabled: req.body.enabled === 'on',
        repEnabled: req.body.repEnabled === 'on',
        repCooldownHours: int(req.body.repCooldownHours, 12, 1, 720),
        robEnabled: req.body.robEnabled === 'on',
        robCooldownMinutes: int(req.body.robCooldownMinutes, 60, 1, 10080),
        robMaxAmount: int(req.body.robMaxAmount, 500, 1),
        robSuccessPercent: int(req.body.robSuccessPercent, 45, 1, 95),
        crimeEnabled: req.body.crimeEnabled === 'on',
        crimeCooldownMinutes: int(req.body.crimeCooldownMinutes, 120, 1, 10080),
        crimeMinAmount: int(req.body.crimeMinAmount, 50, 1),
        crimeMaxAmount: int(req.body.crimeMaxAmount, 250, 1),
        crimeSuccessPercent: int(req.body.crimeSuccessPercent, 50, 1, 95),
      },
    });
    res.redirect('/dashboard/social?saved=1');
  });

  // --- mensajes avanzados: tarjetas con texto, imagenes y botones con link ---

  function richPage(req, extra = {}) {
    return views.richMessagesPage({
      user: req.session.user,
      channels: getTextChannels(req),
      templates: RICH_TEMPLATES,
      guildName: guildName(req),
      ...extra,
    });
  }

  app.get('/dashboard/disenos', requireAuth, requireActiveGuild, async (req, res) => {
    const messages = await db.listRichMessages(req.session.activeGuildId);
    const editing = req.query.editar ? messages.find((m) => m.id === String(req.query.editar)) || null : null;
    const flashByState = { new: 'Mensaje publicado.', updated: 'Mensaje actualizado: se editó el que ya estaba publicado.' };
    res.send(
      richPage(req, {
        messages,
        editing,
        flash: req.query.published ? flashByState[req.query.published] || 'Listo.' : req.query.saved ? 'Guardado.' : null,
        error: req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/disenos/guardar', requireAuth, requireActiveGuild, async (req, res) => {
    const guildId = req.session.activeGuildId;
    const name = String(req.body.name || '').trim().slice(0, 60) || 'Mensaje sin nombre';
    const channelId = getTextChannels(req).find((c) => c.id === req.body.channelId)?.id || null;
    const messages = await db.listRichMessages(guildId);

    // si algo falla se vuelve a mostrar el editor con lo que ya habias escrito,
    // en vez de mandarte a una pagina vacia y perder el trabajo
    let parsed = null;
    try {
      parsed = JSON.parse(req.body.payload || '');
    } catch {
      parsed = null;
    }
    const fail = (error) =>
      res.status(400).send(
        richPage(req, {
          messages,
          editing: { id: String(req.body.id || ''), name, channelId, containers: parsed?.containers },
          error,
        }),
      );

    if (!parsed) return fail('No se pudo leer el diseño. Recarga la página e inténtalo de nuevo.');
    const checked = richMessage.sanitizeRichMessage(parsed);
    if (!checked.ok) return fail(checked.error);

    let id = String(req.body.id || '');
    if (!messages.some((m) => m.id === id)) {
      if (messages.length >= db.MAX_RICH_MESSAGES_PER_GUILD) {
        return fail(`Llegaste al máximo de ${db.MAX_RICH_MESSAGES_PER_GUILD} diseños guardados. Elimina alguno para crear otro.`);
      }
      id = crypto.randomBytes(5).toString('hex');
    }

    await db.saveRichMessage(guildId, { id, name, channelId, containers: checked.value.containers });
    return res.redirect(`/dashboard/disenos?editar=${id}&saved=1`);
  });

  app.post('/dashboard/disenos/publicar', requireAuth, requireActiveGuild, async (req, res) => {
    const guildId = req.session.activeGuildId;
    const id = String(req.body.id || '');
    const back = (query) => res.redirect(`/dashboard/disenos?editar=${encodeURIComponent(id)}&${query}`);
    const fail = (message) => back(`error=${encodeURIComponent(message)}`);

    const stored = await db.getRichMessage(guildId, id);
    if (!stored) return res.redirect('/dashboard/disenos?error=' + encodeURIComponent('Ese diseño ya no existe.'));

    const channelId = getTextChannels(req).find((c) => c.id === req.body.channelId)?.id;
    if (!channelId) return fail('Elige el canal donde publicar.');

    const guild = getGuild(req);
    try {
      const result = await richMessage.publishRichMessage(guild, stored, channelId, {
        server: guild.name,
        membercount: guild.memberCount,
        servericon: guild.iconURL({ extension: 'png', size: 256 }) || '',
      });
      await db.setRichMessagePublished(guildId, id, result.channelId, result.messageId);
      await db.saveRichMessage(guildId, { id, name: stored.name, channelId, containers: stored.containers });
      return back(`published=${result.updated ? 'updated' : 'new'}`);
    } catch (err) {
      console.error('No se pudo publicar el mensaje avanzado:', err);
      return fail(richMessage.describePublishError(err));
    }
  });

  app.post('/dashboard/disenos/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const guildId = req.session.activeGuildId;
    const id = String(req.body.id || '');
    await db.deleteRichMessage(guildId, id);
    // si la bienvenida usaba este diseño, se desvincula para que vuelva al mensaje normal
    const config = await db.getGuildConfig(guildId);
    if (config.welcome.richMessageId === id) await db.updateGuildConfig(guildId, { 'welcome.richMessageId': null });
    res.redirect('/dashboard/disenos?saved=1');
  });

  // --- alertas de YouTube / Twitch ---

  app.get('/dashboard/alertas', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.alertsPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        twitchReady: alerts.twitchConfigured(),
        maxItems: alerts.MAX_ITEMS_PER_GUILD,
        defaultMessages: alerts.DEFAULT_MESSAGES,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
        error: req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/alertas/config', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, { 'alerts.enabled': req.body.enabled === 'on' });
    res.redirect('/dashboard/alertas?saved=1');
  });

  app.post('/dashboard/alertas/agregar', requireAuth, requireActiveGuild, async (req, res) => {
    const guildId = req.session.activeGuildId;
    const fail = (message) => res.redirect(`/dashboard/alertas?error=${encodeURIComponent(message)}`);

    try {
      const config = await db.getGuildConfig(guildId);
      if (config.alerts.items.length >= alerts.MAX_ITEMS_PER_GUILD) {
        return fail(`Llegaste al máximo de ${alerts.MAX_ITEMS_PER_GUILD} alertas por servidor.`);
      }

      const platform = req.body.platform === 'twitch' ? 'twitch' : 'youtube';
      // el canal y el rol tienen que existir de verdad en ESTE server
      const channelId = getTextChannels(req).find((c) => c.id === req.body.channelId)?.id;
      if (!channelId) return fail('Elige un canal de texto válido para los avisos.');
      const roleId = getAssignableRoles(req).find((r) => r.id === req.body.roleId)?.id || null;

      const resolved =
        platform === 'twitch'
          ? await alerts.resolveTwitchChannel(req.body.target)
          : await alerts.resolveYoutubeChannel(req.body.target);

      if (config.alerts.items.some((i) => i.platform === platform && i.target === resolved.target && i.channelId === channelId)) {
        return fail('Ya tienes esa alerta en ese canal.');
      }

      await db.addAlertItem(guildId, {
        id: crypto.randomBytes(4).toString('hex'),
        platform,
        target: resolved.target,
        name: resolved.name,
        channelId,
        roleId,
        message: String(req.body.message || '').trim().slice(0, 400) || alerts.DEFAULT_MESSAGES[platform],
        seenIds: resolved.seenIds || [],
        lastStreamId: null,
        createdAt: new Date(),
      });
      return res.redirect('/dashboard/alertas?saved=1');
    } catch (err) {
      return fail(err.message || 'No se pudo agregar la alerta.');
    }
  });

  app.post('/dashboard/alertas/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    await db.removeAlertItem(req.session.activeGuildId, String(req.body.id || ''));
    res.redirect('/dashboard/alertas?saved=1');
  });

  app.post('/dashboard/alertas/probar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const item = config.alerts.items.find((i) => i.id === req.body.id);
    if (!item) return res.redirect('/dashboard/alertas?error=' + encodeURIComponent('Esa alerta ya no existe.'));

    try {
      const sent = await alerts.sendTestAlert(client, config, item);
      return res.redirect(
        sent ? '/dashboard/alertas?saved=1' : '/dashboard/alertas?error=' + encodeURIComponent('No pude escribir en ese canal (revisa los permisos del bot).'),
      );
    } catch (err) {
      return res.redirect('/dashboard/alertas?error=' + encodeURIComponent('No se pudo mandar la prueba: ' + err.message));
    }
  });

  app.get('/dashboard/automoderacion', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.automodPage({ user: req.session.user, config, guildName: guildName(req), flash: req.query.saved ? 'Guardado.' : null }),
    );
  });

  app.post('/dashboard/automoderacion', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      automod: {
        enabled: req.body.enabled === 'on',
        bannedWords: (req.body.bannedWords || '')
          .split('\n')
          .map((w) => w.trim().toLowerCase())
          .filter(Boolean),
        blockInvites: req.body.blockInvites === 'on',
        mentionSpamLimit: Math.max(0, Number(req.body.mentionSpamLimit) || 0),
        aiAssist: req.body.aiAssist === 'on',
      },
    });
    res.redirect('/dashboard/automoderacion?saved=1');
  });

  app.get('/dashboard/mensajes', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const editingTopic = req.query.editar
      ? (config.helpResponses.topics || []).find((t) => t.name === req.query.editar) || null
      : null;
    res.send(
      views.messagesPage({
        user: req.session.user,
        config,
        editingTopic,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/mensajes/tips', requireAuth, requireActiveGuild, async (req, res) => {
    const tips = (req.body.tips || '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    await db.updateGuildConfig(req.session.activeGuildId, { tips });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.post('/dashboard/mensajes/ayuda/general', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const generalTriggers = (req.body.generalTriggers || '')
      .split('\n')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    await db.updateGuildConfig(req.session.activeGuildId, {
      helpResponses: {
        ...config.helpResponses,
        generalTriggers,
        fallbackResponse: req.body.fallbackResponse || config.helpResponses.fallbackResponse,
      },
    });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.post('/dashboard/mensajes/ayuda/tema', requireAuth, requireActiveGuild, async (req, res) => {
    const name = (req.body.name || '').trim().toLowerCase().replace(/\s+/g, '-');
    const response = (req.body.response || '').trim();

    if (!name || !response) {
      return res.redirect(`/dashboard/mensajes?error=${encodeURIComponent('El tema necesita un nombre y una respuesta.')}`);
    }

    const keywords = (req.body.keywords || '')
      .split('\n')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const examples = (req.body.examples || '')
      .split('\n')
      .map((e) => e.trim())
      .filter(Boolean);

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const originalName = (req.body.originalName || '').trim().toLowerCase();
    const topics = (config.helpResponses.topics || []).filter((t) => t.name !== name && t.name !== originalName);
    topics.push({ name, keywords, examples, response });

    await db.updateGuildConfig(req.session.activeGuildId, {
      helpResponses: { ...config.helpResponses, topics },
    });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.post('/dashboard/mensajes/ayuda/tema/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const topics = (config.helpResponses.topics || []).filter((t) => t.name !== req.body.name);
    await db.updateGuildConfig(req.session.activeGuildId, { helpResponses: { ...config.helpResponses, topics } });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.get('/dashboard/anuncio', requireAuth, requireActiveGuild, (req, res) => {
    res.send(
      views.announcePage({
        user: req.session.user,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.sent ? 'Anuncio enviado.' : null,
      }),
    );
  });

  app.post('/dashboard/anuncio', requireAuth, requireActiveGuild, async (req, res) => {
    const { channelId, mensaje, titulo, color, imagen } = req.body;
    const guild = getGuild(req);
    const channel = guild ? guild.channels.cache.get(channelId) : null;

    if (!channel || !channel.isTextBased()) {
      return res
        .status(400)
        .send(views.announcePage({ user: req.session.user, channels: getTextChannels(req), guildName: guildName(req), flash: 'Canal inválido.' }));
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const embed = new EmbedBuilder().setDescription(mensaje).setColor(resolveColor(config, 'brand')).setTimestamp();
    if (titulo) embed.setTitle(titulo);
    if (/^#?[0-9a-fA-F]{6}$/.test(color || '')) embed.setColor(parseInt(color.replace('#', ''), 16));
    if (imagen && /^https?:\/\//.test(imagen)) embed.setImage(imagen);

    try {
      await channel.send({ embeds: [embed] });
      res.redirect('/dashboard/anuncio?sent=1');
    } catch (err) {
      console.error('No se pudo mandar el anuncio desde el dashboard:', err);
      res.status(500).send(
        views.announcePage({
          user: req.session.user,
          channels: getTextChannels(req),
          guildName: guildName(req),
          flash: 'No se pudo enviar (revisá permisos del bot en ese canal).',
        }),
      );
    }
  });

  app.get('/dashboard/estadisticas', requireAuth, requireActiveGuild, async (req, res) => {
    const stats = await db.getStats(req.session.activeGuildId);
    const leaderboard = withDisplayNames(req, await db.getLeaderboard(req.session.activeGuildId, 5));
    const economyLeaderboard = withDisplayNames(req, await db.getEconomyLeaderboard(req.session.activeGuildId, 5));
    const channelNames = {};
    for (const c of getTextChannels(req)) channelNames[c.id] = c.name;
    res.send(
      views.statsPage({ user: req.session.user, stats, channelNames, leaderboard, economyLeaderboard, guildName: guildName(req) }),
    );
  });

  app.get('/dashboard/tickets', requireAuth, requireActiveGuild, async (req, res) => {
    const tickets = await db.listTickets(req.session.activeGuildId);
    res.send(views.ticketsPage({ user: req.session.user, tickets, guildName: guildName(req) }));
  });

  app.get('/dashboard/tickets/config', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const editingPanel = req.query.editarPanel
      ? (config.ticketPanels || []).find((p) => p.id === req.query.editarPanel) || null
      : null;
    const editingCategory = req.query.editarCategoria
      ? (config.ticketCategories || []).find((c) => c.id === req.query.editarCategoria) || null
      : null;
    res.send(
      views.ticketConfigPage({
        user: req.session.user,
        config,
        editingPanel,
        editingCategory,
        channels: getTextChannels(req),
        categoryChannels: getCategoryChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.published ? 'Panel publicado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/tickets/config/categoria', requireAuth, requireActiveGuild, async (req, res) => {
    const label = (req.body.label || '').trim();
    if (!label) {
      return res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('Ponele un nombre a la categoría.')}`);
    }
    const emojiInput = readEmoji(req.body.emoji);
    if (emojiInput.invalid) return res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent(invalidEmojiMessage(emojiInput.invalid))}`);

    const config = await db.getGuildConfig(req.session.activeGuildId);
    // presente solo al editar una categoria existente (ver "Editar" en la lista)
    const originalId = (req.body.originalId || '').trim();
    const staffRoleIds = [].concat(req.body.staffRoleIds || []);

    let id;
    if (originalId) {
      // el id se mantiene igual al editar, aunque cambie el nombre — lo
      // referencian los paneles (categoryIds) y los tickets ya creados
      id = originalId;
    } else {
      id = slugify(label) || `cat-${Date.now()}`;
      // antes esto pisaba en silencio una categoria existente con el mismo
      // nombre "slugificado"; ahora se rechaza en vez de perder datos sin avisar
      const collision = (config.ticketCategories || []).find((c) => c.id === id);
      if (collision) {
        return res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('Ya existe una categoría con ese nombre.')}`);
      }
    }

    const category = {
      id,
      label,
      emoji: emojiInput.value || '🎫',
      description: (req.body.description || '').trim(),
      staffRoleIds,
    };

    const existing = (config.ticketCategories || []).filter((c) => c.id !== id);
    await db.updateGuildConfig(req.session.activeGuildId, { ticketCategories: [...existing, category] });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/categoria/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      ticketCategories: (config.ticketCategories || []).filter((c) => c.id !== req.body.id),
    });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/transcripciones', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      ticketTranscripts: {
        enabled: req.body.transcriptsEnabled === 'on',
        channelId: req.body.transcriptsChannelId || null,
      },
      ticketFeedback: {
        enabled: req.body.feedbackEnabled === 'on',
      },
    });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/staff-default', requireAuth, requireActiveGuild, async (req, res) => {
    const ticketDefaultStaffRoleIds = Array.isArray(req.body.ticketDefaultStaffRoleIds)
      ? req.body.ticketDefaultStaffRoleIds
      : req.body.ticketDefaultStaffRoleIds
        ? [req.body.ticketDefaultStaffRoleIds]
        : [];
    await db.updateGuildConfig(req.session.activeGuildId, { ticketDefaultStaffRoleIds });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/panel', requireAuth, requireActiveGuild, async (req, res) => {
    if (!req.body.channelId) {
      return res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('Elegí un canal para el panel.')}`);
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const originalId = (req.body.originalId || '').trim();
    const original = originalId ? (config.ticketPanels || []).find((p) => p.id === originalId) : null;

    const panel = {
      id: original ? original.id : `panel-${Date.now()}`,
      channelId: req.body.channelId,
      // si cambio de canal el mensaje viejo queda en otro canal: se descarta el
      // messageId para que el proximo "Actualizar" publique uno nuevo en vez de
      // intentar editar un mensaje que ya no esta ahi
      messageId: original && original.channelId === req.body.channelId ? original.messageId : null,
      title: (req.body.title || '🎫 Centro de soporte').trim(),
      description: (req.body.description || '').trim(),
      categoryChannelId: req.body.categoryChannelId || null,
      categoryIds: [].concat(req.body.categoryIds || []),
      style: req.body.style === 'button' ? 'button' : 'select',
    };

    const ticketPanels = original
      ? (config.ticketPanels || []).map((p) => (p.id === panel.id ? panel : p))
      : [...(config.ticketPanels || []), panel];

    await db.updateGuildConfig(req.session.activeGuildId, { ticketPanels });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/panel/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      ticketPanels: (config.ticketPanels || []).filter((p) => p.id !== req.body.id),
    });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/panel/publicar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    const config = await db.getGuildConfig(req.session.activeGuildId);

    if (!config.ticketCategories.length) {
      return res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('Creá al menos una categoría primero.')}`);
    }

    try {
      const messageId = await ticketCommand.publishPanel(guild, config, req.body.id);
      await db.updateGuildConfig(req.session.activeGuildId, {
        ticketPanels: config.ticketPanels.map((p) => (p.id === req.body.id ? { ...p, messageId } : p)),
      });
      res.redirect('/dashboard/tickets/config?published=1');
    } catch (err) {
      console.error('No se pudo publicar el panel de tickets:', err);
      res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('No se pudo publicar: ' + err.message)}`);
    }
  });

  app.get('/dashboard/niveles', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.levelsPage({
        user: req.session.user,
        config,
        roles: getAssignableRoles(req),
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/niveles', requireAuth, requireActiveGuild, async (req, res) => {
    const levelRoles = [];
    for (let i = 1; i <= 5; i++) {
      const level = req.body[`level_${i}`];
      const roleId = req.body[`role_${i}`];
      if (level && roleId) {
        levelRoles.push({ level: Number(level), roleId });
      }
    }

    await db.updateGuildConfig(req.session.activeGuildId, {
      leveling: {
        enabled: req.body.enabled === 'on',
        xpMin: Math.max(1, Number(req.body.xpMin) || 15),
        xpMax: Math.max(1, Number(req.body.xpMax) || 25),
        cooldownSeconds: Math.max(0, Number(req.body.cooldownSeconds) || 60),
        levelUpChannelId: req.body.levelUpChannelId || null,
        levelRoles,
        voiceXpEnabled: req.body.voiceXpEnabled === 'on',
        voiceXpPerMinute: Math.max(0, Number(req.body.voiceXpPerMinute) || 0),
      },
    });
    res.redirect('/dashboard/niveles?saved=1');
  });

  app.get('/dashboard/roles-reaccion', requireAuth, requireActiveGuild, async (req, res) => {
    const sets = await db.listReactionRoleSets(req.session.activeGuildId);
    res.send(
      views.reactionRolesPage({
        user: req.session.user,
        sets,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved
          ? 'Mensaje de roles creado.'
          : req.query.deleted
            ? 'Eliminado.'
            : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/roles-reaccion', requireAuth, requireActiveGuild, async (req, res) => {
    const pairs = [];
    for (let i = 1; i <= 5; i++) {
      const emojiInput = readEmoji(req.body[`emoji_${i}`]);
      if (emojiInput.invalid) return res.redirect(`/dashboard/roles-reaccion?error=${encodeURIComponent(invalidEmojiMessage(emojiInput.invalid))}`);
      const emoji = emojiInput.value;
      const roleId = req.body[`role_${i}`];
      const label = (req.body[`label_${i}`] || '').trim();
      if (emoji && roleId) pairs.push({ emoji, roleId, label });
    }

    if (!req.body.channelId) {
      return res.redirect(`/dashboard/roles-reaccion?error=${encodeURIComponent('Elegí un canal.')}`);
    }
    if (!pairs.length) {
      return res.redirect(
        `/dashboard/roles-reaccion?error=${encodeURIComponent('Completá al menos un par de emoji + rol.')}`,
      );
    }

    const guild = getGuild(req);
    try {
      const config = await db.getGuildConfig(req.session.activeGuildId);
      await reactionRoles.postReactionRoleMessage(guild, {
        channelId: req.body.channelId,
        title: req.body.titulo,
        description: req.body.descripcion,
        pairs,
        config,
      });
      res.redirect('/dashboard/roles-reaccion?saved=1');
    } catch (err) {
      console.error('No se pudo crear el mensaje de roles por reacción:', err);
      res.redirect(
        `/dashboard/roles-reaccion?error=${encodeURIComponent('No se pudo crear el mensaje: ' + err.message)}`,
      );
    }
  });

  app.post('/dashboard/roles-reaccion/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    if (guild) {
      await reactionRoles.deleteReactionRoleSet(guild, req.body.messageId);
    }
    res.redirect('/dashboard/roles-reaccion?deleted=1');
  });

  app.get('/dashboard/roles-menu', requireAuth, requireActiveGuild, async (req, res) => {
    const sets = await db.listSelectRoleSets(req.session.activeGuildId);
    const editingSet = req.query.editar ? sets.find((s) => s.messageId === req.query.editar) || null : null;
    res.send(
      views.selectRolesPage({
        user: req.session.user,
        sets,
        editingSet,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved
          ? 'Menú creado y publicado.'
          : req.query.updated
            ? 'Menú actualizado.'
            : req.query.deleted
              ? 'Eliminado.'
              : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/roles-menu', requireAuth, requireActiveGuild, async (req, res) => {
    const options = [];
    for (let i = 1; i <= 25; i++) {
      const label = (req.body[`label_${i}`] || '').trim();
      const roleId = req.body[`role_${i}`];
      const emojiInput = readEmoji(req.body[`emoji_${i}`]);
      if (emojiInput.invalid) return res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent(invalidEmojiMessage(emojiInput.invalid))}`);
      const emoji = emojiInput.value;
      const description = (req.body[`desc_${i}`] || '').trim();
      if (label && roleId) options.push({ id: slugify(label) || `opcion-${i}`, label, roleId, emoji, description });
    }

    if (!req.body.channelId) {
      return res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('Elegí un canal.')}`);
    }
    if (!options.length) {
      return res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('Completá al menos una opción con nombre y rol.')}`);
    }
    if (options.length > 25) {
      return res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('Un menú de Discord admite máximo 25 opciones.')}`);
    }

    const guild = getGuild(req);
    const originalMessageId = (req.body.originalMessageId || '').trim();
    try {
      const config = await db.getGuildConfig(req.session.activeGuildId);
      if (originalMessageId) {
        await selectRoles.updateSelectRoleMessage(guild, {
          originalMessageId,
          channelId: req.body.channelId,
          title: req.body.titulo,
          description: req.body.descripcion,
          placeholder: req.body.placeholder,
          options,
          config,
        });
        return res.redirect('/dashboard/roles-menu?updated=1');
      }
      await selectRoles.postSelectRoleMessage(guild, {
        channelId: req.body.channelId,
        title: req.body.titulo,
        description: req.body.descripcion,
        placeholder: req.body.placeholder,
        options,
        config,
      });
      res.redirect('/dashboard/roles-menu?saved=1');
    } catch (err) {
      console.error('No se pudo guardar el menú de roles:', err);
      res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('No se pudo guardar el menú: ' + err.message)}`);
    }
  });

  app.post('/dashboard/roles-menu/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    if (guild) {
      await selectRoles.deleteSelectRoleSet(guild, req.body.messageId);
    }
    res.redirect('/dashboard/roles-menu?deleted=1');
  });

  app.get('/dashboard/logs', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.logsPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/logs', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      logging: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        logDeletes: req.body.logDeletes === 'on',
        logEdits: req.body.logEdits === 'on',
        logJoins: req.body.logJoins === 'on',
        logModeration: req.body.logModeration === 'on',
      },
    });
    res.redirect('/dashboard/logs?saved=1');
  });

  function isDebugUnlocked(req, guildId) {
    return Boolean(req.session.debugUnlocked && req.session.debugUnlocked[guildId]);
  }

  // requiere haber pasado por /dashboard/debug/desbloquear en esta sesion
  // (si el server tiene contraseña puesta); protege las rutas POST tambien,
  // no solo la pantalla, para que no se puedan tocar los settings a mano
  // sin haber entrado por la contraseña
  async function requireDebugUnlocked(req, res, next) {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    if (config.dashboardAccess.passwordHash && !isDebugUnlocked(req, req.session.activeGuildId)) {
      return res.redirect('/dashboard/debug');
    }
    next();
  }

  app.get('/dashboard/debug', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);

    if (config.dashboardAccess.passwordHash && !isDebugUnlocked(req, req.session.activeGuildId)) {
      return res.send(
        views.debugPasswordPage({
          user: req.session.user,
          guildName: guildName(req),
          flash: req.query.error || null,
        }),
      );
    }

    const mem = process.memoryUsage();
    res.send(
      views.debugPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
        stats: {
          version: pkg.version,
          nodeVersion: process.version,
          ping: client.ws.ping,
          uptime: debugCommand.formatUptime(client.uptime),
          guildCount: client.guilds.cache.size,
          memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
        },
      }),
    );
  });

  app.post('/dashboard/debug/desbloquear', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const access = config.dashboardAccess;

    if (!verifyPassword(req.body.password || '', access.passwordSalt, access.passwordHash)) {
      return res.redirect(`/dashboard/debug?error=${encodeURIComponent('Contraseña incorrecta.')}`);
    }

    req.session.debugUnlocked = req.session.debugUnlocked || {};
    req.session.debugUnlocked[req.session.activeGuildId] = true;
    res.redirect('/dashboard/debug');
  });

  app.post('/dashboard/debug', requireAuth, requireActiveGuild, requireDebugUnlocked, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      debug: {
        enabled: req.body.enabled === 'on',
        errorChannelId: req.body.errorChannelId || null,
      },
    });
    res.redirect('/dashboard/debug?saved=1');
  });

  app.post('/dashboard/debug/acceso', requireAuth, requireActiveGuild, requireDebugUnlocked, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const newPassword = (req.body.password || '').trim();

    let passwordHash = config.dashboardAccess.passwordHash;
    let passwordSalt = config.dashboardAccess.passwordSalt;
    if (newPassword) {
      passwordSalt = crypto.randomBytes(16).toString('hex');
      passwordHash = hashPassword(newPassword, passwordSalt);
    }

    const allowedUserIds = (req.body.allowedUserIds || '')
      .split('\n')
      .map((id) => id.trim())
      .filter(Boolean);
    const blockedUserIds = (req.body.blockedUserIds || '')
      .split('\n')
      .map((id) => id.trim())
      .filter(Boolean);

    await db.updateGuildConfig(req.session.activeGuildId, {
      dashboardAccess: { passwordHash, passwordSalt, allowedUserIds, blockedUserIds },
    });
    res.redirect('/dashboard/debug?saved=1');
  });

  app.get('/dashboard/apariencia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.appearancePage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/apariencia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const hexPattern = /^#?[0-9a-fA-F]{6}$/;

    const colors = { ...config.branding.colors };
    for (const key of Object.keys(colors)) {
      const value = req.body[`color_${key}`];
      if (hexPattern.test(value || '')) {
        colors[key] = value.startsWith('#') ? value : `#${value}`;
      }
    }

    const nickname = (req.body.nickname || '').trim().slice(0, 32);

    await db.updateGuildConfig(req.session.activeGuildId, {
      branding: {
        colors,
        footerText: (req.body.footerText || '').trim(),
        footerIcon: (req.body.footerIcon || '').trim(),
        nickname,
      },
    });

    const guild = getGuild(req);
    if (guild) {
      try {
        const me = guild.members.me || (await guild.members.fetchMe());
        if (nickname && me.nickname !== nickname) {
          await me.setNickname(nickname);
        } else if (!nickname && me.nickname) {
          await me.setNickname(null);
        }
      } catch (err) {
        console.error('No se pudo cambiar el apodo del bot desde el dashboard:', err);
      }
    }

    res.redirect('/dashboard/apariencia?saved=1');
  });

  app.get('/dashboard/contador', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.memberCounterPage({
        user: req.session.user,
        config,
        voiceChannels: getVoiceChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/contador', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);

    await db.updateGuildConfig(req.session.activeGuildId, {
      memberCounter: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        template: req.body.template || config.memberCounter.template,
      },
    });

    res.redirect('/dashboard/contador?saved=1');
  });

  app.get('/dashboard/skills', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.skillsPage({
        user: req.session.user,
        config,
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/skills', requireAuth, requireActiveGuild, async (req, res) => {
    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : req.body.roleIds ? [req.body.roleIds] : [];
    await db.updateGuildConfig(req.session.activeGuildId, {
      skills: {
        enabled: req.body.enabled === 'on',
        roleIds,
      },
    });
    res.redirect('/dashboard/skills?saved=1');
  });

  app.get('/dashboard/invitaciones', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const guild = getGuild(req);
    res.send(
      views.inviteTrackerPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        missingPermission: guild ? !inviteTracker.hasManageGuild(guild) : false,
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/invitaciones', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      inviteTracker: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
      },
    });
    res.redirect('/dashboard/invitaciones?saved=1');
  });

  app.get('/dashboard/cumpleanos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.birthdaysPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/cumpleanos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);

    await db.updateGuildConfig(req.session.activeGuildId, {
      birthdays: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.birthdays.message,
      },
    });

    res.redirect('/dashboard/cumpleanos?saved=1');
  });

  app.get('/dashboard/sugerencias', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.suggestionsPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/sugerencias', requireAuth, requireActiveGuild, async (req, res) => {
    const approvalRoleIds = Array.isArray(req.body.approvalRoleIds)
      ? req.body.approvalRoleIds
      : req.body.approvalRoleIds
        ? [req.body.approvalRoleIds]
        : [];

    await db.updateGuildConfig(req.session.activeGuildId, {
      suggestions: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        approvalRoleIds,
        anonymous: req.body.anonymous === 'on',
      },
    });
    res.redirect('/dashboard/sugerencias?saved=1');
  });

  app.get('/dashboard/comandos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const editingCommand = req.query.editar
      ? (config.customCommands || []).find((cmd) => cmd.name === req.query.editar) || null
      : null;
    res.send(
      views.customCommandsPage({
        user: req.session.user,
        config,
        editingCommand,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/comandos', requireAuth, requireActiveGuild, async (req, res) => {
    // se normaliza el nombre en vez de rechazar el formato (minusculas, tildes
    // sacadas, espacios/simbolos convertidos a "-"): asi cualquier texto que
    // escriba el admin termina en un nombre valido en vez de mostrar un error
    const name = slugify(req.body.name).slice(0, 32);
    const description = (req.body.description || '').trim() || 'Comando personalizado';
    const response = (req.body.response || '').trim();
    const adminOnly = req.body.adminOnly === 'on';
    const cooldownSeconds = Math.max(0, Number(req.body.cooldownSeconds) || 0);
    // presente solo cuando se edita un comando existente (ver "Editar" en la lista);
    // permite renombrar sin duplicar y sin perder el comando viejo en Discord
    const originalName = (req.body.originalName || '').trim();

    if (!name) {
      return res.redirect(`/dashboard/comandos?error=${encodeURIComponent('Ponele un nombre al comando.')}`);
    }

    const validationError = customCommands.validateCommandName(name);
    if (validationError || !response) {
      return res.redirect(`/dashboard/comandos?error=${encodeURIComponent(validationError || 'La respuesta no puede estar vacía.')}`);
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    // si el nuevo nombre ya lo usa OTRO comando (no el que se esta editando),
    // se rechaza en vez de pisarlo en silencio
    const collision = (config.customCommands || []).find((cmd) => cmd.name === name && cmd.name !== originalName);
    if (collision) {
      return res.redirect(`/dashboard/comandos?error=${encodeURIComponent('Ya existe un comando con ese nombre.')}`);
    }

    const existing = (config.customCommands || []).filter((cmd) => cmd.name !== name && cmd.name !== originalName);
    const newCommand = { name, description, response, adminOnly, cooldownSeconds };
    await db.updateGuildConfig(req.session.activeGuildId, {
      customCommands: [...existing, newCommand],
    });

    // no se espera a Discord antes de redirigir: registrar de a un comando ya
    // es rapido (a diferencia de la sobreescritura masiva de antes), pero si
    // Discord llega a tardar igual no queremos que el dashboard se quede
    // "cargando" — el guardado en la base ya paso, que es lo que importa
    const guild = getGuild(req);
    if (guild) {
      // si se renombro, el comando viejo queda huerfano en Discord (upsert
      // busca por nombre, no encuentra el nuevo y crea uno aparte) — hay que
      // borrar el de antes explicitamente
      if (originalName && originalName !== name) {
        customCommands
          .deleteGuildCommandByName(guild, originalName)
          .catch((err) => console.error('No se pudo borrar el comando anterior en Discord tras renombrarlo:', err));
      }
      customCommands
        .upsertGuildCommand(guild, newCommand)
        .catch((err) => console.error('No se pudo registrar el comando personalizado en Discord:', err));
    }

    res.redirect('/dashboard/comandos?saved=1');
  });

  app.post('/dashboard/comandos/prefijo', requireAuth, requireActiveGuild, async (req, res) => {
    const prefix = (req.body.prefix || '!').trim().slice(0, 5) || '!';
    await db.updateGuildConfig(req.session.activeGuildId, {
      textCommands: { enabled: req.body.enabled === 'on', prefix },
    });
    res.redirect('/dashboard/comandos?saved=1');
  });

  app.post('/dashboard/comandos/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      customCommands: (config.customCommands || []).filter((cmd) => cmd.name !== req.body.name),
    });

    const guild = getGuild(req);
    if (guild) {
      customCommands
        .deleteGuildCommandByName(guild, req.body.name)
        .catch((err) => console.error('No se pudo borrar el comando personalizado en Discord:', err));
    }

    res.redirect('/dashboard/comandos?saved=1');
  });

  app.get('/dashboard/houses', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.housesPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.published ? 'Mensaje publicado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/houses', requireAuth, requireActiveGuild, async (req, res) => {
    const formFields = (req.body.formFields || '')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .slice(0, 5);

    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      houses: {
        ...config.houses,
        enabled: req.body.enabled === 'on',
        requestChannelId: req.body.requestChannelId || null,
        requestTitle: req.body.requestTitle || config.houses.requestTitle,
        requestDescription: req.body.requestDescription || config.houses.requestDescription,
        reviewChannelId: req.body.reviewChannelId || null,
        formFields,
        acceptMessage: req.body.acceptMessage || '',
        rejectMessage: req.body.rejectMessage || '',
      },
    });
    res.redirect('/dashboard/houses?saved=1');
  });

  app.post('/dashboard/houses/publicar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    const config = await db.getGuildConfig(req.session.activeGuildId);

    try {
      const messageId = await housesCommand.publishRequestMessage(guild, config);
      // publicar el boton implica que el sistema queda activo, para que no quede
      // un mensaje funcional pero "desactivado" sin que se note
      await db.updateGuildConfig(req.session.activeGuildId, {
        houses: { ...config.houses, enabled: true, requestMessageId: messageId },
      });
      res.redirect('/dashboard/houses?published=1');
    } catch (err) {
      console.error('No se pudo publicar el mensaje de House:', err);
      res.redirect(`/dashboard/houses?error=${encodeURIComponent('No se pudo publicar: ' + err.message)}`);
    }
  });

  app.get('/dashboard/economia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.economyPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/economia', requireAuth, requireActiveGuild, async (req, res) => {
    const shopItems = (req.body.shopItemsText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, price, ...descParts] = line.split('|').map((p) => p.trim());
        return {
          id: slugify(name),
          name,
          price: Math.max(0, Number(price) || 0),
          description: descParts.join('|') || '',
        };
      })
      .filter((item) => item.name);

    await db.updateGuildConfig(req.session.activeGuildId, {
      economy: {
        enabled: req.body.enabled === 'on',
        currencyName: req.body.currencyName || 'monedas',
        currencySymbol: req.body.currencySymbol || '🪙',
        dailyAmount: Math.max(0, Number(req.body.dailyAmount) || 0),
        workMinAmount: Math.max(0, Number(req.body.workMinAmount) || 0),
        workMaxAmount: Math.max(0, Number(req.body.workMaxAmount) || 0),
        workCooldownMinutes: Math.max(1, Number(req.body.workCooldownMinutes) || 60),
        shopItems,
      },
    });
    res.redirect('/dashboard/economia?saved=1');
  });

  app.get('/dashboard/casino', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.casinoSettingsPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/casino', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      casino: {
        enabled: req.body.enabled === 'on',
        minBet: Math.max(1, Number(req.body.minBet) || 1),
        maxBet: Math.max(1, Number(req.body.maxBet) || 1000),
      },
    });
    res.redirect('/dashboard/casino?saved=1');
  });

  app.get('/dashboard/mascotas', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.petsSettingsPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/mascotas', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      pets: {
        enabled: req.body.enabled === 'on',
        feedCooldownMinutes: Math.max(1, Number(req.body.feedCooldownMinutes) || 120),
        playCooldownMinutes: Math.max(1, Number(req.body.playCooldownMinutes) || 60),
      },
    });
    res.redirect('/dashboard/mascotas?saved=1');
  });

  app.get('/dashboard/starboard', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.starboardPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/starboard', requireAuth, requireActiveGuild, async (req, res) => {
    const emojiInput = readEmoji(req.body.emoji);
    if (emojiInput.invalid) return res.redirect(`/dashboard/starboard?error=${encodeURIComponent(invalidEmojiMessage(emojiInput.invalid))}`);
    await db.updateGuildConfig(req.session.activeGuildId, {
      starboard: {
        enabled: req.body.enabled === 'on',
        emoji: emojiInput.value || '⭐',
        threshold: Math.max(1, Number(req.body.threshold) || 3),
        channelId: req.body.channelId || null,
      },
    });
    res.redirect('/dashboard/starboard?saved=1');
  });

  app.get('/dashboard/trivia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.triviaPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/trivia', requireAuth, requireActiveGuild, async (req, res) => {
    const lines = (req.body.questionsText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const questions = [];
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 6) continue;
      const [question, optA, optB, optC, optD, correct] = parts;
      const correctIndex = Number(correct) - 1;
      if (!question || correctIndex < 0 || correctIndex > 3) continue;
      questions.push({ question, options: [optA, optB, optC, optD], correctIndex });
    }

    if (!questions.length) {
      return res.redirect(
        `/dashboard/trivia?error=${encodeURIComponent('Ninguna pregunta tiene el formato correcto (pregunta|A|B|C|D|correcta).')}`,
      );
    }

    await db.updateGuildConfig(req.session.activeGuildId, {
      trivia: {
        enabled: req.body.enabled === 'on',
        rewardAmount: Math.max(1, Number(req.body.rewardAmount) || 50),
        questions,
      },
    });
    res.redirect('/dashboard/trivia?saved=1');
  });

  app.get('/dashboard/eventos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.miniEventsPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/eventos', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      miniEvents: {
        enabled: req.body.enabled === 'on',
        intervalMinutes: Math.max(5, Number(req.body.intervalMinutes) || 120),
        reward: Math.max(1, Number(req.body.reward) || 30),
        channelId: req.body.channelId || null,
      },
    });
    res.redirect('/dashboard/eventos?saved=1');
  });

  app.get('/dashboard/ia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const usageStats = await db.getAiUsageStats(req.session.activeGuildId);
    res.send(
      views.aiPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        aiConfigured: aiHelper.isConfigured(config),
        usageStats,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/ia/staff-roles', requireAuth, requireActiveGuild, async (req, res) => {
    const roleId = (req.body.roleId || '').trim();
    const label = (req.body.label || '').trim().slice(0, 60);
    if (!roleId || !label) {
      return res.redirect(`/dashboard/ia?error=${encodeURIComponent('Elegí un rol y ponele una etiqueta.')}`);
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const staffRoleTags = (config.ai.staffRoleTags || []).filter((tag) => tag.roleId !== roleId);
    staffRoleTags.push({ roleId, label });
    await db.updateGuildConfig(req.session.activeGuildId, { ai: { ...config.ai, staffRoleTags } });
    res.redirect('/dashboard/ia?saved=1');
  });

  app.post('/dashboard/ia/staff-roles/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const staffRoleTags = (config.ai.staffRoleTags || []).filter((tag) => tag.roleId !== req.body.roleId);
    await db.updateGuildConfig(req.session.activeGuildId, { ai: { ...config.ai, staffRoleTags } });
    res.redirect('/dashboard/ia?saved=1');
  });

  app.post('/dashboard/ia/resumen', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      ai: {
        ...config.ai,
        digest: {
          // lastSentAt se mantiene: cambiar el canal/frecuencia no deberia
          // disparar un resumen antes de tiempo
          ...config.ai.digest,
          enabled: req.body.enabled === 'on',
          channelId: req.body.channelId || null,
          frequency: req.body.frequency === 'weekly' ? 'weekly' : 'daily',
        },
      },
    });
    res.redirect('/dashboard/ia?saved=1');
  });

  app.post('/dashboard/ia/feedback-renders', requireAuth, requireActiveGuild, async (req, res) => {
    const emojiInput = readEmoji(req.body.emoji);
    if (emojiInput.invalid) return res.redirect(`/dashboard/ia?error=${encodeURIComponent(invalidEmojiMessage(emojiInput.invalid))}`);
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const channelIds = Array.isArray(req.body.channelIds) ? req.body.channelIds : req.body.channelIds ? [req.body.channelIds] : [];
    await db.updateGuildConfig(req.session.activeGuildId, {
      ai: {
        ...config.ai,
        renderFeedback: {
          enabled: req.body.enabled === 'on',
          channelIds,
          emoji: emojiInput.value || '🔍',
        },
      },
    });
    res.redirect('/dashboard/ia?saved=1');
  });

  // conversacion libre: el bot se suma a la charla de UN canal cuando lo mencionan
  app.post('/dashboard/ia/conversacion', requireAuth, requireActiveGuild, async (req, res) => {
    const guildId = req.session.activeGuildId;
    const config = await db.getGuildConfig(guildId);
    const bounded = (value, fallback, min, max) => Math.min(max, Math.max(min, Number(value) || fallback));
    await db.updateGuildConfig(guildId, {
      ai: {
        ...config.ai,
        conversation: {
          enabled: req.body.enabled === 'on',
          channelId: getTextChannels(req).find((c) => c.id === req.body.channelId)?.id || null,
          idleMinutes: bounded(req.body.idleMinutes, 4, 1, 30),
          maxMinutes: bounded(req.body.maxMinutes, 20, 2, 120),
          maxReplies: Math.floor(bounded(req.body.maxReplies, 25, 3, 100)),
          minSecondsBetweenReplies: bounded(req.body.minSecondsBetweenReplies, 10, 3, 120),
          chattiness: ['calmada', 'habladora'].includes(req.body.chattiness) ? req.body.chattiness : 'normal',
        },
      },
    });
    res.redirect('/dashboard/ia?saved=1');
  });

  app.post('/dashboard/ia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    // las claves de Groq son ASCII imprimible; se limpia cualquier caracter pegado
    // por error (emojis, comillas raras, etc.) que rompería el header HTTP al usarla
    const cleanedInput = (req.body.apiKey || '').replace(/[^\x21-\x7e]/g, '').trim();
    const staffUserIds = (req.body.staffUserIds || '')
      .split('\n')
      .map((id) => id.trim())
      .filter(Boolean);
    // el <select multiple> manda un string si eligieron uno solo, array si eligieron varios, nada si ninguno
    const channelIds = [].concat(req.body.channelIds || []).filter(Boolean);
    const forbiddenTopics = (req.body.forbiddenTopics || '')
      .split('\n')
      .map((topic) => topic.trim())
      .filter(Boolean);
    const cooldownSeconds = Math.min(120, Math.max(1, parseInt(req.body.cooldownSeconds, 10) || 8));
    await db.updateGuildConfig(req.session.activeGuildId, {
      ai: {
        // se conserva todo lo que se edita en otros formularios de esta pagina
        // (roles etiquetados, resumen, feedback de renders, conversacion): antes
        // guardar este formulario los borraba
        ...config.ai,
        enabled: req.body.enabled === 'on',
        helpFallback: req.body.helpFallback === 'on',
        channelId: null, // deprecado a favor de channelIds; se limpia para no confundir con lo nuevo
        channelIds,
        tone: ['formal', 'gracioso'].includes(req.body.tone) ? req.body.tone : 'amigable',
        customPersonality: (req.body.customPersonality || '').trim().slice(0, 500),
        forbiddenTopics,
        cooldownSeconds,
        staffUserIds,
        // si el campo llega vacio, mantenemos la clave que ya estaba guardada (no la borramos por error),
        // salvo que se tilde explicitamente "quitar clave"
        apiKey: req.body.removeApiKey === 'on' ? '' : cleanedInput || config.ai.apiKey,
      },
    });
    res.redirect('/dashboard/ia?saved=1');
  });

  app.get('/dashboard/guia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const editingSection = req.query.edit
      ? (config.serverGuide.sections || []).find((s) => s.id === req.query.edit) || null
      : null;
    res.send(
      views.serverGuidePage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        editingSection,
        flash: req.query.saved ? 'Guardado.' : req.query.published ? 'Panel publicado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/guia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      serverGuide: {
        ...config.serverGuide,
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        title: req.body.title || config.serverGuide.title,
        description: req.body.description || config.serverGuide.description,
      },
    });
    res.redirect('/dashboard/guia?saved=1');
  });

  app.post('/dashboard/guia/seccion', requireAuth, requireActiveGuild, async (req, res) => {
    const label = (req.body.label || '').trim();
    const content = (req.body.content || '').trim();

    if (!label || !content) {
      return res.redirect(`/dashboard/guia?error=${encodeURIComponent('La sección necesita un nombre y un contenido.')}`);
    }
    const emojiInput = readEmoji(req.body.emoji);
    if (emojiInput.invalid) return res.redirect(`/dashboard/guia?error=${encodeURIComponent(invalidEmojiMessage(emojiInput.invalid))}`);

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const sections = config.serverGuide.sections || [];
    const existingId = (req.body.id || '').trim();
    const isEditing = existingId && sections.some((s) => s.id === existingId);
    const id = isEditing ? existingId : slugify(label) || `seccion-${Date.now()}`;
    const section = { id, label, emoji: emojiInput.value, content };

    const updatedSections = isEditing
      ? sections.map((s) => (s.id === id ? section : s))
      : [...sections.filter((s) => s.id !== id), section];

    await db.updateGuildConfig(req.session.activeGuildId, {
      serverGuide: { ...config.serverGuide, sections: updatedSections },
    });
    res.redirect('/dashboard/guia?saved=1');
  });

  app.post('/dashboard/guia/seccion/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const sections = (config.serverGuide.sections || []).filter((s) => s.id !== req.body.id);
    await db.updateGuildConfig(req.session.activeGuildId, { serverGuide: { ...config.serverGuide, sections } });
    res.redirect('/dashboard/guia?saved=1');
  });

  app.post('/dashboard/guia/publicar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    const config = await db.getGuildConfig(req.session.activeGuildId);

    try {
      const messageId = await serverGuide.publishGuide(guild, config);
      await db.updateGuildConfig(req.session.activeGuildId, {
        serverGuide: { ...config.serverGuide, enabled: true, messageId },
      });
      res.redirect('/dashboard/guia?published=1');
    } catch (err) {
      console.error('No se pudo publicar la guía del servidor:', err);
      res.redirect(`/dashboard/guia?error=${encodeURIComponent('No se pudo publicar: ' + err.message)}`);
    }
  });

  return app;
}

module.exports = { createApp };
