// Email updates on starred items: the shared pieces of /api/follow and /api/notify.
// A person stars something on the page (an issue, event, game, meeting, congregation, business...). If they turned on
// email updates, the star is also kept here, and /api/notify emails them when that item changes in the site's data
// (a new date, time, place, status, result, service times), the day before or the morning of a dated item, and when
// residents comment on it. One email per person per run, never more.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mail_subscribers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', created TEXT NOT NULL, last_sent TEXT)`,
  `CREATE TABLE IF NOT EXISTS mail_devices (key_hash TEXT PRIMARY KEY, sub_id INTEGER NOT NULL, author TEXT, confirmed INTEGER NOT NULL DEFAULT 0, confirm_token TEXT UNIQUE, created TEXT NOT NULL, confirmed_at TEXT, ip TEXT, pending TEXT)`,
  `CREATE TABLE IF NOT EXISTS mail_follows (id INTEGER PRIMARY KEY AUTOINCREMENT, sub_id INTEGER NOT NULL, town TEXT NOT NULL, ref_t TEXT NOT NULL, ref_id TEXT NOT NULL, label TEXT, href TEXT, url TEXT, created TEXT NOT NULL, snap TEXT, fp TEXT, checked TEXT, reminded INTEGER NOT NULL DEFAULT 0, gone INTEGER NOT NULL DEFAULT 0, UNIQUE (sub_id, town, ref_t, ref_id))`,
  `CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, sub_id INTEGER, ip TEXT, kind TEXT NOT NULL, at TEXT NOT NULL)`,
];
export async function ensureSchema(DB) { for (const s of SCHEMA) await DB.prepare(s).run(); }

export const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function hash(s, salt) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + s)); return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join(''); }
export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(20))].map(b => b.toString(16).padStart(2, '0')).join('');
export const validEmail = e => /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i.test(e);
export function maskEmail(e) { const [u, d] = String(e).split('@'); return (u.length <= 2 ? u[0] + '*' : u[0] + '***' + u[u.length - 1]) + '@' + d; }
export const REF_TYPES = new Set(['issue', 'meeting', 'bmeeting', 'decision', 'post', 'news', 'event', 'idea', 'candidate', 'race', 'park', 'project', 'program', 'parknote', 'business', 'notice', 'case', 'official', 'person', 'game', 'school', 'budget', 'housing', 'election', 'market', 'congregation', 'help']);
export function cleanRef(r) {
  if (!r || typeof r !== 'object' || !REF_TYPES.has(r.t)) return null;
  const id = clean(r.id, 300); if (!id) return null;
  const href = clean(r.href, 200), url = clean(r.url, 500);
  return { t: r.t, id, label: clean(r.label, 200), href: /^#[\w-]*$/.test(href) ? href : '', url: /^https?:\/\//.test(url) ? url : '' };
}
export function etDate(now, plusDays = 0) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() + plusDays * 864e5)); }
export function fmtDate(iso) { const d = new Date(iso + 'T12:00:00Z'); return isNaN(d) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }

