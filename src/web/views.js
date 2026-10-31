const fs = require('fs');
const path = require('path');
const { icon } = require('./icons');

const THEME_CSS = fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8');
const EMOJI_PICKER_SCRIPT = fs.readFileSync(path.join(__dirname, 'emojiPicker.client.js'), 'utf8');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

// los emojis personalizados del server se guardan como <:nombre:id> (o <a:nombre:id> si son animados): en el panel se
// muestran como imagen, y donde solo cabe texto (un <option>) como :nombre:
const CUSTOM_EMOJI_RE = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;

function emojiHtml(value) {
  const match = String(value ?? '').trim().match(CUSTOM_EMOJI_RE);
  if (!match) return escapeHtml(value || '');
  return `<img class="emoji-inline" src="https://cdn.discordapp.com/emojis/${match[3]}.${match[1] ? 'gif' : 'png'}?size=48&amp;quality=lossless" alt=":${match[2]}:" width="20" height="20">`;
}

function emojiPlain(value) {
  const match = String(value ?? '').trim().match(CUSTOM_EMOJI_RE);
  return match ? `:${match[2]}:` : String(value || '');
}

// enabledPath: ruta punteada dentro de config para saber si esa funcion esta
// activada (se usa en la tarjeta de la pantalla de inicio). Se omite cuando
// la pagina no tiene un unico interruptor "activado/desactivado" claro
const NAV_GROUPS = [
  {
    label: 'General',
    links: [
      { href: '/dashboard/general', label: 'General', icon: 'sliders' },
      { href: '/dashboard/estadisticas', label: 'Estadísticas', icon: 'bars' },
      { href: '/dashboard/contador', label: 'Contador de miembros', icon: 'hash', enabledPath: 'memberCounter.enabled' },
      { href: '/dashboard/debug', label: 'Estado / Debug', icon: 'pulse', enabledPath: 'debug.enabled' },
    ],
  },
  {
    label: 'Comunidad',
    links: [
      { href: '/dashboard/bienvenida', label: 'Bienvenida/Despedida', icon: 'door-in', enabledPath: 'welcome.enabled' },
      { href: '/dashboard/mensajes', label: 'Tips y ayuda', icon: 'message' },
      { href: '/dashboard/anuncio', label: 'Anuncios', icon: 'megaphone' },
      { href: '/dashboard/disenos', label: 'Mensajes avanzados', icon: 'layout' },
      { href: '/dashboard/houses', label: 'Houses', icon: 'house', enabledPath: 'houses.enabled' },
      { href: '/dashboard/starboard', label: 'Starboard', icon: 'star', enabledPath: 'starboard.enabled' },
      { href: '/dashboard/sugerencias', label: 'Sugerencias', icon: 'note', enabledPath: 'suggestions.enabled' },
      { href: '/dashboard/cumpleanos', label: 'Cumpleaños', icon: 'calendar', enabledPath: 'birthdays.enabled' },
      { href: '/dashboard/invitaciones', label: 'Invite Tracker', icon: 'link', enabledPath: 'inviteTracker.enabled' },
      { href: '/dashboard/skills', label: 'Skills', icon: 'tag', enabledPath: 'skills.enabled' },
      { href: '/dashboard/alertas', label: 'Alertas YouTube/Twitch', icon: 'bell', enabledPath: 'alerts.enabled' },
    ],
  },
  {
    label: 'Moderación',
    links: [
      { href: '/dashboard/automoderacion', label: 'Automoderación', icon: 'shield', enabledPath: 'automod.enabled' },
      { href: '/dashboard/logs', label: 'Logs', icon: 'list', enabledPath: 'logging.enabled' },
    ],
  },
  {
    label: 'Tickets',
    links: [
      { href: '/dashboard/tickets', label: 'Tickets', icon: 'ticket' },
      { href: '/dashboard/tickets/config', label: 'Configurar', icon: 'gear' },
    ],
  },
  {
    label: 'Progresión',
    links: [
      { href: '/dashboard/niveles', label: 'Niveles', icon: 'steps', enabledPath: 'leveling.enabled' },
      { href: '/dashboard/roles-reaccion', label: 'Roles por reacción', icon: 'smile' },
      { href: '/dashboard/roles-menu', label: 'Roles por menú', icon: 'checklist' },
    ],
  },
  {
    label: 'Economía y juegos',
    links: [
      { href: '/dashboard/economia', label: 'Economía', icon: 'coins', enabledPath: 'economy.enabled' },
      { href: '/dashboard/casino', label: 'Casino', icon: 'dice', enabledPath: 'casino.enabled' },
      { href: '/dashboard/mascotas', label: 'Mascotas', icon: 'paw', enabledPath: 'pets.enabled' },
      { href: '/dashboard/trivia', label: 'Trivia', icon: 'help', enabledPath: 'trivia.enabled' },
      { href: '/dashboard/juegos', label: 'Minijuegos', icon: 'gamepad', enabledPath: 'games.enabled' },
      { href: '/dashboard/social', label: 'Social y acciones', icon: 'users', enabledPath: 'social.enabled' },
      { href: '/dashboard/eventos', label: 'Eventos', icon: 'flag', enabledPath: 'miniEvents.enabled' },
    ],
  },
  {
    label: 'A medida',
    links: [
      { href: '/dashboard/comandos', label: 'Comandos', icon: 'terminal', enabledPath: 'textCommands.enabled' },
      { href: '/dashboard/ia', label: 'IA', icon: 'chip', enabledPath: 'ai.enabled' },
      { href: '/dashboard/guia', label: 'Guía', icon: 'book', enabledPath: 'serverGuide.enabled' },
      { href: '/dashboard/apariencia', label: 'Apariencia', icon: 'palette' },
    ],
  },
];

function getConfigValue(config, path) {
  return path.split('.').reduce((obj, key) => (obj == null ? obj : obj[key]), config);
}

