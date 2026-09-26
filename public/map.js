// Satellite map with the great-circle route and the aircraft's live position.
// You can zoom and pan; the map then stays where you leave it until "reset view" is pressed.
import { ICONS } from './icons.js';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function greatCircle(a, b, n = 64) {
  const φ1 = rad(a.lat), λ1 = rad(a.lon), φ2 = rad(b.lat), λ2 = rad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [[a.lat, a.lon]];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push([deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))]);
  }
  return pts;
}

const ResetControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const bar = L.DomUtil.create('div', 'leaflet-bar map-reset');
    const a = L.DomUtil.create('a', '', bar);
    a.href = '#';
    a.title = 'Reset view';
    a.setAttribute('role', 'button');
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6"/></svg>';
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(a, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      this.options.onReset();
    });
    return bar;
  },
});

export class FlightMap {
  constructor(el, center) {
    this.map = L.map(el, { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      className: 'imagery', maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    }).addTo(this.map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      className: 'labels', maxZoom: 18,
    }).addTo(this.map);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    new ResetControl({ onReset: () => this.resetView() }).addTo(this.map);

    this.routeLayer = L.layerGroup().addTo(this.map);
    this.center = center;
    this.routeKey = null;
    this.plane = null;
    this.target = null; // what the automatic view would show
    this.userMoved = false;
    this.autoMoving = false;
    this.locked = false;

    this.map.setView([center.lat, center.lon], 10);

    // A zoom or drag that the board didn't start itself means the user has taken over the view.
    this.map.on('dragstart', () => { this.userMoved = true; });
    this.map.on('zoomstart', () => { if (!this.autoMoving) this.userMoved = true; });
    this.map.on('moveend', () => { this.autoMoving = false; });

    // Phones: the map sits in a scrolling page, so it stays still until tapped (otherwise swiping
    // down the page would pan the map instead).
    this.hint = L.DomUtil.create('div', 'map-hint', el);
    this.hint.textContent = 'Tap the map to move it';
    this.map.on('click', () => this.setLocked(false));
    this.setPhone(document.body.classList.contains('phone'));
  }

  setLocked(locked) {
    this.locked = locked;
    this.hint.hidden = !locked;
    if (locked) this.map.dragging.disable();
    else this.map.dragging.enable();
  }

  setPhone(phone) {
    this.phone = phone;
    if (phone) this.map.scrollWheelZoom.disable();
    else this.map.scrollWheelZoom.enable();
    this.setLocked(phone);
  }

  applyTarget(animate = true) {
    const t = this.target;
    if (!t) return;
    this.autoMoving = true;
    const opts = { duration: animate ? 1.2 : 0, animate };
    // Airport labels sit to the right of their dots, so leave extra room on that side.
    const pad = this.phone ? 30 : 90;
    const labelRoom = this.phone ? 50 : 60;
    if (t.bounds) {
      this.map.flyToBounds(t.bounds, { ...opts, paddingTopLeft: [pad, pad], paddingBottomRight: [pad + labelRoom, pad], maxZoom: 8 });
    }
    else this.map.flyTo(t.center, t.zoom, opts);
  }

  /** After the layout changes size (e.g. switching to the phone layout). */
  refresh() {
    this.setPhone(document.body.classList.contains('phone'));
    this.map.invalidateSize();
    if (this.plane) this.plane.setIcon(this.planeIcon(this.lastTrack));
    if (!this.userMoved) this.applyTarget(false);
  }

  /** Built as elements (not an HTML string with style="…") so it works under the strict CSP. */
  planeIcon(track) {
    const size = document.body.classList.contains('phone') ? 34 : 56;
    const el = document.createElement('div');
    el.className = 'map-plane';
    el.innerHTML = ICONS.plane;
    Object.assign(el.style, { width: `${size}px`, height: `${size}px`, transform: `rotate(${track ?? 0}deg)` });
    return L.divIcon({ html: el, className: 'map-plane-wrap', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }

  resetView() {
    this.userMoved = false;
    if (this.phone) this.setLocked(true);
    this.applyTarget();
  }

  endpoint(p, cls) {
    L.circleMarker([p.lat, p.lon], { radius: 8, weight: 3, color: '#0b0f14', fillColor: cls === 'from' ? '#4ade4a' : '#f6b90b', fillOpacity: 1 })
      .bindTooltip(p.iata || '', { permanent: true, direction: 'right', offset: [10, 0], className: `ep-label ${cls}` })
      .addTo(this.routeLayer);
  }

  showRoute(key, from, to, live) {
    const routeKey = `${key}|${from?.iata}|${to?.iata}`;
    if (routeKey === this.routeKey) return;
    this.routeKey = routeKey;
    this.routeLayer.clearLayers();
    this.plane = null;

    if (!from || !to) {
      const c = live ?? this.center;
      if (from) this.endpoint(from, 'from');
      if (to) this.endpoint(to, 'to');
      this.target = { center: [c.lat, c.lon], zoom: 9 };
    } else {
      const pts = greatCircle(from, to);
      L.polyline(pts, { color: '#f6b90b', weight: 10, opacity: 0.18, interactive: false }).addTo(this.routeLayer);
      L.polyline(pts, { color: '#f6b90b', weight: 3.5, opacity: 0.95, interactive: false }).addTo(this.routeLayer);
      this.endpoint(from, 'from');
      this.endpoint(to, 'to');
      this.target = { bounds: L.latLngBounds(pts) };
    }
    if (!this.userMoved) this.applyTarget();
  }

  showPlane(live) {
    if (!live) {
      if (this.plane) this.routeLayer.removeLayer(this.plane);
      this.plane = null;
      return;
    }
    this.lastTrack = live.track;
    const icon = this.planeIcon(live.track);
    if (!this.plane) {
      this.plane = L.marker([live.lat, live.lon], { icon, interactive: false, zIndexOffset: 1000 }).addTo(this.routeLayer);
    } else {
      this.plane.setLatLng([live.lat, live.lon]);
      this.plane.setIcon(icon);
    }
  }
}
