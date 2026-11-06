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
- **Automoderación**: palabras prohibidas, bloqueo de invitaciones a otros servers, límite de spam de menciones, con una segunda opinión opcional de la IA en el canal de logs. El interruptor general de la página activa además estas reglas avanzadas (todas se configuran en *Moderación → Automoderación*; el staff con permiso de Gestionar mensajes o más, y los roles y canales que marques, nunca se tocan con ellas):
  - **Escudo anti-estafas**: detecta links que imitan a Discord, Steam y otros (`dlscord-gift.com`, `steamcommunnity.com`, `discord.com.sitio-malo.xyz`, dominios con punycode, acortadores...), los «nitro gratis» y las cuentas robadas que reparten el mismo link por 3 canales. Borra el mensaje, silencia a la persona y le avisa por privado que su cuenta puede estar comprometida. Los links de sitios conocidos (YouTube, Drive, Blender, CurseForge, Modrinth...) nunca se tocan; probado contra más de 1300 mensajes reales de un server sin ningún falso positivo. Si algo es dudoso, la IA lo revisa antes de borrar (un fallo de la IA nunca castiga a nadie).
  - **Anti-spam**: demasiados mensajes seguidos, el mismo mensaje repetido, mayúsculas y emojis de más (los dos últimos, apagados por defecto).
  - **Protección contra raids**: avisa al staff cuando entran muchas cuentas de golpe (por ejemplo 8 en 20 segundos), con cuántas son nuevas, y opcionalmente silencia a los recién llegados mientras se revisa.
  - **Advertencias y castigos automáticos**: cada mensaje borrado por la automoderación y cada `/warn` suman una advertencia; al llegar a las cantidades que elijas (por defecto 3 = silencio de 1 h, 5 = expulsión, 7 = ban; vencen a los 30 días) la persona recibe el castigo sola. Respeta la jerarquía de roles: si el bot no puede, no lo hace.
  - **IA moderadora según tus reglas**: los mensajes con lenguaje fuerte (insultos, amenazas) los lee un modelo de Groq hecho para moderar (`gpt-oss-safeguard`, con respaldo a `gpt-oss-20b` porque la cuenta gratis solo le da 3 pedidos por minuto) y decide con las reglas del server (las básicas más las que escribas) si es una falta o charla normal entre amigos: «te voy a matar jajaja» en un bedwars no es una amenaza. Por defecto solo avisa al staff; también puede borrar y sumar una advertencia.
- **Historial de casos**: todo lo que pasa con una persona (advertencias, silencios, expulsiones, bans, faltas de automoderación) queda numerado; `/historial @persona` lo muestra con las advertencias vigentes.
- **Herramientas del día a día**: `/purge` (borra los últimos N mensajes, o los de una persona; respeta los fijados y los de más de 14 días), `/slowmode`, `/lock` y `/unlock`.
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
- **Mensajes avanzados**: editor del dashboard (*Comunidad → Mensajes avanzados*) para armar mensajes con **tarjetas** (contenedores de Discord), texto con markdown (títulos, listas, enlaces), **secciones con imagen a un lado**, separadores, galerías de imágenes y **filas de botones con link**. Trae 7 diseños prearmados (hub del servidor, reglas, bienvenida con foto, anuncio, redes, preguntas frecuentes y un aviso de perfiles), vista previa en vivo, y se publica en cualquier canal; si lo vuelves a publicar en el mismo canal, **edita** el mensaje ya enviado en vez de mandar otro. Cada tarjeta admite hasta **20 bloques** (el editor muestra en vivo cuántos de los 40 componentes de Discord usa: una sección con imagen cuenta 3, así que de esas caben 13 por tarjeta) y el texto de cada bloque lleva un botón **Agregar emoji**. Un diseño puede tener hasta **20 tarjetas**: como Discord solo deja 40 componentes y 4000 letras por mensaje, el diseño se reparte solo en hasta 6 mensajes seguidos (cada tarjeta va entera en uno, en el mismo orden) y el editor te dice en cuántos queda; al republicar se editan los mismos mensajes, se mandan los que falten y se borran los que sobren. Un diseño también se puede elegir como mensaje de bienvenida (admite `{user}`, `{username}`, `{server}`, `{membercount}`, `{avatar}` y `{servericon}`). Usa Components V2 de Discord (discord.js 14.19 o superior); esos mensajes no admiten el texto/embed clásico a la vez. Límites: 5 tarjetas, 40 componentes y unos 3800 caracteres por mensaje.
- **Alertas de YouTube y Twitch** (estilo Pingcord): avisa en el canal que elijas cuando un canal sube un video o empieza un directo, con rol a mencionar y mensaje con variables (`{channel}`, `{title}`, `{link}`, `{role}`, `{game}`). YouTube usa el feed RSS público (sin clave); Twitch necesita `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET`. Máximo 10 alertas por servidor, se revisa cada 3 minutos. X/TikTok/Kick/Reddit no están incluidos.

