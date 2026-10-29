# Data guide (schema the daily refresh must follow)

Every live town has four files in `data/<town>/`. All towns use the same page (`index.html`), so every field below means the same thing in every town. Never use em dashes. Every fact carries its source URL.

## record.json (the town's official record)
- `about`: as_of (YYYY-MM-DD), records_from, documents_used, note.
- `town`: name, state, **body** (the governing body's full name, e.g. "City Council", "Board of Aldermen"), **bodyShort** ("Council", "Aldermen"), **members** ("councilors", "aldermen"), registeredVoters, registeredByWard {ward: count}, turnout2025 {ballots, registered, pct}, sources {election, roster, wards, voters?}, demoAddress (City Hall, used as the demo address on the Verify sheet), nextCityElection, financeNote?, contactNote?.
- `next_council_meeting`: {date, items:[{item, from}]}. Items earlier meetings scheduled for it; replace with the posted agenda once it is out.
- `issues`: curated live issues {id, title, topic, status, next, summary, points[], keywords[], sources[], scope, related[]}. Edit status/next/points when a related decision happens; never add opinion.
- `council_meetings` (newest first): {body, date, minutes_url, minutes_status draft|final|agenda only, ocr, attendance{present[],absent[]}, headline, decisions[], discussed[], public_comment[], coming_up[]}.
  - decision: {title, detail, outcome, moved_by, seconded_by, roll_call, dissent[], topic, dollars, ordinance_reading, needs_review, review_note}.
  - `outcome` copied exactly as recorded ("passed 8-0", "failed 3-5", "passed unanimously"). Never inferred.
  - `roll_call` only when members are listed by name. `dissent` holds the named minority (for a failed motion, the members who voted yes).
  - `needs_review: true` + `review_note` wherever the minutes are ambiguous or contradict themselves.
- `roll_call_votes`: [{date, title, outcome, yes[], no[], url}], newest first. Names are each member's `last` key.
- `attendance`: {Last: {present, total}} since `attendance_from` (the start of the current term).
- `officials`: council [{name, last, role, votes2025, term, ward?, contact?}] with the mayor first (each `last` must be unique; use "F. Last" when two share a name), councilNote, railNote (one line under "Your <body>"), rollCallNote?, staff[], schoolBoard {note, members[]}, commissions[], boards[{name, meets, does, url}].
- `board_meetings` (newest first): {body, date, record_url, record_type, headline, items:[{address, applicant, request, decision, vote, conditions[], topic, needs_review, review_note}], policy_items[]}. Requests in plain English with jargon explained once in parentheses, e.g. "a variance (permission to break a zoning rule for this one property)".
- `budget`: fiscalYear, fundLabel?, adopted, adoptedVote, generalFund, priorGeneralFund, changePct, departments[{name, fy26, fy27, note}], departmentsNote, drivers[], revenue, taxRate {fy27Estimate|null, fy26, rateLabel?, note, components[], history[{fy, rate, note}], medianHome}, taxDollar?, enterprise[], waterSewerBill?, debtOutstanding?, valuation?, cip?, sources{}. Any block the town doesn't publish is null and the page hides it.
- `resident_requests` (optional): {items:[[title, topic]], clockStart, origin, note, source{label,url}, idPrefix?} for requests residents already filed through the town's own process.
- Topic tags: Housing & zoning, Parking & transportation, Budget & taxes, Schools, Public safety, Parks & recreation, Infrastructure & utilities, City buildings & facilities, Environment & resilience, Downtown & business, Historic preservation, Government & elections, Arts & culture, Health & human services, Other.

## local.json (the local desk)
- `notices`: {date, kind, title, detail, source{label,url}, strip?, stripLine?, oneLiner?, until?}. `strip` (3 words max) + `stripLine` (8 words max) put a dated happening in Home's "this week" cards. `oneLiner` puts it in Home's "In town" list.
- `events`: {date, time, title, venue, town, kind, url, source, price?, note?}. Next 45 days only. `events_as_of`.
- `business.closures/openings`: {name, what, date, detail, source{label,url}}.
- `housing`: `<town id>` {source, url, period, median, yoy, sold, soldLabel, soldLastYear, dom, domLastYear, overList, note}, `region` {source, url, reported, period, towns, summary} (or Portsmouth's `seacoast` block), records[{what, price, note, date, tagline?}].
- `election`: block for the next election; the page hides it after the date.
- `safety` (Police and fire page): {as_of, note, alerts{name,url}, police{name, chief{name,since,src}, nonEmergency, address, site, oversight, logsUrl, logsNote, logDigest[{date, calls, top[[type,count]], arrests, url}], stats[{label,value,year,src}], recent[{date, kind, title, detail, area, source{label,url}}], programs[{name,detail,url}], social[{platform,url}]}, fire{same, plus stations[{name,address}], burnPermits, liveIncidents{name,url}}}. **Never include names** of people arrested, charged, injured or involved, and no home addresses. Police and fire items never go on Home or into notifications.
- `social`: accounts[{who, level, role, platform, url, type Official|Campaign, source}], notListed[].
- `links`, `newsSources`, `notHere[{title, text, url?, label?}]`, `posts` (snapshot fallback for the Social feed; the live feed comes from /api/feed?town=<id>).

## beyond.json
County, state and federal officials with sourced positions: as_of, note, ballot_note, ward_reps {ward: [person keys]}, levels[{id, title, blurb, people[]}], people {key: {name, party, office, level federal|state|house|county, since, status, statusSrc?, positions[[issue, stance, quote, where/when]], caveat?, src{label,url}, contact?}}. Update after every election from official results.

## feeds.json
Official sources for the live feed: [{id, who, platform, type rss|atom|bluesky, url | actor, person?, tag?}]. `tag: "safety"` routes police and fire feeds to the Police and fire page instead of Social. Only add accounts the office itself lists.

## Known limits
- Portsmouth: local campaign finance is paper-only at the City Clerk. School Board agendas are on Google Drive; Police Commission on PowerDMS. Most council votes are tallies only.
- Nashua: see `notes` in each Nashua file's research log in UPDATE.md.
