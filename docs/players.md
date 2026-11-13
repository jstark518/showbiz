# Players and screens

## Deploying to a BrightSign

Open the **Signs** tab, press **Add sign**, name it after where it hangs and pick
what it should show. You get back an address like
`https://sign.example/s/g2x4v7bt2xtgccfupx9v` — point the player at it as a plain
HTML5 page. Nothing else is needed there: no BrightAuthor presentation, no local
content.

Each sign either follows **whatever is on air** or is pinned to one playlist. Pin
them once you have more than one screen, so putting something on air for the
lobby does not also change what the kitchen is showing. Both the name and the
playlist can be changed later without the address changing, which matters
because changing it means walking to the player.

The Signs tab also shows whether each screen is **connected** — that is a live
connection to the server, the same one an edit travels down, so it answers the
question you actually have when a screen looks wrong. A screen that has dropped
shows when it was last heard from instead.

### About the address

The token in the address is the credential. Anyone who has it sees that
playlist, which is exactly what a player on a shelf needs and the reason it is
20 random characters rather than something guessable. **Deleting a sign revokes
its address immediately** — a player still pointed at it falls back to a
placeholder rather than the current playlist, so delete is how you retire a
screen, and re-adding it produces a new address.

Older hand-assembled addresses still work for players already pointed at one:
`/sign/<playlistId>` for a specific playlist, and a bare `/sign` for whatever is
on air. Nothing generates them now.

Things worth knowing:

- **Browser age.** BrightSign firmware embeds a Chromium that trails the desktop
  considerably, and a wall-mounted sign rarely gets updated. The frontend is
  built with `build.target: 'chrome79'` in [vite.config.ts](../vite.config.ts).
  If you are on older OS 8 hardware and see a blank screen, lower that and
  rebuild — a blank page with a syntax error in the console is the usual symptom.
- **Audio.** Videos are muted by default because players block autoplay with
  sound. The renderer retries muted if a play attempt is rejected. Only turn
  muting off if the sign actually has speakers and you have tested that panel.
- **Live updates.** The sign holds a server-sent events connection and reloads
  its playlist when you change something. It also polls once a minute as a
  backstop, and retries with backoff when the server is unreachable, so a
  network blip does not need a visit with a ladder.
- **Clock drift.** Countdowns are corrected by the offset between the player's
  clock and the server's, so a player whose time is wrong still counts down to
  the right moment.
- **Blanking the panel overnight** is better done by the BrightSign itself,
  which can cut the backlight. Slide scheduling only controls what is shown.

## Touch

The sign is a carousel until someone touches it, then it becomes something you
can explore. Nothing here is required: with no touchscreen the loop just plays.

**Navigating the loop**

- **Tap** the background to wake the nav bar. While hidden it ignores input, so
  the first tap only reveals it; it stays up for 10 seconds. Tapping empty space
  again puts it away — tapping the bar itself, or a row, does not.
- The bar carries prev / pause / next plus **one labelled chip per slide**, so
  you can jump straight to a slide instead of pressing next until it comes
  round. The current chip is highlighted and scrolls itself into view; a
  playlist too long to fit scrolls sideways.
- **Swipe** left or right to change slide. The slide follows your finger and
  springs back if you let go short of the threshold, so you can tell the gesture
  registered. A swipe works anywhere, including across a countdown card or an
  epic row — it will not also open whatever it started on.
- **Swipe up or down** on a Jira slide's ticket list to scroll it, when there are
  more tickets than fit. Sideways still changes slide, from anywhere including
  the list itself, and scrolling never opens the row under your finger.
- Arrow keys, Page Up/Down and space work too, for a USB remote or for setup.

The bar is deliberately not permanent: a strip that never moves is a burn-in
risk on a panel that runs for months, and it would cover the bottom of every
slide. Image captions slide up out of its way while it is open.

**Drilling in**

Tapping content opens a detail view rather than merely pausing:

| Tap | Opens |
| --- | --- |
| An epic in the portfolio | That epic's dates, progress, forecast, health and its tickets |
| A breakdown row (a status, assignee or epic) | The tickets in that bucket |
| A ticket anywhere | Assignee, type, priority, due date, points and its link |
| The total ticket count | Every ticket behind the board |
| A countdown card | The date in full, with its description |

Detail views stack, so a breadcrumb tracks where you are and **Back** unwinds one
level. The slideshow is fully suspended while you are drilled in — it does not
advance underneath you.

Because nobody closes a wall panel, the overlay closes itself after the idle
timeout in **Settings → Sign display** (default 45 seconds) and the loop resumes.
A countdown in the corner shows how long is left, and any touch resets it.

Ticket lists scroll, which is the one place the sign permits scrolling at all.
