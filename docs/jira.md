# Connecting Jira

Jira **Cloud** only — the client speaks REST API v3 and authenticates with an
email plus an API token. Create a token at
<https://id.atlassian.com/manage-profile/security/api-tokens>, then set in
`.env`:

```
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-token
```

and `docker compose up -d app` to pick it up. **Settings → Jira Cloud → Test
connection** confirms it.

The panel can also store these in the database, which is the fallback when the
environment variables are absent. Prefer the environment: the panel has no
login, so anything saved there is writable by anyone who can reach the URL.

## What a Jira slide can follow

Pick one from a dropdown; the panel fills the rest from your Jira and shows a
live match count as you go. No JQL unless you want it.

| Mode | Shows |
| --- | --- |
| **A whole project** | Counts by status category, completion bar, breakdown, ranked ticket list |
| **One sprint** | The same, scoped to a sprint. Leave it on "whichever sprint is open" and the board follows each new sprint by itself |
| **One epic, in detail** | Dates, progress, forecast finish and a health verdict |
| **Every epic in a project** | Each epic ranked worst-first, so anything slipping is at the top |
| **A custom JQL query** | The escape hatch, for anything the pickers cannot express |

Kanban boards have no sprints. The editor detects this and says so rather than
offering an empty dropdown.

Once the pickers hold enough to draw a board, the editor shows a **live preview
of the slide itself** — the real thing, drawn by the sign's own code against
your unsaved edits, not a mock-up of it. Change the mode, the project or the
heading and it follows. Nothing is saved until you press Save.

## The sprint view

A sprint slide adds a band above the numbers: the window (`Aug 10 → Aug 21`),
how long is left, the sprint goal, work remaining, and a **burndown**.

The dashed line is the ideal pace, the solid line is what actually happened, and
a faint vertical rule marks today. Solid above dashed means behind.

The curve is reconstructed from each ticket's resolution date rather than from
Jira's changelog, which would cost a request per ticket. The trade is that it
uses the sprint's **current** scope for every day, so a ticket added yesterday
is drawn as though it had been in the sprint since day one. Scope churn will
therefore not show up as the step it really was.

Remaining work counts story points when at least 60% of the sprint's tickets
carry an estimate, and falls back to counting tickets when they do not — the same
rule epic health uses, for the same reason.

## Ticket color coding

Every ticket row carries a saturated left edge: blue in progress, amber due
inside the slide's due-soon window, red past due, green done, gray untouched.
Anything with a date also gets a chip — `Aug 18` in amber with `6d`, or in red
with `4d late`.

Finished tickets are struck through and dimmed. Done is the one state that wants
*less* attention, so it recedes and the eye lands on what is still open.

The row background is deliberately left alone. A warm color at low alpha over
the navy panel comes out brown, which reads as "dirty" rather than "due soon"
and carries no meaning at a distance.

Whether a ticket is overdue is decided on the server, so a player with a drifted
clock cannot disagree with the sign about it.

## How "At risk" is decided

An epic's health compares **how much of its schedule has been used** against
**how much of the work is done**. An epic 60% through its dates with 45% of the
work finished has slipped 15 percentage points.

- Past the due date and unfinished → **Overdue**
- Slipped by more than the off-track threshold (default 25 points) → **Off track**
- Slipped by more than the at-risk threshold (default 10 points) → **At risk**
- Otherwise → **On track**

Both thresholds are per-slide. The progress bar draws a notch at the elapsed-time
mark, so fill falling short of the notch is the whole story at a glance.

The verdicts are a traffic light — green, amber, red, with overdue a deeper red
again. The two red states and at risk also ping: a ring pulses out from the
badge, faster for the red states than for amber, and the red rows' accent bars
pulse with them. Tempo is the ranking, so the worst epic pulls the eye from
across the room without anyone reading a word. Complete stays blue on purpose,
outside the stoplight: it is not a health verdict, and a finished epic painted
green looks like a live one that is going well. Motion is dropped entirely if
the player asks for reduced motion.

Two things worth knowing about the inputs:

- **Start dates.** Jira epics frequently have a due date but no start date. When
  one is missing the epic's creation date is used instead and the sign says so,
  rather than refusing to judge.
- **Story points.** Progress can be measured in points instead of ticket counts,
  but it falls back to counting tickets when fewer than 60% of the tickets carry an
  estimate — otherwise an unestimated backlog reads 0% done forever.

## Other behavior

- Responses are cached for `JIRA_CACHE_TTL_SECONDS` (default 120) in memory and
  kept indefinitely in the `jira_cache` table. If Jira becomes unreachable the
  sign keeps showing the last good numbers with a "Cached" badge rather than
  going blank.
- A board scans at most 250 tickets. Past that it reports the true total from
  Jira's approximate-count endpoint but computes the breakdown from the first
  250.
- Custom field ids for story points and start date differ per site, so they are
  discovered from the API rather than hardcoded.
- Credentials never leave the server. The player receives computed results only.
