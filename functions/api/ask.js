// POST /api/ask : writes a short answer from the records the page already matched.
// Off until ANTHROPIC_API_KEY is set in Cloudflare (Settings > Variables and Secrets).
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).hostname !== new URL(request.url).hostname) return json({ error: 'origin' }, 403);
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const q = String(b.question || '').slice(0, 300).trim();
  const town = String(b.town || '').slice(0, 80);
  const today = String(b.today || '').slice(0, 10);
  const recs = (Array.isArray(b.records) ? b.records : []).slice(0, 10).map((r, i) => '[' + (i + 1) + '] ' + String(r).slice(0, 700)).join('\n');
  if (!q || !recs) return json({ error: 'bad_request' }, 400);
  const rules = `You are the search assistant on Agorri, a nonpartisan civic information site for ${town}. Today is ${today}. A resident typed a question. Answer it using ONLY the numbered records below, which are plain-English summaries of official documents and public profiles.
Rules:
- Answer in 2 to 5 short sentences of plain English. No headings, no markdown, no em dashes. A short list is fine when the question asks for several items.
- Use only facts in the records. If the records do not answer the question, say so plainly in one sentence and suggest a better search word or the office that would know. Never guess and never add outside knowledge.
- Stay neutral. Report what officials said or did and how votes came out. Do not praise, criticize, predict, or recommend how anyone should vote or feel.
- After each fact, cite the record number in brackets like [2].`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANSWER_MODEL || 'claude-haiku-5-5', max_tokens: 400,
      messages: [{ role: 'user', content: rules + '\n\nRECORDS:\n' + recs + '\n\nQUESTION: ' + q }] })
  });
  if (!r.ok) return json({ error: 'upstream', status: r.status }, 502);
  const j = await r.json();
  return json({ text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() });
}
