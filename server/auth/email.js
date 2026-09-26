// Email via Resend's HTTP API (as ProcrastiMate). Without RESEND_API_KEY (local development)
// messages are only logged.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer({ apiKey, from, appName = 'Ertiper Flight Board' }) {
  async function send(to, subject, text, htmlBody) {
    if (!apiKey) {
      console.log(`[email] (not sent, no RESEND_API_KEY) "${subject}"`);
      return;
    }
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${htmlBody}
      <p style="color:#666;font-size:12px;margin-top:24px">${esc(appName)}</p></div>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Email not sent (${res.status})`);
  }

  return {
    code: (to, code) => send(
      to,
      `${code} is your ${appName} code`,
      `Your code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      `<p>Your code is</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${esc(code)}</p>
       <p>It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
    ),
    approvalNeeded: (to, email, link) => send(
      to,
      `New ${appName} sign-up waiting for approval`,
      `${email} has signed up and is waiting for approval: ${link}`,
      `<p><b>${esc(email)}</b> has signed up and is waiting for approval.</p>
       <p><a href="${esc(link)}">Review it on the admin page</a></p>`,
    ),
    approved: (to, link) => send(
      to,
      `Your ${appName} account is ready`,
      `Your account has been approved. Sign in at ${link}`,
      `<p>Your account has been approved.</p><p><a href="${esc(link)}">Open the flight board</a></p>`,
    ),
  };
}