### 🔊 Voz y actividades
- **La IA también habla**: no solo lee lo que escriben los demás. `/voz preguntar` le hace una pregunta a la IA y responde por escrito **y en voz alta** en tu canal de voz (corto, sin listas, pensado para hablarse; usa los datos reales del server). Además, cuando el bot está en tu canal de voz, lo que la IA contesta por escrito (al mencionarla, con `/preguntar` o en la charla del canal) también se dice en voz alta, en frases completas y con la voz del servidor. Se apaga con *La IA también habla* en la página Voz del panel.
- **El bot en canales de voz con TTS**: `/voz unir` entra a tu canal de voz y **lee en voz alta lo que escriban** (en el chat donde usaste el comando, o en el chat propio del canal de voz) las personas que estén en ese canal; `/voz decir` dice un texto; `/voz mi-voz` deja que cada quien elija la voz con la que se leen sus mensajes; `/voz parar`, `/voz salir` y `/voz estado`. Cola de mensajes con tope, pausa entre mensajes de una misma persona, y el nombre de quien escribe («Ana dice: …») cuando cambia la persona. Las menciones se leen como nombres, los links como «enlace», sin markdown ni emojis; no lee a quien está silenciado, ni mensajes con palabras prohibidas de la Automoderación, ni invitaciones a otros servers. Se va solo si se queda solo o sin hablar un rato (configurable) y sale limpio en cada deploy.
- **Voces**: Google Traductor en 11 idiomas (español por defecto; sirve para leer en voz «gringa» o «francesa» por diversión) y 6 voces HD en inglés de Groq Orpheus (con la clave de Groq de la página IA). Todo se decodifica y convierte a Opus en JavaScript puro (`mpg123-decoder` + `opusscript`): no hace falta ffmpeg en Render. Si una voz HD falla, usa la de Google. Las voces neuronales de Microsoft Edge **no** se usan: su servicio exige hacerse pasar por el navegador Edge.
- **`/actividad`** (como el bot «Activities»): inicia una actividad de Discord en tu canal de voz y manda un botón para unirse. Trae 15 actividades verificadas contra la API de Discord (Watch Together, ajedrez, damas, póker, Blazing 8s, Letter League, Sketch Heads, SpellCast, Land-io, Bobble League, Ask Away, Bash Out, Chef Showdown, Fishington.io y Betrayal.io), con autocompletado, y también se puede pegar el ID de cualquier aplicación que Discord tenga como actividad. Funciona creando una invitación al canal de voz dirigida a la aplicación (las abre cada persona; el bot solo crea la invitación, que vence a las 2 horas). Pide que quien lo use tenga el permiso «Usar actividades» y el bot «Crear invitación»; tope de una por persona cada 15 s y 30 por hora en el servidor.
- **Panel** (*Comunidad → Voz y actividades*): activar `/voz` y `/actividad`, voz por defecto, un canal de texto que siempre se lee, decir quién escribe, largo máximo, pausa, salida automática y qué roles pueden usar `/voz`. El bot necesita los permisos Conectar, Hablar y Crear invitación (el enlace de invitación del panel ya los incluye).
- **Perfiles de miembros** (`/perfil`, *Comunidad → Perfiles*): el bot crea un perfil por cada miembro —los que ya están (todos de una vez la primera vez que arranca, o con el botón del panel) y los que van entrando— con sus datos de Discord (nombre, foto, roles, fecha de ingreso) y contadores de actividad (mensajes del último mes y en total, canales donde más escribe, última vez activo). **Nunca guarda el texto de los mensajes.** Cada persona ve el suyo con `/perfil ver`, lo borra con `/perfil olvidar` (no se vuelve a registrar nada hasta que use `/perfil activar`) y `/perfil info` explica qué se guarda; quien tenga *Gestionar servidor* ve el de otros con `/perfil ver miembro:`. El perfil de quien se va se borra solo a los 30 días (configurable). En el panel: activar, contar mensajes, roles sin perfil, días de retención, buscar y abrir un perfil, borrarlo y crear los de todos. El diseño *Aviso de perfiles* de los mensajes avanzados lo explica a los miembros. Por ahora solo guarda datos de Discord y contadores: la IA todavía no usa los perfiles.

