# Daily refresh runbook

This is what the scheduled Agorri refresh does every morning, for every town with `"status": "live"` in `towns.json` except towns marked `"paused"` (Nashua, since Nov 1, 2026: its page stays up with a banner and is not refreshed). Today that means Portsmouth and the Mount Washington Valley. A person can follow it too.

All towns share one page (`index.html`). Only edit data in `data/<town>/`. Never edit `index.html` or `functions/` during a refresh.

## Hard rules
- Facts only from sources you fetched in this run. Every new item carries its source URL.
- Plain English, neutral, no em dashes. Report what officials said and did; never characterize.
- Copy vote outcomes exactly as recorded. Mark anything ambiguous `needs_review` with a `review_note`.
- Police and fire: never include names of people arrested, charged, injured or involved, and no home addresses. Type, street or neighborhood, and date only.
- If a source can't be reached, keep the existing data and say so in the run summary. Never delete data because a fetch failed.
- Read `docs/DATA_GUIDE.md` first; it defines every field.
- Never edit, delete or summarize residents' Talk posts during a refresh. They live in the D1 database, not in this repo.

## Start here: the fetcher's inbox
A GitHub Action (`.github/workflows/fetch-sources.yml`, 07:17 UTC daily) checks each town's official sources listed in `ingest/sources.json` and commits what it finds to `inbox/<town>/items.json`. Read that file first, after `git pull`:
- `sources` says which sources were reached today and which failed (`ok: false`, with the error). A failed source keeps its earlier items.
- `items` are newest first by `firstSeen`. Items with `firstSeen` after the last daily refresh are the new ones to work through.
- Agendas and minutes have `text`: the path of the saved text in `inbox/<town>/docs/`. Read the minutes there instead of fetching them. Cite the item's `url` (the official document), never the inbox path.
- Police and fire items carry no names: titles that may name people are withheld, and police logs are links only. Open the `url` if you need more, and write the item without names as always.
- `inbox/` is the fetcher's file. Never edit it during a refresh. To add or fix a source, edit `ingest/sources.json`.
The fetcher covers the Seacoast (Greater Portsmouth) and Mount Washington Valley towns in `ingest/sources.json`, including towns that do not have a page yet (Dover, Hampton, Durham, Rye and the rest). Their inboxes are there for building those pages later; a daily refresh only works on live, unpaused towns. For the valley, read every valley town's inbox (conway, bartlett, tamworth, madison, jackson, freedom, albany, eaton, harts-location). Greater Nashua and Greater Manchester sources are switched off (`ingest/sources-paused.json`).
Use the source lists further down for anything the inbox does not cover (events, the paper, housing, candidates), or when a source shows as failed.

## Every day, for each live town
1. **Notices** (`local.json` notices). Add new resident-relevant items from the last 14 days (closures, road work, water, trash, events, elections, grants, hearings). Give dated happenings residents should plan around a `strip` and `stripLine`. Drop notices more than 30 days past.
2. **Events** (`local.json` events). Refresh the next 45 days from the town's sources below. Delete past events. De-duplicate. Set `events_as_of` to today.
3. **Meetings** (`record.json`). Look for minutes or agendas posted since the newest dates in `council_meetings` and `board_meetings`. Summarize each new document in the schema, newest first. Add new named roll calls to `roll_call_votes` and update `attendance`. Replace `next_council_meeting` items with the posted agenda when it appears. Update matching `issues` (status, next, points, related). Set `about.as_of` to today. Skip on days with nothing new.
4. **Police and fire** (`local.json` safety). Add new department press releases and news items to `police.recent` / `fire.recent` (keep about 60 days). Where the town posts daily police logs, add a `logDigest` entry per new day by counting call types (top 6) and arrests; keep the newest 7 days. Update `stats` when a commission or annual report publishes new figures. Set `safety.as_of` to today.

5. **Local news** (`local.json` paper). Replace `paper.headlines` with the paper's newest local headlines (up to 8, newest first): title exactly as published, article URL, and publish date. Headlines and links only, never story text. Set `paper.asOf` to today. Portsmouth: Portsmouth Patch (the Herald is paywalled with no public feed); take the date from each article page and skip "Patch AM" newsletter posts. Nashua: The Telegraph homepage, `/news/YYYY/MM/DD/` links only (date comes from the URL), skip "Real Estate Transactions". On the live site the Telegraph's headlines also update every few minutes through `/api/feed`.

