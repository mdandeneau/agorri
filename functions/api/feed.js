// GET /api/feed : merges the official sources in /feeds.json into one feed.
// Cached for 5 minutes at Cloudflare's edge so upstream sites see at most ~12 requests an hour.
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
  return src.type === 'atom' ? parseAtom(xml, src) : parseRSS(xml, src);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(new URL('/api/feed', request.url).toString());
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const cfg = await (await env.ASSETS.fetch(new URL('/feeds.json', request.url))).json();
  const results = await Promise.allSettled((cfg.sources || []).map(fetchSource));
  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []).sort((a, b) => b.when.localeCompare(a.when)).slice(0, 80);
  const errors = results.map((r, i) => r.status === 'rejected' ? (cfg.sources[i].id) : null).filter(Boolean);
  const res = new Response(JSON.stringify({ updated: new Date().toISOString(), items, errors }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + TTL } });
  if (cache) context.waitUntil(cache.put(key, res.clone()));
  return res;
}
