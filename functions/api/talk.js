// /api/talk : the single store for everything residents post (ideas, questions, debate, comments, replies, neighbor posts).
// Needs a Cloudflare D1 database bound as DB with migrations 0001 and 0002 applied.
// Secrets: TALK_SALT (salts hashes of browser ids, IPs and addresses), ANTHROPIC_API_KEY (AI review), MOD_TOKEN (moderators' key).
//
// Moderation (rules in lib/moderation.js):
//   Every new post gets an AI review. restrict -> blocked with the reason (the author can ask a person to review);
//   nudge -> the author is asked to reconsider and can post anyway; review -> held for a person; allow -> live.
//   Every flag triggers another AI review with the flaggers' reasons: restrict -> taken down; review -> stays up, queued for a person;
//   allow -> stays up, and three flags still queue it for a person. Flags never hide a post by count alone while AI review is on.
//   Without ANTHROPIC_API_KEY: posts go live after the rule checks, and three flags hide a post until a person reviews it.
// Posting and commenting require an address-checked resident (/api/verify). Support and flags are open to everyone.
import { MOD_POLICY, modPrompt, modVerdict } from '../../lib/moderation.js';

const KINDS = ['idea', 'question', 'argument', 'comment', 'neighbor'];
const REF_TYPES = ['town', 'issue', 'meeting', 'decision', 'post', 'news'];
const HIDE_AT = 3;
const FLAG_REASONS = ['Hate or slurs', 'Threat', 'Harassment', 'Personal information', 'Spam or ads', 'Campaigning', 'Off-topic national politics', 'False information', 'Something else'];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

async function hash(s, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + s));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
const isMod = (request, env) => !!env.MOD_TOKEN && env.MOD_TOKEN.length >= 16 && same(request.headers.get('x-agorri-mod') || '', env.MOD_TOKEN);

