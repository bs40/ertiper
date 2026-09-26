// Settings page: airport search, display mode, and home location + view wedge on a map.
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Geometry
const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function distanceKm(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function destination(p, brg, km) {
  const δ = km / R, θ = rad(brg), φ1 = rad(p.lat), λ1 = rad(p.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lon: ((deg(λ2) + 540) % 360) - 180 };
}
const angleDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (b) => COMPASS[Math.round(b / 22.5) % 16];

// ---------------------------------------------------------------------------
// Plus codes (Open Location Code), so "C65F+GG Bristol" style locations can be pasted in.
const OLC = '23456789CFGHJMPQRVWX';
const OLC_RES = [20, 1, 0.05, 0.0025, 0.000125];

function olcEncode(lat, lon) {
  let la = clamp(lat + 90, 0, 179.999999), lo = ((lon + 180) % 360 + 360) % 360;
  let code = '';
  for (const r of OLC_RES) {
    const a = Math.floor(la / r), b = Math.floor(lo / r);
    code += OLC[a] + OLC[b];
    la -= a * r; lo -= b * r;
  }
  return code; // 10 digits, no '+'
}

function olcDecode(digits) {
  let lat = -90, lon = -180;
  for (let i = 0; i < digits.length / 2; i++) {
    lat += OLC.indexOf(digits[2 * i]) * OLC_RES[i];
    lon += OLC.indexOf(digits[2 * i + 1]) * OLC_RES[i];
  }
  const r = OLC_RES[digits.length / 2 - 1];
  return { lat: lat + r / 2, lon: lon + r / 2 };
}

/** Decode a full or short plus code; short codes are resolved near `ref`. */
function parsePlusCode(text, ref) {
  const token = text.trim().toUpperCase().split(/[\s,]+/)[0];
  const m = token.match(/^([23456789CFGHJMPQRVWX]{2,8})\+([23456789CFGHJMPQRVWX]{2})?/);
  if (!m || m[1].length % 2) return null;
  let digits = m[1] + (m[2] ?? '');
  if (m[1].length < 8) {
    const pad = 8 - m[1].length;
    const full = olcEncode(ref.lat, ref.lon).slice(0, pad) + digits;
    const res = 20 ** (2 - pad / 2);
    const p = olcDecode(full);
    if (p.lat - ref.lat > res / 2) p.lat -= res; else if (ref.lat - p.lat > res / 2) p.lat += res;
    if (p.lon - ref.lon > res / 2) p.lon -= res; else if (ref.lon - p.lon > res / 2) p.lon += res;
    return p;
  }
  if (digits.length % 2) digits = digits.slice(0, -1);
  return olcDecode(digits);
}

function parseLocation(text, ref) {
  const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    return null;
  }
  return parsePlusCode(text, ref);
}

// ---------------------------------------------------------------------------
// State
let s = null; // { airport, home, view, mode, schedule }

const map = L.map('map', { zoomControl: true, zoomSnap: 0.5 });
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  className: 'imagery', maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);

const aptMarker = L.circleMarker([0, 0], { radius: 9, weight: 3, color: '#0b0f14', fillColor: '#f6b90b', fillOpacity: 1 })
  .bindTooltip('', { permanent: true, direction: 'right', offset: [10, 0], className: 'apt-label' });
