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

## Files
- `index.html`: the whole site.
- `data/<town>/record.json` (meetings, votes, officials, budget), `local.json` (events, notices, housing, businesses, police and fire, social accounts), `beyond.json` (county, state, federal), `feeds.json` (live feed sources).
- `towns.json`: town registry. To add a town: add its four files in `data/<id>/`, an entry with `"status": "live"`, and `/<id> /index.html 200` in `_redirects`.
- `_redirects`: serves the page at `/portsmouth`, `/nashua`, etc.
- `docs/DATA_GUIDE.md`: field definitions. `UPDATE.md`: the daily refresh runbook.
- `scripts/check.mjs`: validates the data before a push. `scripts/test-feed.mjs`: offline tests for the feed function.

Run locally: `npx wrangler pages dev .` (runs the functions too).
