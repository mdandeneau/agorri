// Platform scanner: for every town in ingest/regions.json, finds the town website, works out which platform it runs on
// (CivicPlus, CivicClerk, Granicus/Legistar, Virtual Town Hall, Drupal, WordPress, ...), and lists its feeds and its
// agenda and minutes pages. Writes ingest/platforms.json. Run occasionally (it is not part of the daily fetch).
// Run: node ingest/scan.mjs [town-id ...]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'ingest/regions.json'), 'utf8'));
const OUT = path.join(ROOT, 'ingest/platforms.json');
const UA = 'AgorriBot/1.0 (+https://agorri.com; nonpartisan civic information; contact marcdandeneau@gmail.com)';

async function get(url, ms = 20000) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    const type = r.headers.get('content-type') || '';
    const text = /html|xml|json|text/i.test(type) ? (await r.text()).slice(0, 2e6) : '';
    return { ok: r.ok, status: r.status, url: r.url, type, text };
  } catch (e) { return { ok: false, status: 0, error: String(e.cause?.code || e.message).slice(0, 120) }; }
}

const slugs = t => {
  const base = t.name.toLowerCase().replace(/['.]/g, '');
  return [...new Set([base.replace(/\s+/g, ''), base.replace(/\s+/g, '-')])];
};
function candidates(t) {
  const out = [...(t.sites || [])];
  for (const s of slugs(t)) out.push(`www.${s}nh.gov`, `${s}nh.gov`, `www.${s}nh.org`, `www.${s}-nh.gov`, `www.${s}-nh.org`, `www.${s}nh.us`, `www.${s}.nh.gov`, `www.town.${s}.nh.us`, `www.ci.${s}.nh.us`, `www.townof${s}nh.gov`, `www.townof${s}nh.org`, `www.${s}nh.com`);
  return [...new Set(out)];
}

const has = (html, re) => re.test(html);
function fingerprint(html, url) {
  const p = [];
  if (has(html, /CivicPlus|civicplus\.com|\/CivicAlerts\.aspx|\/AgendaCenter|\/DocumentCenter/i)) p.push('civicplus');
  if (has(html, /civicclerk\.com/i)) p.push('civicclerk');
  if (has(html, /legistar\.com/i)) p.push('legistar');
  if (has(html, /granicus\.com/i)) p.push('granicus');
  if (has(html, /virtualtownhall|vthweb|Virtual Towns? (&|and|&amp;) Schools|vt-hall/i)) p.push('virtual-town-hall');
  if (has(html, /revize/i)) p.push('revize');
  if (has(html, /municode|meetings\.municode/i)) p.push('municode');
  if (has(html, /boarddocs\.com/i)) p.push('boarddocs');
  if (has(html, /primegov/i)) p.push('primegov');
  if (has(html, /novusagenda/i)) p.push('novusagenda');
  if (has(html, /govaccess|visioninternet/i)) p.push('granicus-govaccess');
  if (has(html, /<meta[^>]+generator[^>]+Drupal|\/sites\/default\/files\/|drupal-settings-json/i)) p.push('drupal');
  if (has(html, /wp-content|wp-includes/i)) p.push('wordpress');
  if (has(html, /squarespace/i)) p.push('squarespace');
  if (has(html, /wix\.com|wixstatic/i)) p.push('wix');
  if (has(html, /drive\.google\.com|docs\.google\.com/i)) p.push('google-drive-links');
  return p;
}
const abs = (u, base) => { try { return new URL(u.replace(/&amp;/g, '&'), base).toString(); } catch { return null; } };
function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = abs(m[1], base); if (!u) continue;
    out.push({ url: u, text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) });
  }
  return out;
}
function feeds(html, base) {
  const f = new Set();
  for (const m of html.matchAll(/<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]*>/gi)) { const h = (m[0].match(/href=["']([^"']+)["']/i) || [])[1]; if (h) f.add(abs(h, base)); }
  for (const l of links(html, base)) if (/\/(rss|feed)(\.xml|\.aspx)?(\/|\?|$)|RSSFeed\.aspx|\/feed\/?$/i.test(l.url)) f.add(l.url);
  return [...f].filter(Boolean).slice(0, 15);
}