// ---------- Finding a starred item in a town's data ----------
export const DATA_FILES = ['record', 'local', 'beyond', 'parks', 'business', 'candidates', 'schools', 'sports', 'faith', 'safety', 'featured', 'market'];
// load(path) returns parsed JSON or null. subtowns: record-<id>.json files of a region.
export async function loadTownData(load, town, subtowns) {
  const out = { records: [] };
  for (const f of DATA_FILES) { const j = await load(`/data/${town}/${f}.json`); if (j) { if (f === 'record') out.records.push(j); else out[f] = j; } }
  for (const s of subtowns || []) { const j = await load(`/data/${town}/record-${s}.json`); if (j) out.records.push(j); }
  return out;
}
const slice60 = s => String(s || '').slice(0, 60);
function events(data) {
  const E = [...((data.local && data.local.events) || [])];
  ((data.faith && data.faith.events) || []).forEach(e => E.push({ ...e, kind: 'Faith', url: e.url || (e.source && e.source.url) || '' }));
  ((data.sports && data.sports.schools) || []).forEach(sc => (sc.teams || []).forEach(t => (t.next || []).forEach(g => E.push({ date: g.date, time: g.time || '', title: `${sc.mascot || sc.name} ${t.sport}${t.level && t.level !== 'Varsity' ? ' (' + t.level + ')' : ''} ${g.home ? 'vs' : 'at'} ${g.opponent}`, venue: g.venue || (g.home ? sc.name : ''), url: (g.source && g.source.url) || sc.scheduleUrl || '' }))));
  return E;
}
function deepFind(o, id, depth = 0) {
  if (!o || depth > 6) return null;
  if (Array.isArray(o)) { for (const x of o) { const f = deepFind(x, id, depth + 1); if (f) return f; } return null; }
  if (typeof o !== 'object') return null;
  if (Object.keys(o).length >= 2 && [o.id, o.url, o.name, o.title].some(v => v != null && String(v) === id)) return o;
  if (o.source && typeof o.source === 'object' && o.source.url === id && Object.keys(o).length >= 3) return o;
  for (const v of Object.values(o)) { if (v && typeof v === 'object') { const f = deepFind(v, id, depth + 1); if (f) return f; } }
  return null;
}
// Returns { obj, date } or null when the item is no longer in the data.
export function findItem(ref, data) {
  const recs = data.records || [], id = ref.id;
  const inRecs = (key, pred) => { for (const r of recs) { const x = (r[key] || []).find(pred); if (x) return x; } return null; };
  let obj = null;
  switch (ref.t) {
    case 'issue': obj = inRecs('issues', i => String(i.id) === id); break;
    case 'meeting': obj = inRecs('council_meetings', m => m.date === id); if (obj) obj = { ...obj, decisions: (obj.decisions || []).length }; break;
    case 'bmeeting': obj = inRecs('board_meetings', b => b.date + ' ' + b.body === id); break;
    case 'game': {
      for (const sc of (data.sports && data.sports.schools) || []) for (const t of sc.teams || []) for (const g of [...(t.recent || []), ...(t.next || [])]) {
        if (g.date + ':' + (sc.name || '') + ':' + (t.sport || '') + ':' + (g.opponent || '') === id) { obj = { date: g.date, time: g.time, venue: g.venue, note: g.note, result: g.result, record: t.record, postseason: t.postseason }; break; }
      }
      // pro and college teams: the page builds their game ids with an empty sport
      if (!obj) for (const tm of (data.sports && data.sports.teams) || []) for (const g of [...(tm.recent || []), ...(tm.next || [])]) {
        if (g.date + ':' + (tm.name || '') + '::' + (g.opponent || '') === id) { obj = { date: g.date, time: g.time, venue: g.venue, note: g.note, result: g.result, record: tm.record }; break; }
      }
      break;
    }
    case 'event': { const E = events(data); obj = E.find(e => e.url && e.url === id) || E.find(e => (e.url || '') + '|' + e.date + '|' + slice60(e.title) === id); break; }
    case 'congregation': { const name = id.slice(id.indexOf(':') + 1); obj = ((data.faith && data.faith.congregations) || []).find(c => c.name === name); break; }
    case 'help': { const name = id.slice(id.indexOf(':') + 1); obj = ((data.faith && data.faith.services) || []).find(c => c.name === name); break; }
    case 'school': {
      // ids are "<district>" or "<district>|<kind>|<key>" (issue, school, up, board), as the Schools page builds them
      const [dk, kind, key] = id.split('|');
      const slug = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      const d = ((data.schools && data.schools.districts) || []).find(x => String(x.id || x.name) === dk);
      if (!d) break;
      if (!kind) obj = d;
      else if (kind === 'issue') obj = (d.issues || []).find(x => (x.id || slug(x.title)) === key);
      else if (kind === 'school') obj = (d.schools || []).find(x => slug(x.name) === key);
      else if (kind === 'up') obj = (d.upcoming || []).find(x => x.date + '-' + slug(x.title) === key);
      else if (kind === 'board') obj = d.board || null;
      break;
    }
    default: { for (const k of Object.keys(data)) { if (k === 'records') continue; obj = deepFind(data[k], id); if (obj) break; } if (!obj) obj = deepFind(recs, id); }
  }
  if (!obj) return null;
  return { obj, date: /^\d{4}-\d{2}-\d{2}$/.test(obj.date || '') ? obj.date : (ref.t === 'meeting' ? id : null) };
}

// ---------- What changed ----------
export const WATCH = { status: 'Status', next: 'Next step', date: 'Date', time: 'Time', venue: 'Where', result: 'Result', record: 'Record', postseason: 'Postseason',
  services: 'Service times', when: 'When', address: 'Address', outcome: 'Outcome', headline: 'Headline', minutes_status: 'Minutes', decisions: 'Decisions recorded', title: 'Name', price: 'Price', stage: 'Stage', summary: 'Summary' };