export function checkText(title, body, links = 2) {
  const s = (title + ' ' + body).trim();
  if (s.length < 3) return 'Write a little more.';
  if (s.length > 2200) return 'Keep it under 2,000 characters.';
  if ((s.match(/https?:\/\//g) || []).length > links) return 'Two links at most.';
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(s) || /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(s)) return 'Leave out phone numbers and email addresses, to protect people’s privacy.';
  return '';
}

async function townName(env, request, id) {
  try { const reg = await (await env.ASSETS.fetch(new URL('/towns.json', request.url))).json(); const t = (reg.towns || []).find(x => x.id === id); if (t) return t.name + ', ' + t.state; } catch (e) {}
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export async function aiReview(env, post, town, flags) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const { system, user } = modPrompt(post, town, flags);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.MOD_MODEL || 'claude-haiku-5-5', max_tokens: 300, system, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) return null;
    const j = await r.json();
    return modVerdict((j.content || []).map(c => c.text || '').join(''));
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

const log = (env, o) => env.DB.prepare('INSERT INTO talk_modlog (key, town, at, by, trigger, decision, cat, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .bind(o.key || null, o.town, new Date().toISOString(), o.by, o.trigger, o.decision, o.cat || null, o.reason || null).run();

function shape(r, mk, kids, last, me, mod, aiOn) {
  const s = (mk[r.key] || {}).support || {}, p = (mk[r.key] || {}).report || {};
  const rep = p.n || 0, mine = !!me && r.author === me;
  let status = r.hidden ? 'restricted' : (r.mod_status || 'ok');
  if (status === 'ok' && !aiOn && rep >= HIDE_AT && !r.kept) status = 'pending';
  const cat = MOD_POLICY.categories[r.mod_cat];
  const out = { key: r.key, kind: r.kind, town: r.town, ref: { t: r.ref_t || 'town', id: r.ref_id || undefined, label: r.ref_label || undefined, url: r.ref_url || undefined },
    parent: r.parent || null, stance: r.stance || null, title: r.title || '', body: r.body || '', tag: r.tag || null,
    name: r.anon ? '' : (r.name || ''), anon: !!r.anon, verified: !!r.verified, at: r.at,
    sup: s.n || 0, vsup: s.v || 0, rep, supported: !!s.mine, reported: !!p.mine, mine, modStatus: status,
    replies: kids[r.key] || 0, active: last[r.key] && last[r.key] > r.at ? last[r.key] : r.at };
  if (mine || mod) { out.modLabel = cat ? cat.label : (status === 'ok' ? '' : r.mod_cat || ''); out.modReason = r.mod_reason || ''; out.appeal = !!r.appeal; }
  if (mod) { out.queued = !!r.queued; out.modBy = r.mod_by || ''; out.flags = p.reasons ? String(p.reasons).split('\u0001').filter(Boolean) : []; }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Talk is not connected yet.' }, 503);
  const salt = env.TALK_SALT || 'agorri';
  const url = new URL(request.url);
  const cid = clean(request.headers.get('x-agorri-client'), 64);
  const me = cid ? await hash(cid, salt) : '';
  const mod = isMod(request, env), aiOn = !!env.ANTHROPIC_API_KEY;

  if (request.method === 'GET') {
    const town = clean(url.searchParams.get('town'), 40).toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(town)) return json({ error: 'town required' }, 400);
    const queue = url.searchParams.get('queue') === '1';
    if (queue && !mod) return json({ error: 'Moderator key required.' }, 403);
    const rows = (await env.DB.prepare(queue ? "SELECT * FROM talk_items WHERE town = ? AND (mod_status = 'pending' OR queued = 1 OR hidden = 1) ORDER BY at DESC LIMIT 300" : 'SELECT * FROM talk_items WHERE town = ? ORDER BY at DESC LIMIT 1000').bind(town).all()).results || [];
    const marks = (await env.DB.prepare("SELECT m.key, m.mark, COUNT(*) AS n, SUM(m.verified) AS v, SUM(CASE WHEN m.author = ? THEN 1 ELSE 0 END) AS mine, GROUP_CONCAT(m.reason, char(1)) AS reasons FROM talk_marks m JOIN talk_items t ON t.key = m.key WHERE t.town = ? GROUP BY m.key, m.mark").bind(me, town).all()).results || [];
    const mk = {}; marks.forEach(m => { (mk[m.key] = mk[m.key] || {})[m.mark] = m; });
    const kids = {}, last = {};
    rows.forEach(r => { if (r.parent) { kids[r.parent] = (kids[r.parent] || 0) + 1; if (!last[r.parent] || r.at > last[r.parent]) last[r.parent] = r.at; } });
    const items = rows.map(r => shape(r, mk, kids, last, me, mod, aiOn)).filter(x => mod || x.mine || x.modStatus === 'ok');
    const resident = me ? await env.DB.prepare('SELECT username FROM talk_residents WHERE author = ? AND town = ?').bind(me, town).first() : null;
    const out = { town, items, ai: aiOn, mod, resident: resident ? { username: resident.username } : null };
    if (queue) out.log = (await env.DB.prepare('SELECT key, at, by, trigger, decision, cat, reason FROM talk_modlog WHERE town = ? ORDER BY id DESC LIMIT 60').bind(town).all()).results || [];
    return json(out);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site posting is not allowed.' }, 403);
  if (!me) return json({ error: 'Missing browser id.' }, 400);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const town = clean(b.town, 40).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(town)) return json({ error: 'town required' }, 400);
  const now = new Date().toISOString();
  const resident = await env.DB.prepare('SELECT username FROM talk_residents WHERE author = ? AND town = ?').bind(me, town).first();

  if (b.action === 'post') {
    if (!resident) return json({ error: 'Check your address to post. Reading is open to everyone.', verify: true }, 403);
    const it = b.item || {};
    let parent = clean(it.parent, 120) || null;
    const kind = parent ? 'comment' : (KINDS.includes(it.kind) ? it.kind : null);
    if (!kind) return json({ error: 'Unknown post type.' }, 400);
    const title = clean(it.title, 160), body = clean(it.body, 2000);
    const err = checkText(title, body); if (err) return json({ error: err }, 400);
    const ip = await hash(request.headers.get('cf-connecting-ip') || 'unknown', salt);
    const since = new Date(Date.now() - 10 * 60e3).toISOString(), hour = new Date(Date.now() - 3600e3).toISOString();
    const recent = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM talk_items WHERE author = ? AND at > ?) AS a, (SELECT COUNT(*) FROM talk_items WHERE ip = ? AND at > ?) AS b').bind(me, since, ip, hour).first();
    if (recent && (recent.a >= 5 || recent.b >= 30)) return json({ error: 'That’s a lot of posts in a short time. Try again shortly.' }, 429);
    const ref = it.ref || {}; const rt = REF_TYPES.includes(ref.t) ? ref.t : 'town';
    if (parent) { const p = await env.DB.prepare('SELECT key FROM talk_items WHERE key = ? AND town = ?').bind(parent, town).first(); if (!p) return json({ error: 'That post no longer exists.' }, 400); }
    const stance = kind === 'argument' ? (it.stance === 'against' ? 'against' : 'for') : null;
    let v = null, status = 'ok', by = aiOn ? 'ai' : 'rules', appeal = 0, mcat = null, mreason = null;
    if (it.appeal) {
      status = 'pending'; appeal = 1; by = 'ai';
      mcat = MOD_POLICY.categories[it.appeal.category] ? it.appeal.category : null; mreason = clean(it.appeal.reason, 300) || 'The author asked a person to review this post.';
    } else {
      v = await aiReview(env, { kind, stance, title, body, about: clean(ref.label, 200) }, await townName(env, request, town), null);
      if (v && v.decision === 'restrict') { await log(env, { town, by: 'ai', trigger: 'post', decision: 'restrict', cat: v.category, reason: v.reason }); return json({ error: v.reason || 'This post breaks a house rule.', moderation: v }, 422); }
      if (v && v.decision === 'nudge' && !it.confirmNudge) return json({ nudge: v }, 409);
      if (v && v.decision === 'review') { status = 'pending'; }
      if (v && v.decision !== 'allow') { mcat = v.category; mreason = v.reason; }
    }
    const id = clean(it.id, 40).replace(/[^\w-]/g, '') || ('t' + Date.now().toString(36));
    const key = me + '~' + id;
    const refUrl = /^https:\/\//.test(ref.url || '') ? clean(ref.url, 500) : null;
    await env.DB.prepare('INSERT INTO talk_items (key, town, author, ip, kind, ref_t, ref_id, ref_label, ref_url, parent, stance, title, body, tag, name, anon, verified, at, mod_status, mod_cat, mod_reason, mod_by, mod_at, appeal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)')
      .bind(key, town, me, ip, kind, rt, rt === 'town' ? null : clean(ref.id, 300), rt === 'town' ? null : clean(ref.label, 200), refUrl, parent, stance, title, body, kind === 'neighbor' ? clean(it.tag, 40) : null, it.anon ? '' : resident.username, it.anon ? 1 : 0, now, status, mcat, mreason, by, now, appeal).run();
    if (appeal || (v && v.decision !== 'allow')) await log(env, { key, town, by: appeal ? 'rules' : 'ai', trigger: appeal ? 'appeal' : 'post', decision: appeal ? 'review' : v.decision, cat: mcat, reason: mreason });
    return json({ ok: true, key, status, moderation: v });
  }

  const key = clean(b.key, 120);
  const row = key ? await env.DB.prepare('SELECT * FROM talk_items WHERE key = ? AND town = ?').bind(key, town).first() : null;
  if (!row) return json({ error: 'That post no longer exists.' }, 404);

  if (b.action === 'support') {
    const had = await env.DB.prepare("SELECT 1 AS x FROM talk_marks WHERE key = ? AND author = ? AND mark = 'support'").bind(key, me).first();
    if (had) await env.DB.prepare("DELETE FROM talk_marks WHERE key = ? AND author = ? AND mark = 'support'").bind(key, me).run();
    else await env.DB.prepare("INSERT INTO talk_marks (key, author, mark, verified, at) VALUES (?, ?, 'support', ?, ?)").bind(key, me, resident ? 1 : 0, now).run();
    return json({ ok: true, on: !had });
  }
  if (b.action === 'report') {
    if (row.author === me) return json({ error: 'That’s your own post.' }, 400);
    const had = await env.DB.prepare("SELECT 1 AS x FROM talk_marks WHERE key = ? AND author = ? AND mark = 'report'").bind(key, me).first();
    if (had) { await env.DB.prepare("DELETE FROM talk_marks WHERE key = ? AND author = ? AND mark = 'report'").bind(key, me).run(); return json({ ok: true, on: false }); }
    const reason = FLAG_REASONS.includes(b.reason) ? b.reason : 'Something else';
    await env.DB.prepare("INSERT INTO talk_marks (key, author, mark, verified, at, reason) VALUES (?, ?, 'report', ?, ?, ?)").bind(key, me, resident ? 1 : 0, now, reason).run();
    if (row.mod_by === 'person' || row.mod_status !== 'ok') return json({ ok: true, on: true, review: null });
    const fl = (await env.DB.prepare("SELECT reason, COUNT(*) AS n FROM talk_marks WHERE key = ? AND mark = 'report' GROUP BY reason").bind(key).all()).results || [];
    const total = fl.reduce((a, f) => a + f.n, 0);
    const v = await aiReview(env, { kind: row.kind, stance: row.stance, title: row.title, body: row.body, about: row.ref_label }, await townName(env, request, town), fl.map(f => f.reason + (f.n > 1 ? ' (' + f.n + ')' : '')));
    if (v && v.decision === 'restrict') {
      await env.DB.prepare("UPDATE talk_items SET mod_status = 'restricted', mod_cat = ?, mod_reason = ?, mod_by = 'ai', mod_at = ?, queued = 0 WHERE key = ?").bind(v.category, v.reason, now, key).run();
    } else if ((v && v.decision === 'review') || total >= HIDE_AT) {
      await env.DB.prepare("UPDATE talk_items SET queued = 1, mod_cat = COALESCE(?, mod_cat), mod_reason = COALESCE(?, mod_reason), mod_at = ? WHERE key = ?").bind(v && v.decision !== 'allow' ? v.category : null, v && v.decision !== 'allow' ? v.reason : null, now, key).run();
    }
    if (v) await log(env, { key, town, by: 'ai', trigger: 'flag', decision: v.decision, cat: v.category, reason: v.reason });
    return json({ ok: true, on: true, review: v ? { decision: v.decision, label: v.label } : null });
  }
  if (b.action === 'appeal') {
    if (row.author !== me) return json({ error: 'Only the author can ask for a review.' }, 403);
    if (row.mod_status !== 'restricted' || row.mod_by === 'person') return json({ error: 'This post can\u2019t be appealed.' }, 400);
    await env.DB.prepare("UPDATE talk_items SET mod_status = 'pending', appeal = 1, mod_at = ? WHERE key = ?").bind(now, key).run();
    await log(env, { key, town, by: 'rules', trigger: 'appeal', decision: 'review', cat: row.mod_cat, reason: 'The author asked a person to review this post.' });
    return json({ ok: true, status: 'pending' });
  }
  if (b.action === 'delete') {
    if (row.author !== me && !mod) return json({ error: 'Only the author can delete a post.' }, 403);
    await env.DB.prepare('DELETE FROM talk_marks WHERE key = ?').bind(key).run();
    await env.DB.prepare('DELETE FROM talk_items WHERE key = ?').bind(key).run();
    return json({ ok: true });
  }
  if (b.action === 'decide') {
    if (!mod) return json({ error: 'Moderator key required.' }, 403);
    const reason = clean(b.reason, 300);
    if (b.decision === 'approve') await env.DB.prepare("UPDATE talk_items SET mod_status = 'ok', queued = 0, hidden = 0, kept = 1, mod_by = 'person', mod_at = ? WHERE key = ?").bind(now, key).run();
    else if (b.decision === 'remove') await env.DB.prepare("UPDATE talk_items SET mod_status = 'restricted', queued = 0, mod_by = 'person', mod_at = ?, mod_cat = COALESCE(?, mod_cat), mod_reason = ? WHERE key = ?").bind(now, MOD_POLICY.categories[b.category] ? b.category : null, reason || 'Removed by a moderator.', key).run();
    else return json({ error: 'decision must be approve or remove' }, 400);
    await log(env, { key, town, by: 'person', trigger: 'queue', decision: b.decision, cat: b.category || row.mod_cat, reason });
    return json({ ok: true });
  }
  return json({ error: 'Unknown action.' }, 400);
}
