// catalogo de emojis del selector del dashboard (con palabras clave en español para buscar).
//  - SIMPLES: formas, colores, marcas, flechas, numeros y corazones: iconos planos y de pocos trazos.
//  - DETALLADOS: los ilustrados de siempre (caras, animales, comida, objetos...).
// Todos son emojis de verdad (sirven en reacciones, botones y menus); solo se usan los de Unicode 13 o
// anteriores, que ya se ven bien en Windows, Android y iOS sin actualizar. Cada entrada es
// "emoji palabras clave" y las entradas se separan con "|".

const { withEmojiPresentation } = require('./emojiUtil');

function parseGroup(id, label, raw) {
  const seen = new Set();
  const items = [];
  for (const entry of raw.split('|')) {
    const [emoji, ...words] = entry.trim().split(/\s+/);
    if (!emoji) continue;
    const fixed = withEmojiPresentation(emoji);
    if (seen.has(fixed)) continue;
    seen.add(fixed);
    items.push([fixed, words.join(' ')]);
  }
  return { id, label, items };
}

const SIMPLE = [
  parseGroup('formas', 'Colores y formas', `
    🔴 rojo circulo|🟠 naranja circulo|🟡 amarillo circulo|🟢 verde circulo|🔵 azul circulo|🟣 morado circulo|🟤 marron cafe circulo|⚫ negro circulo|⚪ blanco circulo|
    🟥 rojo cuadrado|🟧 naranja cuadrado|🟨 amarillo cuadrado|🟩 verde cuadrado|🟦 azul cuadrado|🟪 morado cuadrado|🟫 marron cuadrado|⬛ negro cuadrado grande|⬜ blanco cuadrado grande|
    ◼️ cuadrado negro mediano|◻️ cuadrado blanco mediano|◾ cuadrado negro|◽ cuadrado blanco|▪️ cuadrado negro pequeño|▫️ cuadrado blanco pequeño|
    🔶 rombo naranja grande|🔷 rombo azul grande|🔸 rombo naranja pequeño|🔹 rombo azul pequeño|🔺 triangulo rojo arriba|🔻 triangulo rojo abajo|
    💠 rombo flor|🔘 boton radio|🔳 boton cuadrado blanco|🔲 boton cuadrado negro|⭕ aro circulo rojo hueco|🔆 brillo alto|🔅 brillo bajo`),
  parseGroup('marcas', 'Marcas y avisos', `
    ✅ listo verificado ok|☑️ casilla marcada|✔️ check marca visto|❌ equis cruz error|❎ cruz verde|✖️ multiplicar equis|➕ mas sumar|➖ menos restar|➗ dividir|
    ❗ exclamacion importante|❕ exclamacion blanca|❓ pregunta|❔ pregunta blanca|‼️ doble exclamacion|⁉️ exclamacion pregunta|⚠️ advertencia cuidado|
    ⛔ prohibido entrada|🚫 prohibido|📛 etiqueta nombre|🔞 adultos 18|♻️ reciclar|⚜️ flor de lis|🔱 tridente|〽️ marca|✳️ asterisco|✴️ estrella ocho puntas|❇️ chispa|
    🆗 ok|🆕 nuevo|🆒 cool genial|🆓 gratis free|🆙 up sube|🆘 sos ayuda|🆖 ng|🆚 versus vs|🅰️ letra a|🅱️ letra b|🆎 ab|🅾️ letra o|🆑 cl|ℹ️ informacion|Ⓜ️ letra m|
    🔝 top arriba|🔚 fin end|🔙 atras back|🔛 on|🔜 pronto soon|™️ marca registrada|©️ copyright|®️ registrado|💯 cien perfecto`),
  parseGroup('flechas', 'Flechas y controles', `
    ⬆️ flecha arriba|⬇️ flecha abajo|⬅️ flecha izquierda|➡️ flecha derecha|↗️ flecha arriba derecha|↘️ flecha abajo derecha|↙️ flecha abajo izquierda|↖️ flecha arriba izquierda|
    ↕️ flecha arriba abajo|↔️ flecha izquierda derecha|↩️ volver|↪️ avanzar|⤴️ curva arriba|⤵️ curva abajo|🔃 recargar|🔄 actualizar|🔁 repetir|🔂 repetir uno|🔀 aleatorio mezclar|
    ▶️ reproducir play|⏸️ pausa|⏹️ detener stop|⏺️ grabar|⏭️ siguiente|⏮️ anterior|⏩ adelantar|⏪ retroceder|⏫ subir rapido|⏬ bajar rapido|🔼 subir|🔽 bajar|◀️ atras|⏏️ expulsar|
    🔊 volumen alto|🔉 volumen medio|🔈 volumen bajo|🔇 silencio mute|🔔 campana notificacion|🔕 sin campana`),
  parseGroup('numeros', 'Números y letras', `
    0️⃣ cero|1️⃣ uno|2️⃣ dos|3️⃣ tres|4️⃣ cuatro|5️⃣ cinco|6️⃣ seis|7️⃣ siete|8️⃣ ocho|9️⃣ nueve|🔟 diez|#️⃣ numeral gato|*️⃣ asterisco|🔠 mayusculas|🔡 minusculas|🔤 abc letras|🔢 numeros 1234|🔣 simbolos|
    🇦 letra a|🇧 letra b|🇨 letra c|🇩 letra d|🇪 letra e|🇫 letra f|🇬 letra g|🇭 letra h|🇮 letra i|🇯 letra j|🇰 letra k|🇱 letra l|🇲 letra m|🇳 letra n|🇴 letra o|🇵 letra p|🇶 letra q|🇷 letra r|🇸 letra s|🇹 letra t|🇺 letra u|🇻 letra v|🇼 letra w|🇽 letra x|🇾 letra y|🇿 letra z`),
  parseGroup('corazones', 'Corazones, estrellas y clima', `
    ❤️ corazon rojo amor|🧡 corazon naranja|💛 corazon amarillo|💚 corazon verde|💙 corazon azul|💜 corazon morado|🤎 corazon marron|🖤 corazon negro|🤍 corazon blanco|💔 corazon roto|❣️ corazon exclamacion|
    💕 dos corazones|💞 corazones girando|💓 corazon latiendo|💗 corazon creciendo|💖 corazon brillante|💘 corazon flecha cupido|💝 corazon regalo lazo|
    ⭐ estrella|🌟 estrella brillante|✨ destellos brillos|💫 mareo estrella|⚡ rayo energia|🔥 fuego|💥 explosion|❄️ copo nieve frio|💧 gota agua|🌈 arcoiris|☀️ sol|🌙 luna|☁️ nube|🌀 ciclon espiral|☔ paraguas lluvia`),
  parseGroup('zodiaco', 'Zodiaco', `
    ♈ aries|♉ tauro|♊ geminis|♋ cancer|♌ leo|♍ virgo|♎ libra|♏ escorpio|♐ sagitario|♑ capricornio|♒ acuario|♓ piscis|⛎ ofiuco`),
];

