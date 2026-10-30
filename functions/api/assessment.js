// /api/assessment?town=<id>&address=<street address>
// Looks up the city assessor's value for a street address, so the tax estimate can use the resident's own home.
// Sources are the towns' public assessing databases (towns.json "assessor"): Vision Government Solutions (Portsmouth)
// and Patriot Properties WebPro (Nashua). Returns location, assessed value and land use only. Owner names are never
// returned, and the address is not stored anywhere. Answers are cached for a day per address.
import { normStreet, sameStreet } from '../../lib/assess.js';

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const UA = { 'user-agent': 'Agorri tax estimate (agorri.com)' };
const money = s => { const n = parseInt(String(s || '').replace(/[^0-9]/g, ''), 10); return n > 0 ? n : null; };
const strip = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
async function timed(url, init = {}, ms = 9000) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); } }

export async function vgsi(base, a) {
  const r = await timed(base + 'async.asmx/GetDataAddress', { method: 'POST', headers: { ...UA, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ inVal: `${a.num} ${a.core}`, src: 'i_address' }) });
  if (!r.ok) throw new Error('vgsi search ' + r.status);
  const list = ((await r.json()).d || []).filter(x => sameStreet(x.value, a));
  const seen = new Set(); const hits = list.filter(x => !seen.has(x.id) && seen.add(x.id)).slice(0, 8);
  const out = await Promise.all(hits.map(async x => {
    try {
      const p = await timed(base + 'Parcel.aspx?pid=' + encodeURIComponent(x.id), { headers: UA });
      if (!p.ok) return null; const h = await p.text();
      const val = money((h.match(/id="MainContent_lblGenAssessment"[^>]*>([^<]*)</) || [])[1]);
      const loc = strip((h.match(/id="MainContent_lblLocation"[^>]*>([^<]*)</) || [])[1]) || x.value;
      const use = strip((h.match(/id="MainContent_lblUseCodeDescription"[^>]*>([^<]*)</) || [])[1]);
      return val ? { loc, value: val, use: use || null, url: base + 'Parcel.aspx?pid=' + encodeURIComponent(x.id) } : null;
    } catch (e) { return null; }
  }));
  return out.filter(Boolean);
}

export async function patriot(base, a) {
  const body = new URLSearchParams({ SearchParcel: '', SearchOwner: '', SearchStreetName: a.core, SearchStreetNumber: a.num, SearchSubmitted: 'yes', cmdGo: 'Go' });
  const r = await timed(base + 'SearchResults.asp', { method: 'POST', headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('patriot search ' + r.status);
  const h = await r.text(); const out = [];
  for (const row of h.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const td = (row.match(/<td[\s\S]*?<\/td>/gi) || []).map(strip);
    if (td.length < 6) continue;
    const loc = td[1], val = money(td[4]);
    if (!val || !sameStreet(loc, a)) continue;
    out.push({ loc, value: val, use: td[5].replace(/^\d+\s*/, '') || null, url: base });
  }
  return out.slice(0, 12);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(request.url);
  const town = String(url.searchParams.get('town') || '').toLowerCase().slice(0, 40);
  
  let t = null;
  try { const reg = await (await env.ASSETS.fetch(new URL('/towns.json', request.url))).json(); t = (reg.towns || []).find(x => x.id === town && x.status === 'live'); } catch (e) {}
  if (!t || !t.assessor || !t.assessor.base) return json({ error: 'Assessor lookup is not available for this town yet.' }, 404);
  const a = normStreet(url.searchParams.get('address'), t.name);
  if (!a) return json({ error: 'Enter a street address with the house number.' }, 400);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://agorri.cache/assessment/${town}/${encodeURIComponent(a.num + ' ' + a.core)}`);
  if (cache) { const hit = await cache.match(key); if (hit) return json(await hit.json()); }
  let results;
  try { results = t.assessor.type === 'vgsi' ? await vgsi(t.assessor.base, a) : t.assessor.type === 'patriot' ? await patriot(t.assessor.base, a) : null; }
  catch (e) { return json({ error: 'The assessor’s database didn’t answer. Try again in a minute.' }, 503); }
  if (!results) return json({ error: 'Assessor lookup is not available for this town yet.' }, 404);
  const out = { town, query: `${a.num} ${a.street}`, results, source: { label: t.assessor.label, url: t.assessor.site || t.assessor.base } };
  if (cache && results.length) context.waitUntil && context.waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=86400' } })));
  return json(out);
}
