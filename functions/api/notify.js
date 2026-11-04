// /api/notify : sends the email updates on starred items. Called twice a day by .github/workflows/notify.yml
// (POST with header x-agorri-notify = the NOTIFY_TOKEN secret). ?dry=1 reports what would be sent without sending.
// For every star of every confirmed address it looks the item up in the live site data and adds a line when:
//   - a watched field changed since the last run (date, time, place, status, next step, result, service times...)
//   - a dated item is tomorrow (evening run) or today (morning run), once
//   - residents posted comments on it since the last run (not the subscriber's own)
// The first run after a star only records the item as it is. Each address gets at most one email per run.
import { ensureSchema, findItem, loadTownData, snapOf, diffSnap, etDate, fmtDate, updateEmail, sendMail } from '../../lib/follow.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
function same(a, b) { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
async function fp(o) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(o))); return [...new Uint8Array(d)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join(''); }
const MAX_EMAILS = 400;

// opts: { load(path) -> JSON|null, site, now, dry, send(to, msg, headers) }
export async function runNotify(env, opts) {
  const DB = env.DB, now = opts.now || new Date(), site = opts.site.replace(/\/$/, '');
  await ensureSchema(DB);
  const today = etDate(now), tomorrow = etDate(now, 1);
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now));
  const towns = (await opts.load('/towns.json')) || { towns: [] };
  const subOf = id => ((towns.towns || []).find(t => t.id === id) || {}).subtowns || [];
  const nameOf = id => ((towns.towns || []).find(t => t.id === id) || {}).name || id;
  const rows = (await DB.prepare(`SELECT f.*, s.email, s.token, (SELECT GROUP_CONCAT(author, ',') FROM mail_devices d WHERE d.sub_id = s.id) AS authors
    FROM mail_follows f JOIN mail_subscribers s ON s.id = f.sub_id
    WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM mail_devices d WHERE d.sub_id = s.id AND d.confirmed = 1) ORDER BY f.sub_id, f.id`).all()).results || [];
  const cache = {};
  const dataFor = async t => (cache[t] = cache[t] || loadTownData(opts.load, t, subOf(t).filter(s => s !== 'north-conway')));
  const bySub = new Map(); const stamp = now.toISOString();
  const report = { follows: rows.length, changed: 0, reminders: 0, comments: 0, gone: 0, emails: 0, errors: [] };

  for (const f of rows) {
    const ref = { t: f.ref_t, id: f.ref_id };
    const data = await dataFor(f.town);
    const hit = findItem(ref, data);
    const lines = [];
    if (!hit) {
      // Past dated things drop off the site; forget those follows. Anything else may come back, so keep it quietly.
      const dt = (f.snap && JSON.parse(f.snap).date) || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(dt) && dt < today) { if (!opts.dry) await DB.prepare('DELETE FROM mail_follows WHERE id = ?').bind(f.id).run(); }
      else if (!f.gone && !opts.dry) await DB.prepare('UPDATE mail_follows SET gone = 1 WHERE id = ?').bind(f.id).run();
      report.gone++; continue;
    }
    const snap = snapOf(hit.obj); const print = await fp(snap);
    if (f.fp && f.fp !== print) { const d = diffSnap(JSON.parse(f.snap || '{}'), snap); if (d.length) { lines.push(...d); report.changed++; } }
    let reminded = f.snap && JSON.parse(f.snap).date !== snap.date ? 0 : f.reminded; // a new date earns a new reminder
    if (hit.date && !reminded) {
      const when = snap.time ? ' at ' + String(snap.time).replace(/^at /i, '') : '';
      if (hit.date === tomorrow && etHour >= 12) { lines.push(`Tomorrow, ${fmtDate(hit.date)}${when}${snap.venue ? ', ' + snap.venue : ''}.`); reminded = 1; report.reminders++; }
      else if (hit.date === today && etHour < 12) { lines.push(`Today${when}${snap.venue ? ', ' + snap.venue : ''}.`); reminded = 1; report.reminders++; }
    }
    const since = f.checked || f.created;
    const mine = String(f.authors || '').split(',').filter(Boolean);
    const cm = (await DB.prepare(`SELECT name, anon, body, title, author FROM talk_items WHERE town = ? AND ref_t = ? AND ref_id = ? AND at > ? AND hidden = 0 AND mod_status = 'ok' ORDER BY at`).bind(f.town, f.ref_t, f.ref_id, since).all().catch(() => ({ results: [] }))).results || [];
    const theirs = cm.filter(c => !mine.includes(c.author));
    if (theirs.length) {
      report.comments += theirs.length;
      const first = theirs[0]; const txt = String(first.body || first.title || '').replace(/\s+/g, ' ').trim();
      lines.push(`${theirs.length} new comment${theirs.length === 1 ? '' : 's'}. ${first.anon || !first.name ? 'A resident' : first.name}: "${txt.length > 140 ? txt.slice(0, 137) + '...' : txt}"`);
    }
    if (!opts.dry) await DB.prepare('UPDATE mail_follows SET snap = ?, fp = ?, checked = ?, reminded = ?, gone = 0 WHERE id = ?').bind(JSON.stringify(snap), print, stamp, reminded, f.id).run();
    if (!lines.length) continue;
    const href = f.href || '';
    const link = /^#/.test(href) || !f.url ? `${site}/${f.town}${href || ''}` : f.url;
    const stop = `${site}/api/follow?u=${f.token}&f=${f.id}`;
    const label = (f.label || 'Something you starred') + (f.town ? ` (${nameOf(f.town)})` : '');
    if (!bySub.has(f.sub_id)) bySub.set(f.sub_id, { email: f.email, token: f.token, items: [] });
    bySub.get(f.sub_id).items.push({ label, link, lines, stop });
  }

  const preview = [];
  for (const [subId, s] of bySub) {
    if (report.emails >= MAX_EMAILS) break;
    const stopAll = `${site}/api/follow?u=${s.token}`;
    const msg = updateEmail(s.items, stopAll);
    if (opts.dry) { preview.push({ to: s.email.replace(/^(.).*@/, '$1***@'), subject: msg.subject, items: s.items.map(i => ({ label: i.label, lines: i.lines })) }); report.emails++; continue; }
    const r = await opts.send(s.email, msg, { 'List-Unsubscribe': `<${stopAll}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    if (r === true) { report.emails++; await DB.prepare('UPDATE mail_subscribers SET last_sent = ? WHERE id = ?').bind(stamp, subId).run(); }
    else report.errors.push(String((r && r.error) || 'send failed').slice(0, 200));
  }
  if (opts.dry) report.preview = preview;
  return report;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.NOTIFY_TOKEN || env.NOTIFY_TOKEN.length < 16 || !same(request.headers.get('x-agorri-notify') || '', env.NOTIFY_TOKEN)) return json({ error: 'Not allowed.' }, 403);
  if (!env.DB) return json({ error: 'No database.' }, 503);
  const url = new URL(request.url);
  const load = async p => { try { const r = await env.ASSETS.fetch(new Request(url.origin + p)); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } };
  const dry = url.searchParams.get('dry') === '1';
  if (!dry && !env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY missing' }, 503);
  const report = await runNotify(env, { load, site: env.SITE_URL || url.origin, dry, send: (to, m, h) => sendMail(env, to, m, h) });
  return json(report);
}