### 🎨 A medida
- **Comandos personalizados**: `/nombre` configurables desde el dashboard.
- **IA (opcional, gratis con Groq)**:
  - **Personalidad**: en la página IA se elige el tono (Amigable, Formal, Con humor o **Jarvis**: súper formal, trata de *usted*, cortés y conciso, sin chistes ni exclamaciones, como un mayordomo digital). Con Jarvis la charla en vivo también se vuelve profesional (sin preguntas de relleno).
  - Charla al mencionarla y fallback inteligente de ayuda, usando datos reales del server (roles, canales, nivel, balance, tickets, etc.) — nunca inventa datos ni opina sobre "quién es el mejor".
  - Conocimiento de herramientas de render/edición (Blender, ibisPaint, Affinity, Photoshop, Photopea) aplicado a renders y animaciones de Minecraft.
  - **Opina de los trabajos de la gente (ve la imagen de verdad)**: si alguien manda un render, una animación, una skin o cualquier imagen y menciona al bot, responde a un mensaje con una imagen, o (en el canal de conversación) pide opinión con una imagen adjunta ("¿qué opinan de mi render?", "feedback?"), el bot **mira la imagen** y da una opinión honesta y concreta: qué funciona, qué mejoraría y 2-3 consejos aplicables (luces, materiales, composición, ajustes de Blender/Photoshop/Photopea...). Mira hasta 3 imágenes por mensaje. También sirve para preguntarle otra cosa de la imagen ("¿qué dice acá?"). Una imagen suelta, sin pedir nada, no recibe comentario (no opina a ciegas ni gasta cuota). Si alguien reacciona con el emoji de feedback en un canal configurado, hace lo mismo. Si ningún modelo con visión responde, lo dice claro en vez de inventar que la vio.
  - **Conocimiento de la IA** (*A medida → Conocimiento de la IA*): el staff escribe lo que el bot debe saber del server (reglas, cómo pedir una House, precios, horarios...) y, además de la guía y los temas de ayuda, el bot **busca lo que más se parece a cada pregunta** (BM25 con raíces de palabras, sin tildes y con tolerancia a errores de tipeo) y contesta con esa información; si no hay nada, dice que no lo sabe en vez de inventar. Si todo lo cargado es poco se le pasa completo; si es mucho, solo lo relevante. La página trae un probador para ver qué encontraría la IA con una pregunta. Funciona también en la conversación libre del canal.
  - **Conoce el server sola** (sin que escribas nada): arma con datos reales de Discord un **mapa del server** (todos los canales públicos por categoría, que va siempre en el prompt) y documentos que busca por la pregunta: datos del server (miembros, fecha, dueño, boosts), cada canal con su tema, los roles (con cuántas personas tiene cada uno), quién es del staff (por permisos reales, sin los roles de bots), los eventos programados, lo que tienes configurado en el bot (niveles con sus recompensas, economía con la tienda, tickets y su panel, casas, bienvenida, cuadro de honor, cumpleaños, moderación automática sin listar palabras) y los comandos con su descripción. Se renueva cada 10 minutos y cuando el staff crea, borra o edita canales o roles. **Nada privado entra**: solo canales que ve cualquiera, y nunca claves, palabras prohibidas ni canales internos del staff.
  - **Lee los canales de información**: el bot lee solo (cada 6 horas, en segundo plano) las reglas y los canales de información (sobre nosotros, anuncios, alianzas...) —o los que elijas en el panel— y la IA contesta con lo que dicen de verdad. Entiende también los mensajes avanzados con bloques de texto (donde suelen estar las reglas). Solo lee canales públicos y solo mensajes del staff o de bots; lo que escribe cualquier miembro no entra. Se ve y se controla en *Conocimiento de la IA* (con «Actualizar ahora» y el mapa que usa la IA).
  - **Piensa antes de contestar**: antes de escribir, el bot decide qué tipo de pregunta es (un dato, dónde está algo, una guía de pasos, una lista, una consulta técnica, varias preguntas juntas), la divide en partes y busca la información de cada una. Las simples razonan poco y gastan pocos tokens; las compuestas, listas o técnicas razonan más (los modelos gpt-oss razonan antes de escribir) y tienen más margen. Responde con la respuesta directa primero, pasos numerados, una viñeta por elemento, o cada parte en su línea. Si el razonamiento se come los tokens o la respuesta queda cortada, se repite una vez con menos razonamiento. Sabe en qué fecha está (para distinguir un concurso que ya pasó de uno que viene).
  - **Menciona canales reales**: cuando nombra un canal lo convierte en la mención clickeable del canal; si inventa uno que no existe lo corrige una vez y, si sigue, lo deja sin «#». Un canal privado nunca se menciona.
  - **Memoria corta**: recuerda las últimas tres vueltas con cada persona (15 minutos, solo en memoria) para entender «¿y cómo lo hago?» aunque en el canal hayan hablado otros en el medio.
  - **La IA en el clic derecho** (Apps sobre un mensaje): *Opinar de este trabajo* (mira las imágenes del mensaje y da feedback concreto), *Traducir mensaje* (español ↔ otro idioma) y *Transcribir voz*. Y `/resumir`, que te pone al día con los últimos mensajes de un canal (solo si tú puedes leerlo). Las respuestas son privadas, salvo que pidas la opinión o la transcripción de tu propio mensaje.
  - **Mensajes de voz**: Whisper de Groq los transcribe (clic derecho → *Transcribir voz*, o automáticamente en los canales que elijas en la página de IA, con un resumen si el audio es largo). Descarta lo que Whisper inventa con el silencio. Ojo: el audio se envía a Groq; por eso la transcripción automática viene apagada. Tope de 150 por día en automático.
  - **Resumen de tickets**: al cerrar un ticket, la transcripción que va al canal del staff trae un resumen de 3 líneas (motivo, qué se hizo, resultado).
  - Resumen automático (diario/semanal) con datos reales del server.
  - **Conversación libre en un canal**: en el canal que elijas (solo uno), al mencionar al bot lee lo que se venía hablando (o pregunta si falta contexto) y se queda participando como un integrante más: mensajes cortos y relajados, sin responder a todo (la IA puede quedarse en silencio). Si nadie escribe por unos minutos, el bot también se calla y no vuelve a hablar hasta que lo mencionen; "@bot cállate" lo para al instante. También se le puede hablar **por su nombre, sin mencionarlo con @** ("planet, ayúdame", "¿qué opinas, planetbot?", "PlanetBot silencia a @x"): vale igual que una mención (charla, memes, trivia, traducción, consultas de datos...) en el canal de conversación y en los canales donde la IA está permitida. Reconoce "PlanetBot" y "Planet" además de su usuario de Discord y de su apodo en el server, aunque lo escriban mal ("plnet", "plannet", "planetvot", "planet bot", "pl4net"): reconoce los errores de tipeo típicos (letra que falta o repetida, tecla vecina, dos letras al revés) pero no confunde su nombre con palabras parecidas ("planes", "planeta", "plan") ni con "Planet Minecraft". En un mensaje corto lo reconoce en cualquier parte; en uno largo, al principio o al final. Las acciones de moderación por nombre solo se ejecutan si nombran a alguien con @, y siguen exigiendo autorización, permiso de Discord y confirmación. Sigue siendo un bot (si le preguntan, lo dice), respeta los temas prohibidos y no menciona a nadie con @. Tiene tope de mensajes, de duración y pausa entre mensajes para cuidar la cuota gratis de Groq. Se configura en la página de IA (viene apagada).
  - Moderación por chat (banear/expulsar/silenciar/advertir mencionando a alguien) solo para IDs autorizados — la IA nunca decide ni ejecuta, solo interpreta el pedido; un sistema aparte valida permisos y jerarquía.
