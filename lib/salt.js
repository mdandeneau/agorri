// The salt for hashing browser ids, IPs and addresses. Uses the TALK_SALT secret when set; otherwise a random salt
// created once and kept in the database (talk_config), so the site works without any secrets on day one.
let cached = null;
export async function getSalt(env) {
  if (env.TALK_SALT) return env.TALK_SALT;
  if (cached) return cached;
  try {
    const row = await env.DB.prepare("SELECT v FROM talk_config WHERE k = 'salt'").first();
    if (row && row.v) return (cached = row.v);
    const v = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare("INSERT OR IGNORE INTO talk_config (k, v) VALUES ('salt', ?)").bind(v).run();
    const again = await env.DB.prepare("SELECT v FROM talk_config WHERE k = 'salt'").first();
    return (cached = (again && again.v) || v);
  } catch (e) { return 'agorri'; }
}
