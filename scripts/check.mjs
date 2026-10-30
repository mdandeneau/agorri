// Validates every live town's data files before a refresh is pushed. Run: node scripts/check.mjs
// Exits non-zero on errors; prints warnings for stale data.
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const exists = f => fs.existsSync(new URL(f, root));
const read = f => JSON.parse(fs.readFileSync(new URL(f, root)));
const errs = [], warns = [];
const today = new Date().toISOString().slice(0, 10);
const daysAgo = d => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);

let T = null;
try { T = read('towns.json'); } catch (e) { errs.push('towns.json does not parse: ' + e.message); }
const live = ((T && T.towns) || []).filter(t => t.status === 'live');
if (T && !live.length) errs.push('towns.json has no live town');
if (T && !live.some(t => t.id === T.default)) errs.push('towns.json default is not a live town');

for (const t of live) {
  const id = t.id, f = t.files || {};
  for (const k of ['record', 'local', 'beyond', 'feeds']) if (!f[k]) errs.push(`${id}: towns.json files.${k} missing`); else if (!exists(f[k])) errs.push(`${id}: towns.json points to missing ${f[k]}`);
  const load = k => { if (!f[k] || !exists(f[k])) return null; try { return read(f[k]); } catch (e) { errs.push(`${id}: ${f[k]} does not parse: ${e.message}`); return null; } };
  const P = load('record'), L = load('local'), B = load('beyond'), F = load('feeds');
  if (P) {
    for (const k of ['about', 'issues', 'council_meetings', 'board_meetings', 'officials', 'budget', 'town', 'roll_call_votes', 'topics']) if (!(k in P)) errs.push(`${id}: record missing ${k}`);
    const tw = P.town || {};
    for (const k of ['name', 'body', 'bodyShort', 'registeredVoters', 'registeredByWard', 'turnout2025', 'sources']) if (tw[k] == null) errs.push(`${id}: record town.${k} missing`);
    if (!(P.officials && (P.officials.council || []).length)) errs.push(`${id}: officials.council is empty`);
    const lasts = (P.officials && P.officials.council || []).map(c => c.last); if (new Set(lasts).size !== lasts.length) errs.push(`${id}: two officials share a "last" key; use "F. Last"`);
    (P.council_meetings || []).forEach((m, i) => { if (!m.date || !m.minutes_url) errs.push(`${id}: council_meetings[${i}] needs date and minutes_url`); if (!m.attendance) errs.push(`${id}: council_meetings[${i}] needs attendance`); });
    (P.board_meetings || []).forEach((m, i) => { if (!m.date || !m.record_url || !m.body) errs.push(`${id}: board_meetings[${i}] needs body, date and record_url`); });
    (P.issues || []).forEach((x, i) => { for (const k of ['id', 'title', 'topic', 'status', 'summary', 'points', 'keywords', 'sources', 'related']) if (x[k] == null) errs.push(`${id}: issues[${i}] missing ${k}`); });
    for (const key of ['council_meetings', 'board_meetings']) { const d = (P[key] || []).map(m => m.date); if (d.join() !== [...d].sort().reverse().join()) errs.push(`${id}: ${key} must be newest first`); }
    const bg = P.budget || {}; if (!bg.taxRate || !(bg.taxRate.fy27Estimate || bg.taxRate.fy26)) errs.push(`${id}: budget.taxRate needs fy27Estimate or fy26`);
    if (P.about && daysAgo(P.about.as_of) > 10) warns.push(`${id}: record as_of is ${daysAgo(P.about.as_of)} days old`);
  }
  if (L) {
    (L.notices || []).forEach((n, i) => { if (!n.date || !n.title || !n.source || !n.source.url) errs.push(`${id}: notices[${i}] needs date, title and source.url`); });
    (L.events || []).forEach((e, i) => { if (!e.date || !e.title || !e.url) errs.push(`${id}: events[${i}] needs date, title and url`); });
    const seen = new Set(); (L.events || []).forEach(e => { const k = e.date + '|' + e.title; if (seen.has(k)) errs.push(`${id}: duplicate event ${k}`); seen.add(k); });
    const upcoming = (L.events || []).filter(e => e.date >= today).length; if (upcoming < 5) warns.push(`${id}: only ${upcoming} upcoming events`);
    if (L.events_as_of && daysAgo(L.events_as_of) > 3) warns.push(`${id}: events are ${daysAgo(L.events_as_of)} days old`);
    for (const k of ['business', 'social', 'links', 'newsSources']) if (!L[k]) errs.push(`${id}: local missing ${k}`);
    if (L.paper) { if (!L.paper.name || !L.paper.url) errs.push(`${id}: paper needs name and url`); (L.paper.headlines || []).forEach((h, i) => { if (!h.title || !h.url || !/^\d{4}-\d{2}-\d{2}$/.test(h.date || '')) errs.push(`${id}: paper.headlines[${i}] needs title, url and date`); }); const hd = (L.paper.headlines || []).map(h => h.date); if (hd.join() !== [...hd].sort().reverse().join()) errs.push(`${id}: paper.headlines must be newest first`); if (L.paper.asOf && daysAgo(L.paper.asOf) > 2) warns.push(`${id}: paper headlines are ${daysAgo(L.paper.asOf)} days old`); } else warns.push(`${id}: no paper headlines`);
    const S = L.safety;
    if (S) {
      for (const d of ['police', 'fire']) if (S[d]) (S[d].recent || []).forEach((r, i) => { if (!r.date || !r.title || !r.source || !r.source.url) errs.push(`${id}: safety.${d}.recent[${i}] needs date, title and source.url`); });
      if (S.as_of && daysAgo(S.as_of) > 7) warns.push(`${id}: safety is ${daysAgo(S.as_of)} days old`);
    } else warns.push(`${id}: no safety section`);
  }
  if (B) { for (const k of ['people', 'levels', 'ward_reps']) if (!B[k]) errs.push(`${id}: beyond missing ${k}`);
    Object.values(B.ward_reps || {}).flat().forEach(k => { if (!B.people[k]) errs.push(`${id}: ward_reps names unknown person ${k}`); });
    (B.levels || []).forEach(l => (l.people || []).forEach(k => { if (!B.people[k]) errs.push(`${id}: level ${l.id} names unknown person ${k}`); })); }
  if (F) (F.sources || []).forEach(s => { if (!['rss', 'atom', 'bluesky', 'links', 'x'].includes(s.type)) errs.push(`${id}: feeds bad type ${s.id}`); if (s.type !== 'bluesky' && s.type !== 'x' && !s.url) errs.push(`${id}: feed ${s.id} needs url`); if (s.type === 'links') { try { if (new RegExp(s.match).source.split('(').length < 4) errs.push(`${id}: feed ${s.id} match needs year, month and day groups`); } catch (e) { errs.push(`${id}: feed ${s.id} match is not a valid pattern`); } } });
  const opt = k => { const f = t.files && t.files[k]; if (!f) return null; try { return JSON.parse(fs.readFileSync(new URL(f, root), 'utf8')); } catch (e) { errs.push(`${id}: ${k} is not valid JSON`); return null; } };
  const PK = opt('parks'), BZ = opt('business'), CD = opt('candidates');
  if (PK) { (PK.facilities || []).forEach((f, i) => { if (!f.id || !f.name || !f.source || !f.source.url) errs.push(`${id}: parks.facilities[${i}] needs id, name and source.url`); }); if ((PK.facilities || []).length < 5) warns.push(`${id}: only ${(PK.facilities || []).length} park facilities`); }
  if (BZ) { for (const k of ['organizations', 'cityOffices', 'howTo', 'notices', 'programs']) (BZ[k] || []).forEach((x, i) => { if (!x.source || !x.source.url) errs.push(`${id}: business.${k}[${i}] needs source.url`); }); if (!(BZ.keywords || []).length) warns.push(`${id}: business has no keywords, so no paper headlines will be picked up`); }
  if (CD) { if (!CD.election || !CD.election.date) errs.push(`${id}: candidates needs election.date`); (CD.races || []).forEach(r => { if (!r.id || !r.office || !r.level) errs.push(`${id}: race ${r.id || '?'} needs id, office and level`); (r.candidates || []).forEach(c => { if (!c.id || !c.name || !c.source || !c.source.url) errs.push(`${id}: candidate ${c.name || '?'} in ${r.id} needs id, name and source.url`); (c.positions || []).forEach((p, i) => { if (!p.topic || !p.stance || !p.source || !p.source.url) errs.push(`${id}: ${c.name} position[${i}] needs topic, stance and source.url`); }); }); });
    if (CD.election && CD.election.date < today) warns.push(`${id}: the ${CD.election.date} election is over; replace candidates with results (see UPDATE.md)`); }
  const QS = opt('questions');
  if (QS) { const ids = new Set(); (QS.questions || []).forEach((q, i) => { if (!q.id || !q.date || !q.text || !q.status) errs.push(`${id}: questions[${i}] needs id, date, text and status`); if (ids.has(q.id)) errs.push(`${id}: question id ${q.id} is used twice`); ids.add(q.id); if (!['draft', 'approved', 'retired'].includes(q.status)) errs.push(`${id}: question ${q.id} status must be draft, approved or retired`); if (q.issue && P && !(P.issues || []).some(x => x.id === q.issue)) errs.push(`${id}: question ${q.id} links to unknown issue ${q.issue}`); if (q.text && q.text.length > 220) warns.push(`${id}: question ${q.id} is long; keep it to one sentence`); });
    if (!(QS.questions || []).some(q => q.status === 'approved' && q.date <= today)) warns.push(`${id}: no approved question for today`); }
  const txt = JSON.stringify([P, L, B, PK, BZ, CD, QS]);
  if (txt.includes('—')) errs.push(`${id}: em dash found in data (house style: none)`);
}
warns.forEach(w => console.log('WARN ' + w));
errs.forEach(e => console.log('ERROR ' + e));
console.log(errs.length ? 'FAILED' : 'OK (' + live.map(t => t.id).join(', ') + ')');
process.exit(errs.length ? 1 : 0);