function discordAvatarUrl(user) {
  if (!user) return null;
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
  }
  // avatar por defecto de discord (sistema nuevo sin discriminador, basado en el ID)
  try {
    const index = Number((BigInt(user.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

// motor de sonido: tonos generados con Web Audio API (sin archivos externos).
// Se guarda la preferencia de silencio en localStorage. Nada de esto es
// critico para el funcionamiento del panel — si el navegador bloquea audio
// (autoplay policy) o no soporta AudioContext, falla en silencio.
const SOUND_SCRIPT = `
(function () {
  var STORAGE_KEY = 'panelSoundMuted';
  var ctx = null;
  function muted() { return localStorage.getItem(STORAGE_KEY) === '1'; }
  function setMuted(value) { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); }
  function getCtx() {
    if (muted()) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }
  function tone(freq, duration, type, delay, gain) {
    var c = getCtx();
    if (!c) return;
    try {
      var osc = c.createOscillator();
      var gainNode = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      var start = c.currentTime + (delay || 0);
      gainNode.gain.setValueAtTime(0, start);
      gainNode.gain.linearRampToValueAtTime(gain || 0.06, start + 0.008);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gainNode).connect(c.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch (e) {}
  }
  window.__sfx = {
    click: function () { tone(720, 0.05, 'sine', 0, 0.045); },
    success: function () { tone(660, 0.09, 'sine', 0, 0.07); tone(990, 0.13, 'sine', 0.07, 0.06); },
    error: function () { tone(220, 0.16, 'sawtooth', 0, 0.05); tone(160, 0.2, 'sawtooth', 0.05, 0.045); },
    delete: function () { tone(340, 0.09, 'triangle', 0, 0.06); tone(220, 0.14, 'triangle', 0.06, 0.05); },
    muted: muted,
    setMuted: setMuted,
  };
})();
`;

// fade-in de pagina, transicion de salida al navegar, boton "Guardando..." en
// forms, auto-cierre del flash, boton de silenciar sonido, y el sonido en si
const APP_SCRIPT = `
(function () {
  var SOUND_ON_ICON = ${JSON.stringify(icon('volume'))};
  var SOUND_OFF_ICON = ${JSON.stringify(icon('volume-off'))};
  document.body.classList.add('page-ready');

  var path = window.location.pathname;
  document.querySelectorAll('.sidebar a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (path === href || (href !== '/dashboard' && href.length > 1 && path.indexOf(href) === 0)) {
      a.classList.add('active');
    }
  });

  var flash = document.querySelector('.flash');
  if (flash) {
    window.__sfx.success();
    setTimeout(function () { flash.classList.add('flash-out'); }, 4000);
  }
  var errorBox = document.querySelector('.error');
  if (errorBox) window.__sfx.error();

  var muteBtn = document.getElementById('sound-toggle');
  function syncMuteBtn() {
    if (!muteBtn) return;
    muteBtn.innerHTML = window.__sfx.muted() ? SOUND_OFF_ICON : SOUND_ON_ICON;
    muteBtn.title = window.__sfx.muted() ? 'Sonido silenciado (click para activar)' : 'Sonido activado (click para silenciar)';
  }
  if (muteBtn) {
    syncMuteBtn();
    muteBtn.addEventListener('click', function () {
      window.__sfx.setMuted(!window.__sfx.muted());
      syncMuteBtn();
      window.__sfx.click();
    });
  }

  var userMenuBtn = document.getElementById('user-menu-btn');
  var userMenu = document.getElementById('user-menu');
  if (userMenuBtn && userMenu) {
    function closeUserMenu() {
      userMenu.hidden = true;
      userMenuBtn.setAttribute('aria-expanded', 'false');
    }
    userMenuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !userMenu.hidden;
      if (isOpen) { closeUserMenu(); } else {
        userMenu.hidden = false;
        userMenuBtn.setAttribute('aria-expanded', 'true');
      }
    });
    document.addEventListener('click', function (e) {
      if (!userMenu.hidden && !userMenu.contains(e.target) && e.target !== userMenuBtn) closeUserMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeUserMenu();
    });
  }

  function isInternalLink(a) {
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('javascript:') === 0) return false;
    return a.origin === window.location.origin;
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a');
    var btn = e.target.closest('button');
    if (btn && !a) window.__sfx.click();
    if (!isInternalLink(a)) return;
    e.preventDefault();
    window.__sfx.click();
    document.body.classList.add('page-exit');
    setTimeout(function () { window.location.href = a.href; }, 130);
  });

  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
        e.preventDefault();
        return;
      }
      var btn = form.querySelector('button[type=submit], button:not([type])');
      if (btn && !btn.disabled) {
        btn.dataset.label = btn.textContent;
        btn.textContent = form.dataset.confirm ? 'Eliminando…' : 'Guardando…';
        btn.disabled = true;
        btn.classList.add('btn-loading');
      }
      window.__sfx[form.dataset.confirm ? 'delete' : 'click']();
      document.body.classList.add('page-exit');
    });
  });
})();
`;

function layout({ title, user, body, flash, error, guildName, wide }) {
  // `error` es un aviso de fallo (borde rojo); `flash` es uno de confirmacion
  const notices = `${error ? `<div class="flash error">${escapeHtml(error)}</div>` : ''}${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ''}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · PlanetBot</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${THEME_CSS}</style>
</head>
<body>
${
  user
    ? `<header>
  <a class="brand" href="/dashboard">${icon('logo', 20)}PlanetBot</a>
  <div class="user">
    <button id="sound-toggle" type="button" aria-label="Sonido">${icon('volume')}</button>
    <div class="user-menu-wrap">
      <button id="user-menu-btn" type="button" class="user-menu-btn" aria-expanded="false" aria-haspopup="true">
        <img class="avatar" src="${discordAvatarUrl(user)}" alt="" width="26" height="26">
        <span>${escapeHtml(user.username)}</span>
        <span class="chevron">${icon('chevron', 14)}</span>
      </button>
      <div id="user-menu" class="user-menu" hidden>
        ${guildName ? `<a href="/servers">${icon('switch')}Cambiar de servidor</a>` : ''}
        <a href="/logout" class="danger">${icon('logout')}Salir</a>
      </div>
    </div>
  </div>
</header>
<div class="app-layout">
<nav class="sidebar">
${
  guildName
    ? `  <a class="server-switcher" href="/servers">
    <span class="server-switcher-icon">${icon('server', 18)}</span>
    <span class="server-switcher-info">
      <span class="server-switcher-label">Servidor</span>
      <span class="server-switcher-name">${escapeHtml(guildName)}</span>
    </span>
    <span class="chevron">${icon('chevron', 14)}</span>
  </a>`
    : ''
}
${NAV_GROUPS.map(
  (group) => `  <div class="nav-group">
    <div class="nav-group-label">${escapeHtml(group.label)}</div>
    <div class="nav-group-links">
${group.links.map((link) => `      <a href="${link.href}">${icon(link.icon)}${escapeHtml(link.label)}</a>`).join('\n')}
    </div>
  </div>`,
).join('\n')}
</nav>
<main${wide ? ' class="wide"' : ''}>
${notices}
${body}
</main>
</div>`
    : `<main>
${notices}
${body}
</main>`
}
<script>${SOUND_SCRIPT}</script>
<script>${APP_SCRIPT}</script>
<script>${EMOJI_PICKER_SCRIPT}</script>
</body>
</html>`;
}

function loginPage({ authorizeUrl, error }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ingresar · PlanetBot</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${THEME_CSS}</style></head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <div class="mark">${icon('logo', 22)}PlanetBot</div>
    <h1>Panel de administración</h1>
    <p>Inicia sesión con Discord para administrar tu comunidad.</p>
    <a class="btn" href="${authorizeUrl}">Iniciar sesión con Discord</a>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  </div>
</div>
<script>${SOUND_SCRIPT}</script>
<script>${APP_SCRIPT}</script>
</body></html>`;
}

// paginas publicas (sin login) que exige Discord para verificar la
// aplicacion: Condiciones del Servicio y Politica de Privacidad
function termsPage() {
  const body = `
  <h1>Condiciones del Servicio</h1>
  <p class="muted">Última actualización: ${new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

  <div class="card">
    <h2>1. Aceptación</h2>
    <p>Al invitar a PlanetBot a tu servidor de Discord o usar este panel web, aceptás estas Condiciones del Servicio. Si no estás de acuerdo, no uses el bot ni el panel.</p>
  </div>

  <div class="card">
    <h2>2. Qué es PlanetBot</h2>
    <p>PlanetBot es un bot de Discord con funciones de moderación, economía virtual, niveles, tickets de soporte, sorteos y un asistente conversacional opcional basado en IA (Groq), administrable desde este panel web mediante inicio de sesión con Discord (OAuth2).</p>
  </div>

  <div class="card">
    <h2>3. Uso aceptable</h2>
    <p>No está permitido usar el bot para actividades ilegales, acoso, spam, evasión de las políticas de Discord, ni para intentar explotar, saturar o comprometer el servicio. Nos reservamos el derecho de restringir el acceso al bot o al panel a cualquier servidor o usuario que incumpla esto.</p>
  </div>

  <div class="card">
    <h2>4. Acceso al panel web</h2>
    <p>El panel se administra mediante inicio de sesión con tu cuenta de Discord. Solo pueden acceder usuarios con permisos de administración en el servidor correspondiente (y, si el dueño del servidor lo configura, una lista adicional de usuarios permitidos/bloqueados o una contraseña extra para la sección de Estado/Debug).</p>
  </div>

  <div class="card">
    <h2>5. Función de IA (opcional)</h2>
    <p>Si el administrador del servidor activa la función de IA, algunos mensajes se envían a un proveedor externo (Groq) para generar una respuesta de texto. Esta función es opcional, puede desactivarse en cualquier momento desde el panel, y las respuestas generadas pueden contener errores — no deben tomarse como asesoramiento profesional de ningún tipo.</p>
  </div>

  <div class="card">
    <h2>6. Disponibilidad</h2>
    <p>El servicio se ofrece "tal cual", sin garantía de disponibilidad ininterrumpida. Puede haber interrupciones por mantenimiento, fallas técnicas o de terceros (Discord, hosting, base de datos, proveedor de IA).</p>
  </div>

  <div class="card">
    <h2>7. Cambios</h2>
    <p>Estas condiciones pueden actualizarse en cualquier momento. El uso continuado del bot o el panel después de un cambio implica la aceptación de la nueva versión.</p>
  </div>

  <div class="card">
    <h2>8. Contacto</h2>
    <p>Para consultas sobre estas condiciones, escribinos a <a href="mailto:mateo.bravo.medina@gmail.com">mateo.bravo.medina@gmail.com</a>.</p>
  </div>`;
  return layout({ title: 'Condiciones del Servicio', user: null, body });
}

function privacyPage() {
  const body = `
  <h1>Política de Privacidad</h1>
  <p class="muted">Última actualización: ${new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

  <div class="card">
    <h2>1. Qué datos recolectamos</h2>
    <p>Para funcionar, PlanetBot y su panel guardan: tu ID de usuario de Discord y el de los servidores donde está el bot, nombres de usuario/apodos, la configuración que el servidor elige (canales, roles, mensajes, etc.), datos de economía virtual y niveles, historial de advertencias de moderación, y estadísticas de uso (por ejemplo, cuántas veces se usó la IA). No guardamos el historial completo de mensajes del servidor — solo lo puntual que cada función necesita (por ejemplo, el mensaje que activa una respuesta automática, o el contexto reciente de un canal cuando se usa la IA).</p>
  </div>

  <div class="card">
    <h2>2. Cómo se usan</h2>
    <p>Estos datos se usan únicamente para que el bot y el panel funcionen: mostrar tu perfil de economía/nivel, aplicar la configuración de tu servidor, mantener tu sesión iniciada en el panel, y generar respuestas cuando la función de IA está activada.</p>
  </div>

  <div class="card">
    <h2>3. Con quién se comparte</h2>
    <p>No vendemos ni compartimos tus datos con terceros con fines comerciales. Sí se comparte información puntual con:</p>
    <ul style="margin:0; padding-left:20px; font-size:14px; color:var(--text); line-height:1.8;">
      <li><strong>Discord</strong>, para autenticarte (OAuth2) y para que el bot funcione dentro de tu servidor.</li>
      <li><strong>Groq</strong>, únicamente si el administrador del servidor activa la función de IA — se le envía el mensaje puntual (y algo de contexto reciente) para generar una respuesta, no un historial completo.</li>
    </ul>
  </div>

  <div class="card">
    <h2>4. Dónde se guarda</h2>
    <p>Los datos se almacenan en una base de datos MongoDB Atlas. Las contraseñas adicionales del panel (si el servidor configura una para la sección de Estado/Debug) se guardan con hash y salt, nunca en texto plano.</p>
  </div>

  <div class="card">
    <h2>5. Cuánto tiempo se guardan</h2>
    <p>Los datos de un servidor se conservan mientras el bot esté agregado a ese servidor. Si el bot es expulsado, la información asociada puede eliminarse a pedido del dueño del servidor escribiendo a nuestro contacto.</p>
  </div>

  <div class="card">
    <h2>6. Tus derechos</h2>
    <p>Podés pedir en cualquier momento que te informemos qué datos tenemos sobre vos, o que los eliminemos, escribiendo a <a href="mailto:mateo.bravo.medina@gmail.com">mateo.bravo.medina@gmail.com</a>. Ten en cuenta que borrar cierta información (como advertencias de moderación) puede afectar el funcionamiento del bot en ese servidor.</p>
  </div>

  <div class="card">
    <h2>7. Menores de edad</h2>
    <p>El uso de Discord y de este bot requiere cumplir con los Términos de Servicio de Discord, que exigen una edad mínima de 13 años (o la que corresponda según tu país).</p>
  </div>

  <div class="card">
    <h2>8. Cambios</h2>
    <p>Esta política puede actualizarse. Los cambios importantes se van a reflejar en esta misma página con la fecha de última actualización.</p>
  </div>

  <div class="card">
    <h2>9. Contacto</h2>
    <p>Para cualquier consulta sobre privacidad, escribinos a <a href="mailto:mateo.bravo.medina@gmail.com">mateo.bravo.medina@gmail.com</a>.</p>
  </div>`;
  return layout({ title: 'Política de Privacidad', user: null, body });
}

// pantalla de inicio del dashboard: grilla de tarjetas, una por funcion del
// bot (se arma reusando NAV_GROUPS para no duplicar la lista de paginas)
// lo basico que conviene dejar andando en un server nuevo; cada item se marca
// hecho segun la config real (no una lista fija de "tareas")
function setupChecklist(config) {
  return [
    { label: 'Bienvenida', href: '/dashboard/bienvenida', done: Boolean(config.welcome?.enabled && config.welcome?.channelId) },
    { label: 'Logs', href: '/dashboard/logs', done: Boolean(config.logging?.enabled && config.logging?.channelId) },
    { label: 'Automoderación', href: '/dashboard/automoderacion', done: Boolean(config.automod?.enabled) },
    { label: 'Panel de tickets', href: '/dashboard/tickets', done: (config.ticketPanels || []).some((p) => p.messageId) },
    { label: 'Niveles', href: '/dashboard/niveles', done: Boolean(config.leveling?.enabled) },
    { label: 'Guía del servidor', href: '/dashboard/guia', done: Boolean(config.serverGuide?.enabled) },
    { label: 'Alertas', href: '/dashboard/alertas', done: Boolean(config.alerts?.enabled && config.alerts.items?.length) },
  ];
}

function dashboardHomePage({ user, config, guildName }) {
  const allLinks = NAV_GROUPS.flatMap((group) => group.links);
  const toggleable = allLinks.filter((link) => link.enabledPath);
  const activeCount = toggleable.filter((link) => getConfigValue(config, link.enabledPath)).length;
  const checklist = setupChecklist(config);
  const doneCount = checklist.filter((item) => item.done).length;

  // una lista por seccion, igual que el menu lateral; el estado (activo/apagado)
  // solo aparece donde la funcion tiene un interruptor
  const groups = NAV_GROUPS.map((group) => {
    const rows = group.links
      .map((link) => {
        const on = link.enabledPath ? Boolean(getConfigValue(config, link.enabledPath)) : null;
        const state = on === null ? '' : `<span class="state ${on ? 'on' : ''}">${on ? 'Activo' : 'Apagado'}</span>`;
        return `<a class="index-row" href="${link.href}" data-search="${escapeHtml(link.label.toLowerCase())}">${icon(link.icon, 18)}<span class="name">${escapeHtml(link.label)}</span>${state}</a>`;
      })
      .join('');
    return `<section class="index-group"><h2 class="index-group-title">${escapeHtml(group.label)}</h2>${rows}</section>`;
  }).join('');

  const body = `
  <h1>${guildName ? escapeHtml(guildName) : 'Panel'}</h1>
  <p class="muted">${user?.username ? `Sesión de ${escapeHtml(user.username)}. ` : ''}Elige qué quieres configurar.</p>

  <div class="stat-row home-stats">
    <div class="stat-tile"><div class="stat-value">${activeCount}/${toggleable.length}</div><div class="stat-label">funciones activas</div></div>
    <div class="stat-tile"><div class="stat-value">${doneCount}/${checklist.length}</div><div class="stat-label">básicos listos</div></div>
  </div>

  <div class="card">
    <h2>Puesta en marcha</h2>
    <div class="setup-list">
      ${checklist.map((item) => `<a class="setup-item ${item.done ? 'done' : ''}" href="${item.href}"><span class="box">${item.done ? icon('check', 11) : ''}</span>${escapeHtml(item.label)}</a>`).join('')}
    </div>
  </div>

  <input type="text" id="module-filter" class="module-filter" placeholder="Buscar una función…" autocomplete="off">
  <div class="index-grid" id="module-grid">${groups}</div>
  <script>
    (function () {
      var input = document.getElementById('module-filter');
      var rows = document.querySelectorAll('#module-grid .index-row');
      var groups = document.querySelectorAll('#module-grid .index-group');
      input.addEventListener('input', function () {
        var term = input.value.trim().toLowerCase();
        rows.forEach(function (row) {
          row.style.display = !term || row.dataset.search.indexOf(term) !== -1 ? '' : 'none';
        });
        groups.forEach(function (group) {
          var anyVisible = Array.prototype.some.call(group.querySelectorAll('.index-row'), function (row) { return row.style.display !== 'none'; });
          group.style.display = anyVisible ? '' : 'none';
        });
      });
    })();
  </script>`;
  return layout({ title: 'Panel', user, body, guildName });
}

function generalPage({ user, config, channels, guildName, flash }) {
  const excludedIds = new Set(config.tipsExcludedChannelIds || []);
  const channelOptions = (channels || [])
    .map((c) => `<option value="${c.id}" ${excludedIds.has(c.id) ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const tipsChannelOptions = (channels || [])
    .map((c) => `<option value="${c.id}" ${c.id === config.tipsChannelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');

  const body = `
  <h1>Configuración general</h1>
  <p class="muted">Idioma e intervalo del tip automático.</p>
  <form class="card" method="post" action="/dashboard/general">
    <label>Idioma</label>
    <select name="language">
      <option value="es" ${config.language === 'es' ? 'selected' : ''}>Español</option>
      <option value="en" ${config.language === 'en' ? 'selected' : ''}>English</option>
    </select>
    <label>Intervalo del tip automático (minutos)</label>
    <input type="number" name="tipsIntervalMinutes" min="1" value="${escapeHtml(config.tipsIntervalMinutes)}">
    <label>Canal de los tips</label>
    <select name="tipsChannelId"><option value="">-- el canal más activo (sin elegir uno fijo) --</option>${tipsChannelOptions}</select>
    <p class="muted" style="margin-top:6px;">Si eliges un canal, los tips se mandan solo ahí, y solo cuando alguien habló en ese canal desde el último tip (no le habla a un canal vacío). Sin elegir, el bot los manda al canal más activo del momento.</p>
    <label>Canales excluidos del tip automático</label>
    <select name="tipsExcludedChannelIds" multiple size="8">${channelOptions}</select>
    <p class="muted" style="margin-top:6px;">Solo se usa cuando no hay un canal fijo arriba: el bot manda el tip al canal más activo, salvo que sea uno de estos — ahí busca el siguiente más activo. Mantén Ctrl (o Cmd) apretado para elegir varios.</p>
    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'General', user, body, flash, guildName });
}

function welcomePage({ user, config, channels, roles, richMessages = [], guildName, flash }) {
  const richOptions = richMessages
    .map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === config.welcome.richMessageId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`)
    .join('');
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
  const roleOptions = (selected) =>
    (roles || []).map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');

  const welcomeMismatch = config.welcome.enabled && !config.welcome.channelId;
  const goodbyeMismatch = config.goodbye.enabled && !config.goodbye.channelId;

  const PLACEHOLDER_TOKENS = [
    { token: '{user}', label: '{user} — menciona al usuario', sample: '@Ejemplo' },
    { token: '{username}', label: '{username} — nombre de usuario', sample: 'usuario_ejemplo' },
    { token: '{server}', label: '{server} — nombre del server', sample: guildName || 'Tu Server' },
    { token: '{membercount}', label: '{membercount} — número de miembro', sample: '1464' },
    { token: '{joindate}', label: '{joindate} — fecha en que se unió', sample: new Date().toLocaleDateString('es-AR') },
  ];
  const placeholderButtons = (targetId) =>
    PLACEHOLDER_TOKENS.map(
      (p) => `<button type="button" class="btn placeholder-btn secondary small" data-target="${targetId}" data-token="${escapeHtml(p.token)}">${escapeHtml(p.label)}</button>`,
    ).join('');
  // los mismos tokens/samples, como JSON para que el script del preview los
  // use del lado del cliente (nunca pasa por el server, es solo para mostrar
  // un ejemplo mientras se edita)
  const placeholderSamplesJson = escapeHtml(JSON.stringify(Object.fromEntries(PLACEHOLDER_TOKENS.map((p) => [p.token, p.sample]))));

  const body = `
  <h1>Bienvenida y despedida</h1>

  <form class="card" method="post" action="/dashboard/bienvenida/welcome">
    <h2>Mensaje de bienvenida</h2>
    ${welcomeMismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se manda nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="w-enabled" ${config.welcome.enabled ? 'checked' : ''}>
      <label for="w-enabled" style="margin:0;">Activado</label></div>
    <label>Canal</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions(config.welcome.channelId)}</select>
    <label>Diseño avanzado (opcional)</label>
    <select name="richMessageId"><option value="">-- ninguno: usar el mensaje de abajo --</option>${richOptions}</select>
    <p class="muted" style="margin-top:-8px;">Si eliges un diseño de <a href="/dashboard/disenos">Mensajes avanzados</a>, se manda ese diseño en lugar del texto, el embed y la tarjeta de abajo. Admite <code>{user}</code>, <code>{username}</code>, <code>{server}</code>, <code>{membercount}</code>, <code>{avatar}</code> y <code>{servericon}</code>.</p>
    <label>Mensaje</label>
    <div>${placeholderButtons('w-message')}</div>
    <textarea name="message" id="w-message">${escapeHtml(config.welcome.message)}</textarea>
    <div class="checkbox-row"><input type="checkbox" name="useEmbed" id="w-embed" ${config.welcome.useEmbed ? 'checked' : ''}>
      <label for="w-embed" style="margin:0;">Mandar como embed (con foto de perfil del usuario)</label></div>
    <label>Título del embed</label>
    <input type="text" name="embedTitle" id="w-embedTitle" value="${escapeHtml(config.welcome.embedTitle || '')}" placeholder="👋 ¡Nuevo miembro!">
    <label>Imagen/banner del embed (opcional)</label>
    <input type="text" name="imageUrl" id="w-imageUrl" value="${escapeHtml(config.welcome.imageUrl || '')}" placeholder="https://...">
    <p class="muted" style="margin-top:-8px;">Pegá el link de una imagen ya subida a algún lado (Discord, Imgur, etc.). Solo se usa si "Mandar como embed" está activado.</p>
    <div class="checkbox-row"><input type="checkbox" name="aiPersonalized" id="w-ai" ${config.welcome.aiPersonalized ? 'checked' : ''}>
      <label for="w-ai" style="margin:0;">Usar la IA para redactar una bienvenida distinta cada vez</label></div>
    <p class="muted" style="margin-top:-8px;">Necesita la IA activada y configurada (página de IA). Si falla o no está configurada, se usa el mensaje fijo de arriba como respaldo.</p>
    <label>Rol automático al unirse (opcional)</label>
    <select name="roleId"><option value="">-- ninguno --</option>${roleOptions(config.welcome.roleId)}</select>
    <label>Rol automático para bots (opcional)</label>
    <select name="botRoleId"><option value="">-- ninguno --</option>${roleOptions(config.welcome.botRoleId)}</select>
    <p class="muted" style="margin-top:-8px;">Los bots que entran reciben este rol (y no se les manda mensaje de bienvenida).</p>

    <label>Vista previa (con datos de ejemplo)</label>
    <div class="embed-preview" id="w-preview">
      <div class="embed-preview-body">
        <div class="embed-preview-title" id="w-preview-title"></div>
        <div class="embed-preview-desc" id="w-preview-desc"></div>
        <img class="embed-preview-image" id="w-preview-image" style="display:none;">
      </div>
      <img class="embed-preview-thumb" src="https://cdn.discordapp.com/embed/avatars/0.png" alt="">
    </div>
    <div class="embed-preview-plain" id="w-preview-plain"></div>

    <button type="submit">Guardar bienvenida</button>
  </form>

  ${cardEditorSection('welcome', config.welcome.card)}

  <form class="card" method="post" action="/dashboard/bienvenida/goodbye">
    <h2>Mensaje de despedida</h2>
    ${goodbyeMismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se manda nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="g-enabled" ${config.goodbye.enabled ? 'checked' : ''}>
      <label for="g-enabled" style="margin:0;">Activado</label></div>
    <label>Canal</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions(config.goodbye.channelId)}</select>
    <label>Mensaje</label>
    <div>${placeholderButtons('g-message')}</div>
    <textarea name="message" id="g-message">${escapeHtml(config.goodbye.message)}</textarea>
    <div class="checkbox-row"><input type="checkbox" name="useEmbed" id="g-embed" ${config.goodbye.useEmbed ? 'checked' : ''}>
      <label for="g-embed" style="margin:0;">Mandar como embed (con foto de perfil del usuario)</label></div>

    <label>Vista previa (con datos de ejemplo)</label>
    <div class="embed-preview" id="g-preview">
      <div class="embed-preview-body">
        <div class="embed-preview-desc" id="g-preview-desc"></div>
      </div>
      <img class="embed-preview-thumb" src="https://cdn.discordapp.com/embed/avatars/0.png" alt="">
    </div>
    <div class="embed-preview-plain" id="g-preview-plain"></div>

    <button type="submit">Guardar despedida</button>
  </form>
  ${cardEditorSection('goodbye', config.goodbye.card)}
  <script>${CARD_EDITOR_SCRIPT}</script>
  <div id="placeholder-samples" data-samples="${placeholderSamplesJson}" style="display:none"></div>
  <script>
    document.querySelectorAll('.placeholder-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.value = target.value.slice(0, start) + btn.dataset.token + target.value.slice(end);
        target.focus();
        const cursor = start + btn.dataset.token.length;
        target.setSelectionRange(cursor, cursor);
        target.dispatchEvent(new Event('input'));
      });
    });

    const placeholderSamples = JSON.parse(document.getElementById('placeholder-samples').dataset.samples);
    function applyPlaceholderSamples(text) {
      return Object.keys(placeholderSamples).reduce(
        (acc, token) => acc.split(token).join(placeholderSamples[token]),
        text,
      );
    }

    function updateWelcomePreview() {
      const message = document.getElementById('w-message').value;
      const useEmbed = document.getElementById('w-embed').checked;
      const preview = document.getElementById('w-preview');
      const previewPlain = document.getElementById('w-preview-plain');
      const text = applyPlaceholderSamples(message);
      if (useEmbed) {
        preview.style.display = 'flex';
        previewPlain.style.display = 'none';
        document.getElementById('w-preview-title').textContent = document.getElementById('w-embedTitle').value || '👋 ¡Nuevo miembro!';
        document.getElementById('w-preview-desc').textContent = text;
        const imageUrl = document.getElementById('w-imageUrl').value.trim();
        const imageNode = document.getElementById('w-preview-image');
        if (imageUrl) { imageNode.src = imageUrl; imageNode.style.display = 'block'; }
        else { imageNode.removeAttribute('src'); imageNode.style.display = 'none'; }
      } else {
        preview.style.display = 'none';
        previewPlain.style.display = 'block';
        previewPlain.textContent = text;
      }
    }

    function updateGoodbyePreview() {
      const message = document.getElementById('g-message').value;
      const useEmbed = document.getElementById('g-embed').checked;
      const preview = document.getElementById('g-preview');
      const previewPlain = document.getElementById('g-preview-plain');
      const text = applyPlaceholderSamples(message);
      if (useEmbed) {
        preview.style.display = 'flex';
        previewPlain.style.display = 'none';
        document.getElementById('g-preview-desc').textContent = text;
      } else {
        preview.style.display = 'none';
        previewPlain.style.display = 'block';
        previewPlain.textContent = text;
      }
    }

    ['w-message', 'w-embed', 'w-embedTitle', 'w-imageUrl'].forEach((id) => {
      document.getElementById(id).addEventListener('input', updateWelcomePreview);
    });
    ['g-message', 'g-embed'].forEach((id) => {
      document.getElementById(id).addEventListener('input', updateGoodbyePreview);
    });
    updateWelcomePreview();
    updateGoodbyePreview();
  </script>`;
  return layout({ title: 'Bienvenida / Despedida', user, body, flash, guildName });
}

function automodPage({ user, config, guildName, flash }) {
  const body = `
  <h1>Automoderación</h1>
  <form class="card" method="post" action="/dashboard/automoderacion">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="a-enabled" ${config.automod.enabled ? 'checked' : ''}>
      <label for="a-enabled" style="margin:0;">Activada</label></div>

    <label>Palabras prohibidas (una por línea, se borra el mensaje si aparece alguna)</label>
    <textarea name="bannedWords">${escapeHtml((config.automod.bannedWords || []).join('\n'))}</textarea>

    <div class="checkbox-row"><input type="checkbox" name="blockInvites" id="a-invites" ${config.automod.blockInvites ? 'checked' : ''}>
      <label for="a-invites" style="margin:0;">Bloquear links de invitación a otros servers de Discord</label></div>

    <label>Límite de menciones en un mismo mensaje (0 = sin límite)</label>
    <input type="number" name="mentionSpamLimit" min="0" value="${escapeHtml(config.automod.mentionSpamLimit)}">

    <div class="checkbox-row"><input type="checkbox" name="aiAssist" id="a-ai-assist" ${config.automod.aiAssist ? 'checked' : ''}>
      <label for="a-ai-assist" style="margin:0;">Pedirle a la IA una segunda opinión cuando se borra un mensaje</label></div>
    <p class="muted" style="margin-top:-8px;">Necesita la IA activada y configurada (página de IA). Solo agrega una nota de contexto/severidad en el canal de logs — nunca banea, silencia ni toma ninguna acción por su cuenta.</p>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Automoderación', user, body, flash, guildName });
}

function messagesPage({ user, config, editingTopic, guildName, flash }) {
  const topicRows = (config.helpResponses.topics || [])
    .map(
      (t) => `<div class="server-row">
        <span class="name">${escapeHtml(t.name)} · ${t.keywords.length} palabra(s) clave</span>
        <span>
          <a class="btn" href="/dashboard/mensajes?editar=${encodeURIComponent(t.name)}">Editar</a>
          <form method="post" action="/dashboard/mensajes/ayuda/tema/eliminar" style="display:inline; margin:0;" data-confirm="¿Eliminar el tema \"${escapeHtml(t.name)}\"?">
            <input type="hidden" name="name" value="${escapeHtml(t.name)}">
            <button type="submit" class="danger inline">Eliminar</button>
          </form>
        </span>
      </div>`,
    )
    .join('');

  const topic = editingTopic || { name: '', keywords: [], examples: [], response: '' };

  const body = `
  <h1>Tips y respuestas de ayuda</h1>

  <form class="card" method="post" action="/dashboard/mensajes/tips">
    <h2>Tips automáticos</h2>
    <p class="muted">Uno por línea. Se elige uno al azar cada vez que se manda.</p>
    <textarea name="tips" style="min-height:180px;">${escapeHtml((config.tips || []).join('\n'))}</textarea>
    <button type="submit">Guardar tips</button>
  </form>

  <form class="card" method="post" action="/dashboard/mensajes/ayuda/general">
    <h2>Cuándo responde el bot</h2>
    <label>Palabras disparadoras (una por línea — alguna tiene que aparecer para que responda con parafraseo o el mensaje genérico)</label>
    <textarea name="generalTriggers">${escapeHtml((config.helpResponses.generalTriggers || []).join('\n'))}</textarea>
    <label>Mensaje genérico (cuando detecta un pedido de ayuda pero no un tema específico)</label>
    <textarea name="fallbackResponse">${escapeHtml(config.helpResponses.fallbackResponse)}</textarea>
    <button type="submit">Guardar</button>
  </form>

  <div class="card">
    <h2>Temas</h2>
    <p class="muted">Cada tema responde solo con que aparezca una de sus palabras clave (no hace falta decir "ayuda").</p>
    <div class="server-list">${topicRows || '<p class="muted">Todavía no hay temas.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/mensajes/ayuda/tema">
    <h2>${editingTopic ? `Editando: ${escapeHtml(editingTopic.name)}` : 'Nuevo tema'}</h2>
    <input type="hidden" name="originalName" value="${escapeHtml(topic.name)}">
    <label>Nombre (identificador simple, sin espacios)</label>
    <input type="text" name="name" value="${escapeHtml(topic.name)}" required>
    <label>Palabras clave (una por línea)</label>
    <textarea name="keywords">${escapeHtml(topic.keywords.join('\n'))}</textarea>
    <label>Frases de ejemplo (opcional, ayuda a reconocer paráfrasis sin la palabra exacta)</label>
    <textarea name="examples">${escapeHtml((topic.examples || []).join('\n'))}</textarea>
    <label>Respuesta</label>
    <textarea name="response" required>${escapeHtml(topic.response)}</textarea>
    <button type="submit">${editingTopic ? 'Guardar cambios' : 'Crear tema'}</button>
    ${editingTopic ? '<a class="btn secondary" href="/dashboard/mensajes" style="margin-left:10px;">Cancelar edición</a>' : ''}
  </form>`;
  return layout({ title: 'Tips y ayuda', user, body, flash, guildName });
}

function announcePage({ user, channels, guildName, flash }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  const body = `
  <h1>Mandar un anuncio</h1>
  <form class="card" method="post" action="/dashboard/anuncio">
    <label>Canal</label>
    <select name="channelId" required>${channelOptions}</select>
    <label>Título (opcional)</label>
    <input type="text" name="titulo">
    <label>Mensaje</label>
    <textarea name="mensaje" required></textarea>
    <label>Color (hex, opcional)</label>
    <input type="text" name="color" placeholder="#ec7b2c">
    <label>Imagen (URL, opcional)</label>
    <input type="url" name="imagen">
    <button type="submit">Enviar anuncio</button>
  </form>`;
  return layout({ title: 'Anuncios', user, body, flash });
}

function safeChartJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function statsPage({ user, stats, channelNames, leaderboard, economyLeaderboard, guildName }) {
  const channelEntries = Object.entries(stats.channelMessageCounts || {}).sort((a, b) => b[1] - a[1]);
  const topChannels = channelEntries.slice(0, 10);

  const rows = channelEntries
    .map(([channelId, count]) => `<tr><td>#${escapeHtml(channelNames[channelId] || channelId)}</td><td>${count}</td></tr>`)
    .join('');

  const leaderboardRows = (leaderboard || [])
    .map((entry, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(entry.displayName || entry.userId)}</td><td>${entry.xp} XP</td></tr>`)
    .join('');

  const economyRows = (economyLeaderboard || [])
    .map((entry, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(entry.displayName || entry.userId)}</td><td>${entry.balance}</td></tr>`)
    .join('');

  const hasCharts = topChannels.length || (leaderboard || []).length || (economyLeaderboard || []).length;

  const body = `
  <h1>Estadísticas</h1>

  <div class="card">
    <h2>Resumen</h2>
    <div class="stat-row">
      <div class="stat-tile"><div class="stat-value">${stats.totalMessages}</div><div class="stat-label">Mensajes totales</div></div>
      <div class="stat-tile"><div class="stat-value">${stats.openTickets}</div><div class="stat-label">Tickets abiertos</div></div>
      <div class="stat-tile"><div class="stat-value">${stats.closedTickets}</div><div class="stat-label">Tickets cerrados</div></div>
    </div>
  </div>

  <div class="card">
    <h2>Mensajes por canal</h2>
    <div style="max-width:100%; overflow-x:auto;"><canvas id="chart-channels" height="${Math.max(120, topChannels.length * 34)}"></canvas></div>
    <table style="margin-top:16px;"><thead><tr><th>Canal</th><th>Mensajes</th></tr></thead><tbody>${rows || '<tr><td colspan="2">Todavía no hay datos</td></tr>'}</tbody></table>
  </div>

  <div class="card">
    <h2>Top experiencia</h2>
    <canvas id="chart-xp" height="140"></canvas>
    <table style="margin-top:16px;"><thead><tr><th>#</th><th>Usuario</th><th>XP</th></tr></thead>
    <tbody>${leaderboardRows || '<tr><td colspan="3">Todavía no hay datos</td></tr>'}</tbody></table>
  </div>

  <div class="card">
    <h2>Top economía</h2>
    <canvas id="chart-economy" height="140"></canvas>
    <table style="margin-top:16px;"><thead><tr><th>#</th><th>Usuario</th><th>Saldo</th></tr></thead>
    <tbody>${economyRows || '<tr><td colspan="3">Todavía no hay datos</td></tr>'}</tbody></table>
  </div>

  ${
    hasCharts
      ? `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    (function () {
      var gridColor = 'rgba(255,255,255,0.06)';
      var textColor = '#8f8c82';
      Chart.defaults.color = textColor;
      Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";

      function barChart(id, labels, data, color, horizontal) {
        var el = document.getElementById(id);
        if (!el || !labels.length) return;
        new Chart(el, {
          type: 'bar',
          data: { labels: labels, datasets: [{ data: data, backgroundColor: color, borderRadius: 2, maxBarThickness: 24 }] },
          options: {
            indexAxis: horizontal ? 'y' : 'x',
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: gridColor }, ticks: { precision: 0 } },
              y: { grid: { color: gridColor }, ticks: { precision: 0 } },
            },
          },
        });
      }

      barChart('chart-channels', ${safeChartJson(topChannels.map(([id]) => `#${channelNames[id] || id}`))}, ${safeChartJson(topChannels.map(([, count]) => count))}, '#ec7b2c', true);
      barChart('chart-xp', ${safeChartJson((leaderboard || []).map((e) => e.displayName || e.userId))}, ${safeChartJson((leaderboard || []).map((e) => e.xp))}, '#7fb685', false);
      barChart('chart-economy', ${safeChartJson((economyLeaderboard || []).map((e) => e.displayName || e.userId))}, ${safeChartJson((economyLeaderboard || []).map((e) => e.balance))}, '#d9ad4e', false);
    })();
  </script>`
      : ''
  }`;
  return layout({ title: 'Estadísticas', user, body, guildName });
}

