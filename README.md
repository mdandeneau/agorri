# Agorri

Government you can see. A voice they can count.

A static site (one page plus JSON data per town) with two small Cloudflare Pages Functions. Every town runs on the same `index.html`, so a layout change applies to all of them. Live towns: Portsmouth (agorri.com/portsmouth), Nashua (agorri.com/nashua) and North Conway (agorri.com/north-conway, the Town of Conway's government).
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

The **Site feedback** button (a highlighted blue item in the main side bar menu, right under Vote, on desktop; a small blue round button above the tab bar on phones) sends bugs and ideas about Agorri itself to `/api/feedback`. Every item is saved in the database (`site_feedback`, created automatically). To get an email for each one, add two settings in the Pages project (Settings > Variables and Secrets): `RESEND_API_KEY` (Secret; a free key from resend.com, made with the same email you want notified) and `FEEDBACK_TO` (the address to notify). Then redeploy. Moderators with `MOD_TOKEN` can list all feedback with a GET to `/api/feedback`. Test: `node scripts/test-feedback.mjs`.

## Interests and comments

Every item on the site (an issue, an event, a candidate, a park, a post, a news story, a meeting, an official) carries two small controls: a star (**Interest**, one tap to follow, one tap to remove) and a speech bubble (**comments**, which stay attached to that item and open in a panel). The Home box posts ideas and questions only; its **Comments** tab lists what you have commented on, what you follow, and new comments on those. Interests are saved in the visitor's browser. Comments go through Talk (below), so every comment also appears there with its context.

## Home: the daily layout

**Nov 2026 Home (v40):** Home now leads with **Up for a vote: weigh in** (the three issues most worth weighing in on: anything on an agenda in the next 30 days first, then recently updated and most-discussed, each with Support / Oppose, where it stands and a Context link), **What <town> is talking about** (the most-discussed Talk threads from the last two weeks, then the most-debated issues, then the next meeting's agenda items), and **<town> by the numbers** (budget, police and fire, median home sale as large cards). Then the day's question and idea box, Today and coming up (moved to the top when an election is within two days), Your stuff, local news. The previous Home is at `#home-v39`.

Nov 2026 Home (v41): Home opens on the town photo with the greeting and date, then a compact Today and coming up strip (each card has a tinted, icon-backed header; chips filter the strip to Today, City and roads, Events, Sports or Business, and a chip only shows when it has something behind it). Then the day's question with the idea box, then a social wall of what the town is talking about (issues up for a vote with Support and Oppose, resident posts, official posts, local news and Because of residents updates, filterable by type), Your stuff when there is any, and a quiet row of icon doors to the sidebar's sections (Budget and Home prices show their headline figure). The v40 Home stays at #home-v40.

Nov 3, 2026: a Featured slot under the town band (data/<town>/featured.json): on Election Day the ballot for your ward with a comment bar on the election and on each race, and the results the morning after. Comments now sit on every item people would discuss: issues, ideas, meetings and each decision, official posts, news, events, businesses, parks items, officials, candidates and races, the budget, school districts, games, the housing market, the day's question, and the Featured item. Threads read in order: first comment first, replies nested under the comment they answer with an inline Reply box, and the box for a new comment at the end. Every post, comment and reply goes through the same AI review, flags and moderator queue. The bell carries replies and support on your posts, new comments on items you marked Interest, moderation decisions, and (for moderators) the queue count, besides agenda matches.

Home opens with **What should <town> do?**: one agree / disagree / pass statement from `data/<town>/questions.json` (results shown after you answer; answers go to `/api/question` and the `q_answers` table, created automatically; address-checked answers are counted separately) above the idea box, then the key-number tiles (they lead to Safety, Budget, Housing and Social), **Today and coming up** (a swipeable row of cards led by a featured Election card while a vote is within 45 days, then weather alerts from api.weather.gov, today and tomorrow's city notices, events, openings and closings, then the next meetings and events), **Your stuff** (your ideas with the supporters still needed, replies to you, starred issues on an agenda in the next three weeks, new comments on what you follow; hidden when empty), and short previews of local news, what the city is deciding (with the latest meeting) and what residents are saying. Items, news and nav tabs show **New** for anything changed since your previous visit (kept in the browser). The previous Home is still at `#home-classic`, and the whole site before this change is saved on the branch `saved/layout-2026-10-30`. Test: `node scripts/test-question.mjs`.

## Your tax bill from your own address

The tax bill card on Budget and taxes asks for a street address and uses the city assessor's value for that home (`/api/assessment`). The address typed for the address check does the same automatically. Sources are each town's public assessing database, set in `towns.json` under `assessor`: Portsmouth's Vision Government Solutions site and Nashua's Patriot Properties site. Only the location, assessed value and land use come back (never owner names), the address is not stored, and answers are cached for a day. When several units share an address (condos), the visitor picks theirs. The estimate is assessed value times the tax rate in `record.json`, before exemptions and credits. Test: `node scripts/test-assessment.mjs`.

## Places made of several towns

Any `towns.json` entry with `subtowns` is a place made of several towns (the Mount Washington Valley is the first). Visitors see every town together until they pick one: issues, meetings, officials and recorded votes from all the town records are combined and labeled with their town, the budget tile and Budget page add up the town operating budgets and show them side by side, the ballot lists every race (saying which towns vote in it), and Schools lists every district. Picking a town in the "Your town" bar switches to that town's own record, budget, tax bill and ballot; "All towns" goes back. Each subtown needs `files.records[<id>]`; a village (`of`) uses its town's record and is left out of the totals. A new grouping only needs a towns.json entry and the per-town record files. Money is added up only from towns that publish a figure, and a total is never compared with last year unless every town has both years.

## Talk, and Parks and public works

Talk is one tab with two views: **Residents** (ideas, debates and comments, `#talk`) and **Officials' posts** (the official-account feed, `#social`). Parks and public works (`#parks`) puts roads, parking, transit, trash and water next to parks: current and upcoming `local.json` notices of those kinds (or whose title is about them), issues on infrastructure, transportation, utilities or parks, and recent official posts about that work, then the parks content from `parks.json`.

## Sports and Faith communities

`data/<town>/sports.json` turns on the Sports tab: each high school's teams with records, recent results and upcoming games, teams to follow, youth and adult leagues, venues and sports news. Student athletes are never named. `data/<town>/faith.json` turns on Faith communities (a section on Local and its own page, `#faith`): every place of worship found, by tradition and not ranked, with service times, community meals and pantries, and public events. Faith events and upcoming games are added to the Events page and the Home carousel. In a region, every item carries a `town` so the town picker filters it.

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
