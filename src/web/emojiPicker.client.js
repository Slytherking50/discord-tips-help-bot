// Selector de emojis del panel. Se activa solo en los campos con el atributo data-emoji (o data-emoji="text" si
// el campo admite texto libre, como el simbolo de la moneda): les agrega una vista previa del emoji actual y un
// boton que abre el selector con cuatro grupos:
//   Simples     formas, colores, marcas, flechas, numeros y corazones (emojis planos, de pocos trazos)
//   Detallados  los ilustrados de siempre: caras, animales, comida, objetos...
//   Píxel       emojis de pixel art propios; al elegir uno nuevo el bot lo sube al servidor como emoji personalizado
//   Del servidor  los emojis personalizados que ya tiene el servidor
// Los datos llegan de /dashboard/api/emoji-catalog (igual para todos) y /dashboard/api/emojis (propios de cada servidor).
// Un <textarea data-emoji-insert> (el texto de un mensaje) lleva debajo un boton "Agregar emoji": el elegido se escribe donde esta el cursor.
(function () {
  'use strict';
  if (window.__emojiPicker) return;
  window.__emojiPicker = true;

  var CUSTOM = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
  var RECENT_KEY = 'planetbot.emoji.recientes';
  var RECENT_MAX = 28;
  var RESULTS_MAX = 240;
  var TABS = [
    { id: 'recent', label: 'Recientes' },
    { id: 'simple', label: 'Simples' },
    { id: 'detailed', label: 'Detallados' },
    { id: 'pixel', label: 'Píxel' },
    { id: 'server', label: 'Del servidor' },
  ];
  var SMILE =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0"/><path d="M9 9.8h.01M15 9.8h.01" stroke-width="2.4"/></svg>';

  var state = { catalog: null, guild: null, loaded: null, loadError: null, tab: 'detailed', query: '', input: null, anchor: null, notice: null, installing: {} };
  var pop = null;

  // --- utilidades ---

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function fold(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function customOf(value) {
    var match = String(value || '').trim().match(CUSTOM);
    return match ? { animated: match[1] === 'a', name: match[2], id: match[3] } : null;
  }

  function emojiImg(custom, size) {
    var px = size > 24 ? 96 : 48;
    return h('img', {
      class: 'emoji-img',
      src: 'https://cdn.discordapp.com/emojis/' + custom.id + '.' + (custom.animated ? 'gif' : 'png') + '?size=' + px + '&quality=lossless',
      alt: ':' + custom.name + ':',
      width: size,
      height: size,
      loading: 'lazy',
    });
  }

  function valueNode(value, size) {
    var custom = customOf(value);
    return custom ? emojiImg(custom, size) : h('span', { text: value });
  }

  function readRecents() {
    try {
      var list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (v) { return typeof v === 'string' && v; }).slice(0, RECENT_MAX) : [];
    } catch (err) {
      return [];
    }
  }

  function rememberRecent(value) {
    if (!value) return;
    try {
      var list = [value].concat(readRecents().filter(function (v) { return v !== value; })).slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (err) {
      /* sin almacenamiento: no pasa nada */
    }
  }

  // --- campos con emoji ---

  function updatePreview(input) {
    var preview = input.parentNode && input.parentNode.querySelector('.emoji-preview');
    if (!preview) return;
    var value = input.value.trim();
    preview.textContent = '';
    preview.classList.toggle('is-empty', !value);
    if (value) preview.appendChild(valueNode(value.length > 6 && !customOf(value) ? value.slice(0, 6) : value, 20));
  }

  function enhance(input) {
    if (input.getAttribute('data-emoji-ready')) return;
    input.setAttribute('data-emoji-ready', '1');
    input.setAttribute('autocomplete', 'off');
    // los emojis personalizados se guardan como <:nombre:id> y miden mas que un emoji normal
    if (!input.getAttribute('maxlength') || Number(input.getAttribute('maxlength')) < 64) input.setAttribute('maxlength', '64');

    var wrapper = h('span', { class: 'emoji-field' });
    var preview = h('span', { class: 'emoji-preview is-empty', 'aria-hidden': 'true' });
    var open = h('button', { type: 'button', class: 'emoji-open', title: 'Elegir emoji', 'aria-label': 'Elegir emoji', 'aria-haspopup': 'dialog', html: SMILE });
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(preview);
    wrapper.appendChild(input);
    wrapper.appendChild(open);

    input.addEventListener('input', function () { updatePreview(input); });
    open.addEventListener('click', function () {
      if (pop && !pop.root.hidden && state.input === input) closePopover();
      else openFor(input);
    });
    updatePreview(input);
  }

  // texto de un mensaje: el emoji elegido se inserta donde esta el cursor (o reemplaza lo seleccionado) en vez de reemplazar todo el campo
  function enhanceInsert(area) {
    if (area.getAttribute('data-emoji-ready')) return;
    area.setAttribute('data-emoji-ready', '1');
    var open = h('button', { type: 'button', class: 'secondary small emoji-open emoji-insert', title: 'Agregar un emoji donde está el cursor', 'aria-haspopup': 'dialog', html: SMILE + '<span>Agregar emoji</span>' });
    area.parentNode.insertBefore(h('div', { class: 'emoji-insert-bar' }, [open]), area.nextSibling);
    open.addEventListener('click', function () {
      if (pop && !pop.root.hidden && state.input === area) closePopover();
      else openFor(area, open);
    });
  }

  function insertAtCursor(field, text) {
    var start = typeof field.selectionStart === 'number' ? field.selectionStart : field.value.length;
    var end = typeof field.selectionEnd === 'number' ? field.selectionEnd : start;
    var max = Number(field.getAttribute('maxlength'));
    if (max && field.value.length - (end - start) + text.length > max) return false;
    field.value = field.value.slice(0, start) + text + field.value.slice(end);
    field.setSelectionRange(start + text.length, start + text.length);
    return true;
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches('input[data-emoji]:not([data-emoji-ready])')) enhance(scope);
    if (scope.matches && scope.matches('textarea[data-emoji-insert]:not([data-emoji-ready])')) enhanceInsert(scope);
    scope.querySelectorAll('input[data-emoji]:not([data-emoji-ready])').forEach(enhance);
    scope.querySelectorAll('textarea[data-emoji-insert]:not([data-emoji-ready])').forEach(enhanceInsert);
  }

  // --- datos ---

  function fetchJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 401 ? 'session' : 'http');
      return res.json();
    });
  }

  // el catalogo se pide una sola vez; lo del servidor (emojis propios, lugares libres) cada vez que se abre
  function loadData() {
    var jobs = [];
    if (!state.catalog) jobs.push(fetchJson('/dashboard/api/emoji-catalog').then(function (data) { state.catalog = data; }));
    jobs.push(fetchJson('/dashboard/api/emojis').then(function (data) { state.guild = data; }));
    state.loadError = null;
    state.loaded = Promise.all(jobs)
      .catch(function (err) { state.loadError = err.message === 'session' ? 'Tu sesión venció: recarga la página para elegir emojis.' : 'No se pudieron cargar los emojis. Inténtalo de nuevo.'; })
      .then(render);
    return state.loaded;
  }

  // --- ventana del selector ---

  function ensurePopover() {
    if (pop) return pop;
    var search = h('input', { type: 'search', class: 'emoji-search', placeholder: 'Buscar: corazón, espada, gato…', 'aria-label': 'Buscar emoji', autocomplete: 'off' });
    var clear = h('button', { type: 'button', class: 'secondary emoji-clear', title: 'Dejar el campo vacío', text: 'Quitar' });
    var tabs = h('div', { class: 'emoji-tabs', role: 'tablist' }, TABS.map(function (tab) { return h('button', { type: 'button', class: 'emoji-tab', role: 'tab', 'data-tab': tab.id, text: tab.label }); }));
    var chips = h('div', { class: 'emoji-chips' });
    var scroll = h('div', { class: 'emoji-scroll' });
    var foot = h('div', { class: 'emoji-foot' });
    var root = h('div', { class: 'emoji-popover', role: 'dialog', 'aria-label': 'Elegir emoji', hidden: true }, [h('div', { class: 'emoji-top' }, [search, clear]), tabs, chips, scroll, foot]);
    document.body.appendChild(root);
    pop = { root: root, search: search, clear: clear, tabs: tabs, chips: chips, scroll: scroll, foot: foot };

    search.addEventListener('input', function () { state.query = fold(search.value.trim()); render(); });
    search.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        var first = scroll.querySelector('.emoji-item');
        if (first) first.click();
      }
    });
    clear.addEventListener('click', function () { choose(''); });
    tabs.addEventListener('click', function (event) {
      var button = event.target.closest('.emoji-tab');
      if (!button) return;
      state.tab = button.getAttribute('data-tab');
      state.query = '';
      search.value = '';
      render();
    });
    chips.addEventListener('click', function (event) {
      var chip = event.target.closest('.emoji-chip');
      var heading = chip && scroll.querySelector('[data-group="' + chip.getAttribute('data-group') + '"]');
      if (heading) scroll.scrollTop = heading.offsetTop - scroll.offsetTop - 4;
    });
    scroll.addEventListener('click', function (event) {
      var item = event.target.closest('.emoji-item');
      if (item) pickItem(item);
    });
    document.addEventListener('mousedown', function (event) {
      if (pop.root.hidden || pop.root.contains(event.target) || event.target.closest('.emoji-open')) return;
      closePopover();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !pop.root.hidden) {
        var input = state.input;
        closePopover();
        if (input) input.focus();
      }
    });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return pop;
  }

  function position() {
    if (!pop || pop.root.hidden || !state.input) return;
    var anchor = (state.anchor || state.input.parentNode || state.input).getBoundingClientRect();
    // si el navegador todavia no midio la ventana (pestaña oculta) se usan medidas de respaldo
    var viewH = window.innerHeight || document.documentElement.clientHeight || 720;
    var viewW = window.innerWidth || document.documentElement.clientWidth || 1280;
    var width = Math.min(392, viewW - 16);
    var left = Math.max(8, Math.min(anchor.left, viewW - width - 8));
    var below = viewH - anchor.bottom;
    var openUp = below < 380 && anchor.top > below;
    var room = openUp ? anchor.top : below;
    // alto: lo que haya de lugar, pero nunca tan chico que no se pueda usar
    var maxHeight = Math.max(Math.min(260, viewH - 16), Math.min(440, room - 14));
    pop.root.style.width = width + 'px';
    pop.root.style.left = left + 'px';
    pop.root.style.maxHeight = maxHeight + 'px';
    if (openUp) {
      pop.root.style.top = 'auto';
      pop.root.style.bottom = viewH - anchor.top + 6 + 'px';
    } else {
      pop.root.style.bottom = 'auto';
      pop.root.style.top = anchor.bottom + 6 + 'px';
    }
  }

  function isInsertTarget(input) {
    return Boolean(input && input.tagName === 'TEXTAREA');
  }

  function openFor(input, anchor) {
    ensurePopover();
    state.input = input;
    state.anchor = anchor || null;
    state.query = '';
    state.notice = null;
    // en el texto de un mensaje lo que mas se busca son los emojis del servidor
    if (isInsertTarget(input)) state.tab = 'server';
    pop.search.value = '';
    pop.root.hidden = false;
    // "Quitar" vacia un campo de un solo emoji; en un texto no hay nada que vaciar
    pop.clear.hidden = isInsertTarget(input);
    position();
    render();
    loadData();
    pop.search.focus({ preventScroll: true });
  }

  function closePopover() {
    if (pop) pop.root.hidden = true;
  }

  function choose(value) {
    var input = state.input;
    if (!input) return;
    if (isInsertTarget(input)) {
      if (!value) return;
      if (!insertAtCursor(input, value)) return notify('No cabe: el texto ya llegó a su límite de letras.', true);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    rememberRecent(value);
    closePopover();
    input.focus();
  }

  function notify(text, isError) {
    state.notice = text ? { text: text, error: Boolean(isError) } : null;
    renderFoot();
  }

  // --- dibujo ---

  function item(value, title, content, extra) {
    var button = h('button', { type: 'button', class: 'emoji-item' + (extra ? ' ' + extra : ''), title: title, 'aria-label': title, 'data-value': value });
    button.appendChild(content);
    return button;
  }

  function addGroup(parts, label, id, items) {
    if (!items.length) return;
    parts.scroll.appendChild(h('div', { class: 'emoji-heading', 'data-group': id, text: label }));
    parts.scroll.appendChild(h('div', { class: 'emoji-grid' }, items));
    parts.chips.appendChild(h('button', { type: 'button', class: 'emoji-chip', 'data-group': id, text: label }));
  }

  function groupItems(group) {
    return group.items.map(function (entry) { return item(entry[0], entry[0] + ' ' + entry[1], h('span', { text: entry[0] }), null); });
  }

  function pixelItem(sprite) {
    var title = sprite.label + (sprite.installed ? ' · ya está en el servidor' : ' · se sube al servidor al elegirlo');
    var button = item(sprite.installed ? sprite.installed.markup : '', title, h('span', { class: 'emoji-pixel', html: sprite.svg }), sprite.installed ? 'is-installed' : 'is-new');
    button.setAttribute('data-pixel', sprite.id);
    if (state.installing[sprite.id]) button.disabled = true;
    return button;
  }

  function serverItem(emoji) {
    return item(emoji.markup, ':' + emoji.name + ':', emojiImg(emoji, 28), null);
  }

  function findMatches(tokens) {
    var seen = {};
    var found = [];
    var matches = function (text) { return tokens.every(function (token) { return text.indexOf(token) !== -1; }); };
    var push = function (key, node) {
      if (seen[key] || found.length >= RESULTS_MAX) return;
      seen[key] = true;
      found.push(node);
    };
    var textField = state.input && (state.input.getAttribute('data-emoji') === 'text' || isInsertTarget(state.input));
    ['simple', 'detailed'].forEach(function (kind) {
      state.catalog[kind].forEach(function (group) {
        group.items.forEach(function (entry) {
          if (matches(fold(entry[1] + ' ' + group.label))) push(entry[0], item(entry[0], entry[0] + ' ' + entry[1], h('span', { text: entry[0] }), null));
        });
      });
    });
    state.guild.pixel.forEach(function (sprite) { if (matches(fold(sprite.label + ' ' + sprite.keywords + ' pixel pixeles'))) push('px' + sprite.id, pixelItem(sprite)); });
    state.guild.custom.forEach(function (emoji) { if (matches(fold(emoji.name + ' servidor'))) push(emoji.markup, serverItem(emoji)); });
    if (textField) state.catalog.symbols.forEach(function (symbol) { if (matches(fold('simbolo ' + symbol))) push(symbol, item(symbol, symbol, h('span', { text: symbol }), null)); });
    return found;
  }

  function renderFoot() {
    if (!pop) return;
    var capacity = state.guild && state.guild.capacity;
    var text = state.notice ? state.notice.text : '';
    var isError = Boolean(state.notice && state.notice.error);
    if (!text && state.loadError) {
      text = state.loadError;
      isError = true;
    }
    if (!text && state.tab === 'pixel' && capacity && !state.query) {
      text = 'Al elegir un emoji nuevo, el bot lo sube a tu servidor (usa 1 lugar: quedan ' + capacity.free + ' de ' + capacity.limit + '). Los que ya están subidos no gastan más.';
    } else if (!text && state.tab === 'server' && capacity && !state.query) {
      text = 'Lugares de emojis del servidor: ' + capacity.static + ' de ' + capacity.limit + ' usados (más ' + capacity.animated + ' animados).';
    }
    pop.foot.textContent = text;
    pop.foot.classList.toggle('is-error', isError);
    pop.foot.hidden = !text;
  }

  function render() {
    if (!pop || pop.root.hidden) return;
    var searching = Boolean(state.query);
    pop.tabs.querySelectorAll('.emoji-tab').forEach(function (button) {
      var on = button.getAttribute('data-tab') === state.tab && !searching;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    pop.scroll.textContent = '';
    pop.chips.textContent = '';

    if (!state.catalog || !state.guild) {
      pop.scroll.appendChild(h('div', { class: 'emoji-empty', text: state.loadError || 'Cargando emojis…' }));
      renderFoot();
      return;
    }

    var textField = state.input && (state.input.getAttribute('data-emoji') === 'text' || isInsertTarget(state.input));

    if (searching) {
      var found = findMatches(state.query.split(/\s+/).filter(Boolean));
      if (found.length) {
        pop.scroll.appendChild(h('div', { class: 'emoji-heading', text: 'Resultados' }));
        pop.scroll.appendChild(h('div', { class: 'emoji-grid' }, found));
      } else {
        pop.scroll.appendChild(h('div', { class: 'emoji-empty', text: 'No encontré emojis con eso. Prueba con otra palabra.' }));
      }
    } else if (state.tab === 'recent') {
      var recents = readRecents();
      if (recents.length) pop.scroll.appendChild(h('div', { class: 'emoji-grid' }, recents.map(function (value) { return item(value, value, valueNode(value, 28), null); })));
      else pop.scroll.appendChild(h('div', { class: 'emoji-empty', text: 'Todavía no elegiste ninguno. Los que uses aparecerán acá.' }));
    } else if (state.tab === 'simple' || state.tab === 'detailed') {
      if (state.tab === 'simple' && textField) {
        addGroup(pop, 'Símbolos de texto', 'symbols', state.catalog.symbols.map(function (symbol) { return item(symbol, symbol, h('span', { text: symbol }), null); }));
      }
      state.catalog[state.tab].forEach(function (group) { addGroup(pop, group.label, group.id, groupItems(group)); });
    } else if (state.tab === 'pixel') {
      // por grupos (redes sociales, objetos y juego, marcas y flechas), igual que Simples y Detallados
      (state.catalog.pixelGroups || []).forEach(function (group) {
        addGroup(pop, group.label, 'px-' + group.id, state.guild.pixel.filter(function (sprite) { return sprite.group === group.id; }).map(pixelItem));
      });
    } else if (state.tab === 'server') {
      if (state.guild.custom.length) pop.scroll.appendChild(h('div', { class: 'emoji-grid' }, state.guild.custom.map(serverItem)));
      else pop.scroll.appendChild(h('div', { class: 'emoji-empty', text: 'Este servidor todavía no tiene emojis personalizados. Los de la pestaña Píxel se suben al elegirlos.' }));
    }
    pop.chips.hidden = !pop.chips.children.length;
    renderFoot();
  }

  // --- elegir ---

  function pickItem(button) {
    var pixelId = button.getAttribute('data-pixel');
    if (pixelId) return pickPixel(pixelId);
    choose(button.getAttribute('data-value') || '');
  }

  function pickPixel(id) {
    var sprite = (state.guild.pixel || []).find(function (entry) { return entry.id === id; });
    if (!sprite || state.installing[id]) return;
    if (sprite.installed) return choose(sprite.installed.markup);

    var capacity = state.guild.capacity;
    if (!capacity.canCreate) return notify('El bot no tiene permiso para crear emojis en este servidor (Gestionar expresiones).', true);
    if (capacity.free <= 0) return notify('El servidor ya usa todos sus lugares de emojis (' + capacity.static + '/' + capacity.limit + '). Borra alguno y vuelve a intentarlo.', true);

    state.installing[id] = true;
    notify('Subiendo «' + sprite.label + '» al servidor…', false);
    render();
    fetch('/dashboard/api/emojis/pixel/' + encodeURIComponent(id), { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok && data.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data.error || 'No se pudo subir el emoji.');
        sprite.installed = { id: result.data.emoji.id, markup: result.data.emoji.markup };
        state.guild.custom.push({ id: result.data.emoji.id, name: result.data.emoji.name, animated: false, markup: result.data.emoji.markup });
        if (result.data.capacity) state.guild.capacity = result.data.capacity;
        delete state.installing[id];
        state.notice = null;
        choose(result.data.emoji.markup);
      })
      .catch(function (err) {
        delete state.installing[id];
        notify(err.message || 'No se pudo subir el emoji.', true);
        render();
      });
  }

  // --- arranque ---

  function start() {
    scan(document);
    // los campos que arma JavaScript (el editor de mensajes avanzados) aparecen despues: se activan cuando llegan
    new MutationObserver(function (records) {
      records.forEach(function (record) { record.addedNodes.forEach(function (node) { if (node.nodeType === 1) scan(node); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
