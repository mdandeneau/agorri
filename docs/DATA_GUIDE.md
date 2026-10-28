# Data guide (schema the daily refresh must follow)

Copied from the Local Government Platform project doc `05_Portsmouth_Data_Guide.md`, Oct 28, 2026.

**portsmouth.json** (the city record)
- `about`: as_of (YYYY-MM-DD), records_from, documents_used, note.
- `next_council_meeting`: {date, items:[{item, from}]}. Items earlier meetings scheduled for it; replace with the posted agenda once it is out.
- `issues`: curated live issues {id, title, topic, status, next, summary, points[], keywords[], sources[], related[]}. Edit status/next/points when a related decision happens; never add opinion.
- `council_meetings` (newest first): {body, date, minutes_url, minutes_status draft|final, ocr, attendance{present[],absent[]}, headline, decisions[], discussed[], public_comment[], coming_up[]}.
  - decision: {title, detail, outcome, moved_by, seconded_by, roll_call, dissent[], topic, dollars, ordinance_reading, needs_review, review_note}.
  - `outcome` copied exactly as recorded ("passed 8-0", "failed 3-5", "passed unanimously", "approved, no tally recorded"). Never inferred.
  - `roll_call` only when members are listed by name. `dissent` holds the named minority (for a failed motion, the members who voted yes).
  - `needs_review: true` + `review_note` wherever the minutes are ambiguous or contradict themselves.
- `board_meetings` (newest first): {body, date, record_url, record_type, headline, items:[{address, applicant, request, decision, vote, conditions[], topic, needs_review, review_note}], policy_items[]}. Requests in plain English with jargon explained once in parentheses, e.g. "a variance (permission to break a zoning rule for this one property)".
- Topic tags: Housing & zoning, Parking & transportation, Budget & taxes, Schools, Public safety, Parks & recreation, Infrastructure & utilities, City buildings & facilities, Environment & resilience, Downtown & business, Historic preservation, Government & elections, Arts & culture, Health & human services, Other.

**local.json** (the local desk)
- `notices`: {date, kind, title, detail, source{label,url}, strip?, stripLine?}. `strip` (3 words max) + `stripLine` (8 words max) put a dated happening in Home's "this week" cards.
- `events`: {date, time, title, venue, town, kind, url, source, price?, note?}. Next 45 days only. `events_as_of`.
- `business.closures/openings`: {name, what, date, detail, source{label,url}}.
- `housing`: portsmouth (Redfin monthly), seacoast (Seacoast Board of Realtors monthly via Patch), records[].
- `election`: block for the next election; the page hides it after the date.
- `posts`: snapshot fallback for the Social feed (the live feed comes from /api/feed).

**beyond.json**: county, state and federal officials with sourced positions. Update after every election from official results.

**Limits**: Local campaign finance is paper-only at the City Clerk. School Board agendas are on Google Drive; Police Commission on PowerDMS. Most council votes are tallies only.
