// Offline tests for /api/assessment (assessor value behind the tax estimate). Run: node scripts/test-assessment.mjs
import * as as from '../functions/api/assessment.js';
import { normStreet, sameStreet } from '../lib/assess.js';
import fs from 'node:fs';
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const root = new URL('../', import.meta.url);
const ASSETS = { async fetch(u) { const p = new URL(u).pathname.slice(1); try { return new Response(fs.readFileSync(new URL(p, root))); } catch (e) { return new Response('nf', { status: 404 }); } } };
const calls = [];
globalThis.fetch = async (u, init = {}) => { u = String(u); calls.push({ u, body: init.body ? String(init.body) : '' });
  if (u.endsWith('async.asmx/GetDataAddress')) { const q = JSON.parse(init.body).inVal; return new Response(JSON.stringify({ d: q.startsWith('1000 MAPLEWOOD') ? [{ id: '29303', value: '1000 MAPLEWOOD AVE', source: 'Address' }, { id: '29304', value: '10000 MAPLEWOOD AVE', source: 'Address' }] : [] })); }
  if (u.includes('Parcel.aspx?pid=29303')) return new Response('<span id="MainContent_lblLocation">1000 MAPLEWOOD AVE </span><span id="MainContent_lblGenOwner">SMITH, JANE</span><span id="MainContent_lblGenAssessment">$854,400</span><span id="MainContent_lblUseCodeDescription">SINGLE FAM MDL-01</span>');
  if (u.endsWith('SearchResults.asp')) return new Response(`<table><tr><td>Parcel ID</td><td>Location</td></tr><tr><td>0000G-00055-23</td><td>307B AMHERST ST</td><td>ROUBELIAN, ROUPEN</td><td>1985 GARDEN</td><td>$280,000</td><td>1021 CONDO NL</td></tr><tr><td>0000G-00055-24</td><td>307B AMHERST ST</td><td>SOMEONE</td><td>1986 GARDEN</td><td>$328,900</td><td>1021 CONDO NL</td></tr><tr><td>X</td><td>3070 AMHERST ST</td><td>Z</td><td>1990</td><td>$1,000</td><td>1010</td></tr></table>`);
  return new Response('nf', { status: 404 }); };
const get = (town, address) => as.onRequest({ request: new Request(`https://agorri.com/api/assessment?town=${town}&address=${encodeURIComponent(address)}`), env: { ASSETS } });
t('normalizes a typed address', JSON.stringify(normStreet('12 Maple Street, Portsmouth NH')) === '{"num":"12","core":"MAPLE","street":"MAPLE ST"}');
t('drops unit numbers and town names', normStreet('307B Amherst St Apt 4 Nashua NH 03060', 'Nashua').core === 'AMHERST');
t('street match is exact on number and name', sameStreet('307B AMHERST ST', normStreet('307 Amherst St')) && !sameStreet('3070 AMHERST ST', normStreet('307 Amherst St')) && !sameStreet('307 NORTH AMHERST RD', normStreet('307 Amherst St')));
let r = await get('portsmouth', '1000 Maplewood Avenue'); let j = await r.json();
t('Portsmouth (Vision) returns the assessed value', r.status === 200 && j.results.length === 1 && j.results[0].value === 854400 && j.results[0].use === 'SINGLE FAM MDL-01');
t('owner names are never returned', !JSON.stringify(j).includes('SMITH'));
t('searches the assessor by number and street name', calls.some(c => c.body.includes('"inVal":"1000 MAPLEWOOD"')));
r = await get('nashua', '307 Amherst St'); j = await r.json();
t('Nashua (Patriot) returns every unit at the address', j.results.length === 2 && j.results[1].value === 328900 && j.results[0].use === 'CONDO NL');
t('Nashua owner names are never returned', !/ROUBELIAN|SOMEONE/.test(JSON.stringify(j)));
t('no house number is refused', (await get('portsmouth', 'Maplewood Ave')).status === 400);
t('unknown town is refused', (await get('dover', '1 Main St')).status === 404);
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
