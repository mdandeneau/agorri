// GET /api/feed?town=<id> : merges the official sources in that town's feeds file (towns.json files.feeds) into one feed.
// Sources tagged "safety" (police and fire) or "news" (the local paper) keep the tag so the page can show them in the right place.
// Cached for 5 minutes per town at Cloudflare's edge so upstream sites see at most ~12 requests an hour.
const TTL = 300;

const decode = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');
const strip = s => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (b, n) => { const m = b.match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i')); return m ? m[1] : ''; };
const iso = s => { const d = new Date(s); return isNaN(d) ? null : d.toISOString(); };

export function parseRSS(xml, src) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].slice(0, 15).map(m => {
    const b = m[0];
    return { who: src.who, platform: src.platform, when: iso(strip(tag(b, 'pubDate'))), quote: strip(tag(b, 'title')),
      gist: strip(tag(b, 'description')).slice(0, 220), url: strip(tag(b, 'link')), source: src.id };
  }).filter(x => x.when && x.quote);
}
export function parseAtom(xml, src) {
  return [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].slice(0, 10).map(m => {
    const b = m[0];
    const href = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    return { who: src.who, platform: src.platform, when: iso(strip(tag(b, 'published')) || strip(tag(b, 'updated'))),
      quote: strip(tag(b, 'title')), gist: '', url: decode(href), source: src.id };
  }).filter(x => x.when && x.quote);
}
export function parseBluesky(json, src) {
  return (json.feed || []).filter(f => !f.reason && f.post && f.post.record).map(f => {
    const p = f.post;
    return { who: src.who, platform: 'Bluesky', when: iso(p.record.createdAt), quote: String(p.record.text || '').slice(0, 500), gist: '',
      url: 'https://bsky.app/profile/' + ((p.author && p.author.handle) || src.actor) + '/post/' + p.uri.split('/').pop(),
      person: src.person, images: (p.embed && p.embed.images) ? p.embed.images.length : 0, source: src.id };
  }).filter(x => x.when);
}

// type "links": a news homepage with no feed. Reads <a href> links whose URL matches src.match (with year, month, day groups),
// keeps the longest text per URL, and dates each item from its URL (page order kept within a day).
export function parseLinks(html, src) {
  const re = new RegExp(src.match), skip = src.skip ? new RegExp(src.skip, 'i') : null, seen = new Map();
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url = decode(m[1]); try { url = new URL(url, src.url).toString(); } catch (e) { continue; }
    const d = url.match(re); if (!d) continue;
    const title = strip(m[2]); if (title.length < 12 || (skip && skip.test(title))) continue;
    const prev = seen.get(url); if (!prev) seen.set(url, { title, date: d[1] + '-' + d[2] + '-' + d[3], n: seen.size }); else if (title.length > prev.title.length) prev.title = title;
  }
  return [...seen.entries()].sort((a, b) => b[1].date.localeCompare(a[1].date) || a[1].n - b[1].n).slice(0, 15)
    .map(([url, x], i) => ({ who: src.who, platform: src.platform, when: new Date(Date.parse(x.date + 'T16:00:00Z') - i * 1000).toISOString(), quote: x.title, gist: '', url, source: src.id }));
}

async function fetchSource(src) {
  const init = { headers: { 'user-agent': 'Agorri civic feed (agorri.com)' }, cf: { cacheTtl: TTL, cacheEverything: true } };
  if (src.type === 'bluesky') {
    const r = await fetch('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=' + encodeURIComponent(src.actor) + '&limit=15&filter=posts_no_replies', init);
    if (!r.ok) throw new Error(src.id + ' ' + r.status);
    return parseBluesky(await r.json(), src);
  }
  const r = await fetch(src.url, init);
  if (!r.ok) throw new Error(src.id + ' ' + r.status);
  const xml = await r.text();
  return src.type === 'atom' ? parseAtom(xml, src) : src.type === 'links' ? parseLinks(xml, src) : parseRSS(xml, src);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const want = (new URL(request.url).searchParams.get('town') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  let feedsPath = '/feeds.json', town = want || 'default';
  try {
    const reg = await (await env.ASSETS.fetch(new URL('/towns.json', request.url))).json();
    const t = (reg.towns || []).find(x => x.id === (want || reg.default));
    if (want && !t) return new Response(JSON.stringify({ error: 'unknown town' }), { status: 404, headers: { 'content-type': 'application/json' } });
    if (t) { town = t.id; if (t.files && t.files.feeds) feedsPath = '/' + t.files.feeds.replace(/^\//, ''); }
  } catch (e) { /* no registry: fall back to /feeds.json */ }
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(new URL('/api/feed?town=' + town, request.url).toString());
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const cfg = await (await env.ASSETS.fetch(new URL(feedsPath, request.url))).json();
  const results = await Promise.allSettled((cfg.sources || []).map(s => fetchSource(s).then(items => s.tag ? items.map(i => ({ ...i, tag: s.tag })) : items)));
  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []).sort((a, b) => b.when.localeCompare(a.when)).slice(0, 80);
  const errors = results.map((r, i) => r.status === 'rejected' ? (cfg.sources[i].id) : null).filter(Boolean);
  const res = new Response(JSON.stringify({ town, updated: new Date().toISOString(), items, errors }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + TTL } });
  if (cache) context.waitUntil(cache.put(key, res.clone()));
  return res;
}