- **Guía del servidor**: FAQ navegable por botones, editable desde el dashboard.
- **Apariencia**: color de marca, footer e ícono de los embeds del bot.
- **Selector de emojis en el dashboard**: todos los campos de emoji (roles por reacción y por menú, starboard, feedback de renders, guía, categorías de tickets, botones de los mensajes avanzados) traen un botón con 4 pestañas y buscador en español: **Simples** (formas, colores, marcas, flechas, números, corazones), **Detallados** (más de 650 emojis ilustrados), **Píxel** (pixel art propio: redes sociales —YouTube, Discord, TikTok y X—, objetos de juego, marcas y flechas) y **Del servidor** (los emojis personalizados que ya tiene el server). Los emojis píxel se suben al servidor como emojis personalizados `px_<nombre>` **solo cuando eliges uno** (usa 1 de los 50 lugares del plan gratis; los ya subidos no gastan más) y el bot necesita el permiso *Gestionar expresiones*. Lo que no sea un emoji de verdad (texto, símbolos como ★) se rechaza al guardar, porque Discord rechazaría el mensaje entero. Los emojis personalizados funcionan en roles por reacción, starboard, feedback de renders, botones y menús.
- **Emojis en los textos de los mensajes**: el selector también inserta emojis **donde está el cursor** (o reemplaza lo seleccionado) en el texto de cada bloque de los mensajes avanzados y en los textos del panel que el bot manda como mensaje (bienvenida, despedida, anuncios, cumpleaños, alertas, comandos, respuestas de ayuda, casas, guía y tickets). Se abre en la pestaña *Del servidor* y la vista previa muestra esos emojis como imagen. La lista del servidor está siempre al día: el bot pide el intent `GuildExpressions` (no es privilegiado: no hay que activar nada en el portal de Discord) y, además, al abrir el selector pide a Discord los emojis actuales.

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
| `/voz` | unir / decir / preguntar / mi-voz / parar / salir / estado — el bot en tu canal de voz con TTS; `preguntar` hace que la IA responda en voz alta |
| `/actividad` | Inicia una actividad de Discord (ajedrez, póker, Watch Together...) en un canal de voz |
| `/perfil` | ver / info / olvidar / activar — tu perfil en el servidor y lo que el bot guarda de ti (ojo: `/economia perfil` es el de monedas y nivel) |
| `/resumir` | La IA te pone al día con los últimos mensajes de un canal |
| `/historial` | Historial de moderación de una persona (staff) |
| `/purge`, `/slowmode`, `/lock`, `/unlock` | Limpiar mensajes, modo lento, bloquear/desbloquear un canal (staff) |
| Clic derecho en un mensaje → Apps | *Opinar de este trabajo*, *Traducir mensaje*, *Transcribir voz* |

