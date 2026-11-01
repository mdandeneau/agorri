// One-off probe: prints a page's status and the links that matter. Run: node ingest/probe.mjs <url> [<url> ...]
const UA = 'AgorriBot/1.0 (+https://agorri.com; nonpartisan civic information; contact marcdandeneau@gmail.com)';
for (const url of process.argv.slice(2)) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    console.log('\n=== ' + url + ' -> ' + r.status + ' ' + r.url + ' ' + (r.headers.get('content-type') || '') + ' ' + t.length + ' bytes');
    console.log('title:', (t.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim());
    const links = [...t.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => [m[1], m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)]);
    const want = links.filter(([h, x]) => /publicrecords|FileDownload|Browse|Folder|agenda|minute|council|planning|meeting/i.test(h + ' ' + x));
    for (const [h, x] of want.slice(0, 60)) console.log('  ', x, '|', h);
    const scripts = [...t.matchAll(/(?:fetch|ajax|url)\s*[:(]\s*["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 15);
    if (scripts.length) console.log('  script urls:', scripts);
    if (!want.length) console.log('  first 1500 chars:', t.replace(/\s+/g, ' ').slice(0, 1500));
  } catch (e) { console.log('\n=== ' + url + ' FAILED ' + (e.cause?.code || e.message)); }
}
