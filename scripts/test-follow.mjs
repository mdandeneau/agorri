// Offline tests for email updates on starred items (/api/follow and /api/notify). Run: node scripts/test-follow.mjs
import fs from 'node:fs'; import path from 'node:path';
import * as fol from '../functions/api/follow.js';
import { runNotify } from '../functions/api/notify.js';
import { findItem, loadTownData } from '../lib/follow.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { DatabaseSync } = await import('node:sqlite'); const sdb = new DatabaseSync(':memory:');
sdb.exec(fs.readFileSync(path.join(ROOT, 'migrations/setup-all.sql'), 'utf8'));
const D1 = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, async all() { return { results: sdb.prepare(sql).all(...a) }; }, async first() { return sdb.prepare(sql).get(...a) ?? null; }, async run() { sdb.prepare(sql).run(...a); return { success: true }; } }; return st; } };
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const sent = []; globalThis.fetch = async (u, init) => { sent.push({ u: String(u), body: JSON.parse(init.body) }); return new Response('{"id":"x"}', { status: 200 }); };
const ENV = { DB: D1, TALK_SALT: 's', RESEND_API_KEY: 're_test' };
const KEY = 'k'.repeat(30), KEY2 = 'z'.repeat(30);
const call = (body, env = ENV, headers = {}) => fol.onRequest({ request: new Request('https://agorri.com/api/follow', { method: 'POST', headers: { 'content-type': 'application/json', 'x-agorri-client': 'c1', ...headers }, body: JSON.stringify(body) }), env });
const get = (q, method = 'GET') => fol.onRequest({ request: new Request('https://agorri.com/api/follow?' + q, { method }), env: ENV });

// ---- data: a small fake town ----
let local = { events: [{ date: '2026-11-21', time: '8 am', title: 'Holiday Fair', venue: 'St. Joseph', url: 'https://example.org/fair' }] };
let record = { issues: [{ id: 'garage', title: 'Parking garage', status: 'Under review', next: 'Council vote Nov 17' }], council_meetings: [] };
let faith = { congregations: [{ name: 'First Church', town: 'Testtown', services: 'Sunday 10 am' }], events: [] };
const files = () => ({ '/towns.json': { towns: [{ id: 'testtown', name: 'Testtown' }] }, '/data/testtown/local.json': local, '/data/testtown/record.json': record, '/data/testtown/faith.json': faith });
const load = async p => { const f = files()[p]; return f ? JSON.parse(JSON.stringify(f)) : null; };

// ---- signing up ----
const fair = { t: 'event', id: 'https://example.org/fair', label: 'Holiday Fair', href: '#events', url: 'https://example.org/fair' };
const garage = { t: 'issue', id: 'garage', label: 'Parking garage', href: '#issue-garage' };
let r = await call({ action: 'start', key: KEY, town: 'testtown', email: 'not an email', refs: [fair] });
t('bad email refused', r.status === 400);
r = await call({ action: 'start', key: KEY, town: 'testtown', email: 'x@example.com', refs: [fair] }, { ...ENV, RESEND_API_KEY: '' });
t('without email settings it says so', r.status === 503);
r = await call({ action: 'start', key: KEY, town: 'testtown', email: 'Pat@Example.com', refs: [fair, garage] }); let j = await r.json();
t('start sends one confirmation email', r.status === 200 && j.status === 'pending' && sent.length === 1 && sent[0].body.to[0] === 'pat@example.com' && /Confirm/.test(sent[0].body.subject));
t('email is masked in replies', j.email === 'p***t@example.com');
t('nothing is followed before confirming', sdb.prepare('SELECT COUNT(*) n FROM mail_follows').get().n === 0);
await call({ action: 'follow', key: KEY, town: 'testtown', ref: { t: 'congregation', id: 'Testtown:First Church', label: 'First Church', href: '#faith' } });
await call({ action: 'unfollow', key: KEY, town: 'testtown', ref: garage });
const link = sent[0].body.text.match(/https:\/\/agorri\.com\/api\/follow\?confirm=\w+/)[0];
r = await get(link.split('?')[1]);
t('confirm link turns updates on', r.status === 200 && /Email updates are on/.test(await r.text()));
const fl = sdb.prepare('SELECT ref_t, ref_id FROM mail_follows ORDER BY id').all();
t('stars made before confirming are applied, unstars too', fl.length === 2 && fl[0].ref_t === 'event' && fl[1].ref_t === 'congregation');
j = await (await call({ action: 'status', key: KEY })).json();
t('status reads on', j.status === 'on');
await call({ action: 'follow', key: KEY, town: 'testtown', ref: garage });
t('stars after confirming are added directly', sdb.prepare("SELECT COUNT(*) n FROM mail_follows WHERE ref_t = 'issue'").get().n === 1);
t('unknown item types are refused', (await call({ action: 'follow', key: KEY, town: 'testtown', ref: { t: 'evil', id: 'x' } })).status === 400);

// someone else typing the same address cannot add follows to it
sent.length = 0;
await call({ action: 'start', key: KEY2, town: 'testtown', email: 'pat@example.com', refs: [{ t: 'news', id: 'https://spam.example', label: 'Spam' }] }, ENV, { 'x-agorri-client': 'c2' });
t('another browser using the same address starts unconfirmed', sdb.prepare("SELECT COUNT(*) n FROM mail_follows WHERE ref_t = 'news'").get().n === 0 && sent.length === 1);
for (let i = 0; i < 4; i++) await call({ action: 'resend', key: KEY2 });
t('confirmation emails are capped at three a day per address', sent.length === 2);

