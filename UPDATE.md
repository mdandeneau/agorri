# Daily refresh runbook

This is what the scheduled Agorri refresh does every morning. A person can follow it too.

## Hard rules
- Facts only from sources you fetched in this run. Every new item carries its source URL.
- Plain English, neutral, no em dashes. Report what officials said and did; never characterize.
- Copy vote outcomes exactly as recorded. Mark anything ambiguous `needs_review` with a `review_note`.
- If a source can't be reached, keep the existing data and say so in the run summary. Never delete data because a fetch failed.
- Only edit the JSON data files. Do not edit `index.html` or `functions/`.
- Read `docs/DATA_GUIDE.md` first; it defines every field.

## Every day
1. **City notices** (`local.json` notices). Read https://www.portsmouthnh.gov/rss.xml and https://www.portsmouthnh.gov/news. Add new resident-relevant items from the last 14 days (closures, road work, water, trash, events, elections, grants, public sessions). Give dated happenings residents should plan around a `strip` and `stripLine`. Drop notices more than 30 days past.
2. **Events** (`local.json` events). Refresh the next 45 days from https://www.themusichall.org/calendar/, https://patch.com/new-hampshire/portsmouth-nh/calendar, https://www.strawberybanke.org/events/, https://portsmouthpl.librarycalendar.com/events/upcoming and city press releases. Delete past events. De-duplicate. Set `events_as_of` to today.
3. **Meetings** (`portsmouth.json`). Look for City Council minutes or agendas, and Planning Board, Zoning Board and Historic District Commission action sheets or minutes, posted since the newest dates in `council_meetings` and `board_meetings` (the city RSS feed lists new minutes; files live under https://files.portsmouthnh.gov/). Summarize each new document in the schema; newest first. Replace `next_council_meeting` items with the posted agenda when it appears. Update matching `issues` status, next and points. Set `about.as_of` to today. Skip this step on days with nothing new.

## Mondays
4. **Businesses** (`local.json` business). Check https://seacoastcurrent.com/tags/opening/ and Portsmouth Patch business news for Portsmouth openings and closings. Headlines and facts only; skip paywalled text. Drop closures more than 30 days past.

## First Monday of each month
5. **Housing** (`local.json` housing). Redfin's Portsmouth page and the Seacoast Board of Realtors monthly report (via Patch). Update the numbers, period and sources.

## After an election
6. **Officials** (`beyond.json`). Update winners from official NH Secretary of State results. Until results are certified, label them unofficial in `status`.

## Before pushing
7. Run `node scripts/check.mjs`. Fix every ERROR. Mention WARNs in the summary.
8. Commit to `main` as "Daily refresh YYYY-MM-DD: what changed" and push. Cloudflare redeploys in about a minute.
9. End with a short summary: what was added, what was removed, anything marked needs_review, any source that failed.