## Dashboard

Login con Discord OAuth2. Tras loguearse, se ve la lista de servers donde el usuario tiene permiso de **Gestionar servidor**: los que ya tienen el bot (botón **Gestionar**) y los que no (botón **Invitar bot**, con permisos correctos ya incluidos). La navegación está agrupada en: General, Comunidad, Moderación, Tickets, Progresión, Economía y juegos, A medida.

Diseño propio y sobrio: tema plano grafito con un único color de acento, tipografía IBM Plex, iconos SVG dibujados a mano y sin emojis ni gradientes. El CSS vive en `src/web/theme.css` y los iconos en `src/web/icons.js`.

## Arquitectura

- **`src/index.js`**: cliente de Discord, maneja todos los eventos (mensajes, reacciones, comandos, botones) y mantiene config/estado en memoria por servidor (multi-guild).
- **`src/db.js`**: capa de acceso a MongoDB — configuración por servidor, estadísticas, tickets, niveles, economía, starboard, concursos, etc.
- **`src/aiHelper.js`**: toda la integración con Groq (texto y visión): lista de modelos con respaldo automático, reintento ante fallas transitorias y filtro de tuteo.
- **`src/knowledge.js`**: búsqueda en lo que el staff cargó para la IA (entradas propias, guía y temas de ayuda) y en lo que el bot aprende solo, y armado del texto que se le pasa al modelo (con tope de caracteres según el tipo de pregunta). **`src/serverBrain.js`** (mapa, datos, canales, roles, staff, sistemas y comandos del server, y anclaje de los canales que nombra la IA), **`src/serverMemory.js`** (lectura de los canales de información), **`src/aiThinking.js`** (el plan de cada pregunta) y **`src/aiMemory.js`** (memoria corta por persona). **`src/aiApps.js`** y **`src/voiceTranscribe.js`**: clic derecho, `/resumir` y transcripción de voz (Whisper).
- **`src/guard.js`** (detectores puros: estafas, spam, raids, escalado), **`src/automodEngine.js`** (los junta con Discord, la base y el juez de IA) y **`src/modTools.js`** (`/purge`, `/slowmode`, `/lock`, `/unlock`, `/historial`). Los casos de moderación viven en la colección `modCases` de MongoDB.
- **`src/voiceChat.js`** (sesiones de voz por servidor, cola, `/voz`), **`src/ttsProviders.js`** (texto → audio de 48 kHz estéreo), **`src/speechText.js`** (limpia el chat para leerlo) y **`src/activities.js`** (`/actividad`). Usa `@discordjs/voice` (con el cifrado DAVE de Discord incluido), que declara Node 22.12 o superior. `package.json` no fija la versión de Node (hacerlo obligaba a Render a reinstalarlo todo con otra): el log de arranque dice con cuál corre (`Node v…`; hoy Render usa la 24.14.1, su versión por defecto) y, si la voz no carga en Render, se fija con la variable de entorno `NODE_VERSION`.
- **`src/userProfiles.js`** (perfiles de miembros: creación de todos y de los que entran, contadores de mensajes sin texto, mantenimiento y `/perfil`) y las funciones `*UserProfile*` de `src/db.js` (colección `userProfiles`, un documento por miembro y servidor; quien pide olvidarse deja solo una marca que ninguna otra función toca).
- **`src/supervisor.js`** (lo que corre `npm start`) lanza `src/index.js` como proceso hijo y lo relanza dentro del mismo servidor si no llega a abrir el panel (hasta 6 intentos), y **`src/bootWatch.js`** vigila la conexión a Discord: si tarda escribe los últimos avisos de Discord (incluidas las respuestas del REST), hace una prueba de red (DNS, HTTPS y conexión al gateway; un 429 aparece como PROBLEMA con sus cabeceras) y cierra el intento a los 60 s.
- **`src/restLimits.js`**: Discord y Cloudflare limitan por IP, y en un hosting compartido como Render un servidor nuevo cae a veces en una IP limitada (la prueba de red da HTTP 429). Ese 429 llega sin `Retry-After` y discord.js, en vez de esperar, repetía el pedido sin pausa (unos 10 por segundo, y cada uno cuenta como pedido inválido: alargaba el bloqueo) con el inicio de sesión colgado y el log mudo. Ahora, antes de estar conectado, un 429 sin tiempo de espera (o con uno de más de 20 s) hace fallar el pedido al instante: el bot lo explica, no insiste y sale con código 75; el supervisor no lo relanza en el mismo servidor (seguiría en la misma IP) y sale para que Render lo mueva a otra instancia. Ya conectado, discord.js espera los límites como siempre. Si ese 429 llega **con** `Retry-After` (lo normal en un bloqueo real: «pide esperar 2348 s»), discord.js se queda esperando en silencio todo ese tiempo, y por eso los arranques «mudos» de antes.
- **`src/restSentinel.js`** y **`src/health.js`**: cada minuto el bot hace un pedido **sin token** a `/api/v10/gateway`; si da 429 es el bloqueo por IP (esa ruta no tiene otro límite). Queda escrito en el log y en `GET /healthz`. Si Discord dice cuánto dura el bloqueo, no se vuelve a preguntar hasta que pase (máximo 15 min), para no sumar pedidos inválidos.
- **`src/imageAttachments.js`**: qué adjuntos cuentan como imagen para que el bot las vea (tipo o extensión, sin SVG, hasta 3 y 18 MB cada una).
- **`src/emojiUtil.js`, `src/emojiCatalog.js`, `src/pixelEmojis.js`, `src/emojiPicker.js`**: validación y comparación de emojis (Unicode y personalizados), catálogo del selector, los emojis píxel (dibujados en código; los de redes salen del arte del dueño) y la lógica con Discord (lugares libres e instalación). El lado del navegador está en `src/web/emojiPicker.client.js`.
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

