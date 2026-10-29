// Offline tests for /api/talk (posting, moderation, flags, review queue) and /api/verify (address check),
// against a real SQLite database standing in for Cloudflare D1, with Claude and the Census geocoder mocked. Run: node scripts/test-talk.mjs
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import * as talk from '../functions/api/talk.js';
import * as verify from '../functions/api/verify.js';
import { modVerdict } from '../lib/moderation.js';
import { addressInTown } from '../lib/address.js';
const db = new DatabaseSync(':memory:');
for (const f of ['setup-all.sql']) db.exec(fs.readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
const D1 = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async first() { return db.prepare(sql).get(...a) ?? null; }, async run() { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: r.changes } }; } }; return st; } };
const TOWNS = { towns: [{ id: 'portsmouth', name: 'Portsmouth', state: 'NH', status: 'live' }, { id: 'nashua', name: 'Nashua', state: 'NH', status: 'live' }] };
const ASSETS = { fetch: async () => new Response(JSON.stringify(TOWNS)) };
const geo = (addr, place) => ({ result: { addressMatches: [{ matchedAddress: addr, geographies: { 'County Subdivisions': [{ NAME: place + ' city', BASENAME: place, STATE: '33' }], 'Incorporated Places': [{ NAME: place + ' city', BASENAME: place, STATE: '33' }] } }] } });
let aiCalls = 0;
globalThis.fetch = async (u, init) => {
  u = String(u);
  if (u.includes('geocoding.geo.census.gov')) {
    const a = decodeURIComponent(new URL(u).searchParams.get('address')).toLowerCase();
    if (a.includes('nowhere')) return new Response(JSON.stringify({ result: { addressMatches: [] } }));
    if (a.includes('dover')) return new Response(JSON.stringify(geo('1 MAIN ST, DOVER, NH, 03820', 'Dover')));
    const n = (a.match(/^\d+/) || ['1'])[0];
    return new Response(JSON.stringify(geo(n + ' JUNKINS AVE, PORTSMOUTH, NH, 03801', 'Portsmouth')));
  }
  if (u.includes('api.anthropic.com')) {
    aiCalls++;
    const body = JSON.parse(init.body); const t = body.messages[0].content.toLowerCase();
    const post = (t.split('<post>')[1] || '').split('</post>')[0];
    const flagged = t.includes('residents flagged');
    let v = { decision: 'allow', category: 'none', reason: '', rewrite: '' };
    if (post.includes('hurt you')) v = { decision: 'restrict', category: 'threat', reason: 'Threats are not allowed.' };
    else if (post.includes('idiots')) v = { decision: 'nudge', category: 'incivility', reason: 'This reads as an insult.', rewrite: 'I disagree with the council on this.' };
    else if (post.includes('vote for')) v = { decision: 'review', category: 'campaigning', reason: 'Campaigning gets a second look.' };
    else if (flagged && post.includes('scam link')) v = { decision: 'restrict', category: 'spam', reason: 'Spam is not allowed.' };
    else if (flagged && post.includes('borderline')) v = { decision: 'review', category: 'accusation', reason: 'Needs a second look.' };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(v) }] }));
  }
  throw new Error('unexpected fetch ' + u);
};
let ok = 0, bad = 0; const t = (name, cond) => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const ENV = { DB: D1, ASSETS, TALK_SALT: 's', ANTHROPIC_API_KEY: 'test', MOD_TOKEN: 'mod-token-0123456789' };
const req = async (fn, method, body, cid = 'alice', env = ENV, extra = {}, qs = '') => {
  const init = { method, headers: { 'x-agorri-client': cid, 'content-type': 'application/json', origin: 'https://agorri.com', ...extra } };
  const url = 'https://agorri.com/api/x' + (method === 'GET' ? '?town=' + (body || 'portsmouth') + qs : '');
  if (method !== 'GET') init.body = JSON.stringify(body);
  const r = await fn.onRequest({ request: new Request(url, init), env });
  return { status: r.status, j: await r.json() };
};
const post = (item, cid = 'alice', env = ENV, town = 'portsmouth') => req(talk, 'POST', { town, action: 'post', item }, cid, env);
const list = (cid = 'erin', env = ENV, town = 'portsmouth') => req(talk, 'GET', town, cid, env);
const find = async (key, cid = 'erin', env = ENV) => (await list(cid, env)).j.items.find(x => x.key === key);