// ---- finding items in real data ----
const port = await loadTownData(async p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { return null; } }, 'portsmouth', []);
const iss = port.records[0].issues[0];
t('finds a real issue', findItem({ t: 'issue', id: iss.id }, port)?.obj.title === iss.title);
const pc = port.faith.congregations[0];
t('finds a real congregation', findItem({ t: 'congregation', id: (pc.town || 'Portsmouth') + ':' + pc.name }, port)?.obj.name === pc.name);
const sc = port.sports.schools.find(s => s.teams.some(x => (x.recent || []).length)); const tm = sc.teams.find(x => (x.recent || []).length); const g = tm.recent[0];
t('finds a real game', findItem({ t: 'game', id: g.date + ':' + sc.name + ':' + tm.sport + ':' + g.opponent }, port)?.obj.result === g.result);

// ---- the notify run ----
const NENV = { DB: D1 };
const mails = []; const send = async (to, m, h) => { mails.push({ to, m, h }); return true; };
const at = iso => new Date(iso);
let rep = await runNotify(NENV, { load, site: 'https://agorri.com', now: at('2026-11-05T12:00:00Z'), send });
t('first run only records items, sends nothing', mails.length === 0 && rep.follows === 3);
record.issues[0].status = 'Approved'; local.events[0].time = '9 am';
sdb.prepare("INSERT INTO talk_items (key, town, author, kind, ref_t, ref_id, body, name, at) VALUES ('k1', 'testtown', 'someone', 'comment', 'issue', 'garage', 'Finally, glad this passed.', 'Sam', '2026-11-05T15:00:00Z')").run();
rep = await runNotify(NENV, { load, site: 'https://agorri.com', now: at('2026-11-05T23:00:00Z'), send });
t('one email for all changes', mails.length === 1 && mails[0].to === 'pat@example.com');
const txt = mails[0].m.text;
t('status change is described', /Status: now Approved \(was Under review\)/.test(txt));
t('time change is described', /Time: now 9 am \(was 8 am\)/.test(txt));
t('new comment is included', /1 new comment\. Sam: "Finally/.test(txt));
t('every item has its own stop link and the email has stop all', (txt.match(/Stop updates on this/g) || []).length === 2 && /Stop all Agorri emails/.test(txt) && /List-Unsubscribe/.test(Object.keys(mails[0].h).join()));
t('links go back to the right page', txt.includes('https://agorri.com/testtown#issue-garage'));
rep = await runNotify(NENV, { load, site: 'https://agorri.com', now: at('2026-11-20T23:00:00Z'), send });
t('reminder the evening before a dated item', mails.length === 2 && /Tomorrow, Sat, Nov 21 at 9 am, St\. Joseph/.test(mails[1].m.text) && !/comment/.test(mails[1].m.text));
rep = await runNotify(NENV, { load, site: 'https://agorri.com', now: at('2026-11-21T12:00:00Z'), send });
t('reminder is sent once', mails.length === 2);
local.events = [];
rep = await runNotify(NENV, { load, site: 'https://agorri.com', now: at('2026-11-23T12:00:00Z'), send });
t('past events that drop off are forgotten quietly', mails.length === 2 && sdb.prepare("SELECT COUNT(*) n FROM mail_follows WHERE ref_t = 'event'").get().n === 0);
faith.congregations[0].services = 'Sunday 9 and 11 am';
rep = await runNotify(NENV, { load, site: 'https://agorri.com', now: at('2026-11-23T23:00:00Z'), dry: true, send });
t('dry run reports without sending', mails.length === 2 && rep.preview.length === 1 && /Service times/.test(rep.preview[0].items[0].lines[0]));

// ---- unsubscribing ----
const tok = sdb.prepare('SELECT token FROM mail_subscribers').get().token; const fid = sdb.prepare("SELECT id FROM mail_follows WHERE ref_t = 'issue'").get().id;
r = await get(`u=${tok}&f=${fid}`);
t('unsubscribe link asks first (mail scanners can’t stop it)', /<form method="post">/.test(await r.text()) && sdb.prepare('SELECT COUNT(*) n FROM mail_follows').get().n === 2);
await get(`u=${tok}&f=${fid}`, 'POST');
t('stop one item', sdb.prepare('SELECT COUNT(*) n FROM mail_follows').get().n === 1);
await get(`u=${tok}`, 'POST');
t('stop all', sdb.prepare('SELECT status FROM mail_subscribers').get().status === 'stopped' && sdb.prepare('SELECT COUNT(*) n FROM mail_follows').get().n === 0);
rep = await runNotify(NENV, { load, site: 'https://agorri.com', now: at('2026-11-24T23:00:00Z'), send });
t('stopped addresses get nothing', rep.follows === 0 && mails.length === 2);
t('notify needs the token', (await (await import('../functions/api/notify.js')).onRequest({ request: new Request('https://agorri.com/api/notify', { method: 'POST' }), env: { NOTIFY_TOKEN: 'x'.repeat(20) } })).status === 403);
t('cross-site posts refused', (await call({ action: 'status', key: KEY }, ENV, { origin: 'https://evil.example' })).status === 403);
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