### Si el bot no responde: Discord puede estar limitando la IP de Render

Render gratis comparte sus IPs de salida entre muchísimos servicios y Discord/Cloudflare bloquea una IP cuando hace demasiados pedidos inválidos (el límite es 10.000 respuestas 401/403/429 cada 10 minutos, de cualquiera que comparta esa IP). Mientras dura el bloqueo (a veces cerca de una hora) un bot nuevo no puede iniciar sesión y uno ya conectado queda mudo: aparece en línea pero no responde. Cómo comprobarlo:

- `GET /healthz` (público, sin datos secretos) dice qué versión corre (`commit`), cuánto lleva encendido, si Discord está conectado y `rest.state`: `ok`, `limited` (con `retryInSeconds`, lo que falta) o `unknown`.
- En el log de Render, `[red] Discord está limitando la IP de este servidor (HTTP 429, Discord pide esperar N min)`. Si un **arranque** falla por esto, el log dice `Discord está limitando a este servidor (HTTP 429, pide esperar N s)` y deja la prueba de red (DNS, HTTPS, TCP y WebSocket del gateway). Esa salida con «Exited with status 1» es lo esperado: el bot no insiste (para no alargar el bloqueo) y Render lo levanta en otra instancia; mientras, la versión anterior sigue sirviendo.
- Un rollback en Render deja corriendo la versión vieja: para volver a la última hay que pulsar **Manual Deploy → Deploy latest commit**.
- La voz (`/voz`) escribe en el log cada unión con el prefijo `[voz]`: cuánto tardó en conectar y, si no conecta, en qué paso se quedó y los últimos avisos de la librería.