const homeMarker = L.marker([0, 0], {
  draggable: true, zIndexOffset: 1000, keyboard: true, title: 'Your location',
  icon: L.divIcon({ className: 'pin', html: '<div></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
});
const wedge = L.polygon([], { color: '#f6b90b', weight: 2, fillColor: '#f6b90b', fillOpacity: 0.18, interactive: false });
const handleIcon = L.divIcon({ className: 'handle', html: '<div></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
const centreHandle = L.marker([0, 0], { draggable: true, icon: handleIcon, title: 'Drag to turn the view and set its distance' });
const leftHandle = L.marker([0, 0], { draggable: true, icon: handleIcon, title: 'Drag to widen or narrow the view' });
const rightHandle = L.marker([0, 0], { draggable: true, icon: handleIcon, title: 'Drag to widen or narrow the view' });

function wedgePoints() {
  const { home, view } = s;
  if (view.width >= 360) {
    return Array.from({ length: 73 }, (_, i) => destination(home, i * 5, view.rangeKm)).map((p) => [p.lat, p.lon]);
  }
  const pts = [[home.lat, home.lon]];
  const start = view.bearing - view.width / 2;
  const steps = Math.max(8, Math.ceil(view.width / 3));
  for (let i = 0; i <= steps; i++) {
    const p = destination(home, start + (view.width * i) / steps, view.rangeKm);
    pts.push([p.lat, p.lon]);
  }
  return pts;
}

function placeHandles(except) {
  const { home, view } = s;
  const at = (b) => { const p = destination(home, b, view.rangeKm); return [p.lat, p.lon]; };
  if (except !== centreHandle) centreHandle.setLatLng(at(view.bearing));
  if (except !== leftHandle) leftHandle.setLatLng(at(view.bearing - Math.min(view.width, 359) / 2));
  if (except !== rightHandle) rightHandle.setLatLng(at(view.bearing + Math.min(view.width, 359) / 2));
}

function drawMap(except) {
  aptMarker.setLatLng([s.airport.lat, s.airport.lon]).setTooltipContent(s.airport.iata || s.airport.icao);
  if (!map.hasLayer(aptMarker)) aptMarker.addTo(map);
  const layers = [homeMarker, wedge, centreHandle, leftHandle, rightHandle];
  if (!s.home) {
    layers.forEach((l) => map.hasLayer(l) && map.removeLayer(l));
    return;
  }
  if (except !== homeMarker) homeMarker.setLatLng([s.home.lat, s.home.lon]);
  wedge.setLatLngs(wedgePoints());
  wedge.setStyle({ opacity: s.mode === 'visible' ? 1 : 0.4, fillOpacity: s.mode === 'visible' ? 0.18 : 0.06 });
  placeHandles(except);
  layers.forEach((l) => !map.hasLayer(l) && l.addTo(map));
}

function renderAirport() {
  const a = s.airport;
  $('airport-chosen').innerHTML = '';
  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = a.iata || a.icao;
  const text = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = a.name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = [a.city, a.country, a.icao].filter(Boolean).join(' · ');
  text.append(name, sub);
  $('airport-chosen').append(big, text);

  // The server describes the timetable source for the saved airport; for a newly picked airport
  // without a timetable provider, say so before saving.
  const note = $('timetable-note');
  const t = s.timetable;
  const unsavedNoTimetable = t && (t.source === 'sample' || t.source === 'none') && a.icao !== 'EGGD';
  note.textContent = unsavedNoTimetable
    ? 'No timetable for this airport without a timetable API key: the board will show live planes only.'
    : t?.text ?? '';
  note.classList.toggle('warn', Boolean(unsavedNoTimetable || t?.warn));
}

function renderControls() {
  const { home, view, mode } = s;
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === mode;
  const visible = document.querySelector('input[value="visible"]');
  visible.disabled = !home;
  $('mode-visible-card').classList.toggle('disabled', !home);
  $('visible-desc').textContent = home ? 'Aircraft inside your view on the map.' : 'Set your location on the map first.';

  $('bearing').value = view.bearing;
  $('width').value = view.width;
  $('range').value = view.rangeKm;
  $('alt').value = view.maxAltFt;
  $('bearing-out').textContent = `${view.bearing}° ${compass(view.bearing)}`;
  $('width-out').textContent = view.width >= 360 ? 'All round' : `${view.width}°`;
  $('range-out').textContent = `${view.rangeKm} km`;
  $('alt-out').textContent = `${view.maxAltFt.toLocaleString('en-GB')} ft`;
  $('sliders').classList.toggle('off', !home);
  $('clear-home').hidden = !home;
  if (document.activeElement !== $('coords')) $('coords').value = home ? `${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}` : '';
  $('location-note').textContent = home
    ? 'Drag the green pin to adjust your location, or the round handles to shape your view.'
    : 'Click the map to place your location, or type coordinates or a plus code below.';
}

function render(except) {
  renderControls();
  drawMap(except);
  setStatus('');
}

function setHome(p) {
  s.home = { lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 };
  render();
}

// ---------------------------------------------------------------------------
// Map interactions
map.on('click', (e) => setHome({ lat: e.latlng.lat, lon: e.latlng.lng }));

homeMarker.on('drag', (e) => {
  const ll = e.target.getLatLng();
  s.home = { lat: Math.round(ll.lat * 1e5) / 1e5, lon: Math.round(ll.lng * 1e5) / 1e5 };
  render(homeMarker);
});

centreHandle.on('drag', (e) => {
  const ll = e.target.getLatLng();
  const p = { lat: ll.lat, lon: ll.lng };
  s.view.bearing = Math.round(bearingDeg(s.home, p)) % 360;
  s.view.rangeKm = clamp(Math.round(distanceKm(s.home, p) * 2) / 2, 1, 30);
  render(centreHandle);
});

for (const h of [leftHandle, rightHandle]) {
  h.on('drag', (e) => {
    const ll = e.target.getLatLng();
    const b = bearingDeg(s.home, { lat: ll.lat, lon: ll.lng });
    s.view.width = clamp(Math.round((2 * angleDiff(b, s.view.bearing)) / 5) * 5, 10, 360);
    render(h);
  });
}
for (const h of [homeMarker, centreHandle, leftHandle, rightHandle]) h.on('dragend', () => render());

// ---------------------------------------------------------------------------
// Form controls
for (const [id, key, parse] of [
  ['bearing', 'bearing', Number], ['width', 'width', Number], ['range', 'rangeKm', Number], ['alt', 'maxAltFt', Number],
]) {
  $(id).addEventListener('input', () => {
    s.view[key] = parse($(id).value);
    render();
  });
}

for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener('change', () => {
    s.mode = r.value;
    render();
  });
}

$('clear-home').addEventListener('click', () => {
  s.home = null;
  if (s.mode === 'visible') s.mode = 'all';
  render();
  setStatus('Location removed. Showing all flights until you set it again.', '');
});

$('coords').addEventListener('change', () => {
  const text = $('coords').value.trim();
  if (!text) return;
  const p = parseLocation(text, s.home ?? s.airport);
  if (!p) {
    setStatus('Couldn’t read that location. Use "lat, lon" or a plus code like C65F+GG.', 'err');
    return;
  }
  setHome(p);
  map.setView([s.home.lat, s.home.lon], Math.max(map.getZoom(), 12));
});

// Airport search with keyboard support
let searchTimer = null;
let results = [];
let active = -1;

function showResults(list) {
  results = list;
  active = list.length ? 0 : -1;
  const ul = $('airport-results');
  ul.innerHTML = '';
  list.forEach((a, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === active));
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = a.iata || '';
    const body = document.createElement('span');
    body.innerHTML = '<div></div><div class="where"></div>';
    body.firstChild.textContent = a.name;
    body.lastChild.textContent = [a.city, a.country, a.icao].filter(Boolean).join(' · ');
    li.append(code, body);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); chooseAirport(a); });
    ul.appendChild(li);
  });
  ul.hidden = !list.length;
}

