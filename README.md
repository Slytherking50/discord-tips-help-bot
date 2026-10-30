# PlanetBot

Bot de Discord multi-servidor con dashboard web propio, hecho para **Planet of Creators** (comunidad de renders/animaciones de Minecraft) pero utilizable en cualquier server. Cualquiera con permiso de **Gestionar servidor** puede invitar el bot y administrar todo desde el dashboard, sin tocar código — igual que MEE6, Dyno o Nekotina.

- **Dashboard en vivo**: https://discord-tips-help-bot.onrender.com/dashboard
- Todos los comandos funcionan como **`/comando`** (slash) y, si el server activa el prefijo en el dashboard (página *A medida → Comandos*), también como **`!comando`** con el mismo texto.

## Índice

- [Funciones por categoría](#funciones-por-categoría)
- [Comandos](#comandos)
- [Dashboard](#dashboard)
- [Arquitectura](#arquitectura)
- [Puesta en marcha](#puesta-en-marcha)
- [Desplegar en Render](#desplegar-en-render-gratis)
- [Notas y limitaciones](#notas-y-limitaciones)

## Funciones por categoría

### 🏠 General
- **Tips automáticos**: cada tanto (intervalo configurable) manda un tip al canal donde más se habló recientemente, o a **un solo canal fijo** si lo eliges en el dashboard (en ese caso solo cuando alguien habló ahí desde el último tip, para no escribirle a un canal vacío). Se pueden **excluir canales puntuales** (staff, tickets, bots) desde el dashboard — si el más activo está excluido, busca el siguiente.
- **Estadísticas**: mensajes, tickets, ranking de niveles y de economía.
- **Contador de miembros**: un canal de voz que muestra el total de miembros en su nombre.
- **Estado del bot**: el globito junto a su foto de perfil rota cada 30 segundos entre lo que hace (tickets, niveles, economía, minijuegos) y datos reales: servidores, miembros, **partidas jugadas** (minijuegos y casino) y comandos usados. Cada número solo aparece si hay algo que contar, y los contadores se guardan en MongoDB. Se apaga con `BOT_STATUS=off` y el intervalo se cambia con `BOT_STATUS_SECONDS` (mínimo 15). El banner del perfil actual es `assets/banner/banner-planet-of-creators-v2.png` (recortado de `banner-original-1280x720.png` con `node scripts/crop-banner.js <entrada> <salida>`) y se aplica con `node set-bot-banner.js assets/banner/banner-planet-of-creators-v2.png`; `node scripts/make-banner.js` genera una alternativa con el logo sobre un cielo estrellado.
- **Estado / Debug**: info técnica del bot (`/debug`, solo staff), protegible con contraseña extra en el dashboard.

### 💬 Comunidad
- **Bienvenida / Despedida**: mensaje (texto o embed) con variables reales — `{user}`, `{username}`, `{server}`, `{membercount}`, `{joindate}` (fecha real de ingreso) — insertables con botones. Título, banner/imagen y **vista previa en vivo** del embed configurables desde el dashboard. Opción de que la IA redacte una bienvenida distinta cada vez.
- **Respuestas de ayuda**: sistema local (gratis, sin API paga) que combina palabras clave con tolerancia a errores de tipeo + un clasificador bayesiano para reconocer paráfrasis. Nunca responde si el mensaje es una respuesta o mención dirigida a otro usuario. Editable con un formulario visual desde el dashboard.
- **`/anuncio`**: manda un embed a cualquier canal (solo staff).
- **Houses**: sistema de solicitud con formulario (Modal de Discord), botón "Solicitar aquí" publicable en un canal, revisión con botones Aceptar/Rechazar, y MD automático al usuario con el resultado.
- **Starboard**: mensajes que juntan suficientes reacciones de un emoji (⭐ por defecto) se republican en un canal de destacados, con conteo que se actualiza en vivo.
- **Sugerencias**: buzón con votación (👍/👎) y aprobación opcional por rol.
- **Cumpleaños**: cada quien carga el suyo (`/cumpleanos configurar`), el bot avisa el día en un canal elegido.
- **Invite Tracker**: cuenta invitaciones reales por usuario, ranking (`/invitaciones ver|ranking`).
- **Skills** 🛠️: los miembros se auto-etiquetan con roles reales marcados como "skill" (`/skills agregar|quitar|ver|buscar`) — un buscador de colaboradores real, sin datos inventados.

### 🛡️ Moderación
- `/ban`, `/kick`, `/mute` (timeout), `/warn`, `/warnings` — respetan la jerarquía real de roles (nunca dejan moderar a alguien de rango igual o superior al tuyo).
- **Automoderación**: palabras prohibidas, bloqueo de invitaciones a otros servers, límite de spam de menciones, con una segunda opinión opcional de la IA en el canal de logs.
- **Logs**: canal configurable para mensajes borrados/editados, entradas/salidas de miembros y acciones de moderación.

### 🎫 Tickets (sistema completo estilo Ticket Tool/Ticket King)
- Uno o varios paneles independientes, cada uno en su propio canal, con menú desplegable o botones de categorías (cada una con su propio rol de staff, emoji y descripción).
- **Rol de staff global** (ve todos los tickets sin importar la categoría) + roles específicos por categoría — se combinan sin duplicar.
- Numeración secuencial, botón "Reclamar", transcripción `.txt` al cerrar, encuesta de satisfacción opcional (1 a 5 estrellas) por MD.

### 📈 Progresión
- **Niveles/XP**: XP por mensaje (y opcionalmente por tiempo en voz) con cooldown, roles automáticos por nivel, `/nivel`, `/ranking`.
- **Roles por reacción** y **roles por menú desplegable**, publicables desde el dashboard.

### 🎮 Economía y juegos (estilo Nekotina)
- **`/economia`**: `balance`, `daily`, `work`, `pay`, `shop`, `comprar`, `inventario`, `perfil`. Moneda, tienda y montos configurables.
- **`/casino`**: `apostar` (cara/cruz), `slots`, `ruleta`, `blackjack` (interactivo con botones), `dados`, `ppt`.
- **Matrimonios**: `/casar` (con botón aceptar/rechazar), `/divorciar`, `/pareja`.
- **Mascotas**: `/mascota adoptar/ver/alimentar/jugar`, con nivel, hambre y felicidad.
- **`/trivia`**: pregunta con 4 opciones, el primero en acertar gana monedas.
- **`/meme`**: trae un meme random **en español** de r/MemesEnEspanol (vía meme-api.com, gratis).
- **`/concurso`** 🏆: a diferencia de un sorteo (ganador al azar), elige ganador por **votos reales**: la gente postea su entrada con imagen en el canal, otros votan reaccionando, y al cerrar el bot cuenta los votos de verdad y anuncia.
- **Eventos automáticos**: el bot larga sorpresas cada tanto — el primero en reaccionar gana monedas.

### 🎭 Social, minijuegos y alertas
- **Tarjetas de bienvenida/despedida con imagen**: se genera una imagen (avatar + título + subtítulo) que acompaña al mensaje. Estilo centrado o lateral, forma del avatar, colores, imagen de fondo propia (https, hasta 5 MB) y **vista previa en vivo** en el dashboard. Si el fondo no carga, usa un degradado. Los bots que entran reciben un rol aparte y no se les da la bienvenida.
- **`/accion`** (y `!abrazar`, `!besar`, `!bailar`…): 21 acciones con gif de [nekos.best](https://nekos.best) (gratis, sin clave). Si el servicio cae, el mensaje sale igual sin gif.
- **`/rep dar|ver`**: reputación entre miembros con espera configurable.
- **`/robar` y `/crimen`**: mueven monedas con riesgo de multa; **apagados por defecto**, se activan en *Social y acciones*.
- **`/ship`, `/8ball`, `/avatar`, `/mezclar`**: calculadora del amor (siempre da lo mismo para la misma pareja), bola mágica, avatar en grande y mezcla de nombres.
- **`/juego`**: `tresenraya` y `conecta4` contra otro miembro (con apuesta opcional de la economía), y `ahorcado`, `adivina` y `matematica` para jugar entre todos en el canal, con recompensa configurable. Las partidas viven en memoria: si el bot se reinicia a mitad de una, se pierde (por eso la apuesta tiene tope).
- **Mensajes avanzados**: editor del dashboard (*Comunidad → Mensajes avanzados*) para armar mensajes con **tarjetas** (contenedores de Discord), texto con markdown (títulos, listas, enlaces), **secciones con imagen a un lado**, separadores, galerías de imágenes y **filas de botones con link**. Trae 6 diseños prearmados (hub del servidor, reglas, bienvenida con foto, anuncio, redes, preguntas frecuentes), vista previa en vivo, y se publica en cualquier canal; si lo vuelves a publicar en el mismo canal, **edita** el mensaje ya enviado en vez de mandar otro. Un diseño también se puede elegir como mensaje de bienvenida (admite `{user}`, `{username}`, `{server}`, `{membercount}`, `{avatar}` y `{servericon}`). Usa Components V2 de Discord (discord.js 14.19 o superior); esos mensajes no admiten el texto/embed clásico a la vez. Límites: 5 tarjetas, 40 componentes y unos 3800 caracteres por mensaje.
- **Alertas de YouTube y Twitch** (estilo Pingcord): avisa en el canal que elijas cuando un canal sube un video o empieza un directo, con rol a mencionar y mensaje con variables (`{channel}`, `{title}`, `{link}`, `{role}`, `{game}`). YouTube usa el feed RSS público (sin clave); Twitch necesita `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET`. Máximo 10 alertas por servidor, se revisa cada 3 minutos. X/TikTok/Kick/Reddit no están incluidos.

### 🎨 A medida
- **Comandos personalizados**: `/nombre` configurables desde el dashboard.
- **IA (opcional, gratis con Groq)**:
  - Charla al mencionarla y fallback inteligente de ayuda, usando datos reales del server (roles, canales, nivel, balance, tickets, etc.) — nunca inventa datos ni opina sobre "quién es el mejor".
  - Conocimiento de herramientas de render/edición (Blender, ibisPaint, Affinity, Photoshop, Photopea) aplicado a renders y animaciones de Minecraft.
  - **Opina de los trabajos de la gente (ve la imagen de verdad)**: si alguien manda un render, una animación, una skin o cualquier imagen y menciona al bot, responde a un mensaje con una imagen, o (en el canal de conversación) pide opinión con una imagen adjunta ("¿qué opinan de mi render?", "feedback?"), el bot **mira la imagen** y da una opinión honesta y concreta: qué funciona, qué mejoraría y 2-3 consejos aplicables (luces, materiales, composición, ajustes de Blender/Photoshop/Photopea...). Mira hasta 3 imágenes por mensaje. También sirve para preguntarle otra cosa de la imagen ("¿qué dice acá?"). Una imagen suelta, sin pedir nada, no recibe comentario (no opina a ciegas ni gasta cuota). Si alguien reacciona con el emoji de feedback en un canal configurado, hace lo mismo. Si ningún modelo con visión responde, lo dice claro en vez de inventar que la vio.
  - Resumen automático (diario/semanal) con datos reales del server.
  - **Conversación libre en un canal**: en el canal que elijas (solo uno), al mencionar al bot lee lo que se venía hablando (o pregunta si falta contexto) y se queda participando como un integrante más: mensajes cortos y relajados, sin responder a todo (la IA puede quedarse en silencio). Si nadie escribe por unos minutos, el bot también se calla y no vuelve a hablar hasta que lo mencionen; "@bot cállate" lo para al instante. Sigue siendo un bot (si le preguntan, lo dice), respeta los temas prohibidos y no menciona a nadie con @. Tiene tope de mensajes, de duración y pausa entre mensajes para cuidar la cuota gratis de Groq. Se configura en la página de IA (viene apagada).
  - Moderación por chat (banear/expulsar/silenciar/advertir mencionando a alguien) solo para IDs autorizados — la IA nunca decide ni ejecuta, solo interpreta el pedido; un sistema aparte valida permisos y jerarquía.
- **Guía del servidor**: FAQ navegable por botones, editable desde el dashboard.
- **Apariencia**: color de marca, footer e ícono de los embeds del bot.

## Comandos

Todos también funcionan con el prefijo `!` si el server lo activa (página *A medida → Comandos*; `!help` lista todo agrupado por categoría con el prefijo real configurado).

| Comando | Qué hace |
|---|---|
| `/ticket` | Abre un canal privado de soporte |
| `/nivel`, `/ranking` | Tu nivel/XP, top 10 del server |
| `/ban`, `/kick`, `/mute`, `/warn`, `/warnings` | Moderación (permiso requerido) |
| `/casa` | Solicitar tu House |
| `/economia` | balance / daily / work / pay / shop / comprar / inventario / perfil |
| `/casino` | apostar / slots / ruleta / blackjack / dados / ppt |
| `/casar`, `/divorciar`, `/pareja` | Matrimonios |
| `/mascota` | adoptar / ver / alimentar / jugar |
| `/trivia` | Pregunta con premio en monedas |
| `/meme` | Meme random en español |
| `/debug` | Estado técnico del bot (staff) |
| `/sorteo` | crear / terminar — ganador al azar |
| `/concurso` | crear / terminar — ganador por votos reales |
| `/encuesta` | Encuesta de hasta 5 opciones |
| `/afk` | Marcarte como ausente |
| `/cumpleanos` | configurar / ver |
| `/invitaciones` | ver / ranking |
| `/decir`, `/programar` | El bot manda un mensaje ahora o programado (staff) |
| `/preguntar` | Preguntarle algo a la IA en privado |
| `/explicar` | La IA te explica cómo usar un comando |
| `/infoserver` | Info real del server (ID, owner, boosts, canales, emojis, etc.) |
| `/portfolio` | Portfolio de un miembro: posts destacados del starboard, roles, nivel |
| `/skills` | agregar / quitar / ver / buscar habilidades reales |
| `/anuncio` | Embed a cualquier canal (staff) |

## Dashboard

Login con Discord OAuth2. Tras loguearse, se ve la lista de servers donde el usuario tiene permiso de **Gestionar servidor**: los que ya tienen el bot (botón **Gestionar**) y los que no (botón **Invitar bot**, con permisos correctos ya incluidos). La navegación está agrupada en: General, Comunidad, Moderación, Tickets, Progresión, Economía y juegos, A medida.

Diseño propio y sobrio: tema plano grafito con un único color de acento, tipografía IBM Plex, iconos SVG dibujados a mano y sin emojis ni gradientes. El CSS vive en `src/web/theme.css` y los iconos en `src/web/icons.js`.

## Arquitectura

- **`src/index.js`**: cliente de Discord, maneja todos los eventos (mensajes, reacciones, comandos, botones) y mantiene config/estado en memoria por servidor (multi-guild).
- **`src/db.js`**: capa de acceso a MongoDB — configuración por servidor, estadísticas, tickets, niveles, economía, starboard, concursos, etc.
- **`src/aiHelper.js`**: toda la integración con Groq (texto y visión): lista de modelos con respaldo automático, reintento ante fallas transitorias y filtro de tuteo.
- **`src/imageAttachments.js`**: qué adjuntos cuentan como imagen para que el bot las vea (tipo o extensión, sin SVG, hasta 3 y 18 MB cada una).
- **`src/web/`**: dashboard (Express + sesiones guardadas en MongoDB). `app.js` tiene las rutas, `views.js` arma el HTML.
- **`src/commandRegistry.js`**: junta los comandos fijos + los personalizados de cada servidor y los registra en Discord.
- **`src/textCommands.js`**: capa de compatibilidad que expone (casi) todos los comandos slash también como `!comando`, reusando los mismos handlers.
- Cada función vive en su propio módulo (`ticketCommand.js`, `economyCommands.js`, `contestCommand.js`, `skillsCommand.js`, etc.) con sus handlers y, cuando aplica, su config por defecto en `db.js`.

## Puesta en marcha

### 1. Crear la aplicación en Discord

1. Andá a https://discord.com/developers/applications y creá una nueva aplicación.
2. En **Bot**, copiá el **Token**.
3. En **Privileged Gateway Intents**, activá **MESSAGE CONTENT INTENT** y **SERVER MEMBERS INTENT**.
4. En **OAuth2 → General**, copiá el **Client Secret** (botón "Reset Secret" si no lo ves).
5. En **OAuth2 → General → Redirects**, agregá: `https://tu-servicio.onrender.com/auth/callback`.

No hace falta invitar el bot manualmente a ningún server puntual — eso se hace desde el dashboard.

### 2. Configurar el proyecto

```bash
npm install
```

Copiá `.env.example` a `.env` y completá las variables (ver comentarios en el archivo): token del bot, credenciales OAuth, `SESSION_SECRET`, connection string de MongoDB. `GROQ_API_KEY` es opcional (también se puede cargar por servidor desde el dashboard, página IA). `CREATOR_USER_ID` es opcional (tu ID de Discord, te da acceso especial a la IA en cualquier server donde uses el bot).

### 3. Base de datos (MongoDB Atlas)

Toda la configuración de cada servidor vive en MongoDB — así el dashboard puede editarla y sobrevive a los redeploys. Cluster gratis en https://www.mongodb.com/cloud/atlas, connection string en `MONGODB_URI`.

Si tu red no resuelve bien el DNS de `mongodb+srv://` (común en algunos routers), el bot ya fuerza un DNS público (8.8.8.8 / 1.1.1.1) automáticamente en `src/db.js`.

La primera vez que el bot entra a un server nuevo, se crea configuración por defecto a partir de `data/tips.json` y `data/helpResponses.json` como semilla inicial.

### 4. Correr el bot y usar el dashboard

```bash
npm start
```

1. Andá a `/login` en la URL de tu dashboard e iniciá sesión con Discord.
2. Elegí tu server en la lista (o invitá el bot si todavía no está).
3. Configurá lo que quieras desde las distintas páginas.

## Desplegar en Render (gratis)

Repo en GitHub → Web Service en Render → variables de entorno (todas las de `.env`, incluida `DASHBOARD_URL` apuntando a la URL real que te da Render) → UptimeRobot pegándole cada 5 min para que no se duerma (el plan gratis de Render duerme el servicio a los 15 min sin tráfico).

Si cambiás la URL de Render, actualizá `DASHBOARD_URL` en las variables de entorno y el redirect en el Developer Portal (paso 1.5). Los comandos slash nuevos aparecen solos la primera vez que el bot arranca después del deploy (se re-registran por servidor en cada `ready`).

## Seguridad

- **Dashboard**: cabeceras de seguridad (anti-clickjacking, `nosniff`, HSTS en https), verificación de origen en todos los POST, límite de peticiones por IP, formularios sin objetos anidados y cookie de sesión `secure` automática bajo https. Los permisos de "Gestionar servidor" se vuelven a comprobar contra Discord cada 5 minutos (antes quedaban guardados en la sesión hasta 30 días). Si falta `SESSION_SECRET` el panel arranca con un secreto temporal en vez de uno conocido.
- **Descargas de URLs del usuario** (fondo de la tarjeta): solo https, bloquea IPs privadas/loopback incluso tras resolver el DNS, sin seguir redirecciones a ciegas, con tope de tamaño y tiempo.
- **Moderación por chat con IA**: aparte de estar en la lista autorizada, quien no es el creador necesita el permiso real de Discord (Ban/Kick/Moderar miembros); el mute se limita a 28 días.
- **Economía**: montos negativos rechazados en `spendBalance`/`transferBalance`, el inventario se actualiza de forma atómica y una transferencia fallida devuelve lo descontado.

## Notas y limitaciones

- **IA**: usa Groq (gratis, sin tarjeta) en vez de OpenAI/Claude para mantener el proyecto sin costo. Se puede activar por separado para ayuda, charla, moderación y feedback de imágenes, y queda completamente desactivada si no hay clave configurada — no rompe nada del resto del bot.
- **Modelos de la IA**: Groq cambia seguido los modelos de la cuenta gratis (el de visión que usaba el bot, `llama-4-scout`, dejó de existir y por eso nunca llegaba a ver una imagen). Por eso cada tarea tiene una **lista** de modelos y se usa el primero que responda; uno que da 404/403 se salta 30 minutos, y uno con límite por minuto (429) o caído (5xx) pasa la tarea al siguiente. Charla y ayuda: `openai/gpt-oss-120b` → `qwen/qwen3.8-27b` → `openai/gpt-oss-20b`; visión: `qwen/qwen3.8-27b` → `llama-4-scout` → `llama-4-maverick`; el resto (resúmenes, traducción, bienvenidas...) usa `gpt-oss-20b`. Puedes forzar el primero de cada lista con las variables `GROQ_SMART_MODEL` y `GROQ_VISION_MODEL` (ver `.env.example`). Para ver qué modelos tiene tu cuenta: `https://api.groq.com/openai/v1/models` con tu clave. Si ningún modelo con visión responde, el bot lo dice explícitamente en vez de inventar una respuesta sobre una imagen que en realidad no vio.
- **Tuteo**: los modelos tienden a escribir en voseo ("probá", "podés"); el prompt de la charla va en tuteo y, como red de seguridad, las respuestas de la IA pasan por un filtro (`tutear` en `src/aiHelper.js`) que convierte las formas más comunes.
- **Música**: evaluada y descartada por ahora — necesita más recursos (CPU/ancho de banda) de los que da el plan gratis de Render, y las librerías para sacar audio de YouTube se rompen seguido.
- **Nunca se inventan datos**: cualquier número, nombre o estadística que menciona el bot (por chat, por comando o por IA) sale de Discord o de la base de datos en el momento — nunca es un valor inventado o hardcodeado.
