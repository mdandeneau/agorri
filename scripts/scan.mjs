// Renders every page of every live town in a headless browser and fails on anything a resident would see as broken:
// a JavaScript error, leaked code or placeholders in the text (undefined, NaN, [object Object], ${...}), a link to a
// page that does not exist, a page that came out nearly empty, or a page that says "the city" for a town.
// Also compares Home's numbers to the tab pages (events count, upcoming sales). Run: node scripts/scan.mjs [--quiet]
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium). CI runs it on every push.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8800 + Math.floor(Math.random() * 100);
const QUIET = process.argv.includes('--quiet');
const ROUTES = ['home', 'local', 'business', 'market', 'parks', 'schools', 'sports', 'issues', 'talk', 'ideas', 'safety', 'election', 'housing', 'budget', 'officials', 'beyond', 'record', 'around', 'town', 'events', 'faith', 'lookup', 'unsure', 'social', 'staff', 'mod'];
const HANDLED = /^(issue-.+|official-.+|meeting-.+|bmeeting-.+|person-.+|talk-.+|candidate-.+|issues|ideas|around|lookup|budget|officials|record|beyond|town|safety|safety-log|safety-latest|local|events|social|business|market|parks|schools|sports|faith|unsure|housing|election|vote|candidates|neighbors|talk|mod|friends|staff|home|home-classic|home-v39|home-v40)$/;

const srv = http.createServer((req, res) => {
  let u = req.url.split('?')[0];
  if (u.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); return res.end('{"items":[]}'); }
  if (u === '/' || !u.includes('.')) u = '/index.html';
  const f = path.join(ROOT, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', u.endsWith('.json') ? 'application/json' : u.endsWith('.html') ? 'text/html' : 'application/octet-stream');
  res.end(fs.readFileSync(f));
});

const towns = JSON.parse(fs.readFileSync(path.join(ROOT, 'towns.json'), 'utf8')).towns.filter(t => t.status === 'live');
const problems = [], notes = [];
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(`http://localhost:${PORT}/#home`);
await page.waitForTimeout(1200);
if (pageErrors.length) problems.push('load: ' + pageErrors.join(' | '));

