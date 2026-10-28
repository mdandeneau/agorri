// Validates the data files before a refresh is pushed. Run: node scripts/check.mjs
// Exits non-zero on errors; prints warnings for stale data.
import fs from 'node:fs';
const read = f => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url)));
const errs = [], warns = [];
const today = new Date().toISOString().slice(0, 10);
const daysAgo = d => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
let P, L, B, T, F;
for (const [f, set] of [['portsmouth.json', v => P = v], ['local.json', v => L = v], ['beyond.json', v => B = v], ['towns.json', v => T = v], ['feeds.json', v => F = v]]) {
  try { set(read(f)); } catch (e) { errs.push(f + ' does not parse: ' + e.message); }
}
if (P) {
  for (const k of ['about', 'next_council_meeting', 'issues', 'council_meetings', 'board_meetings', 'officials', 'budget', 'town']) if (!(k in P)) errs.push('portsmouth.json missing ' + k);
  (P.council_meetings || []).forEach((m, i) => { if (!m.date || !m.minutes_url) errs.push('council_meetings[' + i + '] needs date and minutes_url'); });
  const dates = (P.council_meetings || []).map(m => m.date);
  if (dates.join() !== [...dates].sort().reverse().join()) errs.push('council_meetings must be newest first');
  if (P.about && daysAgo(P.about.as_of) > 10) warns.push('portsmouth.json as_of is ' + daysAgo(P.about.as_of) + ' days old');
}
if (L) {
  (L.notices || []).forEach((n, i) => { if (!n.date || !n.title || !n.source || !n.source.url) errs.push('notices[' + i + '] needs date, title and source.url'); });
  (L.events || []).forEach((e, i) => { if (!e.date || !e.title || !e.url) errs.push('events[' + i + '] needs date, title and url'); });
  const seen = new Set(); (L.events || []).forEach(e => { const k = e.date + '|' + e.title; if (seen.has(k)) errs.push('duplicate event ' + k); seen.add(k); });
  const upcoming = (L.events || []).filter(e => e.date >= today).length;
  if (upcoming < 5) warns.push('only ' + upcoming + ' upcoming events');
  if (L.events_as_of && daysAgo(L.events_as_of) > 3) warns.push('events are ' + daysAgo(L.events_as_of) + ' days old');
  const txt = JSON.stringify(L) + JSON.stringify(P || {});
  if (txt.includes('—')) errs.push('em dash found in data (house style: none)');
}
if (T) { (T.towns || []).filter(t => t.status === 'live').forEach(t => Object.values(t.files || {}).forEach(f => { if (!fs.existsSync(new URL('../' + f, import.meta.url))) errs.push('towns.json points to missing ' + f); })); }
if (F) (F.sources || []).forEach(s => { if (!['rss', 'atom', 'bluesky'].includes(s.type)) errs.push('feeds.json bad type ' + s.id); });
warns.forEach(w => console.log('WARN ' + w));
errs.forEach(e => console.log('ERROR ' + e));
console.log(errs.length ? 'FAILED' : 'OK');
process.exit(errs.length ? 1 : 0);
