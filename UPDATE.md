# Daily refresh runbook

This is what the scheduled Agorri refresh does every morning, for every town with `"status": "live"` in `towns.json`. A person can follow it too.

All towns share one page (`index.html`). Only edit data in `data/<town>/`. Never edit `index.html` or `functions/` during a refresh.

## Hard rules
- Facts only from sources you fetched in this run. Every new item carries its source URL.
- Plain English, neutral, no em dashes. Report what officials said and did; never characterize.
- Copy vote outcomes exactly as recorded. Mark anything ambiguous `needs_review` with a `review_note`.
- Police and fire: never include names of people arrested, charged, injured or involved, and no home addresses. Type, street or neighborhood, and date only.
- If a source can't be reached, keep the existing data and say so in the run summary. Never delete data because a fetch failed.
- Read `docs/DATA_GUIDE.md` first; it defines every field.

## Every day, for each live town
1. **Notices** (`local.json` notices). Add new resident-relevant items from the last 14 days (closures, road work, water, trash, events, elections, grants, hearings). Give dated happenings residents should plan around a `strip` and `stripLine`. Drop notices more than 30 days past.
2. **Events** (`local.json` events). Refresh the next 45 days from the town's sources below. Delete past events. De-duplicate. Set `events_as_of` to today.
3. **Meetings** (`record.json`). Look for minutes or agendas posted since the newest dates in `council_meetings` and `board_meetings`. Summarize each new document in the schema, newest first. Add new named roll calls to `roll_call_votes` and update `attendance`. Replace `next_council_meeting` items with the posted agenda when it appears. Update matching `issues` (status, next, points, related). Set `about.as_of` to today. Skip on days with nothing new.
4. **Police and fire** (`local.json` safety). Add new department press releases and news items to `police.recent` / `fire.recent` (keep about 60 days). Where the town posts daily police logs, add a `logDigest` entry per new day by counting call types (top 6) and arrests; keep the newest 7 days. Update `stats` when a commission or annual report publishes new figures. Set `safety.as_of` to today.

## Mondays
5. **Businesses** (`local.json` business): openings and closings from local news. Headlines and facts only; skip paywalled text. Drop closures more than 30 days past.

## First Monday of each month
6. **Housing** (`local.json` housing): Redfin's city page and the regional realtor report. Update numbers, period and sources.

## After an election
7. **Officials** (`beyond.json`, and `record.json` officials after a city election). Update winners from official results. Until results are certified, label them unofficial in `status`.

## Before pushing
8. Run `node scripts/check.mjs` (checks every live town). Fix every ERROR. Mention WARNs in the summary.
9. Commit to `main` as "Daily refresh YYYY-MM-DD: what changed" and push. Cloudflare redeploys in about a minute.
10. End with a short summary per town: what was added, what was removed, anything marked needs_review, any source that failed.

---

## Portsmouth sources
- City news and notices: https://www.portsmouthnh.gov/rss.xml and https://www.portsmouthnh.gov/news
- Minutes and agendas: City Council, Planning Board, Zoning Board, Historic District Commission under https://files.portsmouthnh.gov/ (new files appear in the city RSS)
- Events: https://www.themusichall.org/calendar/, https://patch.com/new-hampshire/portsmouth-nh/calendar, https://www.strawberybanke.org/events/, https://portsmouthpl.librarycalendar.com/events/upcoming
- Police logs (one PDF per day, posted 2 to 3 days later): https://www.portsmouthnh.gov/police/police-logs
- Police and Fire Commission minutes (monthly statistics): https://files.portsmouthnh.gov/minutes/ and https://public.powerdms.com/PORTSMOUTHNH
- Police and fire news feeds: https://www.portsmouthnh.gov/taxonomy/term/20/feed, https://www.portsmouthnh.gov/taxonomy/term/13/feed
- Businesses: https://seacoastcurrent.com/tags/opening/ and Portsmouth Patch. Housing: Redfin Portsmouth; Seacoast Board of Realtors via Patch.

## Nashua sources
- Board of Aldermen and board minutes/agendas (CivicClerk): https://nashuanh.portal.civicclerk.com/ . File links have the form https://nashuanh.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=N,plainText=false). The event list API: https://nashuanh.api.civicclerk.com/v1/Events (filter by categoryName "Board of Aldermen"; Fire Commission is category 33).
- Board of Aldermen meets 7:30 pm on the 2nd and 4th Tuesdays (2nd Tuesday only in July and August). Nashua records most votes by name: capture every named roll call.
- City news: https://www.nashuanh.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml ; calendar https://www.nashuanh.gov/Calendar.aspx ; legal notices https://www.nashuanh.gov/199/Legal-Notices
- Events: https://nashuacenterforthearts.com/tickets-events/, https://nashualibrary.libcal.com/calendar/events, https://downtownnashua.org/, https://patch.com/new-hampshire/nashua/calendar
- Police: media releases https://www.nashuanhpd.gov/DocumentCenter/Index/46 and arrest logs https://www.nashuanhpd.gov/DocumentCenter/Index/45 (these folders load by script; if they won't open, use local news), annual report https://www.nashuanhpd.gov/Archive.aspx?ADID=56
- Fire: Fire Commission minutes in CivicClerk; https://www.nashuanh.gov/383/Fire-Rescue
- News: https://nashua.inklink.news/, https://www.nashuaindependent.com/ (RSS: /rss/), Nashua Telegraph (mostly paywalled; headlines only)
- Housing: https://www.redfin.com/city/12918/NH/Nashua/housing-market ; NH Association of Realtors via Nashua Ink Link.
- Known gaps: department-level adopted budget (ClearGov book is not readable as text), FY25 debt outstanding, police daily logs, police and fire RSS feeds.