// policy plumbing
t('verdict: policy action wins over the model', modVerdict('{"decision":"restrict","category":"campaigning","reason":"x"}').decision === 'review');
t('verdict: unknown category goes to a person', modVerdict({ decision: 'restrict', category: 'weird' }).decision === 'review');
t('verdict: junk is null', modVerdict('no json here') === null);
t('address: inside town', addressInTown(geo('1 JUNKINS AVE, PORTSMOUTH, NH, 03801', 'Portsmouth'), 'Portsmouth', 'NH').ok);
t('address: other town named', addressInTown(geo('1 MAIN ST, DOVER, NH, 03820', 'Dover'), 'Portsmouth', 'NH').place === 'Dover city');

// address check
t('no database: 503 so the page falls back', (await req(talk, 'GET', 'portsmouth', 'a', {})).status === 503);
let r = await post({ id: 'i0', kind: 'idea', title: 'Add a crosswalk at Islington' });
t('posting requires an address check', r.status === 403 && r.j.verify === true);
t('verify: address not found', (await req(verify, 'POST', { town: 'portsmouth', address: '9 Nowhere Rd', username: 'alice_p' })).status === 400);
r = await req(verify, 'POST', { town: 'portsmouth', address: '1 Main St, Dover, NH', username: 'alice_p' });
t('verify: address in another town is refused', r.status === 400 && /Dover/.test(r.j.error));
r = await req(verify, 'POST', { town: 'portsmouth', address: '1 Junkins Ave', username: 'alice_p' });
t('verify: address in town passes', r.status === 200 && r.j.username === 'alice_p');
t('verify: address is not stored, only a hash', !JSON.stringify(db.prepare('SELECT * FROM talk_residents').all()).toUpperCase().includes('JUNKINS'));
t('verify: username taken', (await req(verify, 'POST', { town: 'portsmouth', address: '2 Junkins Ave', username: 'ALICE_P' }, 'bob')).status === 409);
for (const c of ['bob', 'carol', 'dave', 'gina']) await req(verify, 'POST', { town: 'portsmouth', address: '5 Junkins Ave', username: c + '_p' }, c);
t('verify: at most 4 accounts per address', (await req(verify, 'POST', { town: 'portsmouth', address: '5 Junkins Ave', username: 'frank_p' }, 'frank')).status === 409);
t('verify: checked for one town only', (await post({ id: 'n0', kind: 'idea', title: 'Nashua idea here' }, 'alice', ENV, 'nashua')).status === 403);

// moderation on post
r = await post({ id: 'i1', kind: 'idea', title: 'Add a crosswalk at Islington and Cass', body: 'Kids cross here.' });
t('clean post goes live, name from the address check', r.status === 200 && r.j.status === 'ok' && (await find(r.j.key)).name === 'alice_p');
const ideaKey = r.j.key;
r = await post({ id: 'x1', kind: 'comment', body: 'If you do that I will hurt you.' });
t('threat is blocked with the reason, not stored', r.status === 422 && r.j.moderation.decision === 'restrict' && !(await list('alice')).j.items.some(x => /hurt/.test(x.body)));
r = await post({ id: 'x2', kind: 'comment', body: 'The council are idiots about parking.' });
t('hostile tone gets a nudge with a rewrite', r.status === 409 && r.j.nudge.rewrite.length > 0);
r = await post({ id: 'x2', kind: 'comment', body: 'The council are idiots about parking.', confirmNudge: true });
t('author can post anyway after the nudge', r.status === 200 && r.j.status === 'ok');
r = await post({ id: 'x3', kind: 'comment', body: 'Everyone vote for Smith on Tuesday.' });
t('campaigning is held for a person', r.status === 200 && r.j.status === 'pending');
const heldKey = r.j.key;
t('held post: hidden from others', !(await find(heldKey)));
t('held post: author sees it with the reason', (await find(heldKey, 'alice')).modStatus === 'pending' && (await find(heldKey, 'alice')).modLabel === 'Campaigning');
r = await post({ id: 'x4', kind: 'comment', body: 'If you do that I will hurt you.', appeal: { category: 'threat', reason: 'Threats are not allowed.' } });
t('appeal goes to a person, skips AI', r.status === 200 && r.j.status === 'pending');
r = await post({ id: 'r1', kind: 'comment', body: 'Agree, add a beacon.', parent: ideaKey }, 'bob');
t('verified neighbor replies', r.status === 200);

