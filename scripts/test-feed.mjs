// Offline test of functions/api/feed.js with sample upstream responses. Run: node scripts/test-feed.mjs
import { onRequest, parseRSS, parseAtom, parseBluesky } from '../functions/api/feed.js';
import fs from 'node:fs';
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
const b = parseBluesky(BSKY, { id: 's', who: 'Jeanne Shaheen', actor: 'shaheen.senate.gov', person: 'shaheen' });
t('bluesky: repost skipped', b.length === 1);
t('bluesky: post url + images', b[0].url === 'https://bsky.app/profile/shaheen.senate.gov/post/3abc' && b[0].images === 2);
// full handler with mocked network
const cfg = JSON.parse(fs.readFileSync(new URL('../feeds.json', import.meta.url)));
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('rss.xml')) return new Response(RSS);
  if (u.includes('youtube.com')) return new Response(ATOM);
  if (u.includes('hassan')) return new Response('down', { status: 503 });
  if (u.includes('bsky.app')) return new Response(JSON.stringify(BSKY));
  throw new Error('unexpected ' + u);
};
const env = { ASSETS: { fetch: async () => new Response(JSON.stringify(cfg)) } };
const res = await onRequest({ request: new Request('https://agorri.com/api/feed'), env, waitUntil() {} });
const body = await res.json();
t('handler: merged, newest first', body.items.length === 4 && body.items[0].platform === 'Bluesky');
t('handler: failing source reported, others still served', body.errors.length === 1 && body.errors[0] === 'hassan');
t('handler: cache header', res.headers.get('cache-control') === 'public, max-age=300');
const post = await onRequest({ request: new Request('https://agorri.com/api/feed', { method: 'POST' }), env, waitUntil() {} });
t('handler: rejects POST', post.status === 405);
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