function highlight(i) {
  active = i;
  [...$('airport-results').children].forEach((li, n) => li.setAttribute('aria-selected', String(n === i)));
  $('airport-results').children[i]?.scrollIntoView({ block: 'nearest' });
}

function chooseAirport(a) {
  s.airport = a;
  $('airport-q').value = '';
  showResults([]);
  renderAirport();
  render();
  fitAll();
}

$('airport-q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('airport-q').value.trim();
  if (q.length < 2) return showResults([]);
  searchTimer = setTimeout(async () => {
    const list = await (await fetch(`api/airports?q=${encodeURIComponent(q)}`)).json();
    if ($('airport-q').value.trim() === q) showResults(list);
  }, 150);
});
$('airport-q').addEventListener('keydown', (e) => {
  if ($('airport-results').hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(active + 1, results.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
  else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) chooseAirport(results[active]); }
  else if (e.key === 'Escape') showResults([]);
});
$('airport-q').addEventListener('blur', () => setTimeout(() => showResults([]), 100));

// ---------------------------------------------------------------------------
// Save
function setStatus(text, kind = '') {
  $('save-status').textContent = text;
  $('save-status').className = `status ${kind}`;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('save').disabled = true;
  setStatus('Saving…');
  try {
    const res = await fetch('api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ airport: { icao: s.airport.icao }, home: s.home, view: s.view, mode: s.mode }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Save failed');
    s = { ...s, ...body };
    renderAirport();
    renderAccount();
    render();
    setStatus('Saved. The board updates within a few seconds.', 'ok');
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    $('save').disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Account (multi-user edition)

async function post(url, body = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function renderAccount() {
  if (!s.user) return;
  $('account-card').hidden = false;
  $('account-email').textContent = s.user.email;
  $('admin-link').hidden = !s.user.isAdmin;
}

$('signout').addEventListener('click', async () => {
  await post('api/auth/logout').catch(() => {});
  location.assign('auth.html');
});
$('signout-all').addEventListener('click', async () => {
  try {
    await post('api/account/signout-all');
    location.assign('auth.html');
  } catch (err) {
    setStatus(err.message, 'err');
  }
});
$('delete-account').addEventListener('click', async () => {
  try {
    await post('api/account/delete', { password: $('delete-password').value });
    location.assign('auth.html');
  } catch (err) {
    setStatus(err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
async function init() {
  const res = await fetch('api/settings');
  if (res.status === 401) return location.assign('auth.html');
  if (res.status === 403) return location.assign('auth.html#pending');
  s = await res.json();
  renderAirport();
  renderAccount();
  render();
  fitAll();
}

/** Frame the airport plus, when set, your location and view wedge. */
function fitAll() {
  if (!s.home) return map.setView([s.airport.lat, s.airport.lon], 11);
  const b = L.latLngBounds(wedgePoints()).extend([s.airport.lat, s.airport.lon]);
  map.fitBounds(b.pad(0.1), { maxZoom: 13 });
}

init().catch((err) => setStatus(`Couldn’t load settings: ${err.message}`, 'err'));
