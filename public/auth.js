// Sign-in page: password sign-in, emailed-code sign-in, sign-up with a 6-digit code, and the
// "waiting for approval" state. All requests are same-origin JSON; the session is an HttpOnly cookie.
const $ = (id) => document.getElementById(id);
let challengeId = null;

function show(panel) {
  for (const id of ['panel-start', 'panel-code', 'panel-pending']) $(id).hidden = id !== panel;
  status('');
}

function status(text, kind = '') {
  $('auth-status').textContent = text;
  $('auth-status').className = `status ${kind}`;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  return data;
}

function afterSignIn(user) {
  if (user.status === 'approved') location.assign('./');
  else show('panel-pending');
}

function startCode({ challengeId: id, email, devCode }) {
  challengeId = id;
  $('code-email').textContent = email;
  $('dev-code').hidden = !devCode;
  $('dev-code').textContent = devCode ? `Development mode: your code is ${devCode}` : '';
  for (const box of document.querySelectorAll('.code-box')) box.value = '';
  show('panel-code');
  document.querySelector('.code-box').focus();
}

async function busy(form, fn) {
  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await fn();
  } catch (err) {
    status(err.message, 'err');
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// Tabs
function selectTab(signup) {
  $('tab-signin').setAttribute('aria-selected', String(!signup));
  $('tab-signup').setAttribute('aria-selected', String(signup));
  $('form-signin').hidden = signup;
  $('form-signup').hidden = !signup;
  status('');
}
$('tab-signin').addEventListener('click', () => selectTab(false));
$('tab-signup').addEventListener('click', () => selectTab(true));

$('form-signin').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.target, async () => {
    const { user } = await api('api/auth/login', { email: $('si-email').value, password: $('si-password').value });
    afterSignIn(user);
  });
});

$('use-code').addEventListener('click', () => {
  const email = $('si-email').value.trim();
  if (!email) return status('Enter your email address first.', 'err');
  busy($('form-signin'), async () => startCode(await api('api/auth/login/code', { email })));
});

$('form-signup').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.target, async () => {
    startCode(await api('api/auth/register/start', { email: $('su-email').value, password: $('su-password').value }));
  });
});

// Code entry: auto-advance, paste or autofill of all six digits, auto-submit when complete.
const boxes = [...document.querySelectorAll('.code-box')];
boxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    const digits = box.value.replace(/\D/g, '');
    // Several digits at once (phone "one-time-code" autofill, fast typing): spread them forwards.
    [...digits].slice(0, boxes.length - i).forEach((d, n) => { boxes[i + n].value = d; });
    if (!digits) box.value = '';
    const next = Math.min(i + Math.max(digits.length, 1), boxes.length - 1);
    if (digits) boxes[next].focus();
    if (boxes.every((b) => b.value)) $('form-code').requestSubmit();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
  });
  box.addEventListener('paste', (e) => {
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (digits.length !== 6) return;
    e.preventDefault();
    boxes.forEach((b, n) => { b.value = digits[n]; });
    $('form-code').requestSubmit();
  });
});

$('form-code').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = boxes.map((b) => b.value).join('');
  if (code.length !== 6) return status('Enter all six digits.', 'err');
  busy(e.target, async () => {
    try {
      const { user } = await api('api/auth/verify', { challengeId, code });
      afterSignIn(user);
    } catch (err) {
      boxes.forEach((b) => { b.value = ''; });
      boxes[0].focus();
      if (err.status === 429 || /expired|start again/i.test(err.message)) show('panel-start');
      throw err;
    }
  });
});

$('resend').addEventListener('click', () => busy($('form-code'), async () => {
  await api('api/auth/resend', { challengeId });
  status('A new code is on its way.', 'ok');
}));
$('back').addEventListener('click', () => show('panel-start'));

$('check-again').addEventListener('click', async () => {
  try {
    const { user } = await api('api/auth/me');
    if (user.status === 'approved') location.assign('./');
    else status('Not approved yet.', '');
  } catch {
    show('panel-start');
  }
});
$('pending-signout').addEventListener('click', async () => {
  await api('api/auth/logout', {}).catch(() => {});
  show('panel-start');
});

// Already signed in?
api('api/auth/me')
  .then(({ user }) => afterSignIn(user))
  .catch(() => show('panel-start'));
