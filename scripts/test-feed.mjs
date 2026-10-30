// Offline test of functions/api/feed.js with sample upstream responses. Run: node scripts/test-feed.mjs
import { onRequest, parseRSS, parseAtom, parseBluesky, parseLinks, parseX } from '../functions/api/feed.js';
const RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>City of Portsmouth</title>
<item><title>Water main break on South Street</title><link>https://www.portsmouthnh.gov/node/728878</link><description>&lt;p&gt;Expect delays &amp;amp; detours near &lt;b&gt;South St&lt;/b&gt;.&lt;/p&gt;</description><pubDate>Mon, 19 Oct 2026 16:59:42 +0000</pubDate></item>
<item><title><![CDATA[City of Portsmouth, NH DPW Launches Automated Collection Program]]></title><link>https://www.portsmouthnh.gov/city/news/x</link><description></description><pubDate>Thu, 22 Oct 2026 12:04:53 +0000</pubDate></item>
<item><title>Broken date</title><link>x</link><pubDate>not a date</pubDate></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>yt:video:abc</id><title>City Council Meeting 10/26/2026</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc&amp;t=1"/><published>2026-10-27T01:00:00+00:00</published></entry></feed>`;
const BSKY = { feed: [
  { post: { uri: 'at://did:plc:x/app.bsky.feed.post/3abc', author: { handle: 'shaheen.senate.gov' }, record: { text: 'Joined Seacoast leaders on PFAS at Pease.', createdAt: '2026-10-28T15:00:00Z' }, embed: { images: [{}, {}] } } },
  { reason: { $type: 'repost' }, post: { uri: 'at://x/y/z', author: {}, record: { text: 'repost', createdAt: '2026-10-28T16:00:00Z' } } } ] };
