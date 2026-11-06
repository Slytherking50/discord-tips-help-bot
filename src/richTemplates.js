// diseños prearmados para el editor de mensajes avanzados: se cargan en el
// editor y se retocan (textos, links, colores). Los links de ejemplo
// (https://example.com) hay que reemplazarlos antes de publicar.

const EXAMPLE = 'https://example.com';

const RICH_TEMPLATES = [
  {
    id: 'hub',
    name: 'Hub del servidor',
    description: 'Bienvenida con canales importantes, redes y recursos, en tarjetas separadas.',
    message: {
      containers: [
        {
          accent: null,
          items: [
            {
              type: 'section',
              content: '## Bienvenido a {server}\nAquí encontrarás recursos, tutoriales y ayuda en tiempo real para que nunca te quedes atascado creando.',
              thumbnail: '{servericon}',
            },
            { type: 'separator', divider: true, spacing: 'small' },
            {
              type: 'text',
              content: '### Canales importantes\n- **#reglas** · Las normas del servidor\n- **#anuncios** · Novedades y avisos\n- **#tutoriales** · Guías paso a paso\n- **#ayuda** · Pregunta y te respondemos',
            },
            {
              type: 'buttons',
              buttons: [
                { label: 'YouTube', url: EXAMPLE, emoji: '' },
                { label: 'X', url: EXAMPLE, emoji: '' },
                { label: 'Ko-fi', url: EXAMPLE, emoji: '' },
              ],
            },
          ],
        },
        {
          accent: null,
          items: [
            { type: 'text', content: '### Recursos gratis\nPara acompañarte en el camino, dejamos estos recursos disponibles para todos.' },
            { type: 'buttons', buttons: [{ label: 'Recursos públicos', url: EXAMPLE, emoji: '' }, { label: 'Pack de inicio', url: EXAMPLE, emoji: '' }] },
          ],
        },
        {
          accent: null,
          items: [
            {
              type: 'text',
              content: '### Soporte\n- **#tickets** · Consultas importantes\n- **#preguntas** · Dudas rápidas\n- **#solicitudes** · Roles y permisos',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'reglas',
    name: 'Reglas del servidor',
    description: 'Reglas numeradas con separadores y una nota al pie.',
    message: {
      containers: [
        {
          accent: '#d9ad4e',
          items: [
            { type: 'text', content: '# Reglas del servidor\n-# Léelas con calma: te van a ahorrar sanciones.' },
            { type: 'separator', divider: true, spacing: 'large' },
            { type: 'text', content: '### 1. Respeta a los demás\nTrata a todos con amabilidad. No se toleran insultos, acoso ni discriminación.' },
            { type: 'text', content: '### 2. Sigue las normas de Discord\nSe aplican las [Normas de la comunidad](https://discord.com/guidelines) y los [Términos](https://discord.com/terms).' },
            { type: 'text', content: '### 3. Nada de spam ni publicidad\nNo promociones otros servidores o canales sin permiso del staff.' },
            { type: 'text', content: '### 4. Usa cada canal para lo suyo\nMantén los temas ordenados para que todos encuentren lo que buscan.' },
            { type: 'separator', divider: true, spacing: 'small' },
            { type: 'text', content: '-# ¿Dudas o algo que reportar? Abre un ticket y el staff te ayuda.' },
          ],
        },
      ],
    },
  },
  {
    id: 'bienvenida',
    name: 'Bienvenida con foto',
    description: 'Para la bienvenida automática: saluda con el nombre y la foto de perfil de quien entra.',
    message: {
      containers: [
        {
          accent: '#7fb685',
          items: [
            {
              type: 'section',
              content: '## ¡Bienvenido/a, {username}!\nTe damos la bienvenida a **{server}**. Ya somos **{membercount}** personas. {user}, pásate por las reglas y cuéntanos qué te trae por aquí.',
              thumbnail: '{avatar}',
            },
            { type: 'separator', divider: true, spacing: 'small' },
            { type: 'buttons', buttons: [{ label: 'Reglas', url: EXAMPLE, emoji: '' }, { label: 'Guía del servidor', url: EXAMPLE, emoji: '' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'anuncio',
    name: 'Anuncio',
    description: 'Título, texto, imagen grande y un botón para leer más.',
    message: {
      containers: [
        {
          accent: '#ec7b2c',
          items: [
            { type: 'text', content: '# Título del anuncio\nEscribe aquí la novedad con todo el detalle que quieras. Puedes usar **negritas**, *cursiva* y listas:\n- Primer punto\n- Segundo punto' },
            { type: 'gallery', urls: ['https://picsum.photos/seed/anuncio/900/380'] },
            { type: 'separator', divider: false, spacing: 'small' },
            { type: 'buttons', buttons: [{ label: 'Leer más', url: EXAMPLE, emoji: '' }] },
          ],
        },
      ],
    },
  },
  {
    id: 'redes',
    name: 'Redes y enlaces',
    description: 'Una tarjeta con tus redes en botones.',
    message: {
      containers: [
        {
          accent: null,
          items: [
            { type: 'text', content: '## Encuéntranos en\nSíguenos para no perderte nada.' },
            {
              type: 'buttons',
              buttons: [
                { label: 'YouTube', url: EXAMPLE, emoji: '' },
                { label: 'X', url: EXAMPLE, emoji: '' },
                { label: 'TikTok', url: EXAMPLE, emoji: '' },
                { label: 'Instagram', url: EXAMPLE, emoji: '' },
                { label: 'Sitio web', url: EXAMPLE, emoji: '' },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'faq',
    name: 'Preguntas frecuentes',
    description: 'Varias secciones con imagen a la derecha, ideal para explicar roles, canales o comandos.',
    message: {
      containers: [
        {
          accent: null,
          items: [
            { type: 'text', content: '## Preguntas frecuentes' },
            { type: 'separator', divider: true, spacing: 'small' },
            { type: 'section', content: '**¿Cómo consigo roles?**\nElige los que quieras en el canal de roles.', thumbnail: '{servericon}' },
            { type: 'section', content: '**¿Dónde pido ayuda?**\nAbre un ticket con `/ticket` y el staff te responde.', thumbnail: '{servericon}' },
            { type: 'section', content: '**¿Cómo subo de nivel?**\nSimplemente participa en el chat y en los canales de voz.', thumbnail: '{servericon}' },
          ],
        },
      ],
    },
  },
  {
    id: 'perfiles',
    name: 'Aviso de perfiles',
    description: 'Cuenta a los miembros qué guarda el bot de cada uno (perfiles) y cómo borrarlo. Publícalo en el canal de reglas o información.',
    message: {
      containers: [
        {
          accent: '#ec7b2c',
          items: [
            { type: 'text', content: '## Perfiles de miembros' },
            { type: 'text', content: 'El bot crea un perfil por cada miembro de **{server}** para conocer mejor a la comunidad.' },
            { type: 'separator', divider: true, spacing: 'small' },
            { type: 'text', content: '**Qué guarda**\n• Datos de Discord: nombre, roles y desde cuándo estás en el servidor.\n• Actividad: cuántos mensajes escribes y en qué canales.\n\n**Qué NO guarda:** el texto de tus mensajes ni tus mensajes privados.' },
            { type: 'separator', divider: true, spacing: 'small' },
            { type: 'text', content: '**Tú decides**\n• `/perfil ver`: mira tu perfil (solo tú lo ves).\n• `/perfil olvidar`: borra tu perfil y deja de registrar tu actividad.\n• `/perfil info`: explica todo esto otra vez.' },
          ],
        },
      ],
    },
  },
];

module.exports = { RICH_TEMPLATES };