5b. **Today's question** (`questions.json`). Keep at least 3 days of approved questions ahead. Draft one statement a day from an open issue or an item on the next agenda: one sentence, plain words, a real choice the city faces, no loaded adjectives, no "should we stop the wasteful...", facts in the statement only when they come from the issue's sources (cost, place, who decides). Fill `id` (`YYYY-MM-DD-<issue>`), `date`, `text`, `issue` (an id in record.json issues) and `source`. New drafts go in with `status: "draft"`; only Marc (or a moderator he names) changes a draft to `"approved"`. Mark questions about decided items `"retired"`. Never edit the text of a question after its date: answers already given were to that wording.

5d. **Businesses for sale** (`business.json` forSale). Add businesses in the town or any surrounding town (same area as 5c) reported for sale in the paper, Seacoast Current, Patch, NH Business Review or a town notice: `name`, `what` (kind of business), `town`, `price` (asking price as published, or leave out), `date` (when reported), `detail` (one sentence), `source` {label, url}. Only what a news outlet or the city published; never copy listings from BizBuySell, BizQuest or BusinessBroker.net (terms forbid it; they are link cards). Move a business to `openings` under its new owner, or `closures`, when that is reported. Drop entries older than 90 days with no update.

5c. **Buy and sell** (`market.json`, towns that have one). Scope is the whole surrounding area, not just the town: for Portsmouth, every Greater Portsmouth town (Dover, Exeter, Hampton, Durham, Rye, Stratham, Greenland, North Hampton, Newmarket) plus Kittery and York; for the valley, every valley town. Fill `surplus` from inbox items with `kind: "market"` and from any sale or auction notice in any of those towns' news feeds (title, date, url, `town`, `source` the town office, `note` with the deadline or auction site). Fill `sales` from the sources under `watch`: library and Friends book sales, school and PTO swaps, town-wide yard sale weekends, auction-house dates anywhere in the area (`title`, `date`, `town`, `where`, `url`, `source`, `note`). Every item carries `town`. Keep sales within the next 60 days plus the last 14; drop older ones. Only pages that belong to the town, the library, the school or the auction house itself, read by hand; never copy listings from Craigslist, Facebook Marketplace, OfferUp, GovDeals, Municibid or EstateSales.net (their terms forbid it; residents open those through the links on the page). Set `as_of` to today.

## Mondays
6. **Businesses** (`business.json`, which feeds the Business tab; keep `local.json` business in sync): openings and closings from local news (headlines and facts only; skip paywalled text; drop closures more than 30 days past), new business-relevant city notices from the last 120 days (outdoor dining rules, downtown parking, licensing deadlines, grants, construction near storefronts; drop items older than 120 days), and check that every `howTo` and `cityOffices` link still loads. Business news on the live site comes from the `business`-tagged feeds plus paper headlines matching `keywords`.
6b. **Parks and recreation** (`parks.json`): update `seasonal` (what is open or closed right now: pools, rinks, beaches, fields), add or finish `projects` from council minutes and the department's pages, refresh `programs` for the coming season from the registration site, and set `as_of`. Facilities change rarely; check addresses once a season.

## First Monday of each month
7. **Housing** (`local.json` housing): Redfin's city page and the regional realtor report. Update numbers, period and sources.