const short = v => { const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 240 ? s.slice(0, 237) + '...' : s; };
export function snapOf(obj) { const o = {}; for (const k of Object.keys(WATCH)) if (obj[k] != null && obj[k] !== '') o[k] = short(obj[k]); return o; }
export function diffSnap(a, b) {
  const lines = [];
  for (const k of Object.keys(WATCH)) {
    const x = a[k], y = b[k];
    if (x === y) continue;
    if (k === 'summary') { if (y) lines.push(`Summary updated: ${y}`); continue; }
    if (y == null) continue; // a field that disappears is usually a data tidy-up, not news
    if (k === 'decisions') { lines.push(`Minutes are in: ${y} decision${y === '1' ? '' : 's'} recorded.`); continue; }
    lines.push(x == null ? `${WATCH[k]}: ${y}` : `${WATCH[k]}: now ${y} (was ${x})`);
  }
  return lines;
}

// ---------- Emails ----------
const WRAP = body => `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#050505;max-width:600px">${body}</div>`;
export function confirmEmail(site, link, label) {
  const subject = 'Confirm email updates from Agorri';
  const html = WRAP(`<p style="font-size:17px;font-weight:700;margin:0 0 10px">One tap to turn on email updates</p>
<p>You asked Agorri to email you when things you star change${label ? `, starting with <b>${esc(label)}</b>` : ''}: a new date or time, a status change, a result, new comments, and a reminder before dated events.</p>
<p style="margin:18px 0"><a href="${esc(link)}" style="background:#1B74E4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Turn on email updates</a></p>
<p style="font-size:13px;color:#65676B">If you didn't ask for this, ignore this email and nothing more will be sent. <a href="${esc(site)}" style="color:#65676B">agorri.com</a></p>`);
  const text = `Turn on Agorri email updates${label ? ' (starting with ' + label + ')' : ''}:\n${link}\n\nIf you didn't ask for this, ignore this email and nothing more will be sent.`;
  return { subject, html, text };
}
// items: [{ label, link, lines: [...], stop }]
export function updateEmail(items, stopAll) {
  const n = items.length;
  const subject = n === 1 ? `Update: ${items[0].label}`.slice(0, 120) : `${n} updates on things you starred`;
  const html = WRAP(`<p style="font-size:13px;color:#65676B;margin:0 0 14px">Things you starred on Agorri</p>
${items.map(it => `<div style="border-top:1px solid #E4E6EB;padding:12px 0"><a href="${esc(it.link)}" style="font-size:16px;font-weight:700;color:#050505;text-decoration:none">${esc(it.label)}</a>
<ul style="margin:6px 0 4px;padding-left:18px">${it.lines.map(l => `<li style="margin:2px 0">${esc(l)}</li>`).join('')}</ul>
<a href="${esc(it.stop)}" style="font-size:12px;color:#65676B">Stop updates on this</a></div>`).join('')}
<p style="font-size:12px;color:#65676B;border-top:1px solid #E4E6EB;padding-top:12px;margin-top:4px">You get this because you starred these on agorri.com and turned on email updates. At most one email a run, twice a day. <a href="${esc(stopAll)}" style="color:#65676B">Stop all Agorri emails</a></p>`);
  const text = items.map(it => `${it.label}\n${it.lines.map(l => '- ' + l).join('\n')}\n${it.link}\nStop updates on this: ${it.stop}`).join('\n\n') + `\n\nStop all Agorri emails: ${stopAll}`;
  return { subject, html, text };
}
export async function sendMail(env, to, m, headers) {
  if (!env.RESEND_API_KEY) return { error: 'RESEND_API_KEY missing' };
  const body = { from: env.NOTIFY_FROM || env.FEEDBACK_FROM || 'Agorri <onboarding@resend.dev>', to: [to], subject: m.subject, html: m.html, text: m.text };
  if (headers) body.headers = headers;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.ok) return true;
  let why = ''; try { const j = await r.json(); why = j.message || j.name || ''; } catch (e) {}
  return { error: 'Resend ' + r.status + (why ? ': ' + String(why).slice(0, 200) : '') };
}
export function page(title, msg, back) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>:root{--bg:#F0F2F5;--card:#fff;--ink:#050505;--muted:#65676B;--accent:#1B74E4}@media (prefers-color-scheme:dark){:root{--bg:#18191A;--card:#242526;--ink:#E4E6EB;--muted:#B0B3B8;--accent:#2D88FF}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:16px}
.card{max-width:420px;background:var(--card);border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.12);padding:26px 22px;display:flex;flex-direction:column;gap:12px}h1{font-size:20px;margin:0}p{margin:0;color:var(--muted)}
a,button{color:var(--accent);font-weight:700}button{background:var(--accent);color:#fff;border:0;border-radius:10px;height:44px;font:inherit;font-weight:700;cursor:pointer;width:100%}</style></head>
<body><div class="card"><h1>${esc(title)}</h1>${msg}${back ? `<a href="${esc(back)}">Back to Agorri</a>` : ''}</div></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
