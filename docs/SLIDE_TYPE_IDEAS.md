# Slide type ideas

Four types ship today: **image**, **video**, **Jira project dashboard** and
**upcoming dates**. This is a backlog of others worth building, with the data
source and the config each would need, so picking one up does not start from a
blank page.

Adding a type touches five places — see [Adding a slide type](#adding-a-slide-type)
at the end.

Rough effort labels: **S** = an afternoon, **M** = a day or two, **L** = longer,
usually because of an integration or an auth flow.

---

## Low-effort, high-value

These need no new external credentials, so they are the cheapest way to make the
loop feel alive.

### Announcement / rich text — S
A headline, body text and an optional accent color. The thing people actually
ask for five minutes after the sign goes up, and the usual reason someone
resorts to making a JPEG in PowerPoint.
- **Config:** `headline`, `body`, `accent`, `align`, `size`
- **Note:** render Markdown, but only a safe subset — this is unauthenticated
  input landing on a screen in the lobby.

### Clock / world clocks — S
Large local time, optionally a row of offices with their current time.
- **Config:** `timezones[]` (IANA name + label), `format` (12/24h), `showDate`
- **Note:** `Intl.DateTimeFormat` with a `timeZone` does all of this; no
  library, no data source.

### Days since last incident — S
One enormous number. Works for safety, for production outages, for anything.
- **Config:** `label`, `sinceDate`, `recordDays`, `accent`
- **Note:** pairs well with a reset button on the touchscreen, behind a
  confirmation.

### Now / next — S
The current slide loop is a carousel; this is a "what's happening today" digest
that pulls from the existing `important_dates` table filtered to today.
- **Config:** reuses the countdown slide's date selection

### Photo gallery — S
Cycle several images inside one slide with a Ken Burns pan, instead of one
image per slide.
- **Config:** `mediaIds[]`, `perImageSeconds`, `effect`
- **Note:** avoids a 40-slide playlist when someone uploads a whole event album.

### QR code — S
Generate a QR from a URL, with a caption. The standard way to get something off
a sign and onto a phone, and it works without a touchscreen.
- **Config:** `url`, `caption`, `size`
- **Note:** render it locally rather than calling an image API, so it still
  works when the network is down.

### Web page embed — S
An `<iframe>` of an internal dashboard that already exists.
- **Config:** `url`, `refreshSeconds`, `zoom`
- **Note:** the escape hatch for everything below — but many sites send
  `X-Frame-Options: DENY` and simply will not load, and anything needing a
  login will show a login screen to the whole office. Treat it as a stopgap,
  not a strategy.

---

## Integrations

Each needs credentials, so each also needs a settings card next to the Jira one,
and the same stale-cache treatment: **serve the last good payload when the API
is unreachable, rather than blanking the slide.**

### Build & deploy status — M
Per-repo or per-pipeline: last build result, duration, who broke it.
- **Source:** GitHub Actions, GitLab CI, Jenkins, CircleCI
- **Config:** `repos[]`, `branchFilter`, `showFailuresOnly`
- **Note:** a red build on the wall is the single most effective CI nag there
  is. Poll conservatively — GitHub's REST rate limit is per token, not per repo.

### On-call roster — M
Who is on call right now, and who is next, with escalation tiers.
- **Source:** PagerDuty, Opsgenie, Grafana OnCall
- **Config:** `scheduleIds[]`, `lookaheadHours`

### Incident / service status — M
Green/amber/red per service, with any open incident summarised.
- **Source:** Statuspage, Better Stack, or your own health endpoints
- **Config:** `services[]`, `showResolvedForMinutes`
- **Note:** worth an **alert override** — a mechanism for a slide to seize the
  whole loop while an incident is open, rather than politely waiting its turn.
  That is a scheduler change, not just a new slide type.

### Meeting room schedule — M
Today's bookings for a room, or a floor's worth of rooms side by side.
- **Source:** Google Calendar API, Microsoft Graph
- **Config:** `calendarIds[]`, `hoursAhead`, `showOrganizer`
- **Note:** mounted outside the room itself this becomes a room-booking panel,
  which is a touch feature and a much bigger piece of work.

### Support queue health — M
Open tickets, oldest waiting, SLA breaches, CSAT.
- **Source:** Zendesk, Intercom, Freshdesk, HubSpot
- **Config:** `viewId`, `slaWarningMinutes`

### Sales / revenue dashboard — M
Pipeline, closed-won this month, progress to target. The classic gong board.
- **Source:** Salesforce, HubSpot, Pipedrive, or a warehouse query
- **Note:** think about who walks past the sign before putting revenue on it.
  A lobby panel is visible to visitors.

### Metrics chart — M
A sparkline or bar chart of one metric over time.
- **Source:** Grafana (its render API returns a PNG, which is by far the
  easiest path), Datadog, Prometheus
- **Config:** `panelUrl` or `query`, `range`, `thresholds`
- **Note:** the PNG route means no charting library in the sign bundle, and it
  inherits whatever styling Grafana already has.

### Weather & forecast — S
Current conditions plus a few days ahead.
- **Source:** Open-Meteo needs no API key at all, which makes it the obvious
  first choice; OpenWeatherMap otherwise
- **Config:** `latitude`, `longitude`, `units`, `days`

### Transit departures — M
Next trains, trams or buses from the stops nearest the office. Genuinely useful
by the door at going-home time.
- **Source:** whatever your local operator publishes; many expose GTFS-realtime
- **Config:** `stopIds[]`, `walkingMinutes`, `maxDepartures`
- **Note:** subtract the walking time and hide anything already unreachable —
  a departure you cannot physically catch is noise.

### Birthdays & anniversaries — M
This week's birthdays and work anniversaries, with photos.
- **Source:** BambooHR, Personio, Workday, or a CSV upload
- **Note:** make opting out easy and obvious. Not everyone wants their birthday
  on a wall, and date of birth is personal data — prefer day-and-month only.

### Git activity — S
Recent merges, a commit leaderboard, open PRs needing review.
- **Source:** GitHub/GitLab API
- **Config:** `repos[]`, `period`, `metric`
- **Note:** leaderboards by commit count reward the wrong behavior. Prefer
  "PRs awaiting review, oldest first", which prompts something useful.

### Now playing — S
Whatever is on the office speakers.
- **Source:** Spotify Web API, Sonos
- **Note:** small, cheap, and disproportionately well liked.

---

## Touch-first

These need the touchscreen, so each also needs a sensible fallback for when the
sign has none — usually "show the results, hide the controls".

### Poll / pulse check — M
One question, a few big buttons, live results. Resets daily.
- **Config:** `question`, `options[]`, `resetSchedule`, `showResults`
- **Storage:** a `poll_responses` table; rate-limit by slide and interval so one
  bored person cannot run up the score.

### Feedback faces — S
Three to five emoji buttons, one tap, aggregated over time. The airport-toilet
pattern, and it works because it costs the passer-by nothing.

### Directory / wayfinding — L
Searchable people and room list, with a floor map. Wants an on-screen keyboard.
- **Note:** add an inactivity reset that returns to the loop, or the sign spends
  its life showing someone's abandoned search for "Dave".

### Visitor check-in — L
Name, who they are visiting, notify by email or Slack.
- **Note:** collects personal data and needs a retention policy. Probably a
  product rather than a slide.

### Menu / cafeteria — S
Today's menu, with tomorrow behind a tap.
- **Source:** a spreadsheet, or typed into the panel

---

## Ambient and utility

### Fundraiser thermometer — S
Progress to a charity target. A big filling bar.
- **Config:** `label`, `target`, `current`, `unit`, `accent`

### New starters — S
Photo, name, team, start date, for anyone who joined in the last fortnight.

### Kudos wall — M
Shout-outs submitted from Slack, cycling on the sign.
- **Source:** a Slack slash command or an emoji reaction hook
- **Note:** needs a moderation queue in the panel. It will be tested.

### Countdown to sprint end — S
Days left in the current sprint, with scope burn-down. Complements the Jira
board; reuses the Jira credentials that are already configured.

### Screensaver / idle — S
Clock and logo on a dim background for out-of-hours, driven by the scheduling
window that slides already support.
- **Note:** a full black-screen schedule is better handled by the BrightSign
  itself, which can actually cut the panel's backlight and save the power.

---

## Adding a slide type

A new type goes in a plugin under `plugins/`. `plugins/data-table/` is the
smallest complete example — a slide type, a panel tab and a table of its own —
and is the one to copy. In order:

1. **`plugins/<id>/shared.ts`** — a `…SlideConfig` interface and a
   `*_SLIDE_TYPES` entry giving the label and starting duration.
2. **`plugins/index.ts`** — the config in `PluginSlideConfigMap`, the spec in
   the `PLUGIN_SLIDE_SPECS` spread, and anything the sign needs to draw it in
   `PluginSignData`.
3. **`plugins/<id>/server/index.ts`** — a zod schema per slide type, plus
   routes and a `signData` hook if it has either; register the plugin in
   `plugins/server/index.ts`. Give every schema field a `.default()` *and* a
   `.catch()`, so a malformed row degrades instead of blanking the sign.
4. **`server/migrations/`** — a new numbered `.sql` file extending the `type`
   check constraint on `slides`, and creating any table the plugin needs. The
   runner applies files in name order and records them in `_migrations`;
   migrations stay a single sequence even for plugin tables.
5. **`plugins/<id>/web/sign.tsx`** — a renderer, a nav chip and any drill-in
   views; register it in `plugins/web/sign.tsx`.
6. **`plugins/<id>/web/admin.tsx`** — an editor, plus a tab or a Settings card
   if it needs one; register it in `plugins/web/admin.tsx`.

Keep server-only code under `server/` and browser code under `web/`: the two
tsconfigs use those folder names as the boundary, so a file in the wrong place
fails typecheck rather than bloating a bundle.

For a type that fetches from an external API, follow the Jira slide:

- Credentials live server-side only and are **never** sent to the sign. The
  player gets computed results, not tokens.
- Expose it as `GET /api/sign/slides/:id/<kind>` so the sign refreshes that one
  board on its own cadence, instead of the whole playlist waiting on a slow API.
- Cache in memory with a TTL *and* in a table for durability. When the upstream
  fails, serve the last good payload with `stale: true` and let the renderer
  show a "Cached" badge. A sign that quietly shows slightly old numbers is far
  better than one showing an error to a room full of people.
- Declare `loadPreview` on the slide spec so the panel's preview can draw an
  unsaved draft with the sign's own component. A type that only draws stored
  rows needs none: its editor passes them to `SlidePreview` directly.
