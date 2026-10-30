// /api/verify : address check before a resident can post or comment.
// POST {town, address, username} -> checks with the U.S. Census geocoder (OpenStreetMap as a backup) that the address is real and inside the town.
// Stores only a salted hash of the matched address (never the address), the public username, and the method.
// At most 4 browsers per address per town; usernames are unique per town. GET ?town= tells this browser whether it's checked.
// This is an honor-system check (anyone can type a real address). Upgrade path: mailed codes (method "mail").
import { censusUrl, addressInTown, osmUrl, osmInTown } from '../../lib/address.js';
import { getSalt } from '../../lib/salt.js';

const MAX_PER_ADDRESS = 4;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
async function hash(s, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + s));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Address check is not connected yet.' }, 503);
  const salt = await getSalt(env);
  const url = new URL(request.url);
  const cid = clean(request.headers.get('x-agorri-client'), 64);
  if (!cid) return json({ error: 'Missing browser id.' }, 400);
  const me = await hash(cid, salt);

  if (request.method === 'GET') {
    const town = clean(url.searchParams.get('town'), 40).toLowerCase();
    const r = await env.DB.prepare('SELECT username, method, at FROM talk_residents WHERE author = ? AND town = ?').bind(me, town).first();
    return json({ town, resident: r || null });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const townId = clean(b.town, 40).toLowerCase();
  let t = null;
  try { const reg = await (await env.ASSETS.fetch(new URL('/towns.json', request.url))).json(); t = (reg.towns || []).find(x => x.id === townId && x.status === 'live'); } catch (e) {}
  if (!t) return json({ error: 'Unknown town.' }, 400);
  const username = clean(b.username, 24).replace(/\s+/g, '_');
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return json({ error: 'Usernames are 3 to 24 letters, numbers, dots, dashes or underscores.' }, 400);
  const address = clean(b.address, 200);
  if (address.length < 5 || !/\d/.test(address)) return json({ error: 'Enter your street address with the house number.' }, 400);

  // The Census geocoder is free and usually answers in under a second, but it is sometimes slow or briefly down. Two tries, 12 seconds each.
  let res, lastErr = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(censusUrl(address, t.name, t.state), { signal: ctl.signal, headers: { 'user-agent': 'Agorri address check (agorri.com)' } });
      if (!r.ok) throw new Error('census ' + r.status);
      res = addressInTown(await r.json(), t.name, t.state);
    } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
  }
  // Backup: OpenStreetMap, used only when the Census service didn't answer.
  if (!res) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(osmUrl(address, t.name, t.state), { signal: ctl.signal, headers: { 'user-agent': 'Agorri address check (agorri.com)', 'accept-language': 'en' } });
      if (!r.ok) throw new Error('osm ' + r.status);
      res = osmInTown(await r.json(), t.name, t.state);
    } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
  }
  if (!res) return json({ error: 'The address services didn\u2019t answer. Try again in a minute.', detail: String(lastErr && lastErr.message || '') }, 503);
  if (!res.ok && res.reason === 'not_found') return json({ error: 'We couldn’t find that address. Check the house number and street name.' }, 400);
  if (!res.ok) return json({ error: `That address is in ${res.place || 'another town'}, not ${t.name}.` }, 400);

  const addr = await hash(res.matched.toUpperCase(), salt);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM talk_residents WHERE town = ? AND addr = ? AND author != ?').bind(t.id, addr, me).first();
  if (n && n.n >= MAX_PER_ADDRESS) return json({ error: `That address already has ${MAX_PER_ADDRESS} accounts, the most we allow.` }, 409);
  const taken = await env.DB.prepare('SELECT 1 AS x FROM talk_residents WHERE town = ? AND lower(username) = lower(?) AND author != ?').bind(t.id, username, me).first();
  if (taken) return json({ error: 'That username is taken. Try another.' }, 409);
  await env.DB.prepare("INSERT INTO talk_residents (author, town, addr, username, method, at) VALUES (?, ?, ?, ?, 'address', ?) ON CONFLICT(author, town) DO UPDATE SET addr = excluded.addr, username = excluded.username, method = 'address', at = excluded.at")
    .bind(me, t.id, addr, username, new Date().toISOString()).run();
  return json({ ok: true, matched: res.matched, username });
}
