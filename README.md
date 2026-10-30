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
7. Talk (resident posts, shared by everyone): Workers & Pages > D1 > Create database named `agorri`. Open it > Console, paste the contents of `migrations/setup-all.sql`, and run it. In the Pages project > Settings > Bindings, add a D1 binding with variable name `DB` pointing to `agorri`, then redeploy. That's enough for residents to post. Optional secrets: `ANTHROPIC_API_KEY` (turns on the AI review; without it posts get rule checks only), `MOD_TOKEN` (a long random string; moderators enter it at agorri.com/<town>#mod), `TALK_SALT` (otherwise a random salt is created once in the database). Until the database is bound, Talk saves posts only in each visitor's own browser.
8. Private testing password (optional): Settings > Variables and Secrets > add `SITE_PASSWORD` (Encrypt), then redeploy. Every page and API then asks for it once per device (remembered 30 days) and search engines are told not to index the site. Change it to sign everyone out; delete it to open the site to the public. The gate lives in `functions/_middleware.js`; test it with `node scripts/test-gate.mjs`.

## X (Twitter) posts

X has no free API, so X posts come from a scheduled Apify task (a third-party scraper; against X's terms, so it can stop working without notice). Setup: an Apify account (free plan, $5 a month of credit), a saved task of an X tweet scraper whose search terms cover every handle in the `type: "x"` sources of each town's feeds.json (`from:Handle1 OR from:Handle2 ... within_time:2d`, split across a few search terms), scheduled every few hours. Then add `APIFY_TOKEN` (Secret) and `APIFY_X_TASK` (the task's id) in the Pages project settings. /api/feed reads the task's latest results (cached 10 minutes) and keeps each account's own posts, no replies or reposts. When you add an X account to feeds.json, add its handle to the Apify task too.

## Site feedback

The **Site feedback** button (bottom left of the side bar on desktop, a small round button above the tab bar on phones) sends bugs and ideas about Agorri itself to `/api/feedback`. Every item is saved in the database (`site_feedback`, created automatically). To get an email for each one, add two settings in the Pages project (Settings > Variables and Secrets): `RESEND_API_KEY` (Secret; a free key from resend.com, made with the same email you want notified) and `FEEDBACK_TO` (the address to notify). Then redeploy. Moderators with `MOD_TOKEN` can list all feedback with a GET to `/api/feedback`. Test: `node scripts/test-feedback.mjs`.

## Interests and comments

Every item on the site (an issue, an event, a candidate, a park, a post, a news story, a meeting, an official) carries two small controls: a star (**Interest**, one tap to follow, one tap to remove) and a speech bubble (**comments**, which stay attached to that item and open in a panel). The Home box posts ideas and questions only; its **Comments** tab lists what you have commented on, what you follow, and new comments on those. Interests are saved in the visitor's browser. Comments go through Talk (below), so every comment also appears there with its context.

## Home: the daily layout

Home opens with **Today in <town>** (only what matters today or tomorrow: city notices, events, an opening or closing, National Weather Service alerts read live from api.weather.gov, the police log against its recent average), **Today's question** (one agree / disagree / pass statement from `data/<town>/questions.json`, results shown after you answer; answers go to `/api/question` and the `q_answers` table, created automatically; address-checked answers are counted separately), and **Your stuff** (your ideas with the supporters still needed, replies to you, starred issues on an agenda in the next three weeks, new comments on what you follow; hidden when empty). Items, news and nav tabs show **New** for anything changed since your previous visit (kept in the browser). The previous Home is still at `#home-classic`, and the whole site before this change is saved on the branch `saved/layout-2026-10-30`. Test: `node scripts/test-question.mjs`.

## Business, Parks and Vote

Three optional data files per town turn on three tabs: `data/<town>/business.json` (organizations, City Hall offices, how-to guides, business notices, programs, keywords that pick business stories out of the paper's headlines), `data/<town>/parks.json` (department, facilities, programs, projects, seasonal notes) and `data/<town>/candidates.json` (every race and candidate on the next ballot, with positions in the candidate's own words and a source for each). A town without a file simply has no tab. Live sources tagged `business` or `parks` in `feeds.json` show on those tabs instead of the social scroll; feed sources carry `level` (City, County, State, Federal) and `kind` (official or candidate) so the social scroll can show local officials first and candidates on their own.

## Talk: one store for everything residents post
Ideas, questions, debate arguments (for or against an issue), comments, replies and neighbor posts all live in one table (`talk_items`), each tagged with what it is about: the town, an issue, a meeting, an official post or a news story. The Talk page, issue debates, meeting threads, the ideas forum and Home all read and write this same store.
- **Address check before posting.** Posting and commenting need a check that the resident's address is inside the town (`/api/verify`, U.S. Census Bureau geocoder). Honor system for now; only a salted hash of the matched address is kept, at most 4 accounts per address, usernames unique per town. Reading, supporting and flagging are open to everyone. Upgrade path: mailed codes.
- **AI review of every post** (`lib/moderation.js` holds the house rules; change a category's action there). Restrict: hate or slurs, threats, harassment of private people, personal information, sexual content, spam. Sent to a person: campaigning, off-topic national politics, unsupported accusations, possibly false claims. Nudge (author can edit, take a suggested rewrite, or post anyway): hostile tone. Rules are about conduct, never viewpoint.
- **Flags** carry a reason and trigger another AI review: clear violations come down, grey areas stay up and go to a person, and three flags on a post the AI allowed also go to a person. Flags alone never hide a post while AI review is on.
- **Review queue** at `#mod` for moderators (MOD_TOKEN): held posts, appeals, flagged posts and AI takedowns, with Approve or Remove and a note to the author. Every AI and human decision is logged in `talk_modlog`.
- Authors can always ask a person to review a blocked or removed post. Automatic checks also block phone numbers, emails, more than two links, and more than 5 posts in 10 minutes.
- Without `ANTHROPIC_API_KEY`, posts go live after the rule checks and three flags hide a post until a person reviews it.

## Files
- `index.html`: the whole site.
- `data/<town>/record.json` (meetings, votes, officials, budget), `local.json` (events, notices, housing, businesses, police and fire, social accounts), `beyond.json` (county, state, federal), `feeds.json` (live feed sources).
- `towns.json`: town registry. To add a town: add its four files in `data/<id>/`, an entry with `"status": "live"`, and `/<id> / 200` in `_redirects` (rewriting to `/index.html` makes Cloudflare redirect to the home page).
- `_redirects`: serves the page at `/portsmouth`, `/nashua`, etc.
- `docs/DATA_GUIDE.md`: field definitions. `UPDATE.md`: the daily refresh runbook.
- `scripts/check.mjs`: validates the data before a push. `scripts/test-feed.mjs` and `scripts/test-talk.mjs`: offline tests for the feed and Talk functions.
- `functions/api/talk.js`, `functions/api/verify.js`, `lib/moderation.js`, `lib/address.js` and `migrations/`: Talk, moderation and the address check.

Run locally: `npx wrangler pages dev .` (runs the functions too).