for (const t of towns) {
  const units = t.subtowns ? [null, ...t.subtowns.map(x => x.id).slice(0, 2)] : [null];
  for (const sub of units) {
    pageErrors.length = 0;
    await page.evaluate(async ({ id, sub }) => { await switchTown(id, true); if (sub !== null && typeof switchSub === 'function') await switchSub(sub); }, { id: t.id, sub });
    await page.waitForTimeout(900);
    const label = t.id + (sub ? ':' + sub : '');
    const isTown = t.kind === 'Town' || !!t.subtowns;
    for (const r of ROUTES) {
      pageErrors.length = 0;
      await page.evaluate(h => { location.hash = '#' + h; route(); }, r);
      await page.waitForTimeout(120);
      const info = await page.evaluate(({ isTown }) => {
        const app = document.getElementById('app'); const txt = app.innerText; const tips = [...app.querySelectorAll('[data-tip]')].map(e => e.getAttribute('data-tip')).join(' ');
        const all = txt + ' ' + tips; const bad = [];
        for (const w of ['undefined', 'NaN', '[object Object]', 'Invalid Date', '${', 'null ·', '· null']) if (all.includes(w)) bad.push(w);
        if (/—/.test(all)) bad.push('em dash');
        if (isTown) { const m = all.match(/[^.\n]*\b(the city|City Hall|city's)\b[^.\n]*/i); if (m) bad.push('says city for a town: "' + m[0].trim().slice(0, 80) + '"'); }
        const links = [...new Set([...app.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href').slice(1)).filter(Boolean))];
        return { bad, links, len: txt.length, h1: (app.querySelector('h1') || {}).innerText || '' };
      }, { isTown });
      const dead = info.links.filter(h => !HANDLED.test(h));
      if (pageErrors.length) problems.push(`${label}/${r}: JS error: ${pageErrors.join(' | ')}`);
      if (info.bad.length) problems.push(`${label}/${r}: ${info.bad.join(', ')}`);
      if (dead.length) problems.push(`${label}/${r}: links to pages that do not exist: ${dead.join(', ')}`);
      if (info.len < 300 && !['mod', 'staff', 'unsure', 'social', 'ideas'].includes(r)) problems.push(`${label}/${r}: page is nearly empty (${info.len} chars)`);
    }
    // every sidebar section opens with By the numbers, and its figures agree with the page under it
    const nb = await page.evaluate(() => {
      const out = []; const go = h => { location.hash = '#' + h; route(); return document.getElementById('app'); };
      const need = ['local', 'business', 'market', 'parks', 'schools', 'sports', 'issues', 'talk', 'safety', 'election'];
      for (const h of need) {
        if (h === 'market' && !(LX && LX.market)) continue; if (h === 'schools' && !(LX && LX.schools)) continue; if (h === 'sports' && !(LX && LX.sports)) continue;
        const app = go(h); const band = app.querySelector('.nband') || (h === 'business' ? app.querySelector('.bn') : null);
        if (!band) { out.push(`${h}: no By the numbers strip`); continue; }
        const tiles = band.querySelectorAll('.bn-t'); if (tiles.length < 2) out.push(`${h}: By the numbers has ${tiles.length} tile`);
        const y = band.getBoundingClientRect().top + scrollY; if (y > 700) out.push(`${h}: By the numbers sits ${Math.round(y)}px down; it belongs at the top`);
        [...tiles].forEach(t => { const v = (t.querySelector('.big') || {}).innerText || ''; if (v.length > 16) out.push(`${h}: tile value "${v}" is too long`); });
      }
      const iss = go('issues'); const t0 = iss.querySelector('.nband .bn-t .big'); if (t0 && +t0.innerText !== D.issues.length) out.push(`issues: strip says ${t0.innerText} being decided, record has ${D.issues.length}`);
      const loc = go('local'); const l0 = loc.querySelector('.nband .bn-t .big'); const wk = upcomingEvents().filter(e => e.date <= addDays(TODAY, 6)).length; if (l0 && +l0.innerText !== wk) out.push(`local: strip says ${l0.innerText} events this week, calendar has ${wk}`);
      if (LX && LX.market) { const mk = go('market'); const m0 = mk.querySelector('.nband .bn-t .big'); const n = (LX.market.sales || []).filter(x => !x.date || x.date >= TODAY).length; if (m0 && +m0.innerText !== n) out.push(`market: strip says ${m0.innerText} sales, list has ${n}`); }
      go('home'); return out;
    });
    nb.forEach(c => problems.push(`${label}: ${c}`));
    // Home against the tab pages
    const cmp = await page.evaluate(() => {
      const go = h => { location.hash = '#' + h; route(); return document.getElementById('app').innerText; };
      const home = go('home'); const out = [];
      const m = home.match(/All (\d+) events/); if (m && +m[1] !== upcomingEvents().length) out.push(`Home says ${m[1]} events, calendar has ${upcomingEvents().length}`);
      if (LX && LX.market) { const n = (LX.market.sales || []).filter(x => !x.date || x.date >= TODAY).length; const hub = go('lookup'); const hm = hub.match(/(\d+) coming up/); if (hm && +hm[1] !== n) out.push(`More hub says ${hm[1]} sales coming up, market has ${n}`); }
      const iss = go('issues'); const im = iss.match(/^(\w+) things the/m); const words = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9, Ten: 10 };
      if (im) { const n = words[im[1]] || +im[1]; if (n && n !== D.issues.length) out.push(`Issues page says ${im[1]} issues, record has ${D.issues.length}`); }
      go('home'); return out;
    });
    cmp.forEach(c => problems.push(`${label}: ${c}`));
    if (!QUIET) console.log(`${label}: ${ROUTES.length} pages checked`);
  }
}
await browser.close(); srv.close();
notes.forEach(n => console.log('NOTE ' + n));
problems.forEach(p => console.log('PROBLEM ' + p));
console.log(problems.length ? `FAILED (${problems.length} problems)` : 'OK: every page of every live town renders clean');
process.exit(problems.length ? 1 : 0);
