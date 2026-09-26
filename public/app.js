import { FlapRow } from './splitflap.js';
import { FlightMap } from './map.js';
import { ICONS, weatherIcon, hydrateIcons } from './icons.js';

const $ = (id) => document.getElementById(id);
const POLL_MS = 3000;
let TZ = 'Europe/London';

// ---------------------------------------------------------------------------
// Layout: phones and upright tablets get the scrolling three-section layout (body.phone);
// anything else gets the fixed 1920x1080 board, scaled to fit the screen.
const phoneQuery = window.matchMedia('(max-width: 899px), (orientation: portrait) and (max-width: 1199px)');
let isPhone = false;

function fitStage() {
  const stage = $('stage');
  const phone = phoneQuery.matches;
  if (phone !== isPhone) {
    isPhone = phone;
    document.body.classList.toggle('phone', phone);
    document.documentElement.classList.toggle('phone', phone);
    fitHeading();
    if (state) render(state);
    map?.refresh();
  }
  if (phone) {
    stage.style.transform = '';
  } else {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
}
window.addEventListener('resize', fitStage);
hydrateIcons();

// ---------------------------------------------------------------------------
// Formatting
const timeFmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (ms) => (ms ? timeFmt().format(new Date(ms)) : '--:--');
const num = (n) => Math.round(n).toLocaleString('en-GB');

function fmtDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

// ---------------------------------------------------------------------------
// Board pieces
const flaps = {
  code: new FlapRow($('flap-code'), 8),
  place: new FlapRow($('flap-place'), 13),
  iata: new FlapRow($('flap-iata'), 3),
  // Phone layout: both ends of the route
  from: new FlapRow($('flap-from'), 13),
  fromIata: new FlapRow($('flap-from-iata'), 3),
  to: new FlapRow($('flap-to'), 13),
  toIata: new FlapRow($('flap-to-iata'), 3),
};

/** Fill the phone's FROM/TO rows (skipped on the TV so hidden flaps don't animate). */
function renderRoute(f) {
  if (!isPhone) return;
  const unknown = f && f.direction === 'over' ? 'UNKNOWN' : '';
  flaps.from.setText(f?.from?.name || unknown);
  flaps.fromIata.setText(f?.from?.iata ?? '');
  flaps.to.setText(f?.to?.name || unknown);
  flaps.toIata.setText(f?.to?.iata ?? '');
}

let map = null;
let state = null;
let flightKey = null;
let serverOffset = 0; // server clock minus browser clock
let configVersion = null;

// Settings gear: shows while the mouse is moving, hides after a few seconds.
let gearTimer = null;
function showGear() {
  $('gear').classList.add('show');
  clearTimeout(gearTimer);
  gearTimer = setTimeout(() => $('gear').classList.remove('show'), 3000);
}
for (const evt of ['mousemove', 'touchstart']) window.addEventListener(evt, showGear, { passive: true });

/** Shrink the airport name until it fits its space. */
function fitHeading() {
  const h = $('airport-name');
  h.style.fontSize = '';
  let size = parseFloat(getComputedStyle(h).fontSize);
  const min = size / 2;
  while (h.scrollWidth > h.clientWidth && size > min) {
    size -= 1;
    h.style.fontSize = `${size}px`;
  }
}

function tickClock() {
  const now = new Date(Date.now() + serverOffset);
  setText('clock-time', timeFmt().format(now));
  setText('clock-date', dateFmt().format(now).replace(/,/g, ''));
}

function renderWeather(w) {
  if (!w) return;
  setText('wx-temp', `${w.tempC}°C`);
  setText('wx-text', w.text);
  const key = `${w.icon}|${w.isDay}`;
  if ($('wx-icon').dataset.key !== key) {
    $('wx-icon').dataset.key = key;
    $('wx-icon').innerHTML = weatherIcon(w.icon, w.isDay);
  }
}

function renderAirline(airline) {
  const img = $('airline-logo');
  const name = airline?.name ?? '';
  const src = airline?.iata ? `https://pics.avs.io/400/160/${airline.iata}.png` : '';
  setText('airline-name', '');
  if (!src) {
    img.hidden = true;
    img.removeAttribute('src');
    setText('airline-name', name);
    return;
  }
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  img.hidden = true;
  img.onload = () => { img.hidden = false; };
  img.onerror = () => { img.hidden = true; setText('airline-name', name); };
  img.alt = name;
  img.src = src;
}

let photoFront = 'photo-a';
function renderPhoto(photo) {
  const src = photo?.src ?? '';
  const front = $(photoFront);
  if ((front.dataset.src ?? '') === src && (src || !$('photo-empty').hidden)) return;
  const credit = photo?.credit ? `Photo © ${photo.credit}` : '';
  if (!src) {
    front.classList.remove('show');
    front.dataset.src = '';
    $('photo-empty').hidden = false;
    setText('photo-credit', '');
    return;
  }
  const backId = photoFront === 'photo-a' ? 'photo-b' : 'photo-a';
  const back = $(backId);
  back.dataset.src = src;
  back.onload = () => {
    back.classList.add('show');
    front.classList.remove('show');
    photoFront = backId;
    $('photo-empty').hidden = true;
    setText('photo-credit', credit);
  };
  back.onerror = () => {
    back.dataset.src = '';
    front.classList.remove('show');
    $('photo-empty').hidden = false;
    setText('photo-credit', '');
  };
  back.src = src;
}

function renderStats(f, now) {
  const labels = [];
  const values = [];
  const p = f?.progress;
  if (f?.mode === 'live') {
    const lv = f.live;
    labels.push('ALTITUDE', 'GROUND SPEED', 'DISTANCE TO GO', 'EST. ARRIVAL');
    values.push(
      lv.onGround ? 'GROUND' : lv.altFt != null ? `${num(lv.altFt)} ft` : '—',
      lv.gs != null ? `${num(lv.gs)} kts` : '—',
      p ? `${num(p.toGoNm)} NM` : '—',
      p?.eta ? fmtTime(p.eta) : '—',
    );
  } else if (f?.mode === 'next') {
    const t = f.times.estimated ?? f.times.scheduled;
    labels.push(f.direction === 'dep' ? 'DEPARTS IN' : 'LANDS IN', 'DISTANCE', 'FLIGHT TIME', f.direction === 'dep' ? 'ARRIVES' : 'LANDS');
    values.push(
      t - now <= 60_000 ? 'NOW' : fmtDuration(t - now),
      p ? `${num(p.totalNm)} NM` : '—',
      f.flightMinutes ? fmtDuration(f.flightMinutes * 60_000) : '—',
      p?.eta ? fmtTime(p.eta) : fmtTime(t),
    );
  } else {
    labels.push('ALTITUDE', 'GROUND SPEED', 'DISTANCE TO GO', 'EST. ARRIVAL');
    values.push('—', '—', '—', '—');
  }
  labels.forEach((l, i) => setText(`s${i + 1}-l`, l));
  values.forEach((v, i) => setText(`s${i + 1}-v`, v));

  const pct = Math.round((p?.pct ?? 0) * 1000) / 10;
  $('prog-fill').style.width = `${pct}%`;
  $('prog-plane').style.left = `${pct}%`;
  setText('prog-left', f?.from?.iata ?? '');
  let right = '';
  if (f?.mode === 'live' && p?.eta) right = p.toGoNm < 1 ? 'Arrived' : `${fmtDuration(p.eta - now)} remaining`;
  else if (f?.mode === 'next') right = f.direction === 'dep' ? 'Awaiting departure' : `Arriving from ${f.from?.iata ?? ''}`;
  setText('prog-right', right);
}

function renderFeed(s) {
  const bits = [];
  if (s.demo) bits.push('<b class="chip demo">DEMO</b>');
  if (s.schedule?.source === 'sample') bits.push('<b class="chip sample">SAMPLE TIMETABLE</b>');
  const ok = s.feed?.name && !s.feed?.error;
  bits.push(`<span class="dot ${ok ? 'ok' : 'bad'}"></span>${ok ? `LIVE · ${s.feed.name}` : 'LIVE FEED OFFLINE'}`);
  const modeText = { visible: 'in view', arrivals: 'arriving now', departures: 'departing now', all: 'moving now' }[s.mode] ?? 'in view';
  bits.push(`${s.feed?.inView ?? 0} ${modeText}`);
  const html = bits.join('<span class="sep">·</span>');
  if ($('feed').innerHTML !== html) $('feed').innerHTML = html;
}

function render(s) {
  const now = s.now;
  const f = s.flight;
  const heading = (s.airport?.name ?? '').toUpperCase();
  if ($('airport-name').textContent !== heading) {
    setText('airport-name', heading);
    fitHeading();
    document.title = `${s.airport?.name ?? 'Airport'} · Flight Board`;
  }
  setText('airport-code', s.airport?.iata ?? '');
  renderWeather(s.weather);
  renderFeed(s);

  document.body.dataset.direction = f?.direction ?? 'none';
  document.body.dataset.mode = f?.mode ?? 'none';

  if (!f) {
    setText('dir-label', 'NO FLIGHTS');
    $('dir-icon').innerHTML = ICONS.plane;
    flaps.code.setText('');
    flaps.place.setText(s.schedule?.source === 'none' ? 'NO TIMETABLE' : 'NONE DUE');
    flaps.iata.setText('');
    setText('place-label', '');
    renderRoute(null);
    renderAirline(null);
    for (const id of ['t-sched', 't-est']) setText(id, '--:--');
    setText('status', '—');
    setText('ac-name', '—');
    setText('ac-reg', '—');
    renderPhoto(null);
    renderStats(null, now);
    map?.showRoute('none', null, null, null);
    map?.showPlane(null);
    flightKey = null;
    return;
  }

  setText('dir-label', f.label);
  const icon = f.direction === 'arr' ? ICONS.landing : f.direction === 'dep' ? ICONS.takeoff : ICONS.plane;
  if ($('dir-icon').dataset.dir !== f.direction) {
    $('dir-icon').dataset.dir = f.direction;
    $('dir-icon').innerHTML = icon;
  }

  flaps.code.setText(f.code);
  flaps.place.setText(f.place.name || (f.direction === 'over' ? 'ROUTE UNKNOWN' : ''));
  flaps.iata.setText(f.place.iata);
  setText('place-label', f.place.name ? f.placeLabel : '');
  renderRoute(f);
  renderAirline(f.airline);

  setText('t-sched', fmtTime(f.times.scheduled));
  setText('t-est', fmtTime(f.times.estimated));
  const late = f.times.scheduled && f.times.estimated && f.times.estimated - f.times.scheduled > 5 * 60_000;
  $('t-est').className = `val ${late ? 'warn' : 'good'}`;
  setText('status', f.status.text);
  $('status').className = `val ${f.status.tone}`;
  setText('ac-name', f.aircraft?.name ?? '—');
  setText('ac-reg', f.aircraft?.reg ?? '—');

  renderPhoto(f.photo);
  renderStats(f, now);

  if (map) {
    map.showRoute(f.key, f.from, f.to, f.live);
    map.showPlane(f.live);
  }
  flightKey = f.key;
}

async function poll() {
  try {
    const res = await fetch(`api/state${location.search}`, { cache: 'no-store', credentials: 'same-origin' });
    // Multi-user edition: signed out, or not yet approved.
    if (res.status === 401) return location.assign('auth.html');
    if (res.status === 403) return location.assign('auth.html#pending');
    state = await res.json();
    // Settings were changed: reload so the map and everything else start fresh.
    if (configVersion != null && state.version !== configVersion) {
      location.reload();
      return;
    }
    serverOffset = state.now - Date.now();
    render(state);
  } catch (err) {
    console.warn('poll failed', err);
    $('feed').innerHTML = '<span class="dot bad"></span>BOARD SERVER OFFLINE';
  }
}

async function init() {
  fitStage(); // choose the layout before the map measures its container
  try {
    const cfgRes = await fetch('api/config', { credentials: 'same-origin' });
    if (cfgRes.status === 401) return location.assign('auth.html');
    if (cfgRes.status === 403) return location.assign('auth.html#pending');
    const cfg = await cfgRes.json();
    TZ = cfg.timezone || TZ;
    configVersion = cfg.version;
    map = new FlightMap($('map'), cfg.home ?? cfg.airport);
  } catch (err) {
    console.warn('config failed', err);
  }
  tickClock();
  setInterval(tickClock, 1000);
  // Keep countdowns moving between polls.
  setInterval(() => state?.flight && renderStats(state.flight, Date.now() + serverOffset), 1000);
  await poll();
  setInterval(poll, POLL_MS);
}

init();
