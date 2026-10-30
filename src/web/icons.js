// iconos del panel: trazo simple de 1.6 px sobre una grilla de 24, dibujados a
// mano (sin libreria de iconos). Todos usan currentColor, asi heredan el color
// del texto donde esten puestos.

const ICONS = {
  // marca
  logo: '<circle cx="12" cy="12" r="4.5"/><ellipse cx="12" cy="12" rx="10" ry="3.8" transform="rotate(-24 12 12)"/>',

  // navegacion
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  bars: '<path d="M4 20h16M7 20v-7M12 20V5M17 20v-10"/>',
  hash: '<path d="M9.5 4 7.5 20M16.5 4l-2 16M4 9h16M3.5 15h16"/>',
  pulse: '<path d="M3 12h4l2.5-6.5 4 13 2.5-6.5H21"/>',
  'door-in': '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M4 12h10M10.5 8 14.5 12l-4 4"/>',
  message: '<path d="M4 5h16v11H10l-6 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  megaphone: '<path d="M4 10v4h3l8 4V6L7 10z"/><path d="M18.5 9a4 4 0 0 1 0 6"/>',
  house: '<path d="m4 11 8-7 8 7"/><path d="M6 10v10h12V10M10 20v-5h4v5"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="1.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><path d="M7.5 8.5h.01" stroke-width="2.4"/>',
  bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21.5h4"/>',
  shield: '<path d="m12 3 7 3v5.5c0 4.3-3 7.7-7 9.5-4-1.8-7-5.2-7-9.5V6z"/>',
  list: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14.5 7v10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  steps: '<path d="M4 20v-4h4v-4h4V8h4V4h4v16z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0"/><path d="M9 9.8h.01M15 9.8h.01" stroke-width="2.4"/>',
  checklist: '<path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" stroke-width="2.4"/>',
  paw: '<circle cx="6.5" cy="10.5" r="1.6"/><circle cx="10.5" cy="6.5" r="1.6"/><circle cx="15.5" cy="7" r="1.6"/><circle cx="18.5" cy="11.5" r="1.6"/><path d="M8 18c0-3 2-5 4.5-5S17 15 17 18c0 1.5-1.5 2-3 1.6-1-.3-2-.3-3 0-1.500.4-3 0-3-1.600z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.100 1-1.100 1.700M12 17h.01" stroke-width="1.800"/>',
  gamepad: '<path d="M7.5 8h9a4.500 4.500 0 0 1 4.500 4.500v.5a3 3 0 0 1-5.400 1.800L14.500 14h-5l-1.100.8A3 3 0 0 1 3 13v-.5A4.500 4.500 0 0 1 7.500 8z"/><path d="M8 10.500v3M6.500 12h3M16 11.500h.01M18 13h.01" stroke-width="1.800"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.500 19c0-3 2.500-5 5.500-5s5.500 2 5.500 5"/><circle cx="17" cy="9" r="2.400"/><path d="M16.500 14.200c2.500-.2 4.500 1.600 4.500 4.300"/>',
  flag: '<path d="M5 21V4M5 5h12l-2 4 2 4H5"/>',
  terminal: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 3 2-3 2M12.500 15H17"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.500 0 2-1 1.500-2.200-.5-1.300.2-2.300 1.600-2.300H17a4 4 0 0 0 4-4C21 6.500 17 3 12 3z"/><path d="M7.500 11h.01M10 7.500h.01M14.500 7.500h.01" stroke-width="2.200"/>',

  layout: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M9.5 9.5V20"/>',

  // interfaz
  server: '<rect x="4" y="4" width="16" height="6" rx="1.500"/><rect x="4" y="14" width="16" height="6" rx="1.500"/><path d="M8 7h.01M8 17h.01" stroke-width="2.200"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M9 12h10"/>',
  switch: '<path d="M6 8h13l-3-3M18 16H5l3 3"/>',
  volume: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.500 9a4 4 0 0 1 0 6"/>',
  'volume-off': '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="m16.500 9.500 5 5M21.500 9.500l-5 5"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="m16 16 4.500 4.500"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  warn: '<path d="m12 4 9.500 16.500h-19z"/><path d="M12 10v4.500M12 17.500h.01" stroke-width="1.800"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 8h.01" stroke-width="1.800"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4.500L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.500L20 15M20 20v-5h-5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.500"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  image: '<rect x="3.500" y="5" width="17" height="14" rx="1.500"/><circle cx="9" cy="10" r="1.500"/><path d="m4 17 5-4.500 4 3.500 3-2.500 4.500 3.500"/>',
};

function icon(name, size = 16) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

module.exports = { ICONS, icon };
