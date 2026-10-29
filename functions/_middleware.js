// Optional site-wide password for private testing.
// Off until the SITE_PASSWORD secret is set in Cloudflare (Workers & Pages > agorri > Settings > Variables and secrets).
// When set, every page and API asks for it once per device; the device stays signed in for 30 days.
// Changing SITE_PASSWORD signs everyone out. Remove it to open the site to the public.
const COOKIE = 'agorri_gate';
const DAYS = 30;

async function token(pw, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('agorri-gate|' + salt + '|' + pw));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeBack = b => (typeof b === 'string' && b.startsWith('/') && !b.startsWith('//') && !b.startsWith('/__gate')) ? b : '/';

export function gatePage(message, back) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Agorri</title>
<style>:root{--bg:#F0F2F5;--card:#fff;--ink:#050505;--muted:#65676B;--accent:#1B74E4;--line:#E4E6EB;--err:#B3261E}
@media (prefers-color-scheme:dark){:root{--bg:#18191A;--card:#242526;--ink:#E4E6EB;--muted:#B0B3B8;--accent:#2D88FF;--line:#3A3B3C;--err:#F2B8B5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:16px}
.card{width:100%;max-width:380px;background:var(--card);border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.12);padding:28px 24px;display:flex;flex-direction:column;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:22px;color:var(--accent)}.dot{width:30px;height:30px;border-radius:50%;background:var(--accent)}
p{margin:0;color:var(--muted)}label{font-weight:600;font-size:13px}input{width:100%;height:44px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;background:var(--card);color:var(--ink)}
input:focus{outline:2px solid var(--accent);outline-offset:1px}button{height:44px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.err{color:var(--err);font-weight:600;font-size:13px}.tag{font-size:13px}</style></head><body>
<form class="card" method="post" action="/__gate"><div class="brand"><span class="dot"></span>Agorri</div>
<p>Agorri is in private testing. Enter the password to continue.</p>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="back" value="${esc(safeBack(back))}">
${message ? `<div class="err" role="alert">${esc(message)}</div>` : ''}<button type="submit">Continue</button>
<p class="tag">Government you can see. A voice they can count.</p></form></body></html>`;
}

const html = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

export async function onRequest(context) {
  const { request, env, next } = context;
  const pw = env.SITE_PASSWORD;
  if (!pw) return next();
  const url = new URL(request.url);
  const want = await token(pw, env.TALK_SALT || '');

  if (url.pathname === '/__gate' && request.method === 'POST') {
    let given = '', back = '/';
    try { const f = await request.formData(); given = String(f.get('password') || ''); back = String(f.get('back') || '/'); } catch (e) {}
    if (same(await token(given, env.TALK_SALT || ''), want)) {
      return new Response(null, { status: 303, headers: { location: safeBack(back), 'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${want}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` } });
    }
    await new Promise(r => setTimeout(r, 600));
    return html(gatePage('That password didn’t work.', back), 401);
  }
  if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });

  const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (cookie && same(cookie.slice(COOKIE.length + 1), want)) {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set('x-robots-tag', 'noindex');
    return out;
  }
  if (url.pathname.startsWith('/api/')) return new Response(JSON.stringify({ error: 'Password required.' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  return html(gatePage('', url.pathname + url.search), 401);
}
