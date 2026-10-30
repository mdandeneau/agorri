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
  if (u === 'https://conway.univers-clt.com/') return new Response('<select name="street_name"><option value=""></option><option value="KEARSARGE RD">KEARSARGE RD</option><option value="KEARSARGE RD UNIT 1">KEARSARGE RD UNIT 1</option><option value="KEARSARGE WOODS LN">KEARSARGE WOODS LN</option><option value="EAST MAIN ST">EAST MAIN ST</option></select>');
  if (u === 'https://conway.univers-clt.com/index.php') { const b = new URLSearchParams(init.body); const st = b.get('street_name'), n = b.get('street_number');
    if (n === '00024' && st === 'KEARSARGE RD') return new Response('<table><tr><td class="form-h2">Parcel ID#</td></tr><tr> <td class="form-input">19979</td> <td class="form-input">218-96</td> <td class="form-input">1</td> <td class="form-input">00024 KEARSARGE RD</td> <td class="form-input">393 - MIXED USE/PRIMARY COMMERCI</td> <td class="form-input" align="right">[ <a href="view_property_C.php?account_no=19979&series_card=1">View Details</a> ]</td> </tr><tr><td class="form-input">19979</td><td>218-96</td><td>2</td><td>00024 KEARSARGE RD</td><td>393</td><td>[ <a href="view_property_C.php?account_no=19979&series_card=2">View Details</a> ]</td></tr></table>');
    return new Response('<p>Sorry, this search returned no results.</p>'); }
  if (u.startsWith('https://conway.univers-clt.com/view_property_C.php?account_no=19979')) return new Response('<tr><td class="form-h2">Living Units</td><td colspan="7" class="form-h2">District</td></tr> <tr><td class="form-input">3</td><td colspan="7" class="form-input">6</td></tr><tr> <td class="form-label">Total:</td> <td class="form-input" align="right">$531,800</td> </tr><tr> <td class="form-label">Net Assessment:</td> <td class="form-input" align="right">$531,800</td> </tr>');
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
const UNI = { towns: [{ id: 'nc', name: 'North Conway', status: 'live', assessor: { type: 'univers', base: 'https://conway.univers-clt.com/', label: 'Conway' } }] };
const ASSETS2 = { async fetch(u) { return new URL(u).pathname === '/towns.json' ? new Response(JSON.stringify(UNI)) : new Response('nf', { status: 404 }); } };
r = await as.onRequest({ request: new Request('https://agorri.com/api/assessment?town=nc&address=' + encodeURIComponent('24 Kearsarge Road, North Conway NH')), env: { ASSETS: ASSETS2 } }); j = await r.json();
t('Conway (Univers) pads the house number and reads the net assessment once per parcel', j.results && j.results.length === 1 && j.results[0].value === 531800 && j.results[0].loc === '24 KEARSARGE RD' && j.results[0].district === '6');
t('Conway searches the matching street and its units, not similar streets', calls.filter(c => c.u.endsWith('univers-clt.com/index.php')).map(c => new URLSearchParams(c.body).get('street_name')).join(',') === 'KEARSARGE RD,KEARSARGE RD UNIT 1');
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