const DETAILED = [
  parseGroup('caras', 'Caras y emociones', `
    😀 sonrisa feliz|😃 sonrisa ojos grandes|😄 sonrisa alegre|😁 sonrisa dientes|😆 risa cerrada|😅 risa sudor nervioso|🤣 carcajada suelo|😂 lagrimas de risa|🙂 sonrisa leve|🙃 al reves|😉 guiño|😊 sonrojado feliz|😇 angel santo|
    🥰 enamorado corazones|😍 ojos de corazon|🤩 asombro estrellas|😘 beso|😗 beso silbido|😚 beso ojos cerrados|😙 beso sonrisa|😋 rico delicioso|😛 lengua|😜 lengua guiño loco|🤪 loco|😝 lengua ojos cerrados|🤑 dinero|
    🤗 abrazo|🤭 risita mano boca|🤫 silencio shh|🤔 pensando duda|🤐 boca cerrada cremallera|🤨 ceja levantada|😐 neutral|😑 sin expresion|😶 sin boca|😏 picaro|😒 fastidio|🙄 ojos en blanco|😬 mueca|🤥 mentiroso|
    😌 aliviado|😔 pensativo triste|😪 sueño|🤤 baba|😴 durmiendo|😷 mascarilla|🤒 fiebre enfermo|🤕 herido venda|🤢 nauseas|🤮 vomito|🤧 estornudo|🥵 calor|🥶 frio|🥴 mareado|😵 aturdido|🤯 mente explotando|
    🤠 vaquero|🥳 fiesta cumpleaños|😎 gafas de sol cool|🤓 nerd|🧐 monoculo|😕 confundido|😟 preocupado|🙁 triste leve|☹️ triste|😮 sorpresa boca abierta|😯 sorprendido|😲 asombrado|😳 sonrojado|🥺 suplicando ojitos|
    😦 ceño fruncido|😧 angustiado|😨 miedo|😰 ansiedad sudor|😥 triste aliviado|😢 llorando|😭 llanto|😱 grito miedo|😖 frustrado|😣 perseverante|😞 decepcionado|😓 sudor frio|😩 agotado|😫 cansado|🥱 bostezo|
    😤 resoplido enojo|😡 furioso enojado|😠 enojado|🤬 insultos|😈 diablillo sonrisa|👿 diablillo enojado|💀 calavera|☠️ calavera huesos|💩 caca|🤡 payaso|👹 ogro|👺 duende|👻 fantasma|👽 alien extraterrestre|👾 monstruo videojuego|🤖 robot|
    😺 gato sonrisa|😸 gato risa|😹 gato lagrimas|😻 gato enamorado|😼 gato picaro|😽 gato beso|🙀 gato asustado|😿 gato llorando|😾 gato enojado|🙈 mono no ver|🙉 mono no oir|🙊 mono no hablar`),
  parseGroup('gestos', 'Manos y personas', `
    👋 saludo mano|🤚 mano levantada|🖐️ mano abierta|✋ alto mano|🖖 vulcano|👌 ok perfecto|🤏 pellizco poquito|✌️ paz victoria|🤞 dedos cruzados suerte|🤟 te amo|🤘 rock|🤙 llamame|👈 izquierda|👉 derecha|👆 arriba|👇 abajo|☝️ uno arriba|
    👍 me gusta pulgar arriba|👎 no me gusta pulgar abajo|✊ puño|👊 golpe puñetazo|🤛 puño izquierda|🤜 puño derecha|👏 aplausos|🙌 celebrar manos arriba|👐 manos abiertas|🤲 manos juntas|🤝 trato apreton|🙏 gracias por favor rezar|
    ✍️ escribir|💅 uñas|🤳 selfie|💪 fuerza musculo|🦾 brazo robotico|🦵 pierna|🦶 pie|👂 oreja|👃 nariz|🧠 cerebro|🦷 diente|👀 ojos mirando|👁️ ojo|👅 lengua|👄 boca|
    👶 bebe|🧒 niño|👦 niño|👧 niña|🧑 persona|👨 hombre|👩 mujer|🧓 anciano|👴 abuelo|👵 abuela|🙍 persona frunciendo|🙅 persona no|🙆 persona ok|💁 persona informacion|🙋 persona levantando mano|🙇 reverencia|🤦 facepalm|🤷 hombros|
    👮 policia|🕵️ detective|💂 guardia|👷 obrero construccion|🤴 principe|👸 princesa|🧙 mago|🧚 hada|🧛 vampiro|🧜 sirena|🧝 elfo|🧞 genio|🧟 zombi|🦸 superheroe|🦹 villano|🎅 santa claus|🤶 mama noel|👼 angelito|🏃 correr|💃 bailarina|🕺 bailarin|🧘 meditar yoga`),
  parseGroup('animales', 'Animales', `
    🐶 perro|🐱 gato|🐭 raton|🐹 hamster|🐰 conejo|🦊 zorro|🐻 oso|🐼 panda|🐨 koala|🐯 tigre|🦁 leon|🐮 vaca|🐷 cerdo|🐸 rana|🐵 mono|🐔 gallina|🐧 pinguino|🐦 pajaro|🐤 pollito|🦆 pato|🦅 aguila|🦉 buho|🦇 murcielago|🐺 lobo|🐗 jabali|🐴 caballo|🦄 unicornio|
    🐝 abeja|🐛 oruga|🦋 mariposa|🐌 caracol|🐞 mariquita|🐜 hormiga|🕷️ arana|🦂 escorpion|🐢 tortuga|🐍 serpiente|🦎 lagarto|🦖 dinosaurio trex|🦕 dinosaurio|🐙 pulpo|🦑 calamar|🦐 camaron|🦀 cangrejo|🐡 pez globo|🐠 pez tropical|🐟 pez|🐬 delfin|🐳 ballena|🐋 ballena|🦈 tiburon|🐊 cocodrilo|
    🐅 tigre|🐆 leopardo|🦓 cebra|🦍 gorila|🐘 elefante|🦏 rinoceronte|🐪 camello|🦒 jirafa|🦘 canguro|🐃 bufalo|🐂 toro|🐄 vaca|🐎 caballo|🐖 cerdo|🐏 carnero|🐑 oveja|🦙 llama|🐐 cabra|🦌 ciervo|🐕 perro|🐩 caniche|🐈 gato|🐓 gallo|🦃 pavo|🦚 pavo real|🦜 loro|🦢 cisne|🕊️ paloma paz|
    🐇 conejo|🦝 mapache|🦡 tejon|🦦 nutria|🦥 perezoso|🐁 raton|🐀 rata|🐿️ ardilla|🦔 erizo|🐾 huellas patas|🐉 dragon|🐲 dragon cara`),
  parseGroup('naturaleza', 'Naturaleza y clima', `
    🌵 cactus|🎄 arbol de navidad|🌲 pino|🌳 arbol|🌴 palmera|🌱 brote planta|🌿 hierba|☘️ trebol|🍀 trebol suerte|🎍 bambu|🍃 hojas viento|🍂 hojas caidas otoño|🍁 hoja arce|🍄 hongo champiñon|🌾 espigas|💐 ramo flores|🌷 tulipan|🌹 rosa|🥀 flor marchita|🌺 hibisco|🌸 flor de cerezo|🌼 margarita|🌻 girasol|
    🌞 sol cara|🌝 luna llena cara|🌛 luna cara|🌜 luna cara|🌚 luna nueva cara|🌕 luna llena|🌖 luna|🌗 cuarto menguante|🌘 luna menguante|🌑 luna nueva|🌒 luna creciente|🌓 cuarto creciente|🌔 luna creciente|🌙 luna|🌎 tierra america|🌍 tierra europa|🌏 tierra asia|🪐 planeta saturno|
    ⭐ estrella|🌟 estrella brillante|✨ destellos|☄️ cometa|🌪️ tornado|🌈 arcoiris|☀️ sol|🌤️ sol nubes|⛅ parcialmente nublado|🌥️ nublado|☁️ nube|🌦️ lluvia sol|🌧️ lluvia|⛈️ tormenta|🌩️ rayo nube|🌨️ nieve nube|❄️ copo de nieve|☃️ muñeco de nieve|⛄ muñeco nieve|🌬️ viento|💨 rapido viento|💧 gota|💦 gotas|☔ paraguas|🌊 ola mar|🔥 fuego|🪨 roca piedra`),
  parseGroup('comida', 'Comida y bebida', `
    🍏 manzana verde|🍎 manzana roja|🍐 pera|🍊 naranja mandarina|🍋 limon|🍌 platano banana|🍉 sandia|🍇 uvas|🍓 fresa frutilla|🍈 melon|🍒 cerezas|🍑 durazno|🥭 mango|🍍 piña|🥥 coco|🥝 kiwi|🍅 tomate|🍆 berenjena|🥑 palta aguacate|🥦 brocoli|🥬 lechuga|🥒 pepino|🌶️ aji picante|🌽 maiz choclo|🥕 zanahoria|🧄 ajo|🧅 cebolla|🥔 papa patata|🍠 camote|
    🥐 croissant|🥯 bagel|🍞 pan|🥖 baguette|🥨 pretzel|🧀 queso|🥚 huevo|🍳 huevo frito|🧈 mantequilla|🥞 panqueques|🧇 waffle|🥓 tocino|🥩 carne|🍗 pollo|🍖 carne hueso|🌭 hot dog completo|🍔 hamburguesa|🍟 papas fritas|🍕 pizza|🥪 sandwich|🥙 pita|🧆 falafel|🌮 taco|🌯 burrito|🥗 ensalada|🥘 paella guiso|🍝 espagueti pasta|🍜 ramen fideos|🍲 olla sopa|🍛 curry|
    🍣 sushi|🍱 bento|🥟 empanada dumpling|🍤 camaron frito|🍙 onigiri|🍚 arroz|🍘 galleta de arroz|🍥 pastel de pescado|🥠 galleta de la fortuna|🥮 pastel de luna|🍢 brocheta|🍡 dango|🍧 raspado granizado|🍨 helado|🍦 helado cono|🥧 tarta pie|🧁 cupcake|🍰 pastel torta|🎂 torta cumpleaños|🍮 flan|🍭 chupete paleta|🍬 caramelo dulce|🍫 chocolate|🍿 palomitas pochoclo|🍩 dona|🍪 galleta|🌰 castaña|🥜 mani cacahuate|🍯 miel|
    🥛 leche|🍼 biberon|☕ cafe|🍵 te|🧃 jugo|🥤 refresco vaso|🍶 sake|🍺 cerveza|🍻 cervezas brindis|🥂 brindis copas|🍷 vino|🥃 whisky|🍸 coctel|🍹 trago tropical|🧉 mate|🧊 hielo|🥄 cuchara|🍴 cubiertos|🍽️ plato|🥣 bol|🥡 comida para llevar|🥢 palillos`),
  parseGroup('actividades', 'Juegos, deportes y fiestas', `
    ⚽ futbol|🏀 baloncesto basquet|🏈 futbol americano|⚾ beisbol|🥎 softbol|🎾 tenis|🏐 voleibol|🏉 rugby|🥏 frisbee|🎱 billar|🏓 ping pong|🏸 badminton|🏒 hockey|🏑 hockey cesped|🥍 lacrosse|🏏 criquet|⛳ golf|🏹 arco flecha|🎣 pesca|🥊 boxeo|🥋 artes marciales|🎽 camiseta correr|🛹 skate|🛷 trineo|⛸️ patinaje|🥌 curling|🎿 esqui|⛷️ esquiador|🏂 snowboard|
    🏋️ pesas gimnasio|🤼 lucha|🤸 gimnasia|🤺 esgrima|🏌️ golfista|🏇 carrera de caballos|🏄 surf|🏊 nadar natacion|🚣 remo|🧗 escalada|🚴 ciclismo|🎪 circo carpa|🎭 teatro mascaras|🎨 arte pintura paleta|🎬 claqueta cine|🎤 microfono|🎧 audifonos|🎼 partitura|🎹 piano teclado|🥁 bateria tambor|🎷 saxofon|🎺 trompeta|🎸 guitarra|🪕 banjo|🎻 violin|
    🎲 dado|♟️ ajedrez peon|🎯 diana dardo|🎳 boliche|🎮 videojuegos control|🎰 tragamonedas|🧩 rompecabezas puzzle|🏆 trofeo copa|🥇 medalla oro primero|🥈 medalla plata segundo|🥉 medalla bronce tercero|🏅 medalla|🎖️ medalla militar|🎗️ lazo recordatorio|🎫 entrada ticket|🎟️ boleto|🎁 regalo|🎀 lazo moño|🎊 confeti bola|🎉 fiesta confeti|🎈 globo|🎆 fuegos artificiales|🎇 bengala|🧨 petardo`),
  parseGroup('viajes', 'Viajes y lugares', `
    🚗 auto coche|🚕 taxi|🚙 camioneta suv|🚌 bus autobus|🚎 trolebus|🏎️ auto de carreras|🚓 patrulla|🚑 ambulancia|🚒 bomberos|🚐 minibus|🚚 camion|🚛 camion articulado|🚜 tractor|🛴 monopatin scooter|🚲 bicicleta|🛵 moto scooter|🏍️ moto|🚨 sirena|🚔 patrulla|🚍 bus|🚘 auto|🚖 taxi|🚡 teleferico|🚠 funicular|🚟 monorriel|
    🚃 vagon tren|🚋 tranvia|🚞 tren montaña|🚝 monorriel|🚄 tren bala|🚅 tren bala|🚈 tren ligero|🚂 locomotora|🚆 tren|🚇 metro subte|🚊 tranvia|🚉 estacion|✈️ avion|🛫 despegue|🛬 aterrizaje|🪂 paracaidas|💺 asiento|🚁 helicoptero|🛰️ satelite|🚀 cohete|🛸 ovni|🚢 barco|⛵ velero|🛶 canoa|🚤 lancha|🛳️ crucero|⛴️ ferry|
    🚧 obras construccion|⚓ ancla|⛽ gasolina|🚏 parada|🚦 semaforo|🚥 semaforo|🗺️ mapa|🗿 moai|🗽 estatua libertad|🗼 torre tokio|🏰 castillo|🏯 castillo japones|🏟️ estadio|🎡 rueda de la fortuna|🎢 montaña rusa|🎠 carrusel|⛲ fuente|⛱️ sombrilla playa|🏖️ playa|🏝️ isla|🏜️ desierto|🌋 volcan|⛰️ montaña|🏔️ montaña nevada|🗻 monte fuji|🏕️ campamento|⛺ carpa|
    🏠 casa|🏡 casa jardin|🏘️ casas|🏚️ casa abandonada|🏗️ construccion|🏭 fabrica|🏢 edificio|🏬 tienda departamental|🏣 correo|🏤 correo|🏥 hospital|🏦 banco|🏨 hotel|🏪 tienda|🏫 escuela|🏩 hotel amor|💒 boda|🏛️ edificio clasico|⛪ iglesia|🕌 mezquita|🕍 sinagoga|🛕 templo hindu|🕋 kaaba|⛩️ santuario|🌃 noche estrellas|🌄 amanecer montañas|🌅 amanecer|🌆 ciudad atardecer|🌇 atardecer|🌉 puente noche|♨️ aguas termales`),
  parseGroup('objetos', 'Objetos y herramientas', `
    ⌚ reloj|📱 celular telefono|📲 celular flecha|💻 laptop computadora|⌨️ teclado|🖥️ computadora escritorio|🖨️ impresora|🖱️ mouse raton|🖲️ trackball|💽 minidisc|💾 disquete guardar|💿 cd|📀 dvd|🎥 camara de cine|🎞️ pelicula fotogramas|📽️ proyector|📺 television|📷 camara foto|📸 camara flash|📹 videocamara|📼 videocasete|🔍 lupa buscar|🔎 lupa derecha|
    🕯️ vela|💡 idea bombilla foco|🔦 linterna|🏮 farol|📔 libreta|📕 libro rojo|📖 libro abierto|📗 libro verde|📘 libro azul|📙 libro naranja|📚 libros|📓 cuaderno|📒 libro de cuentas|📃 pagina|📜 pergamino|📄 documento|📰 periodico|🗞️ diario|📑 pestañas|🔖 marcador|🏷️ etiqueta|
    💰 bolsa de dinero|💴 yenes|💵 dolares|💶 euros|💷 libras|💸 dinero volando|💳 tarjeta|🧾 recibo|✉️ sobre carta|📧 correo|📨 correo entrante|📩 mensaje enviado|📤 bandeja salida|📥 bandeja entrada|📦 paquete caja|📫 buzon|📪 buzon|📬 buzon|📭 buzon vacio|📮 buzon postal|🗳️ urna|
    ✏️ lapiz|✒️ pluma|🖋️ pluma estilografica|🖊️ boligrafo|🖌️ pincel|🖍️ crayon|📝 nota escribir|💼 maletin|📁 carpeta|📂 carpeta abierta|🗂️ separadores|📅 calendario|📆 calendario|🗒️ bloc de notas|🗓️ calendario espiral|📇 tarjetero|📈 grafico subiendo|📉 grafico bajando|📊 grafico barras|📋 portapapeles|📌 chincheta|📍 ubicacion pin|📎 clip|🖇️ clips|📏 regla|📐 escuadra|✂️ tijeras|🗃️ archivo|🗄️ archivero|🗑️ papelera basura|
    🔒 candado cerrado|🔓 candado abierto|🔏 candado pluma|🔐 candado llave|🔑 llave|🗝️ llave antigua|🔨 martillo|🪓 hacha|⛏️ pico|⚒️ martillo pico|🛠️ herramientas|🗡️ daga espada|⚔️ espadas|🔫 pistola de agua|🛡️ escudo|🔧 llave inglesa|🔩 tornillo|⚙️ engranaje configuracion|🗜️ prensa|⚖️ balanza justicia|🔗 enlace|⛓️ cadenas|🧰 caja de herramientas|🧲 iman|
    ⚗️ alambique|🧪 tubo de ensayo|🧫 placa petri|🧬 adn|🔬 microscopio|🔭 telescopio|📡 antena satelital|💉 jeringa|💊 pastilla|🩹 curita|🩺 estetoscopio|🚪 puerta|🛏️ cama|🛋️ sofa|🚽 inodoro|🚿 ducha|🛁 baño|🧴 crema|🧷 gancho|🧹 escoba|🧺 canasta|🧻 papel higienico|🧼 jabon|🧽 esponja|🧯 extintor|🛒 carrito de compras|
    🔔 campana|🔕 sin campana|🎵 nota musical|🎶 notas musicales|📢 megafono altavoz|📣 megafono|🔊 volumen|🧿 amuleto ojo|💎 diamante gema|🔮 bola de cristal|🪙 moneda|⏰ despertador|⏱️ cronometro|⏲️ temporizador|🕰️ reloj de repisa|⌛ reloj de arena|⏳ reloj de arena corriendo|👑 corona|🎩 sombrero de copa|🎓 birrete graduacion|💍 anillo|💄 labial|👓 lentes|🕶️ gafas de sol|🎒 mochila|👜 bolso|👟 zapatilla|👕 camiseta|🧢 gorra|🧣 bufanda|🧤 guantes`),
  parseGroup('banderas', 'Banderas', `
    🏁 meta cuadros|🚩 bandera roja|🎌 banderas cruzadas|🏴 bandera negra|🏳️ bandera blanca|🏳️‍🌈 orgullo arcoiris|🏴‍☠️ pirata|
    🇦🇷 argentina|🇧🇴 bolivia|🇧🇷 brasil|🇨🇱 chile|🇨🇴 colombia|🇨🇷 costa rica|🇨🇺 cuba|🇩🇴 republica dominicana|🇪🇨 ecuador|🇸🇻 el salvador|🇪🇸 españa|🇺🇸 estados unidos usa|🇬🇹 guatemala|🇭🇳 honduras|🇲🇽 mexico|🇳🇮 nicaragua|🇵🇦 panama|🇵🇾 paraguay|🇵🇪 peru|🇵🇷 puerto rico|🇺🇾 uruguay|🇻🇪 venezuela|
    🇫🇷 francia|🇮🇹 italia|🇩🇪 alemania|🇬🇧 reino unido|🇵🇹 portugal|🇯🇵 japon|🇰🇷 corea|🇨🇳 china|🇷🇺 rusia|🇨🇦 canada|🇦🇺 australia|🇮🇳 india|🇹🇷 turquia|🇺🇦 ucrania|🇪🇺 union europea`),
];

// simbolos de TEXTO (no son emojis): sirven donde el campo admite texto libre (por ejemplo el simbolo de la
// moneda), pero NO en reacciones, botones ni menus, que exigen un emoji de verdad
const TEXT_SYMBOLS = '★ ☆ ♥ ♦ ♣ ♠ ● ○ ■ □ ▲ ▼ ◆ ◇ ✦ ✧ ❖ ✿ ❀ ➜ ➤ ✔ ✖ ✚ ✱ ☾ ♪ ♫ ¤ $ € £ ¥ ¢ ₿ • · » « ※'.split(' ');

module.exports = { SIMPLE, DETAILED, TEXT_SYMBOLS };
