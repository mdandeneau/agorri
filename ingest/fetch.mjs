// Daily source fetcher. Checks each town's official sources (ingest/sources.json) and records what it finds in
// inbox/<town>/items.json, plus the text of new agendas and minutes in inbox/<town>/docs/. The daily refresh reads
// these files instead of fetching the web itself. No AI here: it only notices what is new.
// Run: node ingest/fetch.mjs [town ...]   (needs `pdftotext` from poppler-utils for PDF agendas and minutes)
// Polite by design: identifies itself, waits 1.5 s between requests to the same host, and never re-downloads a saved document.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'ingest/sources.json'), 'utf8'));
const UA = 'AgorriBot/1.0 (+https://agorri.com; nonpartisan civic information; contact marcdandeneau@gmail.com)';
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const KEEP_DAYS = 45;          // drop items not seen for this long
const MAX_NEW_DOCS = 30;       // per town per run
const MAX_DOC_BYTES = 20e6;
const DEBUG = !!process.env.INGEST_DEBUG;

// ---------- fetching ----------
const lastHit = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, { as = 'text', method = 'GET', body, headers = {} } = {}) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + 1500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  let err;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { method, body, headers: { 'user-agent': UA, accept: '*/*', ...headers }, signal: AbortSignal.timeout(45000), redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (as === 'json') return await r.json();
      if (as === 'buffer') { const b = Buffer.from(await r.arrayBuffer()); if (b.length > MAX_DOC_BYTES) throw new Error('too large'); return { buf: b, type: r.headers.get('content-type') || '' }; }
      return await r.text();
    } catch (e) { err = e; await sleep(3000); }
  }
  throw new Error(`${url}: ${err.message}`);
}

// ---------- parsing helpers ----------
const decode = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const strip = s => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (b, n) => { const m = b.match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i')); return m ? m[1] : ''; };
const day = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const abs = (u, base) => { try { return new URL(decode(u).trim(), base).toString(); } catch { return null; } };

function parseRSS(xml) {
  return [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi)].map(m => {
    const b = m[0];
    const link = strip(tag(b, 'link')) || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    return { title: strip(tag(b, 'title')), url: decode(link).trim(), date: day(strip(tag(b, 'pubDate')) || strip(tag(b, 'published')) || strip(tag(b, 'updated')) || strip(tag(b, 'dc:date'))),
      detail: strip(tag(b, 'description') || tag(b, 'summary')).slice(0, 600) };
  }).filter(x => x.title && x.url);
}

function parseLinks(html, base, match) {
  const re = new RegExp(match, 'i'), out = new Map();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = abs(m[1], base); if (!url || !re.test(url)) continue;
    let title = strip(m[2]);
    if (!title || /^(agenda|minutes|packet|view|download|here|more info)$/i.test(title)) title = (title ? title + ': ' : '') + decodeURIComponent(url.split('/').pop().replace(/\+/g, ' '));
    if (!out.has(url) || title.length > out.get(url).title.length) out.set(url, { title, url });
  }
  return [...out.values()];
}

