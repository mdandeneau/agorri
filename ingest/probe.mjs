// One-off probe: prints table rows of a page. Run: node ingest/probe.mjs <url>
const UA = 'AgorriBot/1.0 (+https://agorri.com; nonpartisan civic information; contact marcdandeneau@gmail.com)';
for (const url of process.argv.slice(2)) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  console.log('=== ' + r.status + ' ' + t.length);
  const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
  console.log('rows', rows.length);
  for (const row of rows.slice(0, 5)) console.log('ROW', row.replace(/\s+/g, ' ').slice(0, 900));
}
