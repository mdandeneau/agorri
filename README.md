# Agorri

Government you can see. A voice they can count.

A static site (one page plus JSON data per town) with two small Cloudflare Pages Functions. Every town runs on the same `index.html`, so a layout change applies to all of them. Live towns: Portsmouth (agorri.com/portsmouth) and Nashua (agorri.com/nashua).
- `/api/feed?town=<id>` merges that town's official feeds (`data/<id>/feeds.json`: city RSS, YouTube, officials on Bluesky, police and fire feeds). Cached 5 minutes per town; the page polls it every 5 minutes.
- `/api/ask` writes short answers for the search bar from the records the page matched. Off until you add an API key.

Data refreshes daily through a scheduled Claude task that follows `UPDATE.md` and pushes to `main`.

## Go live on Cloudflare Pages (about 15 minutes, free)

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. Workers & Pages > Create > Pages > Connect to Git. Pick this repository.
3. Build settings: Framework preset **None**. Build command **blank**. Build output directory **/**. Save and Deploy.
   The site is live at `<project>.pages.dev`, with `/api/feed` working.
4. Domain: in Cloudflare, add the site `agorri.com` (Free plan) and change the nameservers at your registrar to the two Cloudflare gives you. An apex domain on Pages requires this. Then in the Pages project > Custom domains, add `agorri.com` and `www.agorri.com`.
5. Optional, for written answers in search: Settings > Variables and Secrets > add `ANTHROPIC_API_KEY` (Encrypt), then redeploy. Get a key at https://console.anthropic.com and set a monthly spend limit there. Uses Claude Haiku 5.5 (about $0.0004 per question). Set `ANSWER_MODEL` to change models.
6. Optional: add a rate-limiting rule for `/api/ask` under Security if your plan includes one.
7. Talk (resident posts, shared by everyone): Workers & Pages > D1 > Create database named `agorri`. Open it > Console, paste the contents of `migrations/0001_talk.sql`, and run it. Then in the Pages project > Settings > Bindings > add a D1 binding with variable name `DB` pointing to `agorri`, and add a secret `TALK_SALT` (any long random string). Redeploy. Until this is done, Talk saves posts only in each visitor's own browser.

## Talk: one store for everything residents post
Ideas, questions, debate arguments (for or against an issue), comments, replies and neighbor posts all live in one table (`talk_items`), each tagged with what it is about: the town, an issue, a meeting, an official post or a news story. The Talk page, issue debates, meeting threads, the ideas forum and Home all read and write this same store.
- Posts go live immediately after an automatic check (length, at most two links, no phone numbers or email addresses, at most 5 posts per 10 minutes per browser and 30 per hour per connection).
- Three reports hide a post from everyone but its author until a moderator reviews it. To restore one, set `kept = 1` on its row; to hide one, set `hidden = 1` (D1 console).
- Anyone can post, as a display name or anonymously. Only verified residents count toward the city's response threshold (verification is not built yet, so `verified` is 0 for now).
- Browser ids and IPs are stored only as salted hashes.

## Files
- `index.html`: the whole site.
- `data/<town>/record.json` (meetings, votes, officials, budget), `local.json` (events, notices, housing, businesses, police and fire, social accounts), `beyond.json` (county, state, federal), `feeds.json` (live feed sources).
- `towns.json`: town registry. To add a town: add its four files in `data/<id>/`, an entry with `"status": "live"`, and `/<id> /index.html 200` in `_redirects`.
- `_redirects`: serves the page at `/portsmouth`, `/nashua`, etc.
- `docs/DATA_GUIDE.md`: field definitions. `UPDATE.md`: the daily refresh runbook.
- `scripts/check.mjs`: validates the data before a push. `scripts/test-feed.mjs` and `scripts/test-talk.mjs`: offline tests for the feed and Talk functions.
- `functions/api/talk.js` and `migrations/0001_talk.sql`: the Talk store.

Run locally: `npx wrangler pages dev .` (runs the functions too).