// A meeting date from a file name or title: 11-04-26, 11-3-2026, 2026.11.05, November 5, 2026, 10132026.
const MONTHS = 'january february march april may june july august september october november december'.split(' ');
function dateIn(s) {
  s = decodeURIComponent(String(s)).replace(/\+/g, ' ');
  let m = s.match(/(20\d\d)[.\-_](\d{1,2})[.\-_](\d{1,2})/); if (m) return iso3(m[1], m[2], m[3]);
  m = s.match(/(?<!\d)(\d{1,2})\.(\d{1,2})(?:-\d{1,2}(?:\.\d{1,2})?)?\.(20\d\d)(?!\d)/); if (m) return iso3(m[3], m[1], m[2]); // 4.3-6.2025, 7.31-8.5.2024
  m = s.match(/(?<!\d)(\d{1,2})[.\-_](\d{1,2})[.\-_](20\d\d|\d\d)(?!\d)/); if (m) return iso3(m[3].length === 2 ? '20' + m[3] : m[3], m[1], m[2]);
  m = s.match(new RegExp('\\b(' + MONTHS.join('|') + ')\\s+(\\d{1,2}),?\\s+(20\\d\\d)', 'i')); if (m) return iso3(m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, m[2]);
  m = s.match(/\b(\d{2})(\d{2})(20\d\d)\b/); if (m) return iso3(m[3], m[1], m[2]);
  // "October 28-29" in a file stored under /files/2026-10/: the year comes from the folder.
  m = s.match(new RegExp('\\b(' + MONTHS.join('|') + ')\\s+(\\d{1,2})\\b', 'i')); const y = s.match(/\/(20\d\d)-\d\d\//);
  if (m && y) return iso3(y[1], MONTHS.indexOf(m[1].toLowerCase()) + 1, m[2]);
  return null;
}
function iso3(y, mo, d) { mo = +mo; d = +d; if (mo < 1 || mo > 12 || d < 1 || d > 31) return null; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

// Agendas and minutes are worth saving as text; packets, staff reports and attachments are too big and too noisy.
const fileName = u => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()).replace(/\+/g, ' '); } catch { return String(u); } };
const isPacket = s => /packet|pkt|staff\s*report|attachment|backup|\.lnk$|presentation|plans?\b|affidavit/i.test(decodeURIComponent(s));
const docKind = s => /minute/i.test(decodeURIComponent(s)) ? 'minutes' : /agenda|_ag[_.]|\bag\b/i.test(decodeURIComponent(s)) ? 'agenda' : /legal\s*notice|_ln[_.]/i.test(decodeURIComponent(s)) ? 'legal notice' : null;

