// /api/talk : the single store for everything residents post (ideas, questions, debate, comments, replies, neighbor posts).
// Needs a Cloudflare D1 database bound to this Pages project as DB, with migrations/0001_talk.sql applied.
// Optional secret TALK_SALT (any long random string) salts the hashes of browser ids and IPs.
// GET  /api/talk?town=<id>                 -> { items: [...] } newest first, with support/report counts for the caller
// POST /api/talk {town, action, ...}       -> action: post {item, name} | support {key} | report {key} | delete {key}
// Posts go live immediately. Three reports hide a post until a moderator restores it (talk_items.kept = 1).
const KINDS = ['idea', 'question', 'argument', 'comment', 'neighbor'];
const REF_TYPES = ['town', 'issue', 'meeting', 'decision', 'post', 'news'];
const HIDE_AT = 3;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

async function hash(s, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + s));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function checkText(title, body, links = 2) {
  const s = (title + ' ' + body).trim();
  if (s.length < 3) return 'Write a little more.';
  if (s.length > 2200) return 'Keep it under 2,000 characters.';
  if ((s.match(/https?:\/\//g) || []).length > links) return 'Two links at most.';
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(s) || /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(s)) return 'Leave out phone numbers and email addresses, to protect people’s privacy.';
  return '';
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Talk is not connected yet.' }, 503);
  const salt = env.TALK_SALT || 'agorri';
  const url = new URL(request.url);
  const cid = clean(request.headers.get('x-agorri-client'), 64);
  const me = cid ? await hash(cid, salt) : '';

  if (request.method === 'GET') {
    const town = clean(url.searchParams.get('town'), 40).toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(town)) return json({ error: 'town required' }, 400);
    const rows = (await env.DB.prepare('SELECT * FROM talk_items WHERE town = ? ORDER BY at DESC LIMIT 1000').bind(town).all()).results || [];
    const marks = (await env.DB.prepare('SELECT m.key, m.mark, COUNT(*) AS n, SUM(m.verified) AS v, SUM(CASE WHEN m.author = ? THEN 1 ELSE 0 END) AS mine FROM talk_marks m JOIN talk_items t ON t.key = m.key WHERE t.town = ? GROUP BY m.key, m.mark').bind(me, town).all()).results || [];
    const mk = {}; marks.forEach(m => { (mk[m.key] = mk[m.key] || {})[m.mark] = m; });
    const kids = {}, last = {};
    rows.forEach(r => { if (r.parent) { kids[r.parent] = (kids[r.parent] || 0) + 1; if (!last[r.parent] || r.at > last[r.parent]) last[r.parent] = r.at; } });
    const items = rows.map(r => {
      const s = (mk[r.key] || {}).support || {}, p = (mk[r.key] || {}).report || {};
      const rep = p.n || 0, mine = !!me && r.author === me;
      const hidden = !!r.hidden || (rep >= HIDE_AT && !r.kept);
      const show = !hidden || mine;
      return { key: r.key, kind: r.kind, town: r.town, ref: { t: r.ref_t || 'town', id: r.ref_id || undefined, label: r.ref_label || undefined, url: r.ref_url || undefined },
        parent: r.parent || null, stance: r.stance || null, title: show ? r.title || '' : '', body: show ? r.body || '' : '', tag: r.tag || null,
        name: r.anon ? '' : (r.name || ''), anon: !!r.anon, verified: !!r.verified, at: r.at,
        sup: s.n || 0, vsup: s.v || 0, rep, supported: !!s.mine, reported: !!p.mine, mine, hidden,
        replies: kids[r.key] || 0, active: last[r.key] && last[r.key] > r.at ? last[r.key] : r.at };
    });
    return json({ town, items });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site posting is not allowed.' }, 403);
  if (!me) return json({ error: 'Missing browser id.' }, 400);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const town = clean(b.town, 40).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(town)) return json({ error: 'town required' }, 400);
  const now = new Date().toISOString();

  if (b.action === 'post') {
    const it = b.item || {};
    const kind = KINDS.includes(it.kind) ? it.kind : null;
    if (!kind) return json({ error: 'Unknown post type.' }, 400);
    const title = clean(it.title, 160), body = clean(it.body, 2000);
    const err = checkText(title, body); if (err) return json({ error: err }, 400);
    const ip = await hash(request.headers.get('cf-connecting-ip') || 'unknown', salt);
    const since = new Date(Date.now() - 10 * 60e3).toISOString(), hour = new Date(Date.now() - 3600e3).toISOString();
    const recent = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM talk_items WHERE author = ? AND at > ?) AS a, (SELECT COUNT(*) FROM talk_items WHERE ip = ? AND at > ?) AS b').bind(me, since, ip, hour).first();
    if (recent && (recent.a >= 5 || recent.b >= 30)) return json({ error: 'That’s a lot of posts in a short time. Try again shortly.' }, 429);
    const ref = it.ref || {}; const rt = REF_TYPES.includes(ref.t) ? ref.t : 'town';
    let parent = clean(it.parent, 120) || null;
    if (parent) { const p = await env.DB.prepare('SELECT key FROM talk_items WHERE key = ? AND town = ?').bind(parent, town).first(); if (!p) return json({ error: 'That post no longer exists.' }, 400); }
    const id = clean(it.id, 40).replace(/[^\w-]/g, '') || ('t' + Date.now().toString(36));
    const key = me + '~' + id;
    const stance = kind === 'argument' ? (it.stance === 'against' ? 'against' : 'for') : null;
    const refUrl = /^https:\/\//.test(ref.url || '') ? clean(ref.url, 500) : null;
    await env.DB.prepare('INSERT INTO talk_items (key, town, author, ip, kind, ref_t, ref_id, ref_label, ref_url, parent, stance, title, body, tag, name, anon, verified, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .bind(key, town, me, ip, parent ? 'comment' : kind, rt, rt === 'town' ? null : clean(ref.id, 300), rt === 'town' ? null : clean(ref.label, 200), refUrl, parent, stance, title, body, kind === 'neighbor' ? clean(it.tag, 40) : null, it.anon ? '' : clean(b.name, 24).replace(/[^\w.-]/g, ''), it.anon ? 1 : 0, now).run();
    return json({ ok: true, key });
  }

  const key = clean(b.key, 120);
  const row = key ? await env.DB.prepare('SELECT key, author FROM talk_items WHERE key = ? AND town = ?').bind(key, town).first() : null;
  if (!row) return json({ error: 'That post no longer exists.' }, 404);

  if (b.action === 'support' || b.action === 'report') {
    const mark = b.action;
    if (mark === 'report' && row.author === me) return json({ error: 'That’s your own post.' }, 400);
    const had = await env.DB.prepare('SELECT 1 AS x FROM talk_marks WHERE key = ? AND author = ? AND mark = ?').bind(key, me, mark).first();
    if (had) await env.DB.prepare('DELETE FROM talk_marks WHERE key = ? AND author = ? AND mark = ?').bind(key, me, mark).run();
    else await env.DB.prepare('INSERT INTO talk_marks (key, author, mark, verified, at) VALUES (?, ?, ?, 0, ?)').bind(key, me, mark, now).run();
    return json({ ok: true, on: !had });
  }
  if (b.action === 'delete') {
    if (row.author !== me) return json({ error: 'Only the author can delete a post.' }, 403);
    await env.DB.prepare('DELETE FROM talk_marks WHERE key = ?').bind(key).run();
    await env.DB.prepare('DELETE FROM talk_items WHERE key = ?').bind(key).run();
    return json({ ok: true });
  }
  return json({ error: 'Unknown action.' }, 400);
}
