// /api/follow : email updates on starred items (see lib/follow.js for what triggers an email).
// POST {action, key, ...} from the page. `key` is a random secret the browser keeps; it ties that browser to one email.
//   start    {email, town, refs[]}  turn on email updates: saves the stars and sends a confirmation email (nothing else
//                                   is ever sent to an address until its owner taps the link)
//   follow   {town, ref}            add one star          unfollow {town, ref}   remove one star
//   status   {}                     none | pending | on   resend  {}             send the confirmation again
//   stop     {}                     stop all emails to this address and forget its stars
// GET ?confirm=TOKEN  the link in the confirmation email.  GET ?u=TOKEN[&f=ID]  unsubscribe page (all, or one item);
// POST ?u=TOKEN[&f=ID] does it (the page's button, and one-click unsubscribe from mail apps).
// Needs the DB binding and, to send, RESEND_API_KEY. NOTIFY_FROM sets the sender (a verified domain in Resend, for
// example "Agorri <updates@agorri.com>"); without a verified domain Resend only delivers to the Resend account's owner.
import { getSalt } from '../../lib/salt.js';
import { ensureSchema, clean, esc, hash, randomToken, validEmail, maskEmail, cleanRef, confirmEmail, sendMail, page } from '../../lib/follow.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const MAX_FOLLOWS = 300;

async function deviceFor(env, keyHash) {
  return env.DB.prepare('SELECT d.key_hash, d.sub_id, d.confirmed, d.confirm_token, s.email, s.status, s.token FROM mail_devices d JOIN mail_subscribers s ON s.id = d.sub_id WHERE d.key_hash = ?').bind(keyHash).first();
}
const statusOf = d => !d ? 'none' : d.status === 'stopped' ? 'none' : d.confirmed ? 'on' : 'pending';