function ticketsPage({ user, tickets, guildName }) {
  const rows = tickets
    .map(
      (t) => `<tr>
        <td>${t.number ? `#${String(t.number).padStart(4, '0')}` : escapeHtml(t.channelId)}</td>
        <td>${escapeHtml(t.categoryLabel || '—')}</td>
        <td><span class="pill ${t.status}">${t.status === 'open' ? 'Abierto' : 'Cerrado'}</span></td>
        <td>${t.claimedBy ? `ID ${escapeHtml(t.claimedBy)}` : '—'}</td>
        <td>${t.rating ? `${t.rating}/5` : '—'}</td>
        <td>${new Date(t.createdAt).toLocaleString('es-AR')}</td>
      </tr>`,
    )
    .join('');

  const body = `
  <h1>Tickets</h1>
  <p class="muted">Para configurar categorías, panel, transcripciones y encuesta, andá a <a href="/dashboard/tickets/config">Config. Tickets</a>.</p>
  <div class="card">
    <table><thead><tr><th>Número</th><th>Categoría</th><th>Estado</th><th>Reclamado por</th><th>Calificación</th><th>Creado</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">Todavía no hay tickets</td></tr>'}</tbody></table>
  </div>`;
  return layout({ title: 'Tickets', user, body, guildName });
}

function serversPage({ user, managed, invitable }) {
  const managedRows = managed
    .map(
      (g) => `<div class="server-row"><span class="name">${escapeHtml(g.name)}</span><a class="btn" href="/servers/select/${g.id}">Gestionar</a></div>`,
    )
    .join('');

  const invitableRows = invitable
    .map(
      (g) => `<div class="server-row"><span class="name">${escapeHtml(g.name)}</span><a class="btn invite" href="${g.inviteUrl}">Invitar bot</a></div>`,
    )
    .join('');

  const body = `
  <h1>Tus servers</h1>
  <p class="muted">Solo se listan los servers donde tenés permiso de Gestionar servidor.</p>

  <div class="card">
    <h2>Ya gestionás</h2>
    <div class="server-list">${managedRows || '<p class="muted">Ninguno todavía.</p>'}</div>
  </div>

  <div class="card">
    <h2>Podés invitar el bot</h2>
    <div class="server-list">${invitableRows || '<p class="muted">Ninguno pendiente.</p>'}</div>
  </div>

  <p><a href="/servers/refresh">${icon('refresh', 14)} Actualizar lista</a></p>`;
  return layout({ title: 'Tus servers', user, body });
}

function levelsPage({ user, config, roles, channels, guildName, flash }) {
  const roleOptions = (selected) =>
    `<option value="">--</option>` +
    roles.map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
  const channelOptions = channels.map((c) => `<option value="${c.id}" ${c.id === config.leveling.levelUpChannelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const existingRoles = config.leveling.levelRoles || [];
  const rows = Array.from({ length: 5 }, (_, i) => existingRoles[i] || {});

  const roleRows = rows
    .map(
      (r, i) => `<div class="row-grid">
        <input type="number" name="level_${i + 1}" placeholder="Nivel" min="1" value="${r.level ?? ''}">
        <select name="role_${i + 1}">${roleOptions(r.roleId)}</select>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Niveles / XP</h1>
  <form class="card" method="post" action="/dashboard/niveles">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="l-enabled" ${config.leveling.enabled ? 'checked' : ''}>
      <label for="l-enabled" style="margin:0;">Activado</label></div>

    <label>XP mínima y máxima por mensaje</label>
    <div class="row-grid" style="grid-template-columns: 1fr 1fr;">
      <input type="number" name="xpMin" min="1" value="${escapeHtml(config.leveling.xpMin)}">
      <input type="number" name="xpMax" min="1" value="${escapeHtml(config.leveling.xpMax)}">
    </div>

    <label>Cooldown entre mensajes que dan XP (segundos)</label>
    <input type="number" name="cooldownSeconds" min="0" value="${escapeHtml(config.leveling.cooldownSeconds)}">

    <label>Canal para avisos de subida de nivel (vacío = el mismo canal donde escribió)</label>
    <select name="levelUpChannelId"><option value="">-- mismo canal --</option>${channelOptions}</select>

    <div class="checkbox-row"><input type="checkbox" name="voiceXpEnabled" id="l-voice" ${config.leveling.voiceXpEnabled ? 'checked' : ''}>
      <label for="l-voice" style="margin:0;">Dar XP también por tiempo en canales de voz</label></div>
    <label>XP por minuto conectado a voz</label>
    <input type="number" name="voiceXpPerMinute" min="0" value="${escapeHtml(config.leveling.voiceXpPerMinute)}">

    <label>Roles por nivel (hasta 5)</label>
    <p class="muted">Cuando alguien llega a ese nivel, se le asigna el rol automáticamente.</p>
    ${roleRows}

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Niveles', user, body, flash, guildName });
}

function reactionRolesPage({ user, sets, channels, roles, guildName, flash }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  const roleOptions = `<option value="">--</option>` + roles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  const pairRows = Array.from(
    { length: 5 },
    (_, i) => `<div class="row-grid">
      <input type="text" name="emoji_${i + 1}" data-emoji placeholder="Emoji (ej 🎨)">
      <select name="role_${i + 1}">${roleOptions}</select>
      <input type="text" name="label_${i + 1}" placeholder="Etiqueta (opcional)">
    </div>`,
  ).join('');

  const existingRows = sets
    .map(
      (s) => `<div class="server-row">
        <span class="name">#${escapeHtml(channels.find((c) => c.id === s.channelId)?.name || s.channelId)} — ${s.pairs.length} rol(es)</span>
        <form method="post" action="/dashboard/roles-reaccion/eliminar" style="margin:0;">
          <input type="hidden" name="messageId" value="${escapeHtml(s.messageId)}">
          <button type="submit" class="danger inline">Eliminar</button>
        </form>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Roles por reacción</h1>

  <div class="card">
    <h2>Mensajes activos</h2>
    <div class="server-list">${existingRows || '<p class="muted">Todavía no creaste ninguno.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/roles-reaccion">
    <h2>Crear mensaje nuevo</h2>
    <label>Canal</label>
    <select name="channelId" required>${channelOptions}</select>
    <label>Título (opcional)</label>
    <input type="text" name="titulo">
    <label>Descripción (opcional)</label>
    <textarea name="descripcion" style="min-height:70px;"></textarea>
    <label>Pares emoji / rol (hasta 5, dejá vacío lo que no uses)</label>
    ${pairRows}
    <button type="submit">Crear</button>
  </form>`;
  return layout({ title: 'Roles por reacción', user, body, flash, guildName });
}

function selectRolesPage({ user, sets, editingSet, channels, roles, guildName, flash }) {
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
  const roleOptions = (selected) =>
    `<option value="">--</option>` +
    roles
      .map(
        (r) =>
          `<option value="${r.id}" data-name="${escapeHtml(r.name)}" data-emoji="${escapeHtml(r.emoji || '')}" ${r.id === selected ? 'selected' : ''}>${escapeHtml(r.name)}</option>`,
      )
      .join('');

  const MAX_OPTIONS = 25;
  const optionRows = Array.from({ length: MAX_OPTIONS }, (_, i) => {
    const opt = editingSet?.options?.[i];
    return `<div class="row-grid" style="grid-template-columns: 1.4fr 1fr 0.5fr 1.6fr;">
      <input type="text" name="label_${i + 1}" class="role-autofill-label" placeholder="Nombre (ej: House Roja)" value="${escapeHtml(opt?.label || '')}">
      <select name="role_${i + 1}" class="role-autofill-select">${roleOptions(opt?.roleId)}</select>
      <input type="text" name="emoji_${i + 1}" class="role-autofill-emoji" data-emoji placeholder="Emoji" value="${escapeHtml(opt?.emoji || '')}">
      <input type="text" name="desc_${i + 1}" placeholder="Descripción (opcional)" value="${escapeHtml(opt?.description || '')}">
    </div>`;
  }).join('');

  const existingRows = sets
    .map(
      (s) => `<div class="server-row">
        <span class="name">${escapeHtml(s.title || 'Sin título')} — #${escapeHtml(channels.find((c) => c.id === s.channelId)?.name || s.channelId)} · ${s.options.length} opción(es)</span>
        <span style="display:flex; gap:8px;">
          <a class="btn" href="/dashboard/roles-menu?editar=${encodeURIComponent(s.messageId)}">Editar</a>
          <form method="post" action="/dashboard/roles-menu/eliminar" style="margin:0;" data-confirm="¿Eliminar el menú \"${escapeHtml(s.title || 'Sin título')}\"? Se borra tambien el mensaje publicado en Discord.">
            <input type="hidden" name="messageId" value="${escapeHtml(s.messageId)}">
            <button type="submit" class="danger inline">Eliminar</button>
          </form>
        </span>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Roles por menú desplegable</h1>
  <p class="muted">Publicá un mensaje con un menú desplegable: cada usuario elige una o varias opciones y se le asignan (o quitan) los roles correspondientes al instante. Ideal para "seguir" houses, equipos o categorías.</p>

  <div class="card">
    <h2>Menús activos</h2>
    <div class="server-list">${existingRows || '<p class="muted">Todavía no creaste ninguno.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/roles-menu">
    <h2>${editingSet ? `Editando: ${escapeHtml(editingSet.title || 'Sin título')}` : 'Crear menú nuevo'}</h2>
    ${editingSet ? `<input type="hidden" name="originalMessageId" value="${escapeHtml(editingSet.messageId)}">` : ''}
    <label>Canal</label>
    <select name="channelId" required>${channelOptions(editingSet?.channelId)}</select>
    ${editingSet ? '<p class="muted" style="margin-top:-8px;">Si cambiás el canal, se borra el mensaje viejo y se publica uno nuevo ahí. Si lo dejás igual, se edita el mensaje existente.</p>' : ''}
    <label>Título</label>
    <input type="text" name="titulo" placeholder="Menú de Artist's houses" value="${escapeHtml(editingSet?.title || '')}">
    <label>Descripción</label>
    <textarea name="descripcion" style="min-height:70px;" placeholder="Aquí podés seguir la artist house que quieras">${escapeHtml(editingSet?.description || '')}</textarea>
    <label>Texto del menú (placeholder)</label>
    <input type="text" name="placeholder" placeholder="Click aquí para elegir una house" value="${escapeHtml(editingSet?.placeholder || '')}">
    <label>Opciones (hasta ${MAX_OPTIONS} — es el máximo que permite Discord en un solo menú; dejá vacío lo que no uses)</label>
    ${optionRows}
    <button type="submit">${editingSet ? 'Guardar cambios' : 'Crear y publicar'}</button>
    ${editingSet ? '<a class="btn secondary" href="/dashboard/roles-menu" style="margin-left:10px;">Cancelar edición</a>' : ''}
  </form>
  <script>
    document.querySelectorAll('.role-autofill-select').forEach((select) => {
      select.addEventListener('change', () => {
        const opt = select.selectedOptions[0];
        const row = select.closest('.row-grid');
        const labelInput = row.querySelector('.role-autofill-label');
        const emojiInput = row.querySelector('.role-autofill-emoji');
        if (!opt || !opt.value) return;
        if (labelInput && !labelInput.value) labelInput.value = opt.dataset.name || '';
        if (emojiInput && !emojiInput.value && opt.dataset.emoji) {
          emojiInput.value = opt.dataset.emoji;
          emojiInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  </script>`;
  return layout({ title: 'Roles por menú', user, body, flash, guildName });
}

function logsPage({ user, config, channels, guildName, flash }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}" ${c.id === config.logging.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
  const mismatch = config.logging.enabled && !config.logging.channelId;

  const body = `
  <h1>Registro de actividad (logs)</h1>
  <form class="card" method="post" action="/dashboard/logs">
    ${mismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se registra nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="log-enabled" ${config.logging.enabled ? 'checked' : ''}>
      <label for="log-enabled" style="margin:0;">Activado</label></div>

    <label>Canal de logs</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <div class="checkbox-row"><input type="checkbox" name="logDeletes" id="log-del" ${config.logging.logDeletes ? 'checked' : ''}>
      <label for="log-del" style="margin:0;">Mensajes borrados</label></div>
    <div class="checkbox-row"><input type="checkbox" name="logEdits" id="log-edit" ${config.logging.logEdits ? 'checked' : ''}>
      <label for="log-edit" style="margin:0;">Mensajes editados</label></div>
    <div class="checkbox-row"><input type="checkbox" name="logJoins" id="log-join" ${config.logging.logJoins ? 'checked' : ''}>
      <label for="log-join" style="margin:0;">Entradas / salidas de miembros</label></div>
    <div class="checkbox-row"><input type="checkbox" name="logModeration" id="log-mod" ${config.logging.logModeration ? 'checked' : ''}>
      <label for="log-mod" style="margin:0;">Acciones de moderación (ban/kick/mute/warn)</label></div>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Logs', user, body, flash, guildName });
}

function customCommandsPage({ user, config, editingCommand, guildName, flash }) {
  const rows = (config.customCommands || [])
    .map(
      (cmd) => `<div class="server-row">
        <span class="name">/${escapeHtml(cmd.name)} ${cmd.adminOnly ? '· solo admins' : `· cooldown ${cmd.cooldownSeconds}s`}</span>
        <span>
          <a class="btn" href="/dashboard/comandos?editar=${encodeURIComponent(cmd.name)}">Editar</a>
          <form method="post" action="/dashboard/comandos/eliminar" style="display:inline; margin:0;" data-confirm="¿Eliminar el comando /${escapeHtml(cmd.name)}? Se borra también de Discord.">
            <input type="hidden" name="name" value="${escapeHtml(cmd.name)}">
            <button type="submit" class="danger inline">Eliminar</button>
          </form>
        </span>
      </div>`,
    )
    .join('');

  const cmd = editingCommand || { name: '', description: '', response: '', adminOnly: false, cooldownSeconds: 10 };

  const body = `
  <h1>Comandos personalizados</h1>

  <form class="card" method="post" action="/dashboard/comandos/prefijo">
    <h2>Comandos con prefijo</h2>
    <p class="muted">Todos los comandos también funcionan escribiéndolos en el chat con este prefijo. La mayoría van con espacios (ej. "!balance", "!mute @usuario 30 spam"). Los que tienen más de un campo de texto libre (/anuncio, /encuesta, /programar, /sorteo crear, /casa) van separados por "|" en vez de espacios, ej. "!anuncio Mensaje del anuncio | #canal | Título". Los de moderación y configuración piden el mismo permiso de Discord que su versión "/". Escribí "!help" en el chat para ver la lista completa — Discord no tiene autocompletado nativo para comandos con prefijo (eso es exclusivo de "/"), así que los "/" siguen apareciendo en el menú de Discord aunque también funcionen con "!".</p>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="tc-enabled" ${config.textCommands.enabled ? 'checked' : ''}>
      <label for="tc-enabled" style="margin:0;">Activado</label></div>
    <label>Prefijo</label>
    <input type="text" name="prefix" maxlength="5" value="${escapeHtml(config.textCommands.prefix)}" style="max-width:100px;">
    <button type="submit">Guardar</button>
  </form>

  <p class="muted">Los comandos personalizados de abajo se registran como comandos de barra /nombre. Puede tardar un minuto en aparecer en Discord.</p>

  <div class="card">
    <h2>Comandos activos</h2>
    <div class="server-list">${rows || '<p class="muted">Todavía no creaste ninguno.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/comandos">
    <h2>${editingCommand ? `Editando: /${escapeHtml(cmd.name)}` : 'Crear comando'}</h2>
    <input type="hidden" name="originalName" value="${escapeHtml(cmd.name)}">
    <label>Nombre (se ajusta automáticamente a minúsculas y sin espacios)</label>
    <input type="text" name="name" value="${escapeHtml(cmd.name)}" required maxlength="32">
    <label>Descripción (se ve en el autocompletado de Discord)</label>
    <input type="text" name="description" value="${escapeHtml(cmd.description)}" maxlength="100">
    <label>Respuesta (podés usar <code>{user}</code>)</label>
    <textarea name="response" required>${escapeHtml(cmd.response)}</textarea>
    <div class="checkbox-row"><input type="checkbox" name="adminOnly" id="cc-admin" ${cmd.adminOnly ? 'checked' : ''}>
      <label for="cc-admin" style="margin:0;">Solo para administradores</label></div>
    <label>Cooldown para usuarios normales (segundos, ignorado si es solo-admin)</label>
    <input type="number" name="cooldownSeconds" min="0" value="${cmd.cooldownSeconds}">
    <button type="submit">${editingCommand ? 'Guardar cambios' : 'Crear'}</button>
    ${editingCommand ? '<a class="btn secondary" href="/dashboard/comandos" style="margin-left:10px;">Cancelar edición</a>' : ''}
  </form>`;
  return layout({ title: 'Comandos', user, body, flash, guildName });
}

function housesPage({ user, config, channels, guildName, flash }) {
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const showMismatchWarning = config.houses.requestMessageId && !config.houses.enabled;

  const body = `
  <h1>Solicitudes de House</h1>
  <p class="muted">Publicá un mensaje con botón en un canal — al apretarlo, el usuario completa el formulario. Las respuestas llegan al canal de revisión con botones de Aceptar/Rechazar (requieren permiso de Gestionar servidor). También funciona con <code>/casa</code>.</p>

  ${showMismatchWarning ? '<div class="warning-banner">El mensaje sigue publicado en Discord, pero el sistema está desactivado — quien apriete el botón va a recibir un error. Activalo de nuevo o volvé a publicar para dar de baja el mensaje.</div>' : ''}

  <form class="card" method="post" action="/dashboard/houses">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="h-enabled" ${config.houses.enabled ? 'checked' : ''}>
      <label for="h-enabled" style="margin:0;">Activado</label></div>

    <label>Canal donde va el mensaje con el botón</label>
    <select name="requestChannelId"><option value="">-- elegir --</option>${channelOptions(config.houses.requestChannelId)}</select>

    <label>Título del mensaje</label>
    <input type="text" name="requestTitle" value="${escapeHtml(config.houses.requestTitle)}">

    <label>Descripción del mensaje</label>
    <textarea name="requestDescription">${escapeHtml(config.houses.requestDescription)}</textarea>

    <label>Canal de revisión (solo lo debería ver tu staff)</label>
    <select name="reviewChannelId"><option value="">-- elegir --</option>${channelOptions(config.houses.reviewChannelId)}</select>

    <label>Campos del formulario (uno por línea, hasta 5)</label>
    <textarea name="formFields">${escapeHtml((config.houses.formFields || []).join('\n'))}</textarea>

    <label>Mensaje por MD si se acepta</label>
    <textarea name="acceptMessage">${escapeHtml(config.houses.acceptMessage)}</textarea>

    <label>Mensaje por MD si se rechaza</label>
    <textarea name="rejectMessage">${escapeHtml(config.houses.rejectMessage)}</textarea>

    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/houses/publicar">
    <h2>Publicar / actualizar el mensaje con botón</h2>
    <p class="muted">Guardá los cambios de arriba primero. Esto borra el mensaje anterior (si había) y publica uno nuevo con la config actual.</p>
    <button type="submit">Publicar mensaje</button>
  </form>`;
  return layout({ title: 'Houses', user, body, flash, guildName });
}

function economyPage({ user, config, guildName, flash }) {
  const shopItemsText = (config.economy.shopItems || [])
    .map((item) => `${item.name}|${item.price}|${item.description || ''}`)
    .join('\n');

  const body = `
  <h1>Economía</h1>
  <form class="card" method="post" action="/dashboard/economia">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="e-enabled" ${config.economy.enabled ? 'checked' : ''}>
      <label for="e-enabled" style="margin:0;">Activada</label></div>

    <label>Nombre de la moneda</label>
    <input type="text" name="currencyName" value="${escapeHtml(config.economy.currencyName)}">

    <label>Emoji/símbolo de la moneda</label>
    <input type="text" name="currencySymbol" data-emoji="text" value="${escapeHtml(config.economy.currencySymbol)}">

    <label>Monto de /economia daily</label>
    <input type="number" name="dailyAmount" min="0" value="${escapeHtml(config.economy.dailyAmount)}">

    <label>Rango de /economia work (mínimo y máximo)</label>
    <div class="row-grid" style="grid-template-columns: 1fr 1fr;">
      <input type="number" name="workMinAmount" min="0" value="${escapeHtml(config.economy.workMinAmount)}">
      <input type="number" name="workMaxAmount" min="0" value="${escapeHtml(config.economy.workMaxAmount)}">
    </div>

    <label>Cooldown de /economia work (minutos)</label>
    <input type="number" name="workCooldownMinutes" min="1" value="${escapeHtml(config.economy.workCooldownMinutes)}">

    <label>Tienda: un item por línea, formato <code>nombre|precio|descripción</code> (la descripción es opcional)</label>
    <textarea name="shopItemsText" style="min-height:140px; font-family: monospace;">${escapeHtml(shopItemsText)}</textarea>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Economía', user, body, flash, guildName });
}

function casinoSettingsPage({ user, config, guildName, flash }) {
  const body = `
  <h1>Casino</h1>
  <p class="muted">Usa la moneda configurada en Economía. Necesitás tener Economía activada para que funcione.</p>
  <form class="card" method="post" action="/dashboard/casino">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="c-enabled" ${config.casino.enabled ? 'checked' : ''}>
      <label for="c-enabled" style="margin:0;">Activado</label></div>

    <label>Apuesta mínima</label>
    <input type="number" name="minBet" min="1" value="${escapeHtml(config.casino.minBet)}">

    <label>Apuesta máxima</label>
    <input type="number" name="maxBet" min="1" value="${escapeHtml(config.casino.maxBet)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Casino', user, body, flash, guildName });
}

function petsSettingsPage({ user, config, guildName, flash }) {
  const body = `
  <h1>Mascotas</h1>
  <form class="card" method="post" action="/dashboard/mascotas">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="p-enabled" ${config.pets.enabled ? 'checked' : ''}>
      <label for="p-enabled" style="margin:0;">Activado</label></div>

    <label>Cooldown para alimentar (minutos)</label>
    <input type="number" name="feedCooldownMinutes" min="1" value="${escapeHtml(config.pets.feedCooldownMinutes)}">

    <label>Cooldown para jugar (minutos)</label>
    <input type="number" name="playCooldownMinutes" min="1" value="${escapeHtml(config.pets.playCooldownMinutes)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Mascotas', user, body, flash, guildName });
}

function starboardPage({ user, config, channels, guildName, flash }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.starboard.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');

  const body = `
  <h1>Starboard</h1>
  <p class="muted">Cuando un mensaje junta suficientes reacciones de un emoji, se republica en el canal que elijas (ideal para un canal tipo #destacados). La reacción del propio autor no cuenta.</p>
  <form class="card" method="post" action="/dashboard/starboard">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="sb-enabled" ${config.starboard.enabled ? 'checked' : ''}>
      <label for="sb-enabled" style="margin:0;">Activado</label></div>

    <label>Emoji a contar</label>
    <input type="text" name="emoji" data-emoji value="${escapeHtml(config.starboard.emoji)}" maxlength="64">

    <label>Cantidad mínima de reacciones</label>
    <input type="number" name="threshold" min="1" value="${escapeHtml(config.starboard.threshold)}">

    <label>Canal de destacados</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Starboard', user, body, flash, guildName });
}

function triviaPage({ user, config, guildName, flash }) {
  const questionsText = (config.trivia.questions || [])
    .map((q) => `${q.question}|${q.options[0]}|${q.options[1]}|${q.options[2]}|${q.options[3]}|${q.correctIndex + 1}`)
    .join('\n');

  const body = `
  <h1>Trivia</h1>
  <p class="muted">Con <code>/trivia</code>, el bot tira una pregunta al azar con 4 opciones (A-D). El primero en apretar el botón correcto gana la recompensa.</p>
  <form class="card" method="post" action="/dashboard/trivia">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="tr-enabled" ${config.trivia.enabled ? 'checked' : ''}>
      <label for="tr-enabled" style="margin:0;">Activada</label></div>

    <label>Recompensa por acertar</label>
    <input type="number" name="rewardAmount" min="1" value="${escapeHtml(config.trivia.rewardAmount)}">

    <label>Preguntas: una por línea, formato <code>pregunta|opciónA|opciónB|opciónC|opciónD|correcta(1-4)</code></label>
    <textarea name="questionsText" style="min-height:200px; font-family: monospace;">${escapeHtml(questionsText)}</textarea>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Trivia', user, body, flash, guildName });
}

function miniEventsPage({ user, config, channels, guildName, flash }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.miniEvents.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const mismatch = config.miniEvents.enabled && !config.miniEvents.channelId;

  const body = `
  <h1>Eventos automáticos</h1>
  <p class="muted">De vez en cuando el bot publica un mensaje sorpresa — el primero en reaccionar gana monedas.</p>
  ${mismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se publica nada. Elegí uno abajo.</div>' : ''}
  <form class="card" method="post" action="/dashboard/eventos">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="me-enabled" ${config.miniEvents.enabled ? 'checked' : ''}>
      <label for="me-enabled" style="margin:0;">Activado</label></div>

    <label>Canal donde se publican</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <label>Cada cuánto (minutos)</label>
    <input type="number" name="intervalMinutes" min="5" value="${escapeHtml(config.miniEvents.intervalMinutes)}">

    <label>Recompensa</label>
    <input type="number" name="reward" min="1" value="${escapeHtml(config.miniEvents.reward)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Eventos', user, body, flash, guildName });
}

function aiPage({ user, config, channels, roles, aiConfigured, usageStats, guildName, flash }) {
  const hasOwnKey = Boolean(config.ai.apiKey);
  const setupWarning = !aiConfigured
    ? `<div class="warning-banner">Todavía no configuraste una clave de Groq. Podés activar estas opciones, pero no van a hacer nada hasta que pongas una clave abajo.</div>`
    : '';

  // config vieja tenia un solo channelId; si channelIds todavia no tiene
  // nada pero channelId si, se muestra ese como preseleccionado
  const selectedChannelIds = config.ai.channelIds?.length ? config.ai.channelIds : config.ai.channelId ? [config.ai.channelId] : [];
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${selectedChannelIds.includes(c.id) ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const digestChannelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.ai.digest?.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const renderFeedbackChannelOptions = channels
    .map((c) => `<option value="${c.id}" ${(config.ai.renderFeedback?.channelIds || []).includes(c.id) ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');

  const conversationChannelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.ai.conversation.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const chattinessOptions = [
    ['calmada', 'Calmada (habla poco)'],
    ['normal', 'Normal'],
    ['habladora', 'Habladora'],
  ]
    .map(([value, label]) => `<option value="${value}" ${config.ai.conversation.chattiness === value ? 'selected' : ''}>${label}</option>`)
    .join('');

  const toneOptions = [
    ['amigable', 'Amigable'],
    ['formal', 'Formal'],
    ['gracioso', 'Con humor'],
  ]
    .map(([value, label]) => `<option value="${value}" ${config.ai.tone === value ? 'selected' : ''}>${label}</option>`)
    .join('');

  const lastUsedText = usageStats.lastUsedAt
    ? new Date(usageStats.lastUsedAt).toLocaleString('es-AR')
    : 'Todavía no se usó';

  const body = `
  <h1>IA (gratis, con Groq)</h1>
  <p class="muted">Usa un modelo de IA gratuito para charlar: responde mejor cuando el sistema normal de ayuda no entiende la pregunta, y también contesta si te mencionan directamente. Puede consultar datos reales (nivel, balance), disparar una trivia o resumir un canal si se lo pedís por chat. Solo contesta texto — nunca borra mensajes, banea, ni toma ninguna acción de moderación ni de configuración por su cuenta.</p>
  ${setupWarning}

  <div class="card">
    <h2>Uso</h2>
    <table>
      <tr><td>Respuestas exitosas</td><td>${usageStats.successCount}</td></tr>
      <tr><td>Fallidas (timeout, error de Groq, etc.)</td><td>${usageStats.failCount}</td></tr>
      <tr><td>Último uso</td><td>${escapeHtml(lastUsedText)}</td></tr>
    </table>
  </div>

  <div class="card">
    <h2>Cómo conseguir la clave (gratis, sin tarjeta)</h2>
    <ol style="margin:0; padding-left:20px; font-size:14px; color:var(--text); line-height:1.8;">
      <li>Andá a <a href="https://console.groq.com/keys" target="_blank" rel="noopener" style="color:var(--accent);">console.groq.com/keys</a> e iniciá sesión (podés usar Google).</li>
      <li>Click en <strong>"Create API Key"</strong>, ponele un nombre y creala.</li>
      <li>Copiala y pegala abajo, en el campo "Clave de Groq".</li>
    </ol>
  </div>

  <form class="card" method="post" action="/dashboard/ia">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="ai-enabled" ${config.ai.enabled ? 'checked' : ''}>
      <label for="ai-enabled" style="margin:0;">Activada</label></div>

    <div class="checkbox-row"><input type="checkbox" name="helpFallback" id="ai-help" ${config.ai.helpFallback ? 'checked' : ''}>
      <label for="ai-help" style="margin:0;">Usar IA cuando no encuentra un tema específico de ayuda, y cuando lo mencionan directamente</label></div>

    <label>Canales permitidos (opcional)</label>
    <select name="channelIds" multiple size="6">${channelOptions}</select>
    <p class="muted" style="margin-top:-8px;">Sin nada seleccionado, la IA responde en todos los canales. Si elegís uno o varios, solo va a responder ahí (ni por mención ni como respaldo de ayuda). Mantené Ctrl (o Cmd en Mac) apretado para elegir varios. El resto de las funciones del bot (comandos, tips, automoderación) no depende de esto.</p>

    <label>Tono</label>
    <select name="tone">${toneOptions}</select>

    <label>Personalidad personalizada (opcional)</label>
    <textarea name="customPersonality" placeholder='Ej: "Sos sarcástico pero nunca ofensivo" o "Hablá como pirata de vez en cuando"' style="min-height:70px;">${escapeHtml(config.ai.customPersonality || '')}</textarea>
    <p class="muted" style="margin-top:-8px;">Se suma a las instrucciones del tono elegido arriba. Es texto libre — escribilo como si le estuvieras explicando a la IA cómo comportarse.</p>

    <label>Temas prohibidos (opcional, uno por línea)</label>
    <textarea name="forbiddenTopics" placeholder="política&#10;religión" style="min-height:70px;">${(config.ai.forbiddenTopics || []).join('\n')}</textarea>
    <p class="muted" style="margin-top:-8px;">Si un mensaje contiene alguna de estas palabras, la IA ni siquiera llega a procesarlo — responde directo que no puede hablar de eso. Funciona sin importar tildes.</p>

    <label>Cooldown por usuario (segundos)</label>
    <input type="number" name="cooldownSeconds" min="1" max="120" value="${config.ai.cooldownSeconds ?? 8}">
    <p class="muted" style="margin-top:-8px;">Cuánto tiempo tiene que esperar la misma persona entre un pedido a la IA y el siguiente (cuida la cuota gratis de Groq).</p>

    <label>Clave de Groq ${hasOwnKey ? '(ya tenés una guardada — dejá esto vacío para no cambiarla)' : ''}</label>
    <input type="password" name="apiKey" placeholder="${hasOwnKey ? '••••••••••••••••' : 'gsk_...'}" autocomplete="off">

    ${hasOwnKey ? `<div class="checkbox-row"><input type="checkbox" name="removeApiKey" id="ai-remove-key">
      <label for="ai-remove-key" style="margin:0;">Quitar la clave guardada</label></div>` : ''}

    <h2 style="margin-top:28px;">Moderación por chat con la IA</h2>
    <p class="muted">Los IDs de esta lista pueden pedirle al bot por chat (mencionándolo) que banee, expulse, silencie o advierta a alguien mencionando a la persona — por ejemplo "@bot baneá a @fulano por spam". El bot siempre pide confirmación (✅/❌) antes de banear/expulsar/silenciar, respeta los roles protegidos y la jerarquía de roles, y nunca deja que la IA decida esto por su cuenta.</p>
    <label>IDs de Discord autorizados (uno por línea)</label>
    <textarea name="staffUserIds" placeholder="123456789012345678" style="min-height:80px;">${(config.ai.staffUserIds || []).join('\n')}</textarea>
    <p class="muted" style="margin-top:-8px;">Activá el Modo de desarrollador en Discord (Configuración → Avanzado) para poder copiar el ID de cualquier usuario con clic derecho → "Copiar ID de usuario".</p>

    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/ia/conversacion">
    <h2>Conversación libre en un canal</h2>
    <p class="muted">Cuando alguien menciona al bot en el canal elegido, el bot lee lo que se venía hablando (o pregunta si falta contexto) y se queda un rato participando como uno más: mensajes cortos y relajados, sin responderle a todo. Si todos dejan de hablar, el bot también se calla y no vuelve a escribir hasta que lo mencionen. Funciona en <strong>un solo canal</strong>. Sigue siendo un bot: si le preguntan, lo dice. Para callarlo en cualquier momento se le puede escribir "@bot cállate".</p>
    ${config.ai.conversation.enabled && !config.ai.conversation.channelId ? '<div class="warning-banner">Está activada pero no elegiste el canal, así que no conversa en ninguno. Elige uno abajo.</div>' : ''}
    ${!config.ai.enabled ? '<div class="warning-banner">La IA de arriba está desactivada: la conversación libre no va a funcionar hasta que la actives.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="conv-enabled" ${config.ai.conversation.enabled ? 'checked' : ''}>
      <label for="conv-enabled" style="margin:0;">Conversación libre activada</label></div>

    <label>Canal de conversación</label>
    <select name="channelId"><option value="">-- elegir --</option>${conversationChannelOptions}</select>
    <p class="muted" style="margin-top:6px;">Este canal funciona por sí solo: no hace falta agregarlo a «Canales permitidos» de arriba (esa lista limita las respuestas por mención en el resto de los canales).</p>

    <div class="field-grid">
      <div>
        <label>Qué tan conversadora es</label>
        <select name="chattiness">${chattinessOptions}</select>
      </div>
      <div>
        <label>Se calla tras (minutos sin que nadie hable)</label>
        <input type="number" name="idleMinutes" min="1" max="30" value="${escapeHtml(config.ai.conversation.idleMinutes)}">
      </div>
      <div>
        <label>Duración máxima de una charla (minutos)</label>
        <input type="number" name="maxMinutes" min="2" max="120" value="${escapeHtml(config.ai.conversation.maxMinutes)}">
      </div>
      <div>
        <label>Mensajes máximos del bot por charla</label>
        <input type="number" name="maxReplies" min="3" max="100" value="${escapeHtml(config.ai.conversation.maxReplies)}">
      </div>
      <div>
        <label>Pausa mínima entre sus mensajes (segundos)</label>
        <input type="number" name="minSecondsBetweenReplies" min="3" max="120" value="${escapeHtml(config.ai.conversation.minSecondsBetweenReplies)}">
      </div>
    </div>
    <p class="muted">Cada mensaje del bot gasta una llamada a Groq, por eso hay tope de mensajes y de duración. Respeta los temas prohibidos, las pausas y el canal de IA de arriba, y nunca menciona a nadie con @.</p>
    <button type="submit">Guardar conversación</button>
  </form>

  <div class="card">
    <h2>Roles importantes (para que la IA sepa quién es quién)</h2>
    <p class="muted">Etiquetá roles del server (Owner/CEO, Staff, Helper, etc). La IA va a poder responder con los nombres reales de quienes tienen ese rol si le preguntan cosas como "quién es el owner" o "quiénes son staff".</p>
    <div class="server-list">${
      (config.ai.staffRoleTags || [])
        .map((tag) => {
          const role = roles.find((r) => r.id === tag.roleId);
          return `<div class="server-row">
            <span class="name">${escapeHtml(tag.label)} → ${role ? escapeHtml(role.name) : '(rol eliminado)'}</span>
            <form method="post" action="/dashboard/ia/staff-roles/eliminar" style="margin:0;" data-confirm="¿Quitar la etiqueta \"${escapeHtml(tag.label)}\"?">
              <input type="hidden" name="roleId" value="${escapeHtml(tag.roleId)}">
              <button type="submit" class="danger inline">Eliminar</button>
            </form>
          </div>`;
        })
        .join('') || '<p class="muted">Todavía no etiquetaste ningún rol.</p>'
    }</div>
  </div>

  <form class="card" method="post" action="/dashboard/ia/staff-roles">
    <h2>Etiquetar un rol</h2>
    <label>Etiqueta (cómo lo llama la IA)</label>
    <input type="text" name="label" required maxlength="60" placeholder="Owner / CEO">
    <label>Rol de Discord</label>
    <select name="roleId" required><option value="">-- elegir --</option>${roles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select>
    <button type="submit">Agregar</button>
  </form>

  <form class="card" method="post" action="/dashboard/ia/resumen">
    <h2>Resumen automático</h2>
    <p class="muted">Publica solo, sin que nadie lo pida, un resumen con datos reales del server (mensajes, tickets, sorteos, sugerencias) redactado por la IA. Necesita la IA activada y configurada.</p>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="digest-enabled" ${config.ai.digest?.enabled ? 'checked' : ''}>
      <label for="digest-enabled" style="margin:0;">Activado</label></div>
    <label>Canal donde se publica</label>
    <select name="channelId"><option value="">-- elegir --</option>${digestChannelOptions}</select>
    <label>Frecuencia</label>
    <select name="frequency">
      <option value="daily" ${config.ai.digest?.frequency !== 'weekly' ? 'selected' : ''}>Diario</option>
      <option value="weekly" ${config.ai.digest?.frequency === 'weekly' ? 'selected' : ''}>Semanal</option>
    </select>
    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/ia/feedback-renders">
    <h2>Feedback de renders</h2>
    <p class="muted">Si alguien reacciona con el emoji elegido a un mensaje con imagen en uno de estos canales, la IA da feedback técnico real sobre esa imagen puntual (composición, iluminación, etc). Necesita que la cuenta de Groq tenga acceso a un modelo con visión — si no, avisa en vez de inventar una crítica sin haber "visto" la imagen.</p>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="rf-enabled" ${config.ai.renderFeedback?.enabled ? 'checked' : ''}>
      <label for="rf-enabled" style="margin:0;">Activado</label></div>
    <label>Canales donde funciona</label>
    <select name="channelIds" multiple size="6">${renderFeedbackChannelOptions}</select>
    <label>Emoji para pedir feedback</label>
    <input type="text" name="emoji" data-emoji maxlength="64" value="${escapeHtml(config.ai.renderFeedback?.emoji || '🔍')}">
    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'IA', user, body, flash, guildName });
}

function serverGuidePage({ user, config, channels, guildName, flash, editingSection }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.serverGuide.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');

  const sectionRows = (config.serverGuide.sections || [])
    .map(
      (s) => `<div class="server-row">
        <span class="name">${emojiHtml(s.emoji)} ${escapeHtml(s.label)}</span>
        <div style="display:flex; gap:8px;">
          <a class="btn secondary" href="/dashboard/guia?edit=${encodeURIComponent(s.id)}">Editar</a>
          <form method="post" action="/dashboard/guia/seccion/eliminar" style="margin:0;">
            <input type="hidden" name="id" value="${escapeHtml(s.id)}">
            <button type="submit" class="danger inline">Eliminar</button>
          </form>
        </div>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Guía del servidor</h1>
  <p class="muted">Publicá un panel con botones — cada uno muestra el contenido de esa sección (visible solo para quien lo aprieta).</p>

  <div class="card">
    <h2>Secciones</h2>
    <div class="server-list">${sectionRows || '<p class="muted">Todavía no hay secciones.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/guia/seccion">
    <h2>${editingSection ? 'Editar sección' : 'Nueva sección'}</h2>
    ${editingSection ? `<input type="hidden" name="id" value="${escapeHtml(editingSection.id)}">` : ''}
    <label>Nombre</label>
    <input type="text" name="label" required maxlength="80" value="${escapeHtml(editingSection ? editingSection.label : '')}">
    <label>Emoji (opcional)</label>
    <input type="text" name="emoji" data-emoji maxlength="64" value="${escapeHtml(editingSection ? editingSection.emoji || '' : '')}">
    <label>Contenido</label>
    <textarea name="content" required style="min-height:100px;">${escapeHtml(editingSection ? editingSection.content : '')}</textarea>
    <button type="submit">${editingSection ? 'Guardar cambios' : 'Crear sección'}</button>
    ${editingSection ? '<a href="/dashboard/guia" style="margin-left:12px; color:var(--muted); font-size:13px;">Cancelar</a>' : ''}
  </form>

  <form class="card" method="post" action="/dashboard/guia">
    <h2>Panel</h2>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="guide-enabled" ${config.serverGuide.enabled ? 'checked' : ''}>
      <label for="guide-enabled" style="margin:0;">Activado</label></div>

    <label>Canal donde va el panel</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <label>Título</label>
    <input type="text" name="title" value="${escapeHtml(config.serverGuide.title)}">

    <label>Descripción</label>
    <textarea name="description">${escapeHtml(config.serverGuide.description)}</textarea>

    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/guia/publicar">
    <h2>Publicar / actualizar el panel</h2>
    <p class="muted">Guardá los cambios de arriba primero. Esto borra el panel anterior (si había) y publica uno nuevo con las secciones actuales.</p>
    <button type="submit">Publicar panel</button>
  </form>`;
  return layout({ title: 'Guía', user, body, flash, guildName });
}

function ticketConfigPage({ user, config, editingPanel, editingCategory, channels, categoryChannels, roles, guildName, flash }) {
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const categoryChannelOptions = (selected) =>
    (categoryChannels || [])
      .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');

  const roleOptions = (selectedIds) =>
    roles.map((r) => `<option value="${r.id}" ${selectedIds.includes(r.id) ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');

  const categoryCheckOptions = (selectedIds) =>
    (config.ticketCategories || [])
      .map(
        (cat) =>
          `<option value="${escapeHtml(cat.id)}" ${(selectedIds || []).includes(cat.id) ? 'selected' : ''}>${cat.emoji ? `${escapeHtml(emojiPlain(cat.emoji))} ` : ''}${escapeHtml(cat.label)}</option>`,
      )
      .join('');

  const categoryRows = (config.ticketCategories || [])
    .map(
      (cat) => `<div class="server-row">
        <span class="name">${cat.emoji ? `${emojiHtml(cat.emoji)} ` : ''}${escapeHtml(cat.label)} ${cat.staffRoleIds?.length ? `· ${cat.staffRoleIds.length} rol(es)` : '· sin rol (usa Manage Server)'}</span>
        <span style="display:flex; gap:8px;">
          <a class="btn" href="/dashboard/tickets/config?editarCategoria=${encodeURIComponent(cat.id)}">Editar</a>
          <form method="post" action="/dashboard/tickets/config/categoria/eliminar" style="margin:0;" data-confirm="¿Eliminar la categoría \"${escapeHtml(cat.label)}\"? Los paneles que la usan van a dejar de mostrarla.">
            <input type="hidden" name="id" value="${escapeHtml(cat.id)}">
            <button type="submit" class="danger inline">Eliminar</button>
          </form>
        </span>
      </div>`,
    )
    .join('');

  const categoryLabelById = Object.fromEntries((config.ticketCategories || []).map((c) => [c.id, `${c.emoji ? `${emojiPlain(c.emoji)} ` : ''}${c.label}`]));

  const panelRows = (config.ticketPanels || [])
    .map((panel) => {
      const channel = channels.find((c) => c.id === panel.channelId);
      const categoriesText = panel.categoryIds && panel.categoryIds.length
        ? panel.categoryIds.map((id) => categoryLabelById[id] || id).join(', ')
        : 'Todas las categorías';
      const styleText = panel.style === 'button' ? 'botones' : 'menú desplegable';
      return `<div class="server-row">
        <span class="name">${escapeHtml(panel.title)} · canal: ${channel ? '#' + escapeHtml(channel.name) : '(sin canal)'} · ${escapeHtml(categoriesText)} · ${styleText} ${panel.messageId ? '· publicado' : '· sin publicar'}</span>
        <div style="display:flex; gap:8px;">
          <a class="btn" href="/dashboard/tickets/config?editarPanel=${encodeURIComponent(panel.id)}">Editar</a>
          <form method="post" action="/dashboard/tickets/config/panel/publicar" style="margin:0;">
            <input type="hidden" name="id" value="${escapeHtml(panel.id)}">
            <button type="submit" style="margin:0;">${panel.messageId ? 'Actualizar' : 'Publicar'}</button>
          </form>
          <form method="post" action="/dashboard/tickets/config/panel/eliminar" style="margin:0;" data-confirm="¿Eliminar el panel \"${escapeHtml(panel.title)}\"?${panel.messageId ? ' El mensaje publicado en Discord queda huerfano (no se borra solo).' : ''}">
            <input type="hidden" name="id" value="${escapeHtml(panel.id)}">
            <button type="submit" class="danger inline">Eliminar</button>
          </form>
        </div>
      </div>`;
    })
    .join('');

  const body = `
  <h1>Configuración de tickets</h1>

  <div class="card">
    <h2>Categorías</h2>
    <p class="muted">Cada categoría aparece como opción en el menú del panel. Si no elegís roles de staff, se usa cualquier rol con "Gestionar servidor".</p>
    <div class="server-list">${categoryRows || '<p class="muted">Todavía no hay categorías.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/tickets/config/staff-default">
    <h2>Quién ve todos los tickets</h2>
    <p class="muted">Estos roles ven CUALQUIER ticket sin importar la categoría, además de los roles específicos que elijas por categoría abajo.</p>
    <select name="ticketDefaultStaffRoleIds" multiple size="5">${roleOptions(config.ticketDefaultStaffRoleIds || [])}</select>
    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/tickets/config/categoria">
    <h2>${editingCategory ? `Editando: ${escapeHtml(editingCategory.label)}` : 'Nueva categoría'}</h2>
    ${editingCategory ? `<input type="hidden" name="originalId" value="${escapeHtml(editingCategory.id)}">` : ''}
    <label>Nombre</label>
    <input type="text" name="label" required maxlength="80" value="${escapeHtml(editingCategory ? editingCategory.label : '')}">
    <label>Emoji</label>
    <input type="text" name="emoji" data-emoji placeholder="🎫" maxlength="64" value="${escapeHtml(editingCategory ? editingCategory.emoji || '' : '')}">
    <label>Descripción (se muestra dentro del ticket)</label>
    <textarea name="description" style="min-height:70px;">${escapeHtml(editingCategory ? editingCategory.description || '' : '')}</textarea>
    <label>Roles de staff con acceso (opcional, podés elegir varios)</label>
    <select name="staffRoleIds" multiple size="5">${roleOptions(editingCategory ? editingCategory.staffRoleIds || [] : [])}</select>
    <button type="submit">${editingCategory ? 'Guardar cambios' : 'Crear categoría'}</button>
    ${editingCategory ? '<a class="btn secondary" href="/dashboard/tickets/config" style="margin-left:10px;">Cancelar edición</a>' : ''}
  </form>

  <div class="card">
    <h2>Paneles</h2>
    <p class="muted">Podés tener varios paneles a la vez, cada uno en su propio canal con su propio set de categorías (por ejemplo, uno de "Soporte" en #ayuda y otro de "Compras" en #tienda).</p>
    <div class="server-list">${panelRows || '<p class="muted">Todavía no hay paneles.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/tickets/config/panel">
    <h2>${editingPanel ? `Editando: ${escapeHtml(editingPanel.title)}` : 'Nuevo panel'}</h2>
    ${editingPanel ? `<input type="hidden" name="originalId" value="${escapeHtml(editingPanel.id)}">` : ''}
    <label>Canal donde va el panel</label>
    <select name="channelId" required><option value="">-- elegir --</option>${channelOptions(editingPanel ? editingPanel.channelId : null)}</select>
    <label>Título</label>
    <input type="text" name="title" value="${escapeHtml(editingPanel ? editingPanel.title : '🎫 Centro de soporte')}">
    <label>Descripción</label>
    <textarea name="description">${escapeHtml(editingPanel ? editingPanel.description : 'Elegí abajo el tipo de ticket que necesitás para que el staff te ayude.')}</textarea>
    <label>Categorías que muestra este panel (dejá vacío para mostrar todas)</label>
    <select name="categoryIds" multiple size="5">${categoryCheckOptions(editingPanel ? editingPanel.categoryIds : [])}</select>
    <label>Categoría de Discord donde se crean los canales de ticket</label>
    <select name="categoryChannelId"><option value="">-- Auto (crea/usa una categoría "Tickets") --</option>${categoryChannelOptions(editingPanel ? editingPanel.categoryChannelId : null)}</select>
    <label>Estilo</label>
    <div class="checkbox-row"><input type="radio" name="style" value="select" id="style-select" ${!editingPanel || editingPanel.style !== 'button' ? 'checked' : ''}>
      <label for="style-select" style="margin:0;">Menú desplegable</label></div>
    <div class="checkbox-row"><input type="radio" name="style" value="button" id="style-button" ${editingPanel && editingPanel.style === 'button' ? 'checked' : ''}>
      <label for="style-button" style="margin:0;">Botones (uno por categoría)</label></div>
    <button type="submit">${editingPanel ? 'Guardar cambios' : 'Crear panel'}</button>
    ${editingPanel ? '<a class="btn" href="/dashboard/tickets/config" style="margin-left:8px;">Cancelar</a>' : ''}
  </form>

  <form class="card" method="post" action="/dashboard/tickets/config/transcripciones">
    <h2>Transcripciones</h2>
    <div class="checkbox-row"><input type="checkbox" name="transcriptsEnabled" id="t-enabled" ${config.ticketTranscripts.enabled ? 'checked' : ''}>
      <label for="t-enabled" style="margin:0;">Activadas</label></div>
    <label>Canal de transcripciones</label>
    <select name="transcriptsChannelId"><option value="">-- elegir --</option>${channelOptions(config.ticketTranscripts.channelId)}</select>

    <h2>Encuesta de satisfacción</h2>
    <div class="checkbox-row"><input type="checkbox" name="feedbackEnabled" id="f-enabled" ${config.ticketFeedback.enabled ? 'checked' : ''}>
      <label for="f-enabled" style="margin:0;">Activada (se manda por MD al cerrar el ticket)</label></div>

    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/tickets/config/panel/publicar">
    <h2>Publicar / actualizar el panel</h2>
    <p class="muted">Guardá los cambios de arriba primero. Esto borra el panel anterior (si había) y publica uno nuevo.</p>
    <button type="submit">Publicar panel</button>
  </form>`;
  return layout({ title: 'Config. Tickets', user, body, flash, guildName });
}

function accessDeniedPage({ user, guildName }) {
  const body = `
  <h1>Acceso denegado</h1>
  <div class="card">
    <p>No tenés permiso para entrar al dashboard de este server. Si pensás que es un error, pedile al dueño del server que te agregue a la lista de usuarios permitidos, o que te saque de la de bloqueados, desde Estado / Debug.</p>
    <a class="btn" href="/servers">Volver a mis servers</a>
  </div>`;
  return layout({ title: 'Acceso denegado', user, body, flash: null, guildName });
}

function debugPasswordPage({ user, guildName, flash }) {
  const body = `
  <h1>Estado / Debug</h1>
  <div class="card">
    <h2>Página protegida</h2>
    <p class="muted">Esta página pide una contraseña aparte, además de tu acceso normal al dashboard.</p>
    <form method="post" action="/dashboard/debug/desbloquear">
      <label>Contraseña</label>
      <input type="password" name="password" autocomplete="off" autofocus>
      <button type="submit">Entrar</button>
    </form>
  </div>`;
  return layout({ title: 'Estado / Debug', user, body, flash, guildName });
}

function debugPage({ user, config, channels, guildName, flash, stats }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}" ${c.id === config.debug.errorChannelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
  const mismatch = config.debug.enabled && !config.debug.errorChannelId;
  const hasPassword = Boolean(config.dashboardAccess.passwordHash);

  const body = `
  <h1>Estado / Debug</h1>

  <div class="card">
    <h2>Estado del bot</h2>
    <table>
      <tr><td>Versión</td><td>${escapeHtml(stats.version)}</td></tr>
      <tr><td>Node</td><td>${escapeHtml(stats.nodeVersion)}</td></tr>
      <tr><td>Ping</td><td>${stats.ping}ms</td></tr>
      <tr><td>Uptime</td><td>${escapeHtml(stats.uptime)}</td></tr>
      <tr><td>Servers conectados</td><td>${stats.guildCount}</td></tr>
      <tr><td>Memoria (heap)</td><td>${stats.memoryMb} MB</td></tr>
    </table>
  </div>

  <form class="card" method="post" action="/dashboard/debug">
    <h2>Canal de errores</h2>
    ${mismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se reportan errores. Elegí uno abajo.</div>' : ''}
    <p class="muted">Si algo falla internamente, el bot puede avisarte en un canal de Discord.</p>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="debug-enabled" ${config.debug.enabled ? 'checked' : ''}>
      <label for="debug-enabled" style="margin:0;">Activado</label></div>

    <label>Canal para reportar errores</label>
    <select name="errorChannelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <button type="submit">Guardar</button>
  </form>

  <div class="card">
    <h2>Comando /debug</h2>
    <p class="muted">Cualquier miembro con permiso "Gestionar servidor" puede usar <code>/debug</code> en Discord para ver esta misma info técnica al instante.</p>
  </div>

  <form class="card" method="post" action="/dashboard/debug/acceso">
    <h2>Acceso al dashboard</h2>
    <p class="muted">Además de necesitar "Administrar servidor" en Discord, podés restringir quién entra al dashboard de este server. El dueño real del server (según Discord) siempre puede entrar, para evitar quedarse afuera por una lista mal cargada.</p>

    <label>Contraseña de esta página ${hasPassword ? '(dejá vacío para no cambiarla)' : '(todavía no tiene una)'}</label>
    <input type="password" name="password" placeholder="${hasPassword ? '••••••••' : ''}" autocomplete="off">

    <label>IDs de usuario permitidos (uno por línea; si dejás esto vacío, entra cualquiera con "Administrar servidor" que no esté bloqueado)</label>
    <textarea name="allowedUserIds" placeholder="123456789012345678">${escapeHtml((config.dashboardAccess.allowedUserIds || []).join('\n'))}</textarea>

    <label>IDs de usuario bloqueados (uno por línea; nunca entran, aunque tengan "Administrar servidor")</label>
    <textarea name="blockedUserIds" placeholder="123456789012345678">${escapeHtml((config.dashboardAccess.blockedUserIds || []).join('\n'))}</textarea>

    <p class="muted">Para conseguir el ID de un usuario: activá el "Modo desarrollador" en Discord (Ajustes > Avanzado), después clic derecho sobre la persona > Copiar ID de usuario.</p>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Estado / Debug', user, body, flash, guildName });
}

function appearancePage({ user, config, guildName, flash }) {
  const colorLabels = { brand: 'Marca', success: 'Éxito', error: 'Error', warning: 'Advertencia', info: 'Info' };
  const colorRows = Object.keys(colorLabels)
    .map(
      (key) => `<div class="color-row">
        <label for="color-${key}">${colorLabels[key]}</label>
        <input type="color" id="color-${key}" name="color_${key}" value="${escapeHtml(config.branding.colors[key])}">
      </div>`,
    )
    .join('');

  const body = `
  <h1>Apariencia</h1>
  <p class="muted">Personalizá cómo se ve el bot en este server: los colores de sus embeds, el pie de página y su apodo.</p>

  <form class="card" method="post" action="/dashboard/apariencia">
    <h2>Colores de los embeds</h2>
    <p class="muted">Se usan en casi todos los mensajes con formato del bot (tickets, niveles, economía, moderación, etc).</p>
    ${colorRows}

    <h2 style="margin-top:24px;">Firma de los embeds</h2>
    <label>Texto del footer (opcional)</label>
    <input type="text" name="footerText" maxlength="100" placeholder="Ej: Powered by tu server" value="${escapeHtml(config.branding.footerText)}">
    <label>URL del ícono del footer (opcional)</label>
    <input type="text" name="footerIcon" maxlength="300" placeholder="https://..." value="${escapeHtml(config.branding.footerIcon)}">

    <h2 style="margin-top:24px;">Apodo del bot</h2>
    <label>Cómo se muestra el nombre del bot en este server (dejá vacío para usar el default)</label>
    <input type="text" name="nickname" maxlength="32" value="${escapeHtml(config.branding.nickname)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Apariencia', user, body, flash, guildName });
}

function inviteTrackerPage({ user, config, channels, guildName, flash, missingPermission }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.inviteTracker.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const mismatch = config.inviteTracker.enabled && !config.inviteTracker.channelId;

  const body = `
  <h1>Invite Tracker</h1>
  <p class="muted">Rastrea qué invitación usó cada nuevo miembro. Usá <code>/invitaciones ver</code> y <code>/invitaciones ranking</code> en Discord para consultarlo.</p>

  ${missingPermission ? '<div class="warning-banner">El bot no tiene el permiso "Gestionar servidor" en este server, así que no puede leer las invitaciones. Volvé a invitarlo con el link actualizado desde "Tus servers", o dale ese permiso manualmente al rol del bot.</div>' : ''}

  <form class="card" method="post" action="/dashboard/invitaciones">
    ${mismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se registra nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="inv-enabled" ${config.inviteTracker.enabled ? 'checked' : ''}>
      <label for="inv-enabled" style="margin:0;">Activado</label></div>

    <label>Canal de logs (opcional)</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Invite Tracker', user, body, flash, guildName });
}

function suggestionsPage({ user, config, channels, roles, guildName, flash }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.suggestions.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const roleOptions = roles
    .map((r) => `<option value="${r.id}" ${config.suggestions.approvalRoleIds.includes(r.id) ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)
    .join('');
  const mismatch = config.suggestions.enabled && !config.suggestions.channelId;

  const body = `
  <h1>Buzón de sugerencias</h1>
  <p class="muted">Los mensajes que se manden en el canal elegido se convierten automáticamente en tarjetas votables. El staff las aprueba o rechaza con botones.</p>

  <form class="card" method="post" action="/dashboard/sugerencias">
    ${mismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no pasa nada todavía. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="sug-enabled" ${config.suggestions.enabled ? 'checked' : ''}>
      <label for="sug-enabled" style="margin:0;">Activado</label></div>

    <label>Canal de sugerencias</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <label>Roles que pueden aprobar/rechazar (opcional, podés elegir varios)</label>
    <select name="approvalRoleIds" multiple size="5">${roleOptions}</select>
    <p class="muted" style="margin-top:6px;">Si no elegís ninguno, se usa cualquier rol con "Gestionar servidor".</p>

    <div class="checkbox-row"><input type="checkbox" name="anonymous" id="sug-anon" ${config.suggestions.anonymous ? 'checked' : ''}>
      <label for="sug-anon" style="margin:0;">Ocultar el nombre de quien sugiere (anónimo)</label></div>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Sugerencias', user, body, flash, guildName });
}

function memberCounterPage({ user, config, voiceChannels, guildName, flash }) {
  const channelOptions = voiceChannels
    .map((c) => `<option value="${c.id}" ${c.id === config.memberCounter.channelId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  const mismatch = config.memberCounter.enabled && !config.memberCounter.channelId;

  const body = `
  <h1>Contador de miembros</h1>
  <p class="muted">Un canal de voz que muestra el número de miembros del server en su nombre. Se actualiza solo cada 10 minutos aprox (Discord limita cuántas veces se puede renombrar un canal).</p>

  <form class="card" method="post" action="/dashboard/contador">
    ${mismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se actualiza nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="mc-enabled" ${config.memberCounter.enabled ? 'checked' : ''}>
      <label for="mc-enabled" style="margin:0;">Activado</label></div>

    <label>Canal de voz</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>
    ${!voiceChannels.length ? '<p class="muted">No hay canales de voz en este server todavía. Creá uno en Discord primero.</p>' : ''}

    <label>Formato del nombre (usá <code>{count}</code> para el número)</label>
    <input type="text" name="template" maxlength="90" value="${escapeHtml(config.memberCounter.template)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Contador de miembros', user, body, flash, guildName });
}

function skillsPage({ user, config, roles, guildName, flash }) {
  const roleOptions = (roles || [])
    .map((r) => `<option value="${r.id}" ${(config.skills.roleIds || []).includes(r.id) ? 'selected' : ''}>${escapeHtml(r.name)}</option>`)
    .join('');

  const body = `
  <h1>Skills</h1>
  <p class="muted">Los miembros se auto-etiquetan con /skills agregar y otros pueden buscar quién sabe hacer qué con /skills buscar. Elegí qué roles reales del server cuentan como una "skill" — el resto de los roles queda afuera de este sistema.</p>

  <form class="card" method="post" action="/dashboard/skills">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="sk-enabled" ${config.skills.enabled ? 'checked' : ''}>
      <label for="sk-enabled" style="margin:0;">Activado</label></div>

    <label>Roles que cuentan como skill</label>
    <select name="roleIds" multiple size="8">${roleOptions}</select>
    ${!roles || !roles.length ? '<p class="muted">Este server no tiene roles asignables todavía.</p>' : ''}

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Skills', user, body, flash, guildName });
}

function birthdaysPage({ user, config, channels, guildName, flash }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.birthdays.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const mismatch = config.birthdays.enabled && !config.birthdays.channelId;

  const body = `
  <h1>Cumpleaños</h1>
  <p class="muted">Los usuarios cargan su fecha con <code>/cumpleanos configurar</code>. El bot anuncia solo el día que corresponde.</p>

  <form class="card" method="post" action="/dashboard/cumpleanos">
    ${mismatch ? '<div class="warning-banner">Está activado pero no elegiste canal, así que no se anuncia nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="bday-enabled" ${config.birthdays.enabled ? 'checked' : ''}>
      <label for="bday-enabled" style="margin:0;">Activado</label></div>

    <label>Canal para los anuncios</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <label>Mensaje (usá <code>{user}</code> para mencionar a quien cumple años)</label>
    <textarea name="message" style="min-height:70px;">${escapeHtml(config.birthdays.message)}</textarea>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Cumpleaños', user, body, flash, guildName });
}

// --- tarjetas de imagen de bienvenida/despedida ---

function cardEditorSection(kind, card) {
  const isWelcome = kind === 'welcome';
  const id = (name) => `${kind}-card-${name}`;
  const option = (value, label, selected) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`;
  const safe = card || {};

  return `
  <form class="card card-editor" id="${id('form')}" method="post" action="/dashboard/bienvenida/card" data-preview-kind="${kind}" data-preview-target="${id('img')}">
    <h2>Tarjeta de imagen ${isWelcome ? 'de bienvenida' : 'de despedida'}</h2>
    <p class="muted" style="margin-bottom:12px;">Genera una imagen con la foto del usuario que se manda junto al mensaje de ${isWelcome ? 'bienvenida' : 'despedida'}. Variables: <code>{username}</code>, <code>{server}</code>, <code>{membercount}</code>. Los emojis no se dibujan en la imagen.</p>
    <input type="hidden" name="kind" value="${kind}">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="${id('enabled')}" ${safe.enabled ? 'checked' : ''}>
      <label for="${id('enabled')}" style="margin:0;">Mandar la tarjeta</label></div>

    <div class="card-preview-wrap">
      <img id="${id('img')}" class="card-preview-img" alt="Vista previa de la tarjeta">
      <p class="muted card-preview-status">Generando vista previa…</p>
    </div>

    <div class="card-grid">
      <div>
        <label>Estilo</label>
        <select name="style">
          ${option('center', 'Centrado (avatar arriba)', safe.style)}
          ${option('left', 'Lateral (avatar a la izquierda)', safe.style)}
        </select>
      </div>
      <div>
        <label>Forma del avatar</label>
        <select name="avatarShape">
          ${option('circle', 'Círculo', safe.avatarShape)}
          ${option('rounded', 'Cuadrado redondeado', safe.avatarShape)}
          ${option('square', 'Cuadrado', safe.avatarShape)}
        </select>
      </div>
    </div>

    <label>Título</label>
    <input type="text" name="title" maxlength="60" value="${escapeHtml(safe.title)}">
    <label>Subtítulo</label>
    <input type="text" name="subtitle" maxlength="100" value="${escapeHtml(safe.subtitle)}">

    <div class="card-colors">
      <div><label>Fondo</label><input type="color" name="backgroundColor" value="${escapeHtml(safe.backgroundColor)}"></div>
      <div><label>Acento</label><input type="color" name="accentColor" value="${escapeHtml(safe.accentColor)}"></div>
      <div><label>Texto</label><input type="color" name="textColor" value="${escapeHtml(safe.textColor)}"></div>
    </div>

    <label>Imagen de fondo (opcional)</label>
    <input type="text" name="backgroundImageUrl" value="${escapeHtml(safe.backgroundImageUrl || '')}" placeholder="https://...">
    <label>Oscurecer la imagen de fondo: <span class="opacity-label">${escapeHtml(safe.overlayOpacity)}%</span></label>
    <input type="range" name="overlayOpacity" min="0" max="90" step="5" value="${escapeHtml(safe.overlayOpacity)}">
    <p class="muted" style="margin-top:6px;">Usa un link https:// directo a una imagen (PNG, JPG o WEBP de hasta 5 MB; lo ideal es 1000×360). Si la imagen no carga, la tarjeta usa el degradado del color de fondo.</p>

    <button type="submit">Guardar tarjeta</button>
  </form>`;
}

// vista previa en vivo: arma la URL de la imagen con los valores del formulario
// (con una pequeña espera para no pedir una imagen por cada tecla)
const CARD_EDITOR_SCRIPT = `
(function () {
  document.querySelectorAll('.card-editor').forEach(function (form) {
    var img = document.getElementById(form.dataset.previewTarget);
    var status = form.querySelector('.card-preview-status');
    var kind = form.dataset.previewKind;
    var timer = null;

    function refresh() {
      var params = new URLSearchParams();
      new FormData(form).forEach(function (value, key) {
        if (key !== 'enabled') params.set(key, value);
      });
      params.set('kind', kind);
      params.set('t', String(Date.now()));
      status.textContent = 'Generando vista previa…';
      img.src = '/dashboard/bienvenida/card-preview.png?' + params.toString();
    }

    img.addEventListener('load', function () {
      status.textContent = 'Vista previa con tu usuario y este servidor como ejemplo.';
    });
    img.addEventListener('error', function () {
      status.textContent = 'No se pudo generar la vista previa (revisa el link de la imagen de fondo).';
    });
    form.addEventListener('input', function () {
      var label = form.querySelector('.opacity-label');
      if (label) label.textContent = form.elements.overlayOpacity.value + '%';
      clearTimeout(timer);
      timer = setTimeout(refresh, 450);
    });
    refresh();
  });
})();
`;

// --- minijuegos, acciones sociales y alertas ---

function numberField(label, name, value, { min = 0, max, help } = {}) {
  return `
    <div>
      <label>${escapeHtml(label)}</label>
      <input type="number" name="${name}" min="${min}" ${max !== undefined ? `max="${max}"` : ''} value="${escapeHtml(value)}">
      ${help ? `<p class="muted" style="margin:-6px 0 0; font-size:12.5px;">${escapeHtml(help)}</p>` : ''}
    </div>`;
}

function checkboxField(label, name, checked) {
  return `<div class="checkbox-row"><input type="checkbox" name="${name}" id="f-${name}" ${checked ? 'checked' : ''}>
      <label for="f-${name}" style="margin:0;">${label}</label></div>`;
}

function gamesPage({ user, config, guildName, flash }) {
  const games = config.games;
  const economyOff = !config.economy.enabled;

  const body = `
  <h1>Minijuegos</h1>
  <p class="muted">Con <code>/juego</code> (o <code>!tresenraya</code>, <code>!conecta4</code>, <code>!ahorcado</code>, <code>!adivina</code>, <code>!matematica</code>): partidas entre dos con apuesta opcional y juegos que se juegan entre todos en el canal.</p>
  ${economyOff ? '<div class="warning-banner">La economía está desactivada: los juegos funcionan igual, pero sin apuestas ni recompensas en monedas.</div>' : ''}
  <form class="card" method="post" action="/dashboard/juegos">
    ${checkboxField('Minijuegos activados', 'enabled', games.enabled)}
    <div class="field-grid">
      ${numberField('Recompensa por ganar (ahorcado, adivina, matemática)', 'rewardAmount', games.rewardAmount, { help: '0 = sin recompensa.' })}
      ${numberField('Apuesta máxima (tres en raya y conecta 4)', 'maxBet', games.maxBet, { min: 1, help: 'Cada jugador pone esta cantidad como máximo.' })}
      ${numberField('Espera para iniciar otro juego con premio (min)', 'rewardCooldownMinutes', games.rewardCooldownMinutes, { help: 'Evita farmear monedas en bucle. Aplica a quien inicia el juego.' })}
    </div>
    <p class="muted" style="margin-top:14px;">Las apuestas salen de la economía del server: cada jugador paga al empezar y el ganador se lleva todo (un empate devuelve las monedas). Si el bot se reinicia a mitad de una partida, esa partida se pierde.</p>
    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Minijuegos', user, body, flash, guildName });
}

function socialPage({ user, config, guildName, flash }) {
  const social = config.social;
  const economyOff = !config.economy.enabled;

  const body = `
  <h1>Social y acciones</h1>
  <p class="muted">Acciones con gif (<code>/accion</code> o <code>!abrazar</code>, <code>!besar</code>, <code>!bailar</code>…), reputación (<code>/rep</code>), y los comandos de riesgo <code>/robar</code> y <code>/crimen</code>. También incluye <code>/ship</code>, <code>/8ball</code>, <code>/avatar</code> y <code>/mezclar</code>, que siempre están disponibles si esta página está activada.</p>
  ${economyOff ? '<div class="warning-banner"><code>/robar</code> y <code>/crimen</code> necesitan la economía activada.</div>' : ''}
  <form class="card" method="post" action="/dashboard/social">
    ${checkboxField('Funciones sociales activadas', 'enabled', social.enabled)}

    <h2 style="margin-top:20px;">Reputación</h2>
    ${checkboxField('Permitir <code>/rep</code>', 'repEnabled', social.repEnabled)}
    <div class="field-grid">${numberField('Espera entre puntos que das (horas)', 'repCooldownHours', social.repCooldownHours, { min: 1, max: 720 })}</div>

    <h2 style="margin-top:20px;">Robar</h2>
    ${checkboxField('Permitir <code>/robar</code> (le quitas monedas a otro miembro)', 'robEnabled', social.robEnabled)}
    <div class="field-grid">
      ${numberField('Espera entre intentos (min)', 'robCooldownMinutes', social.robCooldownMinutes, { min: 1 })}
      ${numberField('Máximo que se puede robar', 'robMaxAmount', social.robMaxAmount, { min: 1 })}
      ${numberField('Probabilidad de éxito (%)', 'robSuccessPercent', social.robSuccessPercent, { min: 1, max: 95, help: 'Si falla, paga una multa a la víctima.' })}
    </div>

    <h2 style="margin-top:20px;">Crimen</h2>
    ${checkboxField('Permitir <code>/crimen</code> (ganas monedas o pagas multa)', 'crimeEnabled', social.crimeEnabled)}
    <div class="field-grid">
      ${numberField('Espera entre crímenes (min)', 'crimeCooldownMinutes', social.crimeCooldownMinutes, { min: 1 })}
      ${numberField('Ganancia mínima', 'crimeMinAmount', social.crimeMinAmount, { min: 1 })}
      ${numberField('Ganancia máxima', 'crimeMaxAmount', social.crimeMaxAmount, { min: 1 })}
      ${numberField('Probabilidad de éxito (%)', 'crimeSuccessPercent', social.crimeSuccessPercent, { min: 1, max: 95 })}
    </div>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Social y acciones', user, body, flash, guildName });
}

function alertsPage({ user, config, channels, roles, twitchReady, maxItems, defaultMessages, guildName, flash, error }) {
  const items = config.alerts.items || [];
  const channelName = (id) => channels.find((c) => c.id === id)?.name;
  const roleName = (id) => roles.find((r) => r.id === id)?.name;

  const channelOptions = channels.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  const roleOptions = roles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  const rows = items.length
    ? items
        .map((item) => {
          const channel = channelName(item.channelId);
          const role = item.roleId ? roleName(item.roleId) : null;
          return `<div class="alert-row">
      <span class="platform-badge ${item.platform === 'twitch' ? 'twitch' : 'youtube'}">${item.platform === 'twitch' ? 'Twitch' : 'YouTube'}</span>
      <div class="alert-meta">
        <div class="alert-name">${escapeHtml(item.name)}</div>
        ${channel ? `en #${escapeHtml(channel)}` : '<span style="color:var(--danger);">el canal ya no existe</span>'}${role ? ` · avisa a @${escapeHtml(role)}` : ''}
      </div>
      <div>
        <form method="post" action="/dashboard/alertas/probar"><input type="hidden" name="id" value="${escapeHtml(item.id)}"><button type="submit" class="secondary">Probar</button></form>
        <form method="post" action="/dashboard/alertas/eliminar"><input type="hidden" name="id" value="${escapeHtml(item.id)}"><button type="submit" class="danger">Quitar</button></form>
      </div>
    </div>`;
        })
        .join('')
    : '<p class="muted" style="margin:0;">Todavía no hay alertas. Agrega la primera abajo.</p>';

  const body = `
  <h1>Alertas de YouTube y Twitch</h1>
  <p class="muted">El bot avisa en el canal que elijas cuando un canal de YouTube sube un video nuevo o uno de Twitch empieza un directo. Se revisa cada pocos minutos.</p>
  ${!twitchReady ? '<div class="warning-banner">Para las alertas de <strong>Twitch</strong> el dueño del bot tiene que configurar <code>TWITCH_CLIENT_ID</code> y <code>TWITCH_CLIENT_SECRET</code> (gratis en dev.twitch.tv). Las de YouTube funcionan sin nada extra.</div>' : ''}

  <form class="card" method="post" action="/dashboard/alertas/config">
    ${checkboxField('Alertas activadas', 'enabled', config.alerts.enabled)}
    <button type="submit">Guardar</button>
  </form>

  <div class="card">
    <h2>Alertas configuradas (${items.length}/${maxItems})</h2>
    ${rows}
  </div>

  <form class="card" method="post" action="/dashboard/alertas/agregar">
    <h2>Agregar una alerta</h2>
    <div class="card-grid">
      <div>
        <label>Plataforma</label>
        <select name="platform" id="alert-platform">
          <option value="youtube">YouTube (videos nuevos)</option>
          <option value="twitch" ${twitchReady ? '' : 'disabled'}>Twitch (directos)${twitchReady ? '' : ' — no configurado'}</option>
        </select>
      </div>
      <div>
        <label>Canal a seguir</label>
        <input type="text" name="target" required maxlength="200" placeholder="URL, @usuario o ID del canal">
      </div>
    </div>
    <div class="card-grid">
      <div><label>Canal de Discord donde avisar</label><select name="channelId" required><option value="">-- elegir --</option>${channelOptions}</select></div>
      <div><label>Rol a mencionar (opcional)</label><select name="roleId"><option value="">-- ninguno --</option>${roleOptions}</select></div>
    </div>
    <label>Mensaje (opcional)</label>
    <textarea name="message" id="alert-message" maxlength="400" style="min-height:80px;" placeholder="${escapeHtml(defaultMessages.youtube)}"></textarea>
    <p class="muted" style="margin-top:6px;">Variables: <code>{channel}</code> nombre del canal, <code>{title}</code> título, <code>{link}</code> enlace, <code>{role}</code> mención del rol, y en Twitch también <code>{game}</code>. Si lo dejas vacío se usa el mensaje por defecto de cada plataforma.</p>
    <button type="submit">Agregar alerta</button>
  </form>
  <script>
    (function () {
      var defaults = ${JSON.stringify(defaultMessages).replace(/</g, '\\u003c')};
      var platform = document.getElementById('alert-platform');
      var message = document.getElementById('alert-message');
      platform.addEventListener('change', function () { message.placeholder = defaults[platform.value]; });
    })();
  </script>`;
  return layout({ title: 'Alertas', user, body, flash, error, guildName });
}

// --- mensajes avanzados (editor de tarjetas) ---

const RICH_EDITOR_SCRIPT = fs.readFileSync(path.join(__dirname, 'richEditor.client.js'), 'utf8');

function richMessagesPage({ user, messages = [], editing, channels = [], templates = [], guildName, flash, error }) {
  const channelName = (id) => channels.find((c) => c.id === id)?.name;
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const initial =
    editing?.containers?.length
      ? { containers: editing.containers }
      : { containers: [{ accent: null, items: [{ type: 'text', content: '## Título\nEscribe aquí tu mensaje.' }] }] };

  const rows = messages
    .map((m) => {
      const channel = m.publishedChannelId ? channelName(m.publishedChannelId) : null;
      return `<tr>
        <td><a href="/dashboard/disenos?editar=${encodeURIComponent(m.id)}">${escapeHtml(m.name)}</a></td>
        <td>${m.messageId ? `<span class="pill open">Publicado${channel ? ` en #${escapeHtml(channel)}` : ''}</span>` : '<span class="pill closed">Sin publicar</span>'}</td>
        <td style="text-align:right; white-space:nowrap;">
          <a class="btn secondary small" href="/dashboard/disenos?editar=${encodeURIComponent(m.id)}">Editar</a>
          <form method="post" action="/dashboard/disenos/eliminar" data-confirm="¿Eliminar el diseño «${escapeHtml(m.name)}»? El mensaje ya publicado en Discord no se borra." style="display:inline;">
            <input type="hidden" name="id" value="${escapeHtml(m.id)}"><button type="submit" class="danger small">Eliminar</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  const clientData = {
    initial,
    templates: templates.map((t) => ({ id: t.id, name: t.name, description: t.description, message: t.message })),
    sample: { server: guildName || 'Tu servidor', membercount: 1464 },
  };
  // el JSON va dentro de un <script>: se escapa "<" para que ningun texto cierre la etiqueta
  const clientJson = JSON.stringify(clientData).replace(/</g, '\\u003c');

  const isSaved = Boolean(editing?.id);
  const publishCard = isSaved
    ? `<form class="card" method="post" action="/dashboard/disenos/publicar">
    <h2>Publicar en Discord</h2>
    <input type="hidden" name="id" value="${escapeHtml(editing.id)}">
    <label>Canal</label>
    <select name="channelId" required><option value="">-- elegir --</option>${channelOptions(editing.publishedChannelId || editing.channelId)}</select>
    <p class="muted">${editing.messageId ? 'Este diseño ya está publicado: si eliges el mismo canal, se edita el mensaje que ya existe en lugar de mandar uno nuevo. ' : ''}Guarda los cambios antes de publicar. Las variables de usuario (<code>{user}</code>, <code>{avatar}</code>…) solo se rellenan en la bienvenida automática.</p>
    <button type="submit">${editing.messageId ? 'Actualizar mensaje publicado' : 'Publicar'}</button>
  </form>`
    : '<div class="card"><h2>Publicar en Discord</h2><p class="muted" style="margin-bottom:0;">Guarda el diseño primero y aquí aparecerá la opción de publicarlo en un canal.</p></div>';

  const body = `
  <h1>Mensajes avanzados</h1>
  <p class="muted">Arma mensajes con tarjetas, texto con formato, imágenes a un lado, separadores y botones con link, como los de los servidores grandes. Empieza desde un diseño prearmado o desde cero.</p>

  ${
    messages.length
      ? `<div class="card"><h2>Diseños guardados (${messages.length}/25)</h2><table><thead><tr><th>Nombre</th><th>Estado</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin:14px 0 0;"><a class="btn secondary small" href="/dashboard/disenos" style="margin:0;">Nuevo diseño</a></p></div>`
      : ''
  }

  <div class="rich-layout">
    <form class="card" id="rich-form" method="post" action="/dashboard/disenos/guardar">
      <h2>${isSaved ? 'Editar diseño' : 'Nuevo diseño'}</h2>
      <input type="hidden" name="id" value="${escapeHtml(editing?.id || '')}">
      <input type="hidden" name="payload" id="rich-payload" value="">

      <label>Nombre (solo para ti)</label>
      <input type="text" name="name" maxlength="60" required value="${escapeHtml(editing?.name || '')}" placeholder="Ej. Reglas, Bienvenida, Hub">

      <label>Empezar desde un diseño</label>
      <div class="re-inline">
        <select id="rich-template">${templates.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')}</select>
        <button type="button" id="rich-load-template" class="secondary inline">Cargar diseño</button>
      </div>
      <p class="muted" id="rich-template-info" style="margin-top:6px;"></p>

      <div id="rich-editor" class="re-editor"></div>

      <button type="submit">Guardar diseño</button>
    </form>

    <div class="rich-side">
      <div class="card">
        <h2>Vista previa</h2>
        <div id="rich-preview" class="dp-wrap"></div>
        <p class="muted" style="margin:10px 0 0; font-size:12.5px;">Aproximación de cómo se verá en Discord (los datos de usuario son de ejemplo).</p>
      </div>
      ${publishCard}
    </div>
  </div>
  <script>window.__RICH = ${clientJson};</script>
  <script>${RICH_EDITOR_SCRIPT}</script>`;

  return layout({ title: 'Mensajes avanzados', user, body, flash, error, guildName, wide: true });
}

module.exports = {
  layout,
  richMessagesPage,
  gamesPage,
  socialPage,
  alertsPage,
  loginPage,
  termsPage,
  privacyPage,
  dashboardHomePage,
  generalPage,
  welcomePage,
  automodPage,
  messagesPage,
  announcePage,
  statsPage,
  ticketsPage,
  serversPage,
  levelsPage,
  reactionRolesPage,
  logsPage,
  customCommandsPage,
  housesPage,
  economyPage,
  casinoSettingsPage,
  petsSettingsPage,
  ticketConfigPage,
  starboardPage,
  triviaPage,
  miniEventsPage,
  aiPage,
  serverGuidePage,
  accessDeniedPage,
  debugPasswordPage,
  debugPage,
  appearancePage,
  suggestionsPage,
  memberCounterPage,
  skillsPage,
  birthdaysPage,
  inviteTrackerPage,
  selectRolesPage,
};