## Each fall, when the FBI publishes a new year
10. **Candidates** (`candidates.json`). Each candidate carries every position with a stated stance from their Citizens Count profile (`positions`: area from the fixed list in the site's CAND_AREAS, topic verbatim, stance For/Against/Other, text, quote verbatim, year, source), `noResponse` (survey questions they skipped), up to 12 recent `votes` for incumbents, `experience` and `education` from the profile overview (never family details or addresses), and `summary`: 3 to 5 neutral sentences written only from those positions, with `summaryFrom` naming the count and date. The summary never uses ideological labels (liberal, conservative, progressive, moderate, left, right, centrist) and never compares or rates candidates. Refresh positions when Citizens Count adds survey answers, and rewrite the summary when positions change. No em dashes.

9. **Featured** (`featured.json`). One item at a time on Home for days when one thing matters more than the rest; each shows from `from` through `until`. For an election item: on Election Day the site builds the ballot view itself. The morning after, fill `results`: set `status` to `unofficial` (or `final` once the Clerk marks it so), `asOf` to now, `turnout.ballots` from the City Clerk's results, and for each race in `results.races` the `votes` per candidate (Portsmouth's count only, from the Clerk's results file; never a statewide figure). Set `called: true` and `winner` to the candidate id only when the Secretary of State or at least two news outlets have called the race; the note explains that. Leave `until` so results stay up about five days. Other kinds: `notice` with `kicker`, `title`, `line`, `actions` [{label, href}] and `source`, for a snow emergency, a town meeting day, the budget hearing or a town celebration.

8. **Crime comparisons** (`local.json` safety.benchmarks). When the FBI releases a new year of Crime in the Nation, update the town, New Hampshire and U.S. rates and counts together, for the same year, from FBI Table 8 (city) and the FBI state and national estimates. Never mix years across the three. Keep the note about small counts and visitors. Police officers per 1,000: town's sworn count over the same population; U.S. figure from the latest Bureau of Justice Statistics local police report for the town's size band.

## Before an election (daily in the last 30 days)
8b. **Candidates** (`candidates.json`, the Vote tab). Add any candidate missing from a race on the ballot (NH Secretary of State filings, Ballotpedia), and add positions only from the candidate's own survey answers (Citizens Count), campaign site or a quoted statement, each with its source. Copy stances in the candidate's framing; never characterize, score or rank anyone, and treat every party identically. Candidate YouTube channels and Bluesky handles go in `accounts` (the feed picks them up with kind "candidate").

## After an election
9. **Officials** (`beyond.json`, and `record.json` officials after a city election). Update winners from official results. Until results are certified, label them unofficial in `status`.
9b. **Results** (`candidates.json`). The day after, add `result: {votes, pct, won: true/false, source}` to each candidate from the official count (NH Secretary of State or the City Clerk), set `note` to say results are unofficial until certified, and leave the page up for 30 days. Then remove `candidates.json` from the town's files in `towns.json` until the next election's filing period, and drop the `cand-*` feed sources from `feeds.json`.

## Before pushing
10. Run `node scripts/check.mjs` (checks every live town). Fix every ERROR. Mention WARNs in the summary.
11. Commit to `main` as "Daily refresh YYYY-MM-DD: what changed" and push. Cloudflare redeploys in about a minute.
12. End with a short summary per town: what was added, what was removed, anything marked needs_review, any source that failed.

---

## Portsmouth sources
- City news and notices: https://www.portsmouthnh.gov/rss.xml and https://www.portsmouthnh.gov/news
- Minutes and agendas: City Council, Planning Board, Zoning Board, Historic District Commission under https://files.portsmouthnh.gov/ (new files appear in the city RSS)
- Events: https://www.themusichall.org/calendar/, https://patch.com/new-hampshire/portsmouth-nh/calendar, https://www.strawberybanke.org/events/, https://portsmouthpl.librarycalendar.com/events/upcoming
- Police logs (one PDF per day, posted 2 to 3 days later): https://www.portsmouthnh.gov/police/police-logs
- Police and Fire Commission minutes (monthly statistics): https://files.portsmouthnh.gov/minutes/ and https://public.powerdms.com/PORTSMOUTHNH
- Police and fire news feeds: https://www.portsmouthnh.gov/taxonomy/term/20/feed, https://www.portsmouthnh.gov/taxonomy/term/13/feed
- Local news headlines (Home): https://patch.com/new-hampshire/portsmouth-nh (article pages carry the posted date).
- Businesses: https://seacoastcurrent.com/tags/opening/ and Portsmouth Patch. Housing: Redfin Portsmouth; Seacoast Board of Realtors via Patch.

## Nashua sources
- Board of Aldermen and board minutes/agendas (CivicClerk): https://nashuanh.portal.civicclerk.com/ . File links have the form https://nashuanh.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=N,plainText=false). The event list API: https://nashuanh.api.civicclerk.com/v1/Events (filter by categoryName "Board of Aldermen"; Fire Commission is category 33).
- Board of Aldermen meets 7:30 pm on the 2nd and 4th Tuesdays (2nd Tuesday only in July and August). Nashua records most votes by name: capture every named roll call.
- City news: https://www.nashuanh.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml ; calendar https://www.nashuanh.gov/Calendar.aspx ; legal notices https://www.nashuanh.gov/199/Legal-Notices
- Events: https://nashuacenterforthearts.com/tickets-events/, https://nashualibrary.libcal.com/calendar/events, https://downtownnashua.org/, https://patch.com/new-hampshire/nashua/calendar
- Police: media releases https://www.nashuanhpd.gov/DocumentCenter/Index/46 and arrest logs https://www.nashuanhpd.gov/DocumentCenter/Index/45 (these folders load by script; if they won't open, use local news), annual report https://www.nashuanhpd.gov/Archive.aspx?ADID=56
- Fire: Fire Commission minutes in CivicClerk; https://www.nashuanh.gov/383/Fire-Rescue
- News: https://nashua.inklink.news/, https://www.nashuaindependent.com/ (RSS: /rss/), The Telegraph https://www.nashuatelegraph.com/ (headlines on Home; mostly paywalled, headlines only)
- Housing: https://www.redfin.com/city/12918/NH/Nashua/housing-market ; NH Association of Realtors via Nashua Ink Link.
- Known gaps: department-level adopted budget (ClearGov book is not readable as text), FY25 debt outstanding, police daily logs, police and fire RSS feeds.

## Mount Washington Valley sources
The Mount Washington Valley (data/mount-washington-valley/) is one place with several towns: the towns whose high school students attend Kennett High School. Conway (which includes North Conway), Bartlett, Tamworth, Madison and Jackson have full records; Albany, Eaton, Freedom and Hart's Location are summary towns in `area.json` (population, 2026 town budget, 2025 tax rate), which count toward the valley totals. Each fall, update every town's budget in area.json from its warrant, MS-636 or Town Meeting results. local, parks, business, feeds, beyond, candidates and questions are shared by the valley; each town has its own government record, `record-<town>.json` (towns.json `subtowns` and `files.records`). Refresh every record-<town>.json like a record.json. In beyond.json and candidates.json the "wards" are town names. Questions may carry a `town` field when they are about one town's government.
Visitors see all the valley towns combined until they pick one, so keep every record-<town>.json's issues, meetings and budget current: a stale town shows up in the combined view. Keep `budget.generalFund` the town operating budget (the warrant amount until the Town Meeting result is found, with `fundLabel` saying so and `needs_review`).
North Conway is a village of the Town of Conway, so its record is the Town of Conway's (Board of Selectmen, official-ballot Town Meeting in April). The North Conway Water Precinct is its own small government: water, sewer and the North Conway Fire Department.
- Town site: https://conwaynh.gov (news RSS: https://conwaynh.gov/rss/news.xml). Select Board agendas (posted as images): https://conwaynh.gov/pages/conway-select-board. Minutes: the Google Drive folder linked from https://conwaynh.gov/documents. Selectmen meet Tuesdays and stream on the town's Facebook page; Valley Vision (valleyvision.com) posts the videos.
- Until official minutes can be read, meetings are built from Conway Daily Sun reporting and marked `minutes_status: "news report"` with a `source_note`. Replace them with the minutes when the Drive folder is reachable.
- Paper: The Conway Daily Sun (conwaydailysun.com, Local section). No RSS; article URLs carry no date, so headlines are refreshed by hand.
- Elections: one polling place, the Town Garage, 1611 East Main St., Center Conway. Town Clerk 603-447-3811.
- Planning Board and ZBA: notices on conwaynh.gov; Conway Forward zoning rewrite: https://bpg.mysocialpinpoint.com/conway-forward-zoning
- Assessing (tax lookup): https://conway.univers-clt.com/ (house numbers are zero-padded; each property lists its tax district). Tax rates by precinct: NH DRA tax rate sheets.
- Police: https://conwaypdnh.gov. Its Logs page links to a public Google Drive folder of daily dispatch logs, but Drive blocks automated reading, so there is no daily digest; the Conway Daily Sun prints the log now and then (add it to `police.recent` as a news item). Fire in North Conway: North Conway Water Precinct.
- Other valley police figures: Tamworth posts monthly stats at https://www.tamworthnh.gov/1386/Police-Stats---2026 (one document per month; add each new month to Tamworth's `police.stats` as "Calls for service, <Month YYYY>", plus arrests and crashes). Bartlett, Jackson, Madison and Freedom publish yearly totals only in their annual town reports.

