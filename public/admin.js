// Admin page: approve / reject / remove accounts, and see timetable quota use and active boards.
// Everything is built with textContent (never innerHTML with user data).
const $ = (id) => document.getElementById(id);
const when = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function status(text, kind = '') {
  $('admin-status').textContent = text;
  $('admin-status').className = `status ${kind}`;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) location.assign('auth.html');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function button(label, cls, onClick) {
  const b = el('button', `btn ${cls}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Two-step confirm built into the page (browser confirm() dialogs are unreliable). */
function confirmButton(label, onConfirm) {
  const b = button(label, 'danger', () => {
    if (b.dataset.armed) return onConfirm();
    b.dataset.armed = '1';
    b.textContent = `Really ${label.toLowerCase()}?`;
    setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, 4000);
  });
  return b;
}

async function act(action, id, done) {
  try {
    await api(`api/admin/users/${action}`, { id });
    status(done, 'ok');
    await load();
  } catch (err) {
    status(err.message, 'err');
  }
}

function userRow(u, focusId) {
  const row = el('div', `user-row${u.id === focusId ? ' focus' : ''}`);
  row.id = `user-${u.id}`;
  const info = el('div', 'user-info');
  info.append(el('div', 'user-email', u.email));
  const meta = [`${u.status}${u.isAdmin ? ' · admin' : ''}`, `joined ${when(u.createdAt)}`];
  if (u.lastLoginAt) meta.push(`last sign-in ${when(u.lastLoginAt)}`);
  info.append(el('div', 'user-meta', meta.join(' · ')));
  const actions = el('div', 'user-actions');
  if (!u.isAdmin) {
    if (u.status !== 'approved') actions.append(button('Approve', 'primary', () => act('approve', u.id, `Approved ${u.email}`)));
    if (u.status !== 'rejected') actions.append(confirmButton('Reject', () => act('reject', u.id, `Rejected ${u.email}`)));
    actions.append(confirmButton('Remove', () => act('delete', u.id, `Removed ${u.email}`)));
  }
  row.append(info, actions);
  return row;
}

async function load() {
  const focusId = (location.hash.match(/user=([\w-]+)/) || [])[1];
  const { users } = await api('api/admin/users');
  const pending = users.filter((u) => u.status === 'pending');
  $('pending-list').replaceChildren(...(pending.length ? pending.map((u) => userRow(u, focusId)) : [el('p', 'note', 'Nobody is waiting.')]));
  $('user-list').replaceChildren(...users.filter((u) => u.status !== 'pending').map((u) => userRow(u, focusId)));
  document.getElementById(`user-${focusId}`)?.scrollIntoView({ block: 'center' });

  const stats = await api('api/admin/stats');
  const lines = [`Active boards: ${stats.boards.activeBoards}${stats.boards.airports.length ? ` (${stats.boards.airports.join(', ')})` : ''}`];
  for (const [name, q] of Object.entries(stats.quotas)) lines.push(`${name} this month: ${q.used} of ${q.cap} requests`);
  if (!Object.keys(stats.quotas).length) lines.push('No timetable API key configured.');
  $('stats').replaceChildren(...lines.map((l) => el('p', null, l)));
}

load().catch((err) => status(err.message, 'err'));
