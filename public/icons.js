// Inline SVG icons. Aircraft glyphs are Material Icons paths (Apache 2.0).
const svg = (body, viewBox = '0 0 24 24', extra = '') =>
  `<svg viewBox="${viewBox}" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  takeoff: svg('<path fill="currentColor" d="M2.5 19h19v2h-19v-2zm19.57-9.36c-.21-.8-1.04-1.28-1.84-1.06L14.92 10l-6.9-6.43-1.93.51 4.14 7.17-4.97 1.33-1.97-1.54-1.45.39 2.59 4.49L21 11.49c.81-.23 1.28-1.05 1.07-1.85z"/>'),
  landing: svg('<path fill="currentColor" d="M2.5 19h19v2h-19v-2zm7.18-5.73 4.35 1.16 5.31 1.42c.8.21 1.62-.26 1.84-1.06.21-.8-.26-1.62-1.06-1.84l-5.31-1.42-2.76-9.02L10.12 2v8.28L5.15 8.95l-.93-2.32-1.45-.39v5.17l1.6.43 5.31 1.43z"/>'),
  plane: svg('<path fill="currentColor" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>'),
};

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const cloud = '<path d="M7 18h10.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.2 10.1 4 4 0 0 0 7 18z"/>';
const sun = (cx, cy, r) => {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 2), y1 = cy + Math.sin(a) * (r + 2);
    const x2 = cx + Math.cos(a) * (r + 4), y2 = cy + Math.sin(a) * (r + 4);
    rays += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}"/>${rays}`;
};
const cloudHigh = '<path d="M7 15h10.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.2 7.1 4 4 0 0 0 7 15z"/>';
const moon ='<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';

export function weatherIcon(kind, isDay = true) {
  const body = {
    clear: isDay ? sun(12, 12, 4.5) : moon,
    partly: (isDay ? sun(9, 8, 3) : '<path d="M13 5.5A4 4 0 0 1 7.6 10 4 4 0 1 0 13 5.5z"/>') + cloud,
    cloudy: cloud,
    fog: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="3" y1="13" x2="21" y2="13"/><line x1="5" y1="17" x2="19" y2="17"/>',
    drizzle: cloudHigh + '<line x1="9" y1="17.5" x2="8.5" y2="19"/><line x1="14" y1="17.5" x2="13.5" y2="19"/>',
    rain: cloudHigh + '<line x1="8" y1="17.5" x2="7" y2="20.5"/><line x1="12" y1="17.5" x2="11" y2="20.5"/><line x1="16" y1="17.5" x2="15" y2="20.5"/>',
    snow: cloudHigh + '<circle cx="8" cy="19" r=".6"/><circle cx="12" cy="20" r=".6"/><circle cx="16" cy="19" r=".6"/>',
    thunder: cloudHigh + '<path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>',
  }[kind] ?? cloud;
  return svg(body, '0 0 24 24', stroke);
}

/** Replace every [data-icon] placeholder with its SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon] ?? '';
}