Si los bloqueos se repiten mucho, no se arreglan con código: hace falta otra IP de salida (otra región de Render, un VPS pequeño con IP propia o un proxy para los pedidos a la API).

**Proxy gratis para los pedidos a la API (Cloudflare Worker).** El bot puede mandar sus pedidos a Discord (mensajes, comandos, el login del panel) por un proxy propio, para que salgan por otra IP; la conexión en vivo (gateway) sigue siendo directa. Se activa con dos variables de entorno y no cambia nada si no las pones:
1. Crea un Worker gratis en Cloudflare y pega el código de [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js); en *Settings → Variables and Secrets* agrega el secreto `PROXY_KEY` (una clave larga inventada).
2. En el servicio del bot agrega `DISCORD_API_URL` (la dirección del Worker más `/api`, por ejemplo `https://planetbot-discord.tu-cuenta.workers.dev/api`) y `DISCORD_PROXY_KEY` (la misma clave).
3. Al arrancar, el log dice `Discord: los pedidos a la API salen por el proxy ...` y `/healthz` sigue mostrando `rest.state`. Para volver a discord.com directo, borra `DISCORD_API_URL`.

El plan gratis de Workers da 100.000 pedidos al día. Es un experimento: Discord podría bloquear también las IPs de Cloudflare.

Si cambiás la URL de Render, actualizá `DASHBOARD_URL` en las variables de entorno y el redirect en el Developer Portal (paso 1.5). Los comandos slash nuevos aparecen solos la primera vez que el bot arranca después del deploy (se re-registran por servidor en cada `ready`).

