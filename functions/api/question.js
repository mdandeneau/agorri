// /api/question : today's question (agree / disagree / pass), one answer per browser per question.
// Questions live in data/<town>/questions.json (towns.json files.questions); only status "approved" counts.
// Answers are stored in D1 (q_answers, created on first use) with a salted browser hash; "verified" is set when the browser
// belongs to an address-checked resident of that town (talk_residents). Results are what participants said, nothing more.
import { getSalt } from '../../lib/salt.js';

const CHOICES = ['agree', 'disagree', 'pass'];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
async function hash(s, salt) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + s)); return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join(''); }
export const SCHEMA = 'CREATE TABLE IF NOT EXISTS q_answers (qid TEXT NOT NULL, town TEXT NOT NULL, author TEXT NOT NULL, choice TEXT NOT NULL, verified INTEGER DEFAULT 0, at TEXT NOT NULL, PRIMARY KEY (qid, author))';

async function question(env, request, town, id) {
  try {
    const reg = await (await env.ASSETS.fetch(new URL('/towns.json', request.url))).json();
    const t = (reg.towns || []).find(x => x.id === town && x.status === 'live');
    if (!t || !t.files || !t.files.questions) return null;
    const q = await (await env.ASSETS.fetch(new URL('/' + t.files.questions.replace(/^\//, ''), request.url))).json();
    return (q.questions || []).find(x => x.id === id && x.status === 'approved') || null;
  } catch (e) { return null; }
}
async function tally(env, town, qid, me) {
  const r = await env.DB.prepare('SELECT choice, COUNT(*) AS n, SUM(verified) AS v FROM q_answers WHERE town = ? AND qid = ? GROUP BY choice').bind(town, qid).all();
  const out = { agree: 0, disagree: 0, pass: 0, verified: { agree: 0, disagree: 0, pass: 0 }, total: 0 };
  (r.results || []).forEach(x => { if (CHOICES.includes(x.choice)) { out[x.choice] = x.n; out.verified[x.choice] = x.v || 0; out.total += x.n; } });
  const mine = me ? await env.DB.prepare('SELECT choice FROM q_answers WHERE qid = ? AND author = ?').bind(qid, me).first() : null;
  out.mine = mine ? mine.choice : null;
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Not connected yet.' }, 503);
  await env.DB.prepare(SCHEMA).run();
  const url = new URL(request.url);
  const salt = await getSalt(env);
  const cid = clean(request.headers.get('x-agorri-client'), 64);
  const me = cid ? await hash(cid, salt) : null;
  if (request.method === 'GET') {
    const town = clean(url.searchParams.get('town'), 40).toLowerCase(), id = clean(url.searchParams.get('id'), 80);
    if (!(await question(env, request, town, id))) return json({ error: 'Unknown question.' }, 404);
    return json({ id, ...(await tally(env, town, id, me)) });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  if (!me) return json({ error: 'Missing browser id.' }, 400);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const town = clean(b.town, 40).toLowerCase(), id = clean(b.id, 80), choice = clean(b.choice, 10);
  if (!CHOICES.includes(choice)) return json({ error: 'Choose agree, disagree or pass.' }, 400);
  if (!(await question(env, request, town, id))) return json({ error: 'Unknown question.' }, 404);
  let verified = 0;
  try { const r = await env.DB.prepare('SELECT 1 AS x FROM talk_residents WHERE author = ? AND town = ?').bind(me, town).first(); verified = r ? 1 : 0; } catch (e) {}
  await env.DB.prepare('INSERT INTO q_answers (qid, town, author, choice, verified, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(qid, author) DO UPDATE SET choice = excluded.choice, verified = excluded.verified, at = excluded.at')
    .bind(id, town, me, choice, verified, new Date().toISOString()).run();
  return json({ id, ...(await tally(env, town, id, me)) });
}