async function addFollow(env, subId, town, ref) {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM mail_follows WHERE sub_id = ?').bind(subId).first();
  if (n && n.n >= MAX_FOLLOWS) return false;
  await env.DB.prepare('INSERT OR IGNORE INTO mail_follows (sub_id, town, ref_t, ref_id, label, href, url, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(subId, town, ref.t, ref.id, ref.label, ref.href, ref.url, new Date().toISOString()).run();
  return true;
}

// Until a browser is confirmed, its stars wait on the browser's own row, so nobody can add follows to someone else's address.
async function stash(env, d, town, ref, add) {
  const row = await env.DB.prepare('SELECT pending FROM mail_devices WHERE key_hash = ?').bind(d.key_hash).first();
  let p = []; try { p = JSON.parse((row && row.pending) || '[]'); } catch (e) {}
  p = p.filter(x => !(x.town === town && x.t === ref.t && x.id === ref.id));
  if (add && p.length < MAX_FOLLOWS) p.push({ town, ...ref });
  await env.DB.prepare('UPDATE mail_devices SET pending = ? WHERE key_hash = ?').bind(JSON.stringify(p), d.key_hash).run();
}

async function sendConfirm(env, request, d, label) {
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE sub_id = ? AND kind = 'confirm' AND at > ?").bind(d.sub_id, dayAgo).first();
  if (n && n.n >= 3) return { error: 'We already sent a few confirmation emails today. Check your inbox and spam folder.' };
  const site = new URL(request.url).origin;
  const r = await sendMail(env, d.email, confirmEmail(site, `${site}/api/follow?confirm=${d.confirm_token}`, label));
  if (r !== true) return { error: 'We couldn’t send the email just now. Try again later.', why: r.error };
  await env.DB.prepare("INSERT INTO mail_log (sub_id, kind, at) VALUES (?, 'confirm', ?)").bind(d.sub_id, new Date().toISOString()).run();
  return { ok: true };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Email updates are not connected yet.' }, 503);
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const home = url.origin + '/';

  // ---- links from emails ----
  const ct = url.searchParams.get('confirm');
  if (request.method === 'GET' && ct) {
    const d = await env.DB.prepare('SELECT key_hash, sub_id, pending FROM mail_devices WHERE confirm_token = ?').bind(clean(ct, 80)).first();
    if (!d) return page('That link has expired', '<p>Star something on Agorri and turn on email updates again to get a new one.</p>', home);
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE mail_devices SET confirmed = 1, confirmed_at = ? WHERE key_hash = ?').bind(now, d.key_hash).run();
    await env.DB.prepare("UPDATE mail_subscribers SET status = 'active' WHERE id = ?").bind(d.sub_id).run();
    let p = []; try { p = JSON.parse(d.pending || '[]'); } catch (e) {}
    for (const x of p) { const r = cleanRef(x); if (r && x.town) await addFollow(env, d.sub_id, x.town, r); }
    await env.DB.prepare('UPDATE mail_devices SET pending = NULL WHERE key_hash = ?').bind(d.key_hash).run();
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM mail_follows WHERE sub_id = ?').bind(d.sub_id).first();
    return page('Email updates are on', `<p>You’ll get an email when something you starred changes, and a reminder before dated events. ${n && n.n ? `You’re following ${n.n} thing${n.n === 1 ? '' : 's'}.` : ''} Star more on Agorri and they’re added automatically.</p>`, home);
  }
  const ut = url.searchParams.get('u');
  if (ut) {
    const s = await env.DB.prepare('SELECT id, email FROM mail_subscribers WHERE token = ?').bind(clean(ut, 80)).first();
    if (!s) return page('Already stopped', '<p>This address isn’t getting Agorri emails.</p>', home);
    const fid = parseInt(url.searchParams.get('f') || '', 10);
    const f = fid ? await env.DB.prepare('SELECT id, label FROM mail_follows WHERE id = ? AND sub_id = ?').bind(fid, s.id).first() : null;
    if (fid && !f) return page('Already stopped', '<p>You’re no longer getting updates on that.</p>', home);
    if (request.method === 'GET') {
      const what = f ? `updates on <b>${esc(f.label || 'this item')}</b>` : `all Agorri emails to ${esc(maskEmail(s.email))}`;
      return page('Stop emails?', `<p>Stop ${what}?</p><form method="post"><button type="submit">Stop</button></form>`, home);
    }
    if (request.method === 'POST') {
      if (f) { await env.DB.prepare('DELETE FROM mail_follows WHERE id = ?').bind(f.id).run(); return page('Stopped', `<p>No more updates on ${esc(f.label || 'that item')}. Your other stars still send updates.</p>`, home); }
      await env.DB.prepare("UPDATE mail_subscribers SET status = 'stopped' WHERE id = ?").bind(s.id).run();
      await env.DB.prepare('DELETE FROM mail_follows WHERE sub_id = ?').bind(s.id).run();
      return page('Stopped', '<p>No more emails from Agorri. Your stars still work on the site.</p>', home);
    }
  }

  // ---- the page ----
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const key = clean(b.key, 80);
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(key)) return json({ error: 'Bad request.' }, 400);
  const salt = await getSalt(env);
  const keyHash = await hash('mailkey|' + key, salt);
  const town = clean(b.town, 60).replace(/[^a-z0-9-]/g, '');
  let d = await deviceFor(env, keyHash);
  const act = String(b.action || '');

  if (act === 'status') return json({ status: statusOf(d), email: d && statusOf(d) !== 'none' ? maskEmail(d.email) : '' });

  if (act === 'start') {
    const email = clean(b.email, 254).toLowerCase();
    if (!validEmail(email)) return json({ error: 'That doesn’t look like an email address.' }, 400);
    if (!town) return json({ error: 'Bad request.' }, 400);
    if (!env.RESEND_API_KEY) return json({ error: 'Email updates aren’t switched on yet. Your stars are saved on this device.' }, 503);
    const ip = await hash(request.headers.get('cf-connecting-ip') || 'unknown', salt);
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE ip = ? AND kind = 'start' AND at > ?").bind(ip, dayAgo).first();
    if (n && n.n >= 8) return json({ error: 'Too many sign-ups from here today. Try again tomorrow.' }, 429);
    await env.DB.prepare("INSERT INTO mail_log (ip, kind, at) VALUES (?, 'start', ?)").bind(ip, new Date().toISOString()).run();
    const now = new Date().toISOString();
    let s = await env.DB.prepare('SELECT id, status FROM mail_subscribers WHERE email = ?').bind(email).first();
    if (!s) { s = await env.DB.prepare("INSERT INTO mail_subscribers (email, token, status, created) VALUES (?, ?, 'pending', ?) RETURNING id, status").bind(email, randomToken(), now).first(); }
    const author = await hash(clean(request.headers.get('x-agorri-client'), 64) || 'anon', salt);
    if (!d || d.sub_id !== s.id) {
      // A browser that switches to another address starts unconfirmed again: only the address's owner can confirm it.
      await env.DB.prepare('DELETE FROM mail_devices WHERE key_hash = ?').bind(keyHash).run();
      await env.DB.prepare('INSERT INTO mail_devices (key_hash, sub_id, author, confirmed, confirm_token, created, ip) VALUES (?, ?, ?, 0, ?, ?, ?)').bind(keyHash, s.id, author, randomToken(), now, ip).run();
    }
    d = await deviceFor(env, keyHash);
    const refs = (Array.isArray(b.refs) ? b.refs : []).slice(0, 1).map(cleanRef).filter(Boolean);
    const live = d.confirmed && d.status !== 'stopped';
    for (const r0 of (Array.isArray(b.refs) ? b.refs : []).slice(0, MAX_FOLLOWS)) {
      const r = cleanRef(r0); if (!r) continue;
      const tw = clean(r0.town || town, 60).replace(/[^a-z0-9-]/g, '') || town;
      if (live) await addFollow(env, s.id, tw, r); else await stash(env, d, tw, r, true);
    }
    if (live) return json({ ok: true, status: 'on', email: maskEmail(email) });
    if (d.status === 'stopped') await env.DB.prepare("UPDATE mail_subscribers SET status = 'pending' WHERE id = ?").bind(s.id).run();
    const sent = await sendConfirm(env, request, d, refs[0] && refs[0].label);
    if (sent.error) return json({ ok: false, status: 'pending', email: maskEmail(email), error: sent.error, ...(sent.why ? { why: sent.why } : {}) }, sent.why ? 502 : 429);
    return json({ ok: true, status: 'pending', email: maskEmail(email) });
  }

  if (!d || d.status === 'stopped') return json({ status: 'none' }, act === 'follow' || act === 'unfollow' ? 200 : 404);

  if (act === 'follow' || act === 'unfollow') {
    const ref = cleanRef(b.ref);
    if (!ref || !town) return json({ error: 'Bad request.' }, 400);
    if (!d.confirmed) { await stash(env, d, town, ref, act === 'follow'); return json({ ok: true, status: 'pending' }); }
    if (act === 'follow') { const okk = await addFollow(env, d.sub_id, town, ref); if (!okk) return json({ error: 'You’re following a lot already. Unstar something first.', status: statusOf(d) }, 429); }
    else await env.DB.prepare('DELETE FROM mail_follows WHERE sub_id = ? AND town = ? AND ref_t = ? AND ref_id = ?').bind(d.sub_id, town, ref.t, ref.id).run();
    return json({ ok: true, status: statusOf(d) });
  }
  if (act === 'resend') {
    if (d.confirmed) return json({ ok: true, status: 'on', email: maskEmail(d.email) });
    const sent = await sendConfirm(env, request, d);
    return json({ ok: !sent.error, status: 'pending', email: maskEmail(d.email), ...(sent.error ? { error: sent.error } : {}) }, sent.error ? 429 : 200);
  }
  if (act === 'stop') {
    await env.DB.prepare("UPDATE mail_subscribers SET status = 'stopped' WHERE id = ?").bind(d.sub_id).run();
    await env.DB.prepare('DELETE FROM mail_follows WHERE sub_id = ?').bind(d.sub_id).run();
    await env.DB.prepare('DELETE FROM mail_devices WHERE sub_id = ?').bind(d.sub_id).run();
    return json({ ok: true, status: 'none' });
  }
  return json({ error: 'Unknown action.' }, 400);
}