// ---------- source readers ----------
const readers = {
  async rss(src) { return parseRSS(await get(src.url)).slice(0, src.max || 30); },

  async links(src) {
    const pages = src.pages || [src.url], all = new Map();
    for (const p of pages) {
      let html; try { html = await get(p); } catch (e) { if (p === pages[0]) throw e; continue; }
      for (const l of parseLinks(html, p, src.match)) if (!all.has(l.url)) all.set(l.url, { ...l, page: p });
    }
    if (DEBUG) console.log(`  [debug] ${src.id}: ${all.size} matching links`);
    if (DEBUG && !all.size) { const html = await get(pages[0]); console.log(`  [debug] ${src.id}: page ${html.length} bytes, sample links:`, [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]).filter(h => /minute|agenda|document|files\.|\.pdf/i.test(h)).slice(0, 25)); }
    return [...all.values()].slice(0, src.max || 40).map(l => ({ title: l.title, url: l.url, date: dateIn(l.url) || dateIn(l.title), doc: docKind(fileName(l.url) + ' ' + l.title), packet: isPacket(fileName(l.url) + ' ' + l.title) }));
  },

  // CivicPlus: /rss.aspx lists every feed on the site (news, calendar, alerts, agendas, bids...). Read each "All" feed.
  async civicplus(src) {
    const page = await get(new URL('rss.aspx', src.base).toString());
    const feeds = new Map();
    for (const m of page.matchAll(/href=["']([^"']*RSSFeed\.aspx\?[^"']+)["']/gi)) {
      const u = abs(m[1], src.base); const mod = (u.match(/ModID=(\d+)/i) || [])[1];
      if (!u || !mod) continue;
      const isAll = /CID=All/i.test(u);
      if (!feeds.has(mod) || (isAll && !/CID=All/i.test(feeds.get(mod)))) feeds.set(mod, u);
    }
    if (DEBUG) console.log(`  [debug] ${src.id}: feeds`, [...feeds.values()]);
    const MOD = { 1: 'news', 51: 'blog', 53: 'faq', 58: 'calendar', 63: 'alert', 64: 'jobs', 65: 'agenda', 66: 'bid', 76: 'job', 92: 'news' };
    const out = [];
    for (const [mod, u] of feeds) {
      if (['64', '76', '53'].includes(mod)) continue; // jobs, FAQs
      try { for (const it of parseRSS(await get(u)).slice(0, 25)) out.push({ ...it, feed: MOD[mod] || 'module ' + mod }); }
      catch (e) { console.log(`  ${src.id}: feed ModID=${mod} failed (${e.message})`); }
    }
    return out;
  },

  // CivicPlus Document Center folders load by script; this is the request the page itself makes.
  async 'civicplus-docs'(src) {
    const url = new URL('Admin/DocumentCenter/Home/Document_AjaxBinding?renderMode=0&loadSource=7', src.base).toString();
    const body = new URLSearchParams({ folderId: String(src.folder), getDocuments: '1', imageRepo: 'false', renderMode: '0', loadSource: '7', requestingModuleID: '75', searchString: '', pageNumber: '1', rowsPerPage: '500', sortColumn: 'DisplayName', sortOrder: '0' });
    const j = await get(url, { as: 'json', method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' } });
    const rows = j.Data || j.data || (j.Documents) || [];
    if (DEBUG && rows[0]) { const r = rows[0]; console.log(`  [debug] ${src.id}: ${rows.length} rows; date fields`, { CreatedDate: r.CreatedDate, FileUploadedDate: r.FileUploadedDate, LastModifiedDate: r.LastModifiedDate, LastModifiedDateString: r.LastModifiedDateString, StartDate: r.StartDate }); }
    // Newest first by document id (ids only grow), then keep the newest few.
    rows.sort((a, b) => (b.ID || 0) - (a.ID || 0));
    return rows.slice(0, src.max || 15).map(r => {
      const id = r.ID || r.DocumentID || r.Id;
      // Link by id only: the readable part of a Document Center URL repeats the title, which can name people.
      const u = id ? `DocumentCenter/View/${id}` : (r.URL || '');
      const when = r.FileUploadedDate || r.CreatedDate || r.LastModifiedDate || r.LastModifiedDateString || r.StartDate || '';
      const ms = String(when).match(/\/Date\((\d+)/);
      const title = strip(r.DisplayName || r.Name || r.FileName || '');
      return { title, url: abs(u, src.base), date: dateIn(title) || (ms ? day(+ms[1]) : day(when)) };
    }).filter(x => x.title && x.url);
  },

  // CivicClerk: public read-only API with every meeting and its published files.
  async civicclerk(src, ctx) {
    const api = `https://${src.tenant}.api.civicclerk.com/v1/`;
    const from = new Date(NOW - (src.back || 21) * 864e5).toISOString().slice(0, 10);
    const to = new Date(+NOW + (src.ahead || 21) * 864e5).toISOString().slice(0, 10);
    const q = `Events?$filter=startDateTime ge ${from}T00:00:00Z and startDateTime le ${to}T23:59:59Z&$orderby=startDateTime desc&$top=200`;
    let next = api + q.replace(/ /g, '%20'), events = [], pages = 0;
    while (next && pages++ < 10) {
      const j = await get(next, { as: 'json' });
      if (DEBUG && pages === 1) console.log(`  [debug] ${src.id}: response keys`, Object.keys(j));
      events.push(...(j.value || j.Value || (Array.isArray(j) ? j : [])));
      next = j['@odata.nextLink'] || j['odata.nextLink'] || null;
    }
    if (DEBUG && events[0]) console.log(`  [debug] ${src.id}: event keys`, Object.keys(events[0]), 'file keys', (events.find(e => (e.publishedFiles || []).length) || {}).publishedFiles?.[0]);
    const out = [];
    for (const e of events) {
      const body = e.categoryName || e.eventCategoryName || '';
      const when = day(e.startDateTime || e.eventDate);
      const files = e.publishedFiles || e.PublishedFiles || [];
      out.push({ title: `${body}${body && e.eventName && e.eventName !== body ? ': ' : ''}${e.eventName && e.eventName !== body ? e.eventName : ''}`.trim() || 'Meeting', url: `https://${src.tenant}.portal.civicclerk.com/event/${e.id}/overview`, date: when, body, meeting: true, files: files.length });
      for (const f of files) {
        const fid = f.fileId || f.id; if (!fid) continue;
        const ftype = String(f.type || f.fileType || f.name || '');
        out.push({ title: `${body} ${when}: ${f.name || ftype}`.trim(), url: `${api}Meetings/GetMeetingFileStream(fileId=${fid},plainText=false)`, textUrl: `${api}Meetings/GetMeetingFileStream(fileId=${fid},plainText=true)`,
          date: when, body, doc: docKind(ftype + ' ' + (f.name || '')), packet: isPacket(ftype + ' ' + (f.name || '')), fileId: fid });
      }
    }
    return out;
  },
};

// ---------- police and fire: no names ----------
// Police and fire titles often name the person arrested or involved, and inbox/ is public. So a safety title is kept
// only when it is clearly about a program, meeting or event; otherwise it becomes a generic label plus the offense words
// it mentions (theft, assault...). The detail text is never kept. Open the source link to write the item, without names.
const SAFE_TITLE = /^(?!.*\b(arrest|charged|suspect|wanted|missing|death|died|killed|victim|injur|accused|indict)).*\b(coffee with a cop|night out|commission|remembrance|ceremony|exercise|survey|accreditation|program|meeting|regulations|task force|open house|recruit|hiring|safety tips?|burn permits?|drill|training|awards?|code cycle|fire prevention|road closure|parking|parade|event|seminar|academy|drug take ?back|take back)\b/i;
const OFFENSES = ['criminal threatening', 'reckless conduct', 'robbery', 'burglary', 'theft', 'shoplifting', 'assault', 'domestic violence', 'stalking', 'arson', 'fraud', 'forgery', 'drug', 'fentanyl', 'dui', 'dwi', 'impaired driving', 'crash', 'accident', 'hit and run', 'shooting', 'stabbing', 'homicide', 'trespass', 'vandalism', 'criminal mischief', 'weapons', 'firearm', 'fire', 'missing'];
function safeTitle(title, src) {
  if (SAFE_TITLE.test(title)) return title;
  const low = ' ' + title.toLowerCase().replace(/[_-]+/g, ' ').replace(/\bdv\b/g, 'domestic violence') + ' ';
  const hits = OFFENSES.filter(o => low.includes(' ' + o)).filter((o, i, a) => !a.some(b => b !== o && b.includes(o)));
  const what = /log/i.test(src.id) ? 'Log' : /release/i.test(src.id) ? 'Press release' : 'News item';
  return `${what} (title withheld: may name people)${hits.length ? ': ' + hits.join(', ') : ''}`;
}

// ---------- documents ----------
function pdfToText(buf) {
  const tmp = path.join(process.env.RUNNER_TEMP || '/tmp', 'agorri-' + crypto.randomUUID() + '.pdf');
  fs.writeFileSync(tmp, buf);
  try { return execFileSync('pdftotext', ['-layout', '-q', tmp, '-'], { maxBuffer: 64e6 }).toString('utf8'); }
  finally { fs.rmSync(tmp, { force: true }); }
}
async function saveDoc(town, item, ctx) {
  const dir = path.join(ROOT, 'inbox', town, 'docs');
  const name = (item.fileId ? 'cc-' + item.fileId : hash(item.url)) + '.txt';
  const file = path.join(dir, name);
  if (fs.existsSync(file)) return 'inbox/' + town + '/docs/' + name;
  if (ctx.newDocs >= MAX_NEW_DOCS) return null;
  let text = '';
  if (item.textUrl) {
    text = await get(item.textUrl);
    if (/^\s*[{[]/.test(text)) { try { const j = JSON.parse(text); text = j.text || j.Text || j.content || text; } catch {} }
  }
  if (!text || text.trim().length < 200) {
    const { buf, type } = await get(item.url, { as: 'buffer' });
    if (/pdf/i.test(type) || buf.slice(0, 5).toString() === '%PDF-') text = pdfToText(buf);
    else if (/html|text/i.test(type)) text = strip(buf.toString('utf8'));
    else return null;
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (text.length < 100) { ctx.notes.push(`no text in ${item.url} (scanned image?)`); return null; }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `Source: ${item.url}\nTitle: ${item.title}\nFetched: ${TODAY}\n\n${text}\n`);
  ctx.newDocs++;
  return 'inbox/' + town + '/docs/' + name;
}

// ---------- main ----------
async function runTown(town, sources) {
  const file = path.join(ROOT, 'inbox', town, 'items.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { items: [] };
  const byKey = new Map((prev.items || []).map(i => [i.key, i]));
  const ctx = { newDocs: 0, notes: [] };
  const status = {};
  let added = 0;
  for (const src of sources) {
    const t0 = Date.now();
    try {
      const found = await readers[src.type](src, ctx);
      let fresh = 0;
      for (const it of found) {
        const key = src.id + ':' + hash(it.url);
        const old = byKey.get(key);
        const safety = src.kind === 'safety' || src.kind === 'police-log';
        const title = safety && !(src.kind === 'police-log' && /^(arrest log|police log|media log)?\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?)?[\s\d.,\-\/]*$/i.test(it.title)) ? safeTitle(it.title, src) : it.title;
        const rec = { key, source: src.id, kind: src.kind, ...(it.feed ? { feed: it.feed } : {}), title, url: it.url, date: it.date || null,
          ...(it.detail && !safety ? { detail: it.detail } : {}), ...(it.body ? { body: it.body } : {}), ...(it.doc ? { doc: it.doc } : {}), ...(it.packet ? { packet: true } : {}),
          ...(it.meeting ? { meeting: true, files: it.files } : {}),
          firstSeen: old ? old.firstSeen : TODAY, lastSeen: TODAY, ...(old && old.text ? { text: old.text } : {}) };
        if (src.docs && it.doc && !it.packet && src.text !== false && !rec.text) {
          try { const t = await saveDoc(town, { ...it, title: it.title }, ctx); if (t) rec.text = t; }
          catch (e) { ctx.notes.push(`could not save ${it.url}: ${e.message}`); }
        }
        if (!old) { fresh++; added++; }
        byKey.set(key, rec);
      }
      status[src.id] = { ok: true, found: found.length, new: fresh, checked: NOW.toISOString(), ms: Date.now() - t0 };
      console.log(`${town}/${src.id}: ${found.length} found, ${fresh} new`);
    } catch (e) {
      status[src.id] = { ok: false, error: String(e.message).slice(0, 300), checked: NOW.toISOString(), lastOk: prev.sources?.[src.id]?.ok ? prev.sources[src.id].checked : prev.sources?.[src.id]?.lastOk || null };
      console.log(`${town}/${src.id}: FAILED ${e.message}`);
    }
  }
  // Keep items seen recently. A source that failed today keeps its old items (never drop data because a fetch failed).
  const cutoff = new Date(NOW - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const items = [...byKey.values()].filter(i => i.lastSeen >= cutoff || status[i.source]?.ok === false)
    .sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '') || (b.date || '').localeCompare(a.date || ''));
  const out = {
    note: 'Written by ingest/fetch.mjs. Each item: where it came from (source, url), the date in the document when known, firstSeen (the day the fetcher first saw it; new since the last refresh = firstSeen on or after that day) and text (the saved agenda or minutes text, when there is one). Facts for the site still come from reading the linked document.',
    town, updated: NOW.toISOString(), sources: status, notes: ctx.notes, items };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  console.log(`${town}: ${added} new items, ${ctx.newDocs} new documents saved${ctx.notes.length ? '; notes: ' + ctx.notes.length : ''}`);
  return { town, added, docs: ctx.newDocs, failed: Object.entries(status).filter(([, s]) => !s.ok).map(([k]) => k) };
}

const want = process.argv.slice(2);
const results = [];
for (const [town, sources] of Object.entries(CFG.towns)) if (!want.length || want.includes(town)) results.push(await runTown(town, sources));
const summary = results.map(r => `${r.town} ${r.added} new${r.docs ? ', ' + r.docs + ' docs' : ''}${r.failed.length ? ', failed: ' + r.failed.join(' ') : ''}`).join('; ');
fs.writeFileSync(path.join(ROOT, 'inbox', 'last-run.txt'), summary + '\n');
console.log('SUMMARY ' + summary);