let ok = 0, bad = 0; const t = (name, cond) => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const src = { id: 'c', who: 'City of Portsmouth', platform: 'City website' };
const r = parseRSS(RSS, src);
t('rss: 2 valid items, bad date dropped', r.length === 2);
t('rss: html stripped and entities decoded', r[0].gist === 'Expect delays & detours near South St .');
t('rss: CDATA title', r[1].quote.startsWith('City of Portsmouth, NH DPW'));
t('rss: ISO date', r[0].when === '2026-10-19T16:59:42.000Z');
const a = parseAtom(ATOM, { id: 'y', who: 'City of Portsmouth', platform: 'YouTube' });
t('atom: link decoded', a[0].url === 'https://www.youtube.com/watch?v=abc&t=1');
const HOME = `<div><a href="https://www.nashuatelegraph.com/news/2026/10/27/fda-tips/"><img src="x.jpg"></a><h2><a href="https://www.nashuatelegraph.com/news/2026/10/27/fda-tips/">FDA offers Halloween safety tips</a></h2>
<h1><a href="/news/2026/10/28/church-fair/">St. Patrick Church Fair slated for Nov. 21</a></h1><a href="/news/2026/10/28/church-fair/">Read</a>
<h2><a href="/news/2026/10/22/real-estate-transactions-32/">Real Estate Transactions</a></h2><a href="/news/community-news/">Community News more</a>
<h2><a href="/sports/2026/10/28/game/">Big game recap for the weekend</a></h2><h2><a href="/news/2026/10/28/second-story/">Second story of the same day here</a></h2></div>`;
const L = parseLinks(HOME, { id: 'tel', who: 'The Telegraph', platform: 'News', url: 'https://www.nashuatelegraph.com/', match: '/news/(\\d{4})/(\\d{2})/(\\d{2})/[^/?#"]+/?$', skip: '^Real Estate Transactions' });
t('links: 3 stories, skip and non-matching links dropped', L.length === 3);
t('links: newest first, page order within a day', L[0].quote.startsWith('St. Patrick') && L[1].quote.startsWith('Second story') && L[2].quote.startsWith('FDA'));
t('links: relative URLs resolved, date from URL', L[0].url === 'https://www.nashuatelegraph.com/news/2026/10/28/church-fair/' && L[2].when.startsWith('2026-10-27'));
const b = parseBluesky(BSKY, { id: 's', who: 'Jeanne Shaheen', actor: 'shaheen.senate.gov', person: 'shaheen' });
t('bluesky: repost skipped', b.length === 1);
t('bluesky: post url + images', b[0].url === 'https://bsky.app/profile/shaheen.senate.gov/post/3abc' && b[0].images === 2);
// full handler with mocked network, routed per town through towns.json
const files = { '/towns.json': { default: 'portsmouth', towns: [
    { id: 'portsmouth', status: 'live', files: { feeds: 'data/portsmouth/feeds.json' } },
    { id: 'nashua', status: 'live', files: { feeds: 'data/nashua/feeds.json' } } ] },
  '/data/portsmouth/feeds.json': { sources: [
    { id: 'city-news', who: 'City of Portsmouth', platform: 'City website', type: 'rss', url: 'https://www.portsmouthnh.gov/rss.xml' },
    { id: 'city-youtube', who: 'City of Portsmouth', platform: 'YouTube', type: 'atom', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=x' },
    { id: 'shaheen', who: 'Jeanne Shaheen', platform: 'Bluesky', type: 'bluesky', actor: 'shaheen.senate.gov', person: 'shaheen' },
    { id: 'hassan', who: 'Maggie Hassan', platform: 'Bluesky', type: 'bluesky', actor: 'hassan.senate.gov', person: 'hassan' } ] },
  '/data/nashua/feeds.json': { sources: [
    { id: 'nashua-police', who: 'Nashua Police', platform: 'City website', type: 'rss', url: 'https://example.gov/police.rss', tag: 'safety' },
    { id: 'tel', who: 'The Telegraph', platform: 'News', type: 'links', url: 'https://www.nashuatelegraph.com/', match: '/news/(\\d{4})/(\\d{2})/(\\d{2})/[^/?#"]+/?$', tag: 'news' } ] } };
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('rss.xml') || u.includes('police.rss')) return new Response(RSS);
  if (u.includes('nashuatelegraph.com')) return new Response(HOME);
  if (u.includes('youtube.com')) return new Response(ATOM);
  if (u.includes('hassan')) return new Response('down', { status: 503 });
  if (u.includes('bsky.app')) return new Response(JSON.stringify(BSKY));
  throw new Error('unexpected ' + u);
};
const env = { ASSETS: { fetch: async (u) => { const p = new URL(u).pathname; return files[p] ? new Response(JSON.stringify(files[p])) : new Response('nf', { status: 404 }); } } };
const call = async (url, init) => onRequest({ request: new Request(url, init), env, waitUntil() {} });
const res = await call('https://agorri.com/api/feed');
const body = await res.json();
t('handler: default town, merged, newest first', body.town === 'portsmouth' && body.items.length === 4 && body.items[0].platform === 'Bluesky');
t('handler: failing source reported, others still served', body.errors.length === 1 && body.errors[0] === 'hassan');
t('handler: cache header', res.headers.get('cache-control') === 'public, max-age=60');
const n = await (await call('https://agorri.com/api/feed?town=nashua')).json();
t('handler: per-town feeds file', n.town === 'nashua' && n.items.length === 6 && n.items.filter(i => i.who === 'Nashua Police').length === 2);
t('handler: safety and news tags passed through', n.items.filter(i => i.tag === 'safety').length === 2 && n.items.filter(i => i.tag === 'news').length === 4);
t('handler: unknown town is 404', (await call('https://agorri.com/api/feed?town=atlantis')).status === 404);
const post = await call('https://agorri.com/api/feed', { method: 'POST' });
t('handler: rejects POST', post.status === 405);
const XITEMS = [
  { id: '1', text: 'Road closure on Main St tonight https://t.co/abc', createdAt: 'Wed Oct 29 18:00:00 +0000 2026', url: 'https://x.com/NashuaPolice/status/1', author: { userName: 'NashuaPolice' } },
  { id: '2', text: 'RT @someone: not ours', createdAt: 'Wed Oct 29 17:00:00 +0000 2026', author: { userName: 'NashuaPolice' } },
  { id: '3', text: '@resident thanks, we will look', createdAt: 'Wed Oct 29 16:00:00 +0000 2026', isReply: true, author: { userName: 'NashuaPolice' } },
  { id: '4', full_text: 'Other account', created_at: 'Wed Oct 29 15:00:00 +0000 2026', user: { screen_name: 'nashuafire' } },
];
const X = parseX(XITEMS, { id: 'x-police', who: 'Nashua Police', handle: '@NashuaPolice' });
t('x: own posts only, no replies or retweets', X.length === 1 && X[0].platform === 'X' && X[0].who === 'Nashua Police');
t('x: trailing t.co link trimmed, date parsed', X[0].quote === 'Road closure on Main St tonight' && X[0].when === '2026-10-29T18:00:00.000Z');
const XF = parseX(XITEMS, { id: 'x-fire', who: 'Nashua Fire', handle: 'NashuaFire' });
t('x: other field names and handle case work', XF.length === 1 && XF[0].url === 'https://x.com/nashuafire/status/4');
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