## Seguridad

- **Dashboard**: cabeceras de seguridad (anti-clickjacking, `nosniff`, HSTS en https), verificación de origen en todos los POST, límite de peticiones por IP, formularios sin objetos anidados y cookie de sesión `secure` automática bajo https. Los permisos de "Gestionar servidor" se vuelven a comprobar contra Discord cada 5 minutos (antes quedaban guardados en la sesión hasta 30 días). Si falta `SESSION_SECRET` el panel arranca con un secreto temporal en vez de uno conocido.
- **Descargas de URLs del usuario** (fondo de la tarjeta): solo https, bloquea IPs privadas/loopback incluso tras resolver el DNS, sin seguir redirecciones a ciegas, con tope de tamaño y tiempo.
- **Moderación por chat con IA**: aparte de estar en la lista autorizada, quien no es el creador necesita el permiso real de Discord (Ban/Kick/Moderar miembros); el mute se limita a 28 días.
- **Economía**: montos negativos rechazados en `spendBalance`/`transferBalance`, el inventario se actualiza de forma atómica y una transferencia fallida devuelve lo descontado.

## Notas y limitaciones

- **IA**: usa Groq (gratis, sin tarjeta) en vez de OpenAI/Claude para mantener el proyecto sin costo. Se puede activar por separado para ayuda, charla, moderación y feedback de imágenes, y queda completamente desactivada si no hay clave configurada — no rompe nada del resto del bot.
- **Modelos de la IA**: Groq cambia seguido los modelos de la cuenta gratis (el de visión que usaba el bot, `llama-4-scout`, dejó de existir y por eso nunca llegaba a ver una imagen). Por eso cada tarea tiene una **lista** de modelos y se usa el primero que responda; uno que da 404/403 se salta 30 minutos, y uno con límite por minuto (429) o caído (5xx) pasa la tarea al siguiente. Charla y ayuda: `openai/gpt-oss-120b` → `qwen/qwen3.8-27b` → `openai/gpt-oss-20b`; visión: `qwen/qwen3.8-27b` → `llama-4-scout` → `llama-4-maverick`; el resto (resúmenes, traducción, bienvenidas...) usa `gpt-oss-20b`. Puedes forzar el primero de cada lista con las variables `GROQ_SMART_MODEL` y `GROQ_VISION_MODEL` (ver `.env.example`). Para ver qué modelos tiene tu cuenta: `https://api.groq.com/openai/v1/models` con tu clave. Si ningún modelo con visión responde, el bot lo dice explícitamente en vez de inventar una respuesta sobre una imagen que en realidad no vio.
- **Otros modelos de Groq que usa el bot**: `openai/gpt-oss-safeguard-20b` (juez de moderación; 3 pedidos por minuto en la cuenta gratis, por eso el respaldo y una cola corta) y `whisper-large-v3-turbo` / `whisper-large-v3` (voz a texto; 2000 pedidos por día). Si la cuenta no los tiene, esas funciones avisan o se saltan sin romper nada.
- **Tuteo**: los modelos tienden a escribir en voseo ("probá", "podés"); el prompt de la charla va en tuteo y, como red de seguridad, las respuestas de la IA pasan por un filtro (`tutear` en `src/aiHelper.js`) que convierte las formas más comunes.
- **TTS de Google Traductor**: no es una API oficial de Google, es el audio que usa su propia web; lo usan casi todos los bots de TTS gratis, pero Google puede limitarlo o cambiarlo (ahí el bot avisa que no pudo generar la voz y las voces HD en inglés siguen funcionando). Si algún día hace falta una voz más natural en español, se puede agregar un proveedor con clave propia (ElevenLabs, Azure...).
- **Música**: evaluada y descartada por ahora — necesita más recursos (CPU/ancho de banda) de los que da el plan gratis de Render, y las librerías para sacar audio de YouTube se rompen seguido.
- **Nunca se inventan datos**: cualquier número, nombre o estadística que menciona el bot (por chat, por comando o por IA) sale de Discord o de la base de datos en el momento — nunca es un valor inventado o hardcodeado.
