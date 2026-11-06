// Editor de mensajes avanzados (corre en el navegador, dentro del dashboard).
// Estado: { containers: [ { accent, items: [ bloques ] } ] }, el mismo formato
// que valida src/richMessage.js. Al guardar se manda como JSON en #rich-payload.
(function () {
  var data = window.__RICH;
  var state = JSON.parse(JSON.stringify(data.initial));
  // tarjetas por diseño: Discord solo deja 40 componentes y 4000 letras de texto por MENSAJE, asi que un diseño con muchas tarjetas se
  // publica en varios mensajes seguidos (mismos topes que src/richMessage.js)
  var LIMITS = { containers: 20, items: 20, buttons: 5, gallery: 4, components: 40, text: 3800, messages: 6 };
  var summaryEl = null;
  var BLOCK_LABELS = { text: 'Texto', section: 'Sección con imagen', separator: 'Separador', buttons: 'Botones con link', gallery: 'Imágenes' };
  var SAMPLE_IMAGE = 'https://cdn.discordapp.com/embed/avatars/1.png';

  var editorEl = document.getElementById('rich-editor');
  var previewEl = document.getElementById('rich-preview');
  var payloadInput = document.getElementById('rich-payload');
  var form = document.getElementById('rich-form');
  var templateSelect = document.getElementById('rich-template');
  var templateInfo = document.getElementById('rich-template-info');

  // ---------- utilidades ----------

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null || value === false) return;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.indexOf('on') === 0) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) {
      if (child) el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return el;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  // un emoji personalizado se guarda como <:nombre:id> (o <a:nombre:id>): en la vista previa se ve como imagen
  function emojiHtml(value) {
    var match = String(value || '').trim().match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
    if (!match) return escapeHtml(value || '');
    return '<img class="emoji-inline" src="https://cdn.discordapp.com/emojis/' + match[3] + (match[1] ? '.gif' : '.png') + '?size=48&amp;quality=lossless" alt=":' + match[2] + ':" width="20" height="20">';
  }

  function move(list, index, delta) {
    var target = index + delta;
    if (target < 0 || target >= list.length) return;
    var item = list.splice(index, 1)[0];
    list.splice(target, 0, item);
  }

  function newItem(type) {
    if (type === 'text') return { type: 'text', content: '' };
    if (type === 'section') return { type: 'section', content: '', thumbnail: '' };
    if (type === 'separator') return { type: 'separator', divider: true, spacing: 'small' };
    if (type === 'buttons') return { type: 'buttons', buttons: [{ label: '', url: '', emoji: '' }] };
    return { type: 'gallery', urls: [] };
  }

  // ---------- markdown de la vista previa (version reducida del de Discord) ----------

  function sampleValues() {
    return {
      '{user}': '@Miembro',
      '{username}': 'Miembro',
      '{server}': data.sample.server,
      '{membercount}': String(data.sample.membercount),
      '{joindate}': new Date().toLocaleDateString('es-AR'),
      '{avatar}': SAMPLE_IMAGE,
      '{servericon}': SAMPLE_IMAGE,
    };
  }

  function fill(text) {
    var values = sampleValues();
    return Object.keys(values).reduce(function (acc, token) {
      return acc.split(token).join(values[token]);
    }, String(text || ''));
  }

  function inline(raw) {
    var out = escapeHtml(raw);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<u>$1</u>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    out = out.replace(/&lt;#\d+&gt;/g, '<span class="dp-mention">#canal</span>');
    out = out.replace(/&lt;@!?\d+&gt;/g, '<span class="dp-mention">@usuario</span>');
    // emojis personalizados del server: <:nombre:id> y <a:nombre:id> (animado) se ven como la imagen; los de Unicode ya son texto
    out = out.replace(/&lt;(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})&gt;/g, function (match, animated, name, id) {
      return '<img class="dp-emoji" src="https://cdn.discordapp.com/emojis/' + id + (animated ? '.gif' : '.png') + '?size=48&amp;quality=lossless" alt=":' + name + ':">';
    });
    return out;
  }

  function markdown(text) {
    var lines = fill(text).split('\n');
    var html = '';
    var list = null;

    function closeList() {
      if (list) {
        html += '</' + list + '>';
        list = null;
      }
    }

    lines.forEach(function (line) {
      var bullet = line.match(/^\s*[-*]\s+(.*)$/);
      var numbered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (bullet || numbered) {
        var tag = bullet ? 'ul' : 'ol';
        if (list !== tag) {
          closeList();
          html += '<' + tag + '>';
          list = tag;
        }
        html += '<li>' + inline((bullet || numbered)[1]) + '</li>';
        return;
      }
      closeList();
      var match;
      if ((match = line.match(/^###\s+(.*)$/))) html += '<div class="dp-h3">' + inline(match[1]) + '</div>';
      else if ((match = line.match(/^##\s+(.*)$/))) html += '<div class="dp-h2">' + inline(match[1]) + '</div>';
      else if ((match = line.match(/^#\s+(.*)$/))) html += '<div class="dp-h1">' + inline(match[1]) + '</div>';
      else if ((match = line.match(/^-#\s+(.*)$/))) html += '<div class="dp-small">' + inline(match[1]) + '</div>';
      else if (line.trim() === '') html += '<div class="dp-gap"></div>';
      else html += '<div>' + inline(line) + '</div>';
    });
    closeList();
    return html;
  }

  function isImageUrl(url) {
    return /^https?:\/\/[^\s<>"]{3,}$/i.test(url);
  }

  function resolveImage(value) {
    var filled = fill(value);
    return isImageUrl(filled) ? filled : '';
  }

  // ---------- vista previa ----------

  var LINK_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function previewItem(item) {
    var el = h('div', { class: 'dp-item dp-' + item.type });
    if (item.type === 'text') {
      el.innerHTML = markdown(item.content);
    } else if (item.type === 'section') {
      var text = h('div', { class: 'dp-section-text' });
      text.innerHTML = markdown(item.content);
      el.appendChild(text);
      var src = resolveImage(item.thumbnail);
      if (src) el.appendChild(h('img', { class: 'dp-thumb', src: src, alt: '' }));
    } else if (item.type === 'separator') {
      el.className += item.spacing === 'large' ? ' dp-sep-large' : '';
      if (item.divider) el.appendChild(h('hr'));
    } else if (item.type === 'buttons') {
      item.buttons.forEach(function (button) {
        if (!button.label) return;
        var node = h('span', { class: 'dp-btn' });
        node.innerHTML = (button.emoji ? emojiHtml(button.emoji) + ' ' : '') + escapeHtml(button.label) + ' ' + LINK_ICON;
        el.appendChild(node);
      });
    } else if (item.type === 'gallery') {
      var urls = item.urls.filter(isImageUrl);
      el.className += ' dp-gallery-' + Math.min(urls.length, 4);
      urls.slice(0, LIMITS.gallery).forEach(function (url) {
        el.appendChild(h('img', { src: url, alt: '' }));
      });
    }
    return el;
  }

  function renderPreview() {
    previewEl.textContent = '';
    state.containers.forEach(function (container) {
      var box = h('div', { class: 'dp-container' });
      if (container.accent) box.style.borderLeft = '4px solid ' + container.accent;
      container.items.forEach(function (item) {
        box.appendChild(previewItem(item));
      });
      previewEl.appendChild(box);
    });
    refreshSizeInfo();
  }

  // ---------- editor ----------

  function field(label, control, hint) {
    return h('div', { class: 're-field' }, [h('label', { text: label }), control, hint ? h('p', { class: 'muted', text: hint }) : null]);
  }

  function textInput(value, placeholder, onChange) {
    return h('input', {
      type: 'text',
      value: value || '',
      placeholder: placeholder || '',
      oninput: function (event) {
        onChange(event.target.value);
        renderPreview();
      },
    });
  }

  // campo de emoji: el selector del panel (emojiPicker.client.js) lo detecta por el atributo data-emoji
  function emojiInput(value, onChange) {
    var input = textInput(value, 'Emoji', onChange);
    input.setAttribute('data-emoji', '');
    return input;
  }

  // withEmoji: el texto de un mensaje lleva el boton "Agregar emoji" del selector del panel (emojiPicker.client.js)
  function textArea(value, placeholder, rows, onChange, withEmoji) {
    var area = h('textarea', {
      placeholder: placeholder || '',
      rows: String(rows || 4),
      'data-emoji-insert': Boolean(withEmoji),
      oninput: function (event) {
        onChange(event.target.value);
        renderPreview();
      },
    });
    area.value = value || '';
    return area;
  }

  function miniButton(label, handler, extraClass) {
    return h('button', { type: 'button', class: 'secondary small ' + (extraClass || ''), text: label, onclick: handler });
  }

  function itemFields(item) {
    if (item.type === 'text') {
      return [
        field('Texto', textArea(item.content, '## Título\nEscribe con **markdown**: listas, enlaces, # títulos y -# letra pequeña.', 5, function (v) { item.content = v; }, true)),
      ];
    }
    if (item.type === 'section') {
      return [
        field('Texto', textArea(item.content, '### Título\nTexto de la sección.', 4, function (v) { item.content = v; }, true)),
        field('Imagen a la derecha (opcional)', textInput(item.thumbnail, 'https://… , {avatar} o {servericon}', function (v) { item.thumbnail = v.trim(); }), '{avatar} es la foto de quien entra (solo en la bienvenida) y {servericon} el icono del servidor.'),
      ];
    }
    if (item.type === 'separator') {
      var divider = h('input', {
        type: 'checkbox',
        checked: item.divider,
        onchange: function (event) { item.divider = event.target.checked; renderPreview(); },
      });
      divider.checked = item.divider;
      var spacing = h('select', { onchange: function (event) { item.spacing = event.target.value; renderPreview(); } }, [
        h('option', { value: 'small', text: 'Pequeño', selected: item.spacing !== 'large' }),
        h('option', { value: 'large', text: 'Grande', selected: item.spacing === 'large' }),
      ]);
      return [h('div', { class: 're-inline' }, [h('label', { class: 're-check' }, [divider, ' Mostrar línea']), h('label', {}, ['Espacio ', spacing])])];
    }
    if (item.type === 'buttons') {
      var rows = h('div', { class: 're-buttons' });
      item.buttons.forEach(function (button, index) {
        rows.appendChild(
          h('div', { class: 're-button-row' }, [
            emojiInput(button.emoji, function (v) { button.emoji = v.trim(); }),
            textInput(button.label, 'Texto del botón', function (v) { button.label = v; }),
            textInput(button.url, 'https://…', function (v) { button.url = v.trim(); }),
            miniButton('Quitar', function () { item.buttons.splice(index, 1); if (!item.buttons.length) item.buttons.push({ label: '', url: '', emoji: '' }); renderEditor(); }, 'danger'),
          ]),
        );
      });
      var add = item.buttons.length < LIMITS.buttons ? miniButton('Agregar botón', function () { item.buttons.push({ label: '', url: '', emoji: '' }); renderEditor(); }) : null;
      return [rows, add];
    }
    // gallery
    return [
      field('Links de imágenes (uno por línea, hasta ' + LIMITS.gallery + ')', textArea(item.urls.join('\n'), 'https://…/imagen.png', 3, function (v) {
        item.urls = v.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
      })),
    ];
  }

  function renderItem(container, item, index) {
    var head = h('div', { class: 're-item-head' }, [
      h('strong', { text: BLOCK_LABELS[item.type] }),
      h('span', { class: 're-tools' }, [
        miniButton('Subir', function () { move(container.items, index, -1); renderEditor(); }),
        miniButton('Bajar', function () { move(container.items, index, 1); renderEditor(); }),
        miniButton('Quitar', function () { container.items.splice(index, 1); renderEditor(); }, 'danger'),
      ]),
    ]);
    return h('div', { class: 're-item' }, [head].concat(itemFields(item)));
  }

  function renderContainer(container, ci) {
    var hasAccent = Boolean(container.accent);
    var accentToggle = h('input', {
      type: 'checkbox',
      onchange: function (event) {
        container.accent = event.target.checked ? colorInput.value : null;
        colorInput.disabled = !event.target.checked;
        renderPreview();
      },
    });
    accentToggle.checked = hasAccent;
    var colorInput = h('input', {
      type: 'color',
      value: container.accent || '#ec7b2c',
      oninput: function (event) {
        if (accentToggle.checked) container.accent = event.target.value;
        renderPreview();
      },
    });
    colorInput.disabled = !hasAccent;

    var head = h('div', { class: 're-container-head' }, [
      h('strong', { text: 'Tarjeta ' + (ci + 1) }),
      h('span', { class: 're-size' }),
      h('label', { class: 're-check' }, [accentToggle, ' Color de borde', colorInput]),
      h('span', { class: 're-tools' }, [
        miniButton('Subir', function () { move(state.containers, ci, -1); renderEditor(); }),
        miniButton('Bajar', function () { move(state.containers, ci, 1); renderEditor(); }),
        miniButton('Quitar', function () { state.containers.splice(ci, 1); if (!state.containers.length) state.containers.push({ accent: null, items: [newItem('text')] }); renderEditor(); }, 'danger'),
      ]),
    ]);

    var items = h('div', { class: 're-items' });
    container.items.forEach(function (item, index) {
      items.appendChild(renderItem(container, item, index));
    });

    var typeSelect = h(
      'select',
      {},
      Object.keys(BLOCK_LABELS).map(function (type) { return h('option', { value: type, text: BLOCK_LABELS[type] }); }),
    );
    var addRow = container.items.length < LIMITS.items
      ? h('div', { class: 're-add' }, [
          h('span', { text: 'Agregar bloque:' }),
          typeSelect,
          miniButton('Agregar', function () { container.items.push(newItem(typeSelect.value)); renderEditor(); }),
        ])
      : h('p', { class: 'muted', text: 'Esta tarjeta ya tiene el máximo de bloques.' });

    return h('div', { class: 're-container' }, [head, items, addRow]);
  }

  // cuanto ocupa una tarjeta en un mensaje de Discord (componentes contando los anidados, y letras de texto): igual que measureContainer
  function measure(container) {
    var components = 1;
    var text = 0;
    container.items.forEach(function (item) {
      var length = String(item.content || '').trim().length;
      if (item.type === 'text') { components += 1; text += length; }
      else if (item.type === 'section') { components += item.thumbnail ? 3 : 1; text += length; }
      else if (item.type === 'separator') components += 1;
      else if (item.type === 'buttons') components += 1 + item.buttons.length;
      else if (item.type === 'gallery') components += 1 + (item.urls || []).length;
    });
    return { components: components, text: text };
  }

  // en cuantos mensajes seguidos queda el diseño y si alguna tarjeta no cabe sola en uno (igual que splitIntoMessages)
  function sizeSummary() {
    var messages = 0;
    var components = 0;
    var text = 0;
    var tooBig = 0;
    state.containers.forEach(function (container, ci) {
      var size = measure(container);
      if (size.components > LIMITS.components || size.text > LIMITS.text) tooBig = tooBig || ci + 1;
      if (!messages || components + size.components > LIMITS.components || text + size.text > LIMITS.text) { messages += 1; components = 0; text = 0; }
      components += size.components;
      text += size.text;
    });
    return { messages: messages, tooBig: tooBig };
  }

  function renderEditor() {
    editorEl.textContent = '';
    state.containers.forEach(function (container, ci) {
      editorEl.appendChild(renderContainer(container, ci));
    });
    if (state.containers.length < LIMITS.containers) {
      editorEl.appendChild(
        miniButton('Agregar tarjeta', function () {
          state.containers.push({ accent: null, items: [newItem('text')] });
          renderEditor();
        }),
      );
    }
    summaryEl = h('p', { class: 'muted' });
    editorEl.appendChild(summaryEl);
    renderPreview();
  }

  // contadores al dia con cada cambio: bloques, componentes y letras de cada tarjeta (una seccion con imagen cuenta 3 de los 40 componentes que
  // Discord deja por mensaje) y, abajo, en cuantos mensajes seguidos queda el diseño
  function refreshSizeInfo() {
    var tags = editorEl.querySelectorAll('.re-size');
    state.containers.forEach(function (container, ci) {
      var tag = tags[ci];
      if (!tag) return;
      var size = measure(container);
      tag.textContent = 'Bloques ' + container.items.length + '/' + LIMITS.items + ' · Componentes ' + size.components + '/' + LIMITS.components + ' · Letras ' + size.text + '/' + LIMITS.text;
      tag.style.color = size.components > LIMITS.components || size.text > LIMITS.text ? 'var(--danger)' : '';
    });
    if (!summaryEl) return;
    var summary = sizeSummary();
    var line = 'Tarjetas: ' + state.containers.length + ' de ' + LIMITS.containers + '. ';
    if (summary.tooBig) line += 'La tarjeta ' + summary.tooBig + ' es demasiado grande para un mensaje de Discord (máximo ' + LIMITS.components + ' componentes y ' + LIMITS.text + ' letras): quítale bloques, botones o texto. ';
    else if (summary.messages > LIMITS.messages) line += 'Es demasiado largo: ocuparía ' + summary.messages + ' mensajes seguidos y el máximo es ' + LIMITS.messages + '. ';
    else if (summary.messages > 1) line += 'Se publicará en ' + summary.messages + ' mensajes seguidos (Discord deja ' + LIMITS.components + ' componentes por mensaje); cada tarjeta va entera en uno. ';
    else line += 'Cabe en un solo mensaje. ';
    summaryEl.textContent = line.trim();
  }

  // ---------- diseños prearmados ----------

  function describeTemplate() {
    var template = data.templates.filter(function (t) { return t.id === templateSelect.value; })[0];
    templateInfo.textContent = template ? template.description : 'Elige un diseño para cargarlo en el editor y retocarlo.';
  }

  document.getElementById('rich-load-template').addEventListener('click', function () {
    var template = data.templates.filter(function (t) { return t.id === templateSelect.value; })[0];
    if (!template) return;
    if (!window.confirm('Esto reemplaza lo que hay en el editor por el diseño «' + template.name + '». ¿Continuar?')) return;
    state = JSON.parse(JSON.stringify(template.message));
    renderEditor();
  });
  templateSelect.addEventListener('change', describeTemplate);
  describeTemplate();

  form.addEventListener('submit', function () {
    payloadInput.value = JSON.stringify(state);
  });

  renderEditor();
})();
