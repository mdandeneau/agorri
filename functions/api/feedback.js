// /api/feedback : feedback about Agorri itself (bugs, ideas to improve it), from the widget at the bottom left of every page.
// Stored in D1 (table site_feedback, created on first use). Anyone can send; no address check.
// Email: when RESEND_API_KEY (a Resend API key) and FEEDBACK_TO (the address to notify) are set in Cloudflare,
// every new item is emailed there. Without them, feedback is still saved and listed for moderators (GET with x-agorri-mod).
import { getSalt } from '../../lib/salt.js';

const KINDS = { bug: 'Something is broken', idea: 'Idea to improve Agorri', other: 'Something else' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function hash(s, salt) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + s)); return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join(''); }
function same(a, b) { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

export const SCHEMA = `CREATE TABLE IF NOT EXISTS site_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, town TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, page TEXT, contact TEXT, author TEXT, ip TEXT, ua TEXT, emailed INTEGER DEFAULT 0)`;

export function emailFor(f) {
  const subject = `Agorri feedback: ${KINDS[f.kind] || f.kind}${f.town ? ' (' + f.town + ')' : ''}`;
  const lines = [['What', KINDS[f.kind] || f.kind], ['Town', f.town || ''], ['Page', f.page || ''], ['Reply to', f.contact || 'Not given'], ['Browser', f.ua || ''], ['When', f.at]];
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#050505;max-width:600px">
<p style="font-size:16px;white-space:pre-wrap;margin:0 0 16px">${esc(f.text)}</p>
<table style="font-size:13px;color:#65676B;border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:2px 0">${esc(v)}</td></tr>`).join('')}</table>
<p style="font-size:12px;color:#65676B;margin-top:16px">Sent by the feedback widget on agorri.com. Item #${esc(f.id)}.</p></div>`;
  const text = `${f.text}\n\n` + lines.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nItem #${f.id}`;
  return { subject, html, text };
}

async function sendEmail(env, f) {
  if (!env.RESEND_API_KEY || !env.FEEDBACK_TO) return false;
  const m = emailFor(f);
  const body = { from: env.FEEDBACK_FROM || 'Agorri feedback <onboarding@resend.dev>', to: [env.FEEDBACK_TO], subject: m.subject, html: m.html, text: m.text };
  if (f.contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact)) body.reply_to = f.contact;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.ok) return true;
  let why = ''; try { const j = await r.json(); why = j.message || j.name || ''; } catch (e) {}
  return { error: 'Resend ' + r.status + (why ? ': ' + String(why).slice(0, 200) : '') };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Feedback is not connected yet.' }, 503);
  await env.DB.prepare(SCHEMA).run();
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mod = !!env.MOD_TOKEN && env.MOD_TOKEN.length >= 16 && same(request.headers.get('x-agorri-mod') || '', env.MOD_TOKEN);
    if (!mod) return json({ error: 'Moderators only.' }, 403);
    const r = await env.DB.prepare('SELECT id, at, town, kind, text, page, contact, emailed FROM site_feedback ORDER BY id DESC LIMIT 200').all();
    return json({ items: r.results || [], email: !!(env.RESEND_API_KEY && env.FEEDBACK_TO) });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const kind = KINDS[b.kind] ? b.kind : 'other';
  const text = clean(b.text, 3000);
  if (text.length < 3) return json({ error: 'Write a little more.' }, 400);
  const contact = clean(b.contact, 200);
  const salt = await getSalt(env);
  const author = await hash(clean(request.headers.get('x-agorri-client'), 64) || 'anon', salt);
  const ip = await hash(request.headers.get('cf-connecting-ip') || 'unknown', salt);
  const hour = new Date(Date.now() - 3600e3).toISOString();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM site_feedback WHERE (author = ? OR ip = ?) AND at > ?').bind(author, ip, hour).first();
  if (n && n.n >= 10) return json({ error: 'Thanks, that’s a lot of feedback for one hour. Try again a little later.' }, 429);
  const f = { at: new Date().toISOString(), town: clean(b.town, 40), kind, text, page: clean(b.page, 300), contact, ua: clean(request.headers.get('user-agent'), 200) };
  const res = await env.DB.prepare('INSERT INTO site_feedback (at, town, kind, text, page, contact, author, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(f.at, f.town, f.kind, f.text, f.page, f.contact, author, ip, f.ua).first();
  f.id = res && res.id;
  let emailed = false, emailError;
  try { const r = await sendEmail(env, f); if (r === true) emailed = true; else if (r && r.error) emailError = r.error; } catch (e) { emailError = 'send failed'; }
  if (emailed) await env.DB.prepare('UPDATE site_feedback SET emailed = 1 WHERE id = ?').bind(f.id).run();
  return json({ ok: true, id: f.id, emailed, ...(emailError ? { emailError } : {}) });
}
