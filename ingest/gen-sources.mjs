// Builds daily-fetcher sources (ingest/sources.json) for towns from the platform scan (ingest/platforms.json).
// Towns already in sources.json keep their hand-made entries unless you pass --force <town>. Run: node ingest/gen-sources.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'ingest/sources.json');
const cfg = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const scan = JSON.parse(fs.readFileSync(path.join(ROOT, 'ingest/platforms.json'), 'utf8')).towns;
const force = new Set(process.argv.slice(process.argv.indexOf('--force') + 1).filter(() => process.argv.includes('--force')));
const DOC_LINK = '\\.pdf(\\?|$)|DocumentCenter/View|AgendaCenter/ViewFile|/files/|/uploads/|/media/|download';
const AGENDA_MINUTES = 'agenda|minute';

const built = {}, skipped = {};
for (const [id, r] of Object.entries(scan)) {
  if (cfg.towns[id] && !force.has(id)) continue;
  const s = [];
  if (!r.site) { skipped[id] = r.error || 'no site'; continue; }
  if (r.civicclerk) s.push({ id: 'civicclerk', type: 'civicclerk', kind: 'meeting-doc', tenant: r.civicclerk, back: 21, ahead: 21, docs: true });
  if (r.civicplusFeeds?.length) s.push({ id: 'town-feeds', type: 'civicplus', kind: 'notice', base: r.site });
  else for (const [i, f] of (r.feeds || []).slice(0, 2).entries()) s.push({ id: 'feed' + (i ? i + 1 : ''), type: 'rss', kind: 'notice', url: f });
  if (!r.civicclerk && r.agendaCenter) s.push({ id: 'agenda-center', type: 'links', kind: 'meeting-doc', docs: true, url: r.agendaCenter, match: 'AgendaCenter/ViewFile/(Agenda|Minutes)/', max: 150 });
  if (!r.civicclerk && !r.agendaCenter) {
    const pages = (r.meetingDocs || []).filter(m => m.docLinks > 0).sort((a, b) => b.docLinks - a.docLinks).slice(0, 2).map(m => m.page);
    if (pages.length) s.push({ id: 'meeting-docs', type: 'links', kind: 'meeting-doc', docs: true, pages, match: DOC_LINK, require: AGENDA_MINUTES, max: 150 });
  }
  if (!s.length) { skipped[id] = 'no readable feed or meeting documents (' + (r.fetch || '?') + ')'; continue; }
  built[id] = s;
}
for (const [id, s] of Object.entries(built)) cfg.towns[id] = s;
fs.writeFileSync(SRC, JSON.stringify(cfg, null, 1) + '\n');
console.log('Added or rebuilt:', Object.keys(built).join(', ') || 'none');
console.log('Skipped:', JSON.stringify(skipped, null, 1));