async function scanTown(t) {
  const res = { id: t.id, name: t.name, population2020: t.population2020 };
  // 1. Find the site: the first candidate that answers with an HTML page naming the town.
  const nameRe = new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]?"), 'i');
  const tried = [];
  for (const host of candidates(t)) {
    const r = await get('https://' + host + '/', 15000);
    tried.push(host + ' ' + (r.status || r.error));
    const finalHost = r.url ? new URL(r.url).host : '';
    const hostOk = slugs(t).some(s => finalHost.replace(/-/g, '').includes(s.replace(/-/g, '').slice(0, 6))) || (t.sites || []).some(h => finalHost.endsWith(h.replace(/^www\./, '')));
    const parked = /namesilo|godaddy|domain (is )?for sale|buy this domain|beangroup|sedo\.com|parked/i.test(r.text || '');
    if (r.ok && hostOk && !parked && /html/i.test(r.type) && nameRe.test(r.text) && /New Hampshire|\bNH\b|N\.H\./.test(r.text)) { res.site = new URL(r.url).origin + '/'; res.home = r; break; }
  }
  if (!res.site) { res.error = 'no website found'; res.tried = tried; return res; }
  const html = res.home.text; delete res.home;
  res.platforms = fingerprint(html, res.site);
  res.feeds = feeds(html, res.site);
  const L = links(html, res.site);
  const pick = re => [...new Map(L.filter(l => re.test(l.url + ' ' + l.text)).map(l => [l.url, l])).values()].slice(0, 12);
  res.meetingPages = pick(/agenda|minutes|meetings?\b|boards?(-|\s|%20)?(and|&|&amp;)?(-|\s)?committees?|selectmen|select(-|\s)?board|council|aldermen/i).map(l => ({ text: l.text, url: l.url }));
  res.external = [...new Set(L.map(l => l.url).filter(u => /civicclerk|granicus|legistar|boarddocs|municode|primegov|novusagenda|drive\.google|facebook\.com|youtube\.com/i.test(u)).map(u => u.replace(/(\?|#).*$/, '')))].slice(0, 15);
  // 2. Platform probes.
  // CivicPlus sometimes serves its agenda center from a second host (nh-town.civicplus.com).
  const cpHost = (L.find(l => /^https?:\/\/[a-z0-9-]+\.civicplus\.com\//i.test(l.url)) || {}).url;
  if (cpHost) res.civicplusHost = new URL(cpHost).origin + '/';
  if (res.platforms.includes('civicplus')) {
    const r = await get(res.site + 'rss.aspx');
    if (r.ok) { res.civicplusFeeds = [...new Set([...r.text.matchAll(/href=["']([^"']*RSSFeed\.aspx\?[^"']+)["']/gi)].map(m => abs(m[1], res.site)))].filter(u => /CID=All/i.test(u)); }
    for (const base of [res.site, res.civicplusHost].filter(Boolean)) {
      const a = await get(base + 'AgendaCenter');
      if (a.ok && /AgendaCenter\/ViewFile/i.test(a.text)) { res.agendaCenter = base + 'AgendaCenter'; break; }
    }
  }
  const ccFromLinks = [...new Set(L.map(l => (l.url.match(/https?:\/\/([a-z0-9-]+)\.portal\.civicclerk\.com/i) || [])[1]).filter(Boolean))];
  for (const tenant of [...ccFromLinks, ...slugs(t).map(s => s.replace(/-/g, '') + 'nh'), ...slugs(t).map(s => s.replace(/-/g, ''))]) {
    const r = await get(`https://${tenant}.api.civicclerk.com/v1/Events?$top=1`, 12000);
    if (r.ok && /"value"/.test(r.text)) { res.civicclerk = tenant; if (!res.platforms.includes('civicclerk')) res.platforms.push('civicclerk'); break; }
  }
  const gr = (L.find(l => /granicus\.com\/ViewPublisher/i.test(l.url)) || {}).url; if (gr) res.granicus = gr;
  const lg = (L.find(l => /legistar\.com/i.test(l.url)) || {}).url;
  if (lg) { res.legistar = lg; const client = (lg.match(/https?:\/\/([a-z0-9-]+)\.legistar\.com/i) || [])[1]; if (client) { const r = await get(`https://webapi.legistar.com/v1/${client}/bodies`); res.legistarApi = r.ok ? client : null; } }
  // 3. Follow up to three meeting pages to see how agendas and minutes are posted (PDF links, Google Drive, a platform).
  res.meetingDocs = [];
  for (const mp of res.meetingPages.filter(m => m.url.startsWith(res.site)).slice(0, 3)) {
    const r = await get(mp.url); if (!r.ok) continue;
    const ml = links(r.text, mp.url);
    const pdfs = ml.filter(l => /\.pdf(\?|$)|DocumentCenter\/View|AgendaCenter\/ViewFile|GetMeetingFileStream|\/files\/|drive\.google/i.test(l.url) && /agenda|minute/i.test(l.url + ' ' + l.text));
    res.meetingDocs.push({ page: mp.url, docLinks: pdfs.length, sample: pdfs.slice(0, 3).map(l => l.url), drive: ml.some(l => /drive\.google/i.test(l.url)), platforms: fingerprint(r.text, mp.url) });
  }
  // 4. A one-line verdict for the fetcher.
  res.fetch = res.civicclerk ? 'civicclerk api' : res.legistarApi ? 'legistar api' : res.civicplusFeeds?.length ? 'civicplus feeds' + (res.agendaCenter ? ' + agenda center' : '') : res.agendaCenter ? 'agenda center' :
    res.meetingDocs.some(m => m.docLinks > 0) ? 'meeting page links' : res.feeds.length ? 'rss only' : res.meetingDocs.some(m => m.drive) ? 'google drive (hard)' : 'manual';
  return res;
}

const want = process.argv.slice(2);
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { towns: {} };
const towns = REG.regions.flatMap(r => r.towns.map(t => ({ ...t, region: r.id }))).filter(t => !want.length || want.includes(t.id));
const results = {};
const queue = [...towns];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) { const t = queue.shift(); const r = await scanTown(t); r.region = t.region; results[t.id] = r; console.log(`${t.id}: ${r.site || r.error} | ${(r.platforms || []).join(',')} | fetch: ${r.fetch || '-'}`); } }));
const out = { note: 'Written by ingest/scan.mjs. One entry per town in ingest/regions.json: its website, detected platforms, feeds, meeting pages, and `fetch` (how the daily fetcher can read it). Re-run when a town changes websites.', scanned: new Date().toISOString(), towns: { ...prev.towns, ...results } };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
const tally = {}; for (const r of Object.values(out.towns)) tally[r.fetch || 'error'] = (tally[r.fetch || 'error'] || 0) + 1;
console.log('SUMMARY', JSON.stringify(tally));
