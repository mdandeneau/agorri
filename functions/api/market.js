// GET /api/market?town=<id>[&q=<words>] : items for sale near the town with local pickup, from eBay's public Browse API.
// eBay is the one big marketplace with a documented read API (https://developer.ebay.com/api-docs/buy/browse/overview.html).
// Craigslist, Facebook Marketplace and OfferUp publish none and forbid automated copying, so they are never fetched here.
// Needs two Cloudflare secrets: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (a free developer account at developer.ebay.com, "production" keyset).
// Without them the endpoint answers {configured:false, items:[]} and the page shows links instead.
// The search is pinned to the town's zip and radius from its market.json and to SELLER_ARRANGED_LOCAL_PICKUP, so only
// nearby pickup items come back. Cached 10 minutes per town and query at Cloudflare's edge.
const TTL = 600;
const MAX = 24;

async function appToken(env) {
  // Client-credentials grant; the token lasts ~2 hours. Cached in the Workers cache keyed on the client id.
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request('https://agorri.internal/ebay-token/' + env.EBAY_CLIENT_ID);
  if (cache) { const hit = await cache.match(key); if (hit) { const j = await hit.json(); if (j.access_token) return j.access_token; } }
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + btoa(env.EBAY_CLIENT_ID + ':' + env.EBAY_CLIENT_SECRET) },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope') });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  if (cache && j.access_token) await cache.put(key, new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + Math.max(60, Math.min(6600, (j.expires_in || 7200) - 600)) } }));
  return j.access_token;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const u = new URL(request.url);
  const want = (u.searchParams.get('town') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const q = (u.searchParams.get('q') || '').replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const json = (o, status = 200, ttl = TTL) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + ttl } });
  let t = null, m = null;
  try {
    const reg = await (await env.ASSETS.fetch(new URL('/towns.json', request.url))).json();
    t = (reg.towns || []).find(x => x.id === (want || reg.default));
    if (!t) return json({ error: 'unknown town' }, 404, 60);
    if (t.files && t.files.market) m = await (await env.ASSETS.fetch(new URL('/' + t.files.market.replace(/^\//, ''), request.url))).json();
  } catch (e) { return json({ error: 'registry' }, 500, 30); }
  if (!m || !m.zip) return json({ town: t.id, configured: false, items: [], why: 'no market file' });
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return json({ town: t.id, configured: false, items: [], why: 'no eBay keys' });

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(new URL('/api/market?town=' + t.id + '&q=' + encodeURIComponent(q), request.url).toString());
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }

  try {
    const token = await appToken(env);
    const radius = Math.max(5, Math.min(100, +m.radius || 25));
    // Filter names and syntax from eBay's Browse filter reference (ref-buy-browse-filters). All four pickup filters are
    // required together with deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}.
    const filter = `deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP},pickupCountry:US,pickupPostalCode:${m.zip},pickupRadius:${radius},pickupRadiusUnit:mi,buyingOptions:{FIXED_PRICE|AUCTION}`;
    const p = new URLSearchParams({ limit: String(MAX), sort: 'newlyListed', filter });
    if (q) p.set('q', q); else p.set('q', m.query || 'furniture tools bike kids snow');
    const r = await fetch('https://api.ebay.com/buy/browse/v1/item_summary/search?' + p.toString(), {
      headers: { authorization: 'Bearer ' + token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US,zip=' + m.zip } });
    if (!r.ok) return json({ town: t.id, configured: true, items: [], error: 'ebay ' + r.status }, 200, 120);
    const j = await r.json();
    const items = (j.itemSummaries || []).map(i => ({
      id: i.itemId, title: i.title, price: i.price ? { value: +i.price.value, currency: i.price.currency } : null,
      image: i.thumbnailImages && i.thumbnailImages[0] ? i.thumbnailImages[0].imageUrl : (i.image ? i.image.imageUrl : null),
      url: i.itemWebUrl, condition: i.condition || '', listed: i.itemCreationDate || null, ends: i.itemEndDate || null,
      town: i.itemLocation ? [i.itemLocation.city, i.itemLocation.stateOrProvince].filter(Boolean).join(', ') : '',
      distance: i.distance ? +i.distance.value : null, auction: (i.buyingOptions || []).includes('AUCTION') }));
    const res = json({ town: t.id, configured: true, zip: m.zip, radius, q: q || null, total: j.total || items.length, updated: new Date().toISOString(), items });
    if (cache) context.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return json({ town: t.id, configured: true, items: [], error: String(e.message).slice(0, 120) }, 200, 120);
  }
}