// flags
await post({ id: 's1', kind: 'comment', body: 'Great deals, visit my scam link' }, 'bob');
const spamKey = (await list('bob')).j.items.find(x => /scam/.test(x.body)).key;
r = await req(talk, 'POST', { town: 'portsmouth', action: 'report', key: spamKey, reason: 'Spam or ads' }, 'zed_unverified');
t('anyone can flag; AI takes down spam', r.status === 200 && r.j.review.decision === 'restrict' && !(await find(spamKey)));
t('author of a taken-down post can ask a person to review', (await req(talk, 'POST', { town: 'portsmouth', action: 'appeal', key: spamKey }, 'bob')).j.status === 'pending' && (await find(spamKey, 'bob')).appeal);
t('only the author can appeal', (await req(talk, 'POST', { town: 'portsmouth', action: 'appeal', key: spamKey }, 'erin')).status === 403);
await post({ id: 'b1', kind: 'comment', body: 'A borderline claim about a contractor.' }, 'carol');
const bKey = (await list('carol')).j.items.find(x => /borderline/.test(x.body)).key;
r = await req(talk, 'POST', { town: 'portsmouth', action: 'report', key: bKey, reason: 'False information' }, 'erin');
t('grey area: stays up, queued for a person', r.j.review.decision === 'review' && !!(await find(bKey)));
for (const c of ['p1', 'p2', 'p3']) await req(talk, 'POST', { town: 'portsmouth', action: 'report', key: ideaKey, reason: 'Something else' }, c);
t('three flags on a clean post: still visible (no brigading)', !!(await find(ideaKey)));
t('cannot flag your own post', (await req(talk, 'POST', { town: 'portsmouth', action: 'report', key: ideaKey, reason: 'Threat' }, 'alice')).status === 400);

// review queue
t('queue needs the moderator key', (await req(talk, 'GET', 'portsmouth', 'm', ENV, {}, '&queue=1')).status === 403);
const MOD = { 'x-agorri-mod': ENV.MOD_TOKEN };
let q = (await req(talk, 'GET', 'portsmouth', 'm', ENV, MOD, '&queue=1')).j;
t('queue lists held, appealed and flagged posts with reasons', q.items.some(x => x.key === heldKey) && q.items.some(x => x.appeal) && q.items.some(x => x.key === bKey && x.flags.includes('False information')) && q.items.some(x => x.key === ideaKey && x.queued));
t('decision log is kept', q.log.length >= 4 && q.log.some(l => l.trigger === 'flag'));
await req(talk, 'POST', { town: 'portsmouth', action: 'decide', key: heldKey, decision: 'approve' }, 'm', ENV, MOD);
t('person approves: post goes live', !!(await find(heldKey)));
await req(talk, 'POST', { town: 'portsmouth', action: 'decide', key: bKey, decision: 'remove', reason: 'Accusation without a source.' }, 'm', ENV, MOD);
t('person removes: post comes down, author sees why', !(await find(bKey)) && (await find(bKey, 'carol')).modReason === 'Accusation without a source.');
t('non-moderator cannot decide', (await req(talk, 'POST', { town: 'portsmouth', action: 'decide', key: ideaKey, decision: 'remove' }, 'erin')).status === 403);

// support and limits
await req(talk, 'POST', { town: 'portsmouth', action: 'support', key: ideaKey }, 'bob');
await req(talk, 'POST', { town: 'portsmouth', action: 'support', key: ideaKey }, 'zed_unverified');
const idea = await find(ideaKey, 'bob');
t('anyone can support; only checked residents count as verified', idea.sup === 2 && idea.vsup === 1 && idea.supported);
t('cross-site post refused', (await req(talk, 'POST', { town: 'portsmouth', action: 'post', item: { id: 'z', kind: 'idea', title: 'Hello there' } }, 'alice', ENV, { origin: 'https://evil.example' })).status === 403);
for (let i = 0; i < 5; i++) await post({ id: 'q' + i, kind: 'question', title: 'Question number ' + i }, 'dave');
t('rate limit after 5 posts in 10 minutes', (await post({ id: 'q9', kind: 'question', title: 'One more question' }, 'dave')).status === 429);

// without AI
const NOAI = { ...ENV, ANTHROPIC_API_KEY: '' };
const before = aiCalls;
r = await post({ id: 'na1', kind: 'comment', body: 'The council are idiots about parking.' }, 'carol', NOAI);
t('without AI: rule checks only, post goes live', r.status === 200 && r.j.status === 'ok' && aiCalls === before);
for (const c of ['h1', 'h2', 'h3']) await req(talk, 'POST', { town: 'portsmouth', action: 'report', key: r.j.key, reason: 'Harassment' }, c, NOAI);
t('without AI: three flags hide it until a person reviews', !(await find(r.j.key, 'erin', NOAI)));
const NOSALT = { ...ENV, TALK_SALT: undefined };
await list('erin', NOSALT);
t('no TALK_SALT secret: a random salt is created once in the database', db.prepare("SELECT v FROM talk_config WHERE k = 'salt'").get().v.length === 48);
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
