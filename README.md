# shwobiz

Digital signage slideshow for a BrightSign player, with a web control panel.

The player loads one URL and plays a loop. Everything about that loop — slides,
order, timings, media, Jira boards, countdowns — is edited from a browser and
lands on the sign within about a second, without touching the player.

Touch is supported but never required: with no touchscreen the sign is a plain
autoplaying carousel.

## Slide types

| Type | What it shows |
| --- | --- |
| **Image** | A still, cover or letterboxed, with an optional caption |
| **Video** | A clip, muted by default, either playing to the end or cut off by the slide timer |
| **Jira project dashboard** | A project, a sprint, one epic in depth, or every epic in a project ranked by health. Built from dropdowns — no JQL required |
| **Upcoming dates** | Countdowns to important dates, in whole days or ticking to the second on the last day |
| **Data table** | A small grid you keep by hand — an on-call rota, a league ladder — edited on the **Tables** tab |

Image and video are built in. The rest are **plugins**: self-contained folders
under `plugins/` that add a slide type and, where it makes sense, a tab of their
own. Removing one is deleting its folder and four lines of registry.

[docs/SLIDE_TYPE_IDEAS.md](docs/SLIDE_TYPE_IDEAS.md) has a backlog of further
types with data sources and config sketches, and
[CLAUDE.md](CLAUDE.md#adding-a-slide-type) has what writing one involves.

## Keeping a table

The **Tables** tab holds small grids you maintain by hand — who is on call,
this week's lunch rota, a league ladder. Press **New table**, name it, and type
into the grid: headings across the top with an alignment each, rows below with
arrows to reorder them and an ✕ to remove one. Up to 8 columns and 100 rows,
which is far more than a wall panel can show legibly.

Nothing is saved until you press **Save** — the whole grid goes in one write,
so adding a column and filling it in is a single change rather than thirty.

Then add a **Data table** slide, point it at the table and set how many rows to
show; anything past that is counted underneath ("+ 3 more") rather than
silently dropped. The slide follows the table, so correcting a name on the
Tables tab reaches every sign showing it within about a second — no slide to
re-edit. Deleting a table leaves any slide using it saying so in plain language
instead of going blank.

## Making an image without a designer

Seven templates ship with the app. Change the words, and the panel turns one
into an image on your media library — no image editor, and nothing to install.

**Media → Make one from a template**, or the same button on any image slide, in
which case the result lands on that slide as well.

| Template | For |
| --- | --- |
| Statement | Artwork and one big sentence |
| Event notice | A date block beside a headline |
| Two facts | Guest Wi-Fi, a door code, a number and an extension |
| Please do this | A house rule, said without nagging |
| Three numbers | A stats board |
| Welcome | A lobby or reception greeting |
| Portrait poster | The same, for a panel hung the other way up |

Text that runs long wraps across the lines the artwork allows and then shrinks
to fit; press Enter to break a line yourself. Click any text in the preview to
jump to the field that draws it. If something still will not fit, the field
says so rather than quietly rendering it microscopic.

The rendering happens in your browser and uploads an ordinary JPEG, so the
server needs no image toolchain and the templates stay
[out of the media library](#security), where an SVG would be a liability.

### Changing one later

What you typed is stored with the image, so **Edit wording** reopens it with
last time's text already in the boxes — on the Media tab, or on any slide
showing it. Next quarter's all-hands is a date change, not a retype.

There are two ways to save the result:

| | |
| --- | --- |
| **Update this image** | Keeps the same entry, so every slide already showing it picks up the new version by itself |
| **Save as a separate image** | Leaves the original where it is |

Updating swaps in a new file rather than overwriting the old path, because
`/media` is served immutable and cached for a month — reusing the address would
leave players showing last quarter's date until something evicted it.

What is stored is the wording, not the drawing: a few hundred bytes of text
against a template id. Edit a template's artwork and every image made from it
picks up the new look the next time it is regenerated.

### Writing a template

This section is meant to be enough on its own. The sources are annotated SVGs in
[server/templates/](server/templates/). **Drop a new `.svg` in that directory and
it appears** — the filename without its extension is the id, and there is nothing
to register. They are read once per process, so restart the server (`npm run dev`
does it on save) or rebuild the image to pick up a new one.

Everything is declared in `data-` attributes, parsed by
[web/src/lib/template.ts](web/src/lib/template.ts). Copy an existing file rather
than starting blank: `celebration.svg` shows a scatter with motion,
`heads-up.svg` a plain left-aligned layout, `holiday-hours.svg` two date fields.

#### The shell

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"
     viewBox="0 0 1920 1080" data-category="Holidays">
  <title>Holiday hours</title>
  <desc>One line describing when to reach for this. Shown in the gallery.</desc>
```

1920×1080 throughout. `<title>` is the gallery name, `<desc>` its description.
`data-category` sections both pickers and defaults to `Everyday`; a new value
sorts after the known ones until it is added to `CATEGORY_ORDER` in
`web/src/lib/template.ts`.

**A template must be entirely self-contained.** The panel rasterizes it by
drawing the SVG into a canvas and calling `toBlob`. A reference to an external
font, image or stylesheet taints the canvas and `toBlob` throws instead of
producing a JPEG. Everything is drawn, and text uses the system font stack the
other templates use.

Ids are namespaced per template when parsed, so every file calling its gradient
`bg` and its blur `soft` is fine.

#### Text fields

```xml
<text data-field="headline" data-label="Headline"
      data-hint="It wraps across two lines." data-fit="1150"
      x="146" y="450" font-size="140" font-weight="700" fill="#f8fafc">Quarterly</text>
<text data-field="headline" data-fit="1150"
      x="146" y="590" font-size="140" font-weight="700" fill="#f8fafc">all-hands</text>
```

- `data-field` is the id, and **two elements sharing one are two *lines* of a
  single thing to type into**, in document order. What you type wraps across
  them; pressing Enter wins over auto-wrap, so the artwork's own line break
  survives a round trip.
- `data-label` (on the first element of the group) is what the panel calls it,
  `data-hint` is an optional note under the input.
- `data-fit` is how wide the text may get, in the SVG's own units. Text past it
  shrinks to 45% and then spills — visibly, on purpose, because a caption that
  quietly became microscopic is worse than one that tells you to cut words.
- **Every `data-field` element needs its own `font-size` attribute.** Fitting
  reads it to reset before measuring; inherit it from a parent `<g>` and the
  shrink-to-fit maths has nothing to work with.

#### Dates

One value drives several elements, each drawing a piece, so a date block is a
date picker rather than three boxes that can disagree about what day it is:

```xml
<text data-field="when" data-type="date" data-part="weekday" data-case="upper" …>THURSDAY</text>
<text data-field="when" data-part="day" …>18</text>
<text data-field="when" data-part="month" …>September</text>
```

`data-part` is `weekday`, `day`, `month`, `year` or `date` (the whole thing).
`data-case="upper"` matches artwork set in capitals. `data-value="2026-09-18"`
sets what it opens on; without it, today. Dates are formatted `en-US` regardless
of the editing machine's locale, so an image made at one desk reads the same as
one made at another.

#### Colors

A color paints attributes instead of writing text, so it has its own attribute —
an element often needs to be a line of text *and* take its color from a swatch:

```xml
<circle data-paint-field="accent" data-paint="fill" data-paint-label="Accent color"
        data-paint-swatch="#f59e0b #ef4444 #38bdf8 #4ade80 #a78bfa #f472b6" fill="#f59e0b" …/>
<rect data-paint-field="accent" data-paint="fill stroke" …/>
```

`data-paint` names the attributes to set, defaulting to `fill`; it takes several,
space-separated. **The first element with a given `data-paint-field` in document
order sets the field's opening value** (read from its first painted attribute)
and should be the one carrying `data-paint-label`. `data-paint-swatch` is the
presets offered before the full picker — usually the palette the artwork was
drawn against.

Only paint *some* of a scatter. Wiring every confetti piece to one picker turns
confetti into a monochrome pattern.

#### Motion

Optional. A template that declares any motion also becomes available as a **live
template slide**, which the sign renders and animates; one without stays a
media-library template that rasterizes to a flat JPEG. Both come from the same
file — `rasterize.ts` serializes the markup without the page's stylesheet, so an
animated element moves on the sign and sits still in the export.

```xml
<g transform="translate(300 230)">
  <path data-animate="draw" data-animate-delay="2" pathLength="1" d="…"/>
</g>
```

Motions are defined in
[plugins/template/web/sign.css](plugins/template/web/sign.css):
`rise` · `pop` · `fade` · `sweep` · `draw` · `drift` · `breathe` · `pulse`.
`data-animate-delay` is 1–6, in 120ms steps, for staggering a group.

Three rules that are easy to get wrong and awkward to notice:

- **Never put a `transform` attribute on an element carrying `data-animate`.**
  The motions animate the `transform` property, and a CSS animation overrides a
  presentation attribute outright rather than composing with it — so the
  attribute is discarded for the life of the animation. A confetti piece written
  as `<rect transform="rotate(-18 …)" data-animate="drift">` sits tilted in the
  panel and snaps upright on the sign. Put placement on a wrapper `<g>` and
  motion on the child.
- **`draw` needs `pathLength="1"`, and only on a `<path>`.** The normalization
  is what makes a short arc and a long one take the same time. `pathLength` on a
  `<rect>` or `<circle>` is SVG2 and lands well after the Chromium a BrightSign
  runs; ignored, `stroke-dasharray: 1` measures against the real perimeter and
  the line renders as dots. Write rounded rectangles and circles as paths.
- **Nothing may set a resting opacity or transform.** An element's rest state
  has to be its normal one, so a player with reduced motion — or one too old to
  run the animation — shows finished artwork rather than a page of invisible
  text.

Entry motions are one-shot; `drift`, `breathe` and `pulse` loop. Use the looping
ones sparingly: a slide is on the wall for twenty seconds next to people trying
to work.

#### Check it

Open the panel, pick the template from **Media → Make one from a template**, and
type into every field. The editor flags any field whose text still spills at
minimum size. For motion, put it on a template slide and use **Play again** in
the slide editor, which runs the real thing.

Two things worth checking that are easy to miss: that decoration does not land on
top of the text (measure, don't eyeball — a corner ornament sitting on the kicker
is invisible in a thumbnail), and that the stock wording you shipped in the file
actually fits its own boxes.

Write sample text in American English — it ends up on a wall.

To rasterize every template with its stock wording, for seeding a fresh install
or eyeballing a change across all of them at once:

```bash
./samples/render.sh
```

That needs Chrome on the machine doing the rendering. You do not need it to use
the templates; the panel does its own.

## Running it

Requires Docker with Compose v2.

```bash
cp .env.example .env
```

Edit `.env` — at minimum set `POSTGRES_PASSWORD`, and keep `DATABASE_URL` in
step with it. Then:

```bash
docker compose up -d --build
```

- Control panel: <http://localhost:3000/>
- Sign: <http://localhost:3000/sign>

The panel is the root. A sign is a screen you add on the **Signs** tab, which
hands back an address of its own to point a player at.

**Preview sign** in the top bar plays the selected playlist in a window over the
panel, without navigating away. It is the live sign, so touch works in it: tap
to wake the bottom bar, swipe between slides, tap a card to drill in. There is
still a link inside it to open the sign full-screen in its own tab, which is
what to use for a real check of how a 1080p panel looks.

The app applies its migrations at startup and seeds one empty playlist named
"Main loop", already on air. Add slides to it from the panel.

### Reaching it from other devices

The container listens on `0.0.0.0` and the published port binds every host
interface, so the same two URLs work from anywhere on the network with the
host's address in place of `localhost` — which is exactly what the player needs.
On macOS:

```bash
ipconfig getifaddr en0
```

If a device still cannot connect, the cause is upstream of this app: a host
firewall, client isolation on the Wi-Fi (common on guest networks), the phone
being on a different VLAN or a VPN, or the host asleep. Check with
`curl http://<host-ip>:3000/` from the host itself first — if that answers, the
app is doing its part.

Worth saying plainly, since this is the moment it matters: the panel has **no
login**. Publishing the port to the network means anyone on that network can
change what the sign shows and upload files to it. See [Security](#security).

To stop, keeping the database and uploads:

```bash
docker compose down
```

Add `-v` to that command to also delete the `db-data` and `media-data` volumes.
That erases every slide, date and uploaded file.

## Deploying to a cluster

The GitLab mirror of this repo **is** the deployment: a push to `main` builds
the image with Kaniko, pushes it to `$REGISTRY/sign`, and applies `k8s/` from
inside the cluster. Nothing is applied from a laptop.

The private coordinates — registry hostname, ingress hostname — are CI/CD
variables rather than literals in this repo, which is public. `REGISTRY` and
`SIGN_HOST` are the two that matter; see
[Registries](#registries) and [.gitlab-ci.yml](.gitlab-ci.yml).

```bash
git push origin main
```

Then watch **Build → Pipelines** in GitLab. What lands:

| | |
|---|---|
| Namespace | `sign` |
| Image | `$REGISTRY/sign:latest` and `:<short-sha>` |
| Database | CloudNativePG `Cluster/sign-pg` — the operator generates the `sign-pg-app` Secret the app reads as `DATABASE_URL` |
| Uploads | MinIO bucket `sign`, via the `sign-s3` Secret — no volume |
| Private URL | `https://$SIGN_HOST` — LAN only, cert from `letsencrypt-prod` |
| Public URL | The Cloudflare Tunnel hostname, see below |

One replica, `strategy: Recreate`. That is not timidity about scale, and since
uploads moved to MinIO there is only one reason left for it: server-sent events
fan out in-process, so a second pod would leave signs holding an SSE stream that
never hears about an edit made on the other one — stale until their 60s poll
caught up. Going wider means moving the event bus to Postgres
`LISTEN`/`NOTIFY` first. Until then one pod is the correct number, and the sign
is built to keep playing across the restart gap.

### Uploads in the cluster

Images and videos go to the cluster MinIO rather than to a volume. `S3_BUCKET`
is what selects it; with that unset the app writes to `MEDIA_DIR`, which is what
`docker compose` does.

**There is nothing to set up by hand.** The deploy does it, following the same
pattern the cluster's own MinIO deployment uses, so this is the house style
rather than something invented here.

On the first deploy it generates a key and then applies
[`k8s/minio-bootstrap.yaml`](k8s/minio-bootstrap.yaml), a Job that creates:

- the `sign` bucket, with versioning on
- a MinIO user `sign`
- a `sign-bucket` policy granting `s3:*` on that bucket **and nothing else**

**The Job runs in the `minio` namespace, not `sign`.** `minio-root` lives there
and Kubernetes has no cross-namespace Secret reference, so that is where the
credentials can be read without copying them anywhere. The key is generated
there too and copied into `sign` for the Deployment to read; both arrive in the
Job as `secretKeyRef`s, so neither appears in a manifest or a CI log.

**Generated once, and only if absent.** A rerun never rotates a working key out
from under the app. To rotate deliberately, delete both Secrets and redeploy.

**All of it runs before `kubectl apply`.** The app will not start without these
credentials and `strategy: Recreate` puts the old pod down before the new one
comes up, so a problem found at rollout time would be an outage rather than a
failed job.

**The bytes are proxied through the app, not linked to directly.** MinIO has no
Ingress — `http://minio.minio.svc:9000` is reachable inside the cluster only —
so a presigned URL would point somewhere a player on the office network cannot
open. `/media/<file>` is served by the app either way, which also means moving
between a directory and a bucket rewrites no stored URL.

### Moving uploads to MinIO

For an install that already has files on the old `sign-media` volume, copy them
across before the deploy that switches the bucket on. The PVC is
`ReadWriteOnce`, so the app has to let go of it first:

```bash
kubectl -n sign scale deploy/sign --replicas=0
sed "s|__MC_IMAGE__|${MC_IMAGE}|" k8s/media-migrate-job.yaml | kubectl apply -f -
kubectl -n sign logs -f job/sign-media-migrate
kubectl -n sign delete job sign-media-migrate
kubectl -n sign scale deploy/sign --replicas=1
```

The Job is `mc mirror`, which skips objects already present at the same size, so
running it twice is safe — and running it again afterwards catches anything
uploaded in between. Set `MC_IMAGE` to a MinIO client image first: the manifest
carries a placeholder rather than a registry hostname, for the same reason
[k8s/sign.yaml](k8s/sign.yaml) does.

`k8s/sign.yaml` no longer declares the PVC, but `kubectl apply` only touches
what a file contains, so **the claim and its data survive the deploy**. Delete
it deliberately once you are satisfied:

```bash
kubectl -n sign delete pvc sign-media
```

### Jira credentials in the cluster

The `sign-jira` Secret is optional and deliberately **not** owned by CI, so a
redeploy can never rotate it out from under the app. Either type the credentials
into the panel's Jira tab, or create the Secret yourself and let env win:

```bash
kubectl -n sign create secret generic sign-jira \
  --from-literal=base-url=https://your-org.atlassian.net \
  --from-literal=email=you@example.com \
  --from-literal=api-token=<token>
```

```bash
kubectl -n sign rollout restart deploy/sign
```

### Going public

`$SIGN_HOST` resolves to the in-cluster ingress and is LAN only. The public URL
is a **Cloudflare Tunnel** hostname, which lives in the Cloudflare dashboard and
in no repo — it is the one part of a deploy that `git push` does not capture,
and it is deliberately not written down here. Under **Zero Trust → Networks →
Tunnels → your tunnel → Public Hostnames**, add:

- The subdomain and domain you want to serve on
- Service **HTTP** → `sign.sign.svc.cluster.local:80`

That path bypasses the Ingress entirely, so the `proxy-body-size` and SSE
annotations in `k8s/sign.yaml` do not apply to it — Cloudflare's own upload limit
governs, which is why the panel is best driven over the LAN URL and the public
one left to the sign.

Because the panel has no login, put a **Cloudflare Access** policy on the
hostname before it is reachable, and a WAF rate-limit rule after it. Without one,
that hostname exposes every write endpoint to the internet — see
[Security](#security).

## Connecting Jira

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

### What a Jira slide can follow

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

### The sprint view

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

### Ticket color coding

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

### How "At risk" is decided

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

### Other behavior

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
  built with `build.target: 'chrome79'` in [vite.config.ts](vite.config.ts).
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

## Development

Requires Node 22+ and a reachable Postgres. Easiest is to run the database from
compose and the app on the host:

```bash
docker compose up -d db
```

Publish the database port by adding `ports: ["5432:5432"]` to the `db` service,
point `DATABASE_URL` at `localhost`, then:

```bash
npm install
npm run dev
```

That runs the API on :3000 and Vite on :5173 with a proxy, so use
<http://localhost:5173/> for the panel and
<http://localhost:5173/sign.html> for the sign.

| Command | Does |
| --- | --- |
| `npm run dev` | API with reload, plus the Vite dev server |
| `npm run build` | Builds both frontends and bundles the server |
| `npm run typecheck` | Typechecks server and web separately |
| `npm start` | Runs the built server |

### Registries

Everything in this repo resolves to **public** registries by default, so a
clone builds with nothing but Docker and an internet connection. The private
mirrors used for the maintainer's own deployment are supplied as overrides, and
nothing you need to build is behind them. Their hostnames are CI/CD variables,
not literals here.

| What | Public default | Private override | Set by |
| --- | --- | --- | --- |
| npm packages | `registry.npmjs.org` (`.npmrc`) | the on-prem Verdaccio | `NPM_CONFIG_REGISTRY` |
| Runtime base image | `node:24.22.3-slim` | `$REGISTRY/docker-base-node:24` | `NODE_IMAGE` |
| Build base image | `node:24.22.3` | `$REGISTRY/docker-base-node-build:24` | `NODE_BUILD_IMAGE` |
| App image, ingress host | — | `$REGISTRY/sign`, `$SIGN_HOST` | `k8s/` placeholders |

The npm half rests on one detail of `npm ci`. npm rewrites a `resolved` URL in
the lockfile that points at the **default** registry to whatever registry is
configured — so this lockfile, resolved against `registry.npmjs.org`, installs
entirely from Verdaccio when `NPM_CONFIG_REGISTRY` names it, integrity hashes
and all. It does **not** rewrite the other way: a lockfile carrying
a private mirror's URL makes `npm ci` request that host regardless of
configuration, and an outside clone fails with `ENOTFOUND` on every package.

So the committed lockfile must stay public. That is what `.npmrc` in the repo
root is for: a project `.npmrc` beats a user one, so `npm install` writes public
URLs even on a machine whose `~/.npmrc` defaults to the on-prem mirror. Delete
it and the next dependency change quietly re-pins the lockfile to the LAN.
Environment variables beat a project `.npmrc`, which is why the private path
still works and needs no file of its own.

To build against the private mirrors by hand:

```bash
docker compose build --build-arg NPM_CONFIG_REGISTRY="$NPM_MIRROR" --build-arg NODE_IMAGE="$REGISTRY/docker-base-node:24" --build-arg NODE_BUILD_IMAGE="$REGISTRY/docker-base-node-build:24"
```

In CI none of that is typed: Kaniko injects `NPM_CONFIG_REGISTRY`, and the two
base images are derived from `$REGISTRY` in
[.gitlab-ci.yml](.gitlab-ci.yml). `REGISTRY` is the single CI/CD variable the
deployment needs; its default there is a `.invalid` host, so a fork that has not
set it fails on a name it can read instead of reaching anything real.

One consequence worth knowing when changing the Dockerfile: the public node
images have no uid 10001 `app` account, which is what `runAsUser` in
[k8s/sign.yaml](k8s/sign.yaml) names. The runtime stage creates it when absent
and runs `USER 10001` numerically, so the image starts on either base.

### Layout

```
shared/types.ts        Core wire types shared by server, sign and panel
server/src/            Fastify API and migrations runner
server/migrations/     Numbered .sql files, applied in order at startup
server/templates/      Annotated SVGs the panel turns into images
plugins/               One folder per feature: dates, jira, data-table
plugins/index.ts       The registry — what is installed
plugins/<id>/shared.ts   Wire types that plugin owns
plugins/<id>/server/     Its routes, schemas and upstream clients
plugins/<id>/web/        Its slide renderer, editor, tab and stylesheets
web/index.html         Control panel entry point — the panel is the root
web/sign.html          Sign entry point, served at /s/:token (and legacy /sign)
web/preview.html       Framed by the panel to preview a slide, never opened directly
web/src/sign/          Slideshow engine, core renderers, drill-in shell
web/src/admin/         Control panel pages, playlists and media
web/src/admin/templates/  Template gallery, text fitting and rasterizing
```

A plugin's folders are also a build boundary: the two tsconfigs keep `server/`
out of the browser projects and `web/` out of the server's, so nothing can
accidentally ship postgres.js to a player or React to the API.

### Writing a plugin

This section is meant to be enough on its own. Copy
[plugins/data-table/](plugins/data-table/) — it is the smallest complete
example, with a slide type, a panel tab, routes, a table of its own and rows
that travel with the playlist.

**What belongs in a plugin.** Anything that is a *feature*: a slide type, a tab,
a set of credentials, an upstream integration. Image and video are deliberately
not plugins — they are the media library on screen and have nothing of their own
to store, fetch or configure. Machinery (playlists, slides, media, signs,
settings, the blackout schedule) is core.

#### 1. Lay out the folder

```
plugins/<id>/shared.ts     Wire types this plugin owns. Both sides import it.
plugins/<id>/server/       Fastify routes, SQL, upstream clients, zod schemas.
plugins/<id>/web/          Sign renderer, panel editor, tab, stylesheets.
```

**The folder names are a build boundary, not a filing preference.** The server
tsconfig takes `plugins/**/*.ts` and excludes `**/web/**`; the browser projects
take `.ts` and `.tsx` and exclude `**/server/**`. Put a server file under `web/`
and you get a typecheck error that reads like a missing dependency. Note also
that the server project stops at the `.ts` extension, which is why every
browser-side contract file is `.tsx`.

**Imports are relative, with no aliases and no extensions.** From
`plugins/<id>/web/` you reach the host as `../../../web/src/admin/components`
and shared types as `../../../shared/types`. Don't add path aliases.

#### 2. Declare the wire types

`plugins/<id>/shared.ts` owns the config interface for each slide type it adds,
plus a spec object:

```ts
export interface MySlideConfig {
  sourceId: string | null;
  heading: string;
}

export const MY_SLIDE_TYPES = {
  my_slide: { label: 'My slide', defaultDurationSeconds: 20, usesTheme: true },
} as const;
```

`usesTheme` says light-or-dark is a real choice for this type. Leave it off for
anything that fills the panel with artwork of its own, where the control would
be a question with no answer.

#### 3. Register it — six places, all static

There is no discovery. esbuild and Vite both need to see the import, and a list
you can read beats a glob.

| File | Add |
| --- | --- |
| `plugins/index.ts` | the config in `PluginSlideConfigMap`, the spec in the `PLUGIN_SLIDE_SPECS` spread, and any rows the sign needs in `PluginSignData` + `EMPTY_PLUGIN_SIGN_DATA` |
| `plugins/server/index.ts` | your plugin in `SERVER_PLUGINS` |
| `plugins/web/sign.tsx` | your plugin in `SIGN_PLUGINS` |
| `plugins/web/admin.tsx` | your plugin in `ADMIN_PLUGINS` |
| `server/migrations/000N_*.sql` | a new numbered file extending the `type` check constraint on `slides` |
| — | nothing else; there is no config file to touch |

The order of the `PLUGIN_SLIDE_SPECS` spread is visible: it decides the sequence
of the panel's "add a slide" buttons.

#### 4. Add the migration

`server/migrations/` is one numbered sequence applied in order at boot. **Never
edit an applied file.** Slide `config` is JSONB, so a config shape change needs
no migration — only the type constraint does:

```sql
-- The <id> plugin: <one line on what it stores>.
alter table slides drop constraint if exists slides_type_check;
alter table slides add constraint slides_type_check
  check (type in ('image', 'video', 'jira_dashboard', 'countdown', 'data_table',
                  'template', 'my_slide'));
```

Copy the current list from the newest migration that sets it and append yours;
the constraint is replaced wholesale each time. Say in the header which plugin
the file is for — a plugin does not own a migration, it borrows a number.

#### 5. The server half

```ts
// plugins/<id>/server/index.ts
import type { ServerPlugin } from '../../server/types';

export const myPlugin: ServerPlugin = {
  id: 'my-plugin',                    // also the log prefix when a hook fails
  slides: { my_slide: myConfigSchema },
  routes,                             // optional: async (app) => { ... }
  signData,                           // optional: rows to send with the playlist
};
```

**Config schemas need both `.default()` and `.catch()` on every field.** A row
written by an older build, or edited by hand in psql, must degrade to something
renderable. A sign showing a stack trace to the office is the failure being
designed against.

```ts
const myConfigSchema = z.object({
  sourceId: z.uuid().nullable().catch(null).default(null),
  heading: z.string().max(120).catch('').default(''),
});
```

Useful helpers: `sql` and `json` from `server/src/db` (postgres.js tagged
templates — use `json()`, not `sql.json()`, whose `JSONValue` union rejects plain
interfaces), `parseOrThrow`/`notFound`/`badRequest` from `server/src/http`, and
`broadcast({ type: 'content-changed' })` from `server/src/events` after any write
so connected signs reload within a second.

If a route of yours needs to read a stored slide config, normalize it with
`normalizeConfig` from `plugins/server/config` — **not** core's
`normalizeSlideConfig`, which would import the registry that imports you. The
dependency runs core → registry → plugin, one way, and that is the rule to check
against whenever an import feels awkward.

**Two ways to get data to the sign, and the choice matters:**

- **`signData`** — rows travel inside the playlist document. Right for anything
  stored locally. You are handed the enabled, in-window slides about to play, so
  send only what they reference rather than your whole table. Return a
  `revision` (row ids and `updated_at` is the usual shape) that folds into the
  playlist hash: too lazy and an edit never reaches the wall, too eager and every
  poll restarts the loop from slide one.
- **A per-slide endpoint** — right for anything fetched from upstream. Expose
  `GET /api/sign/slides/:id/<kind>`, let the slide refresh on its own cadence,
  and cache in memory *and* in a table so an outage serves a stale copy instead
  of a blank panel. Follow `plugins/jira/`. This is what keeps one slow upstream
  from delaying the whole loop.

A `signData` that throws is caught and logged per plugin, so one broken plugin
draws its own placeholder rather than 500ing the playlist for every other slide.

#### 6. The sign half

```tsx
// plugins/<id>/web/sign.tsx
import { SlidePlaceholder } from '../../../web/src/sign/slides/SlidePlaceholder';
import { NAV_ICON_PROPS, type SignPlugin } from '../../web/types';
import './sign.css';

export const mySignPlugin: SignPlugin = {
  id: 'my-plugin',
  slides: {
    my_slide: {
      render: ({ slide, data, media, clockOffsetMs, onFinished, onDrill, preview }) => …,
      nav: { label: 'Mine', icon: <svg {...NAV_ICON_PROPS}>…</svg> },  // optional
      prefetch: (slide) => …,      // optional: warm before the loop arrives
      loadPreview: (slide, signal) => …,  // optional: draw an unsaved draft
    },
  },
  drill: { 'my-thing': drillView<MyTarget>({ title, render }) },  // optional
};
```

**Every not-ready state gets a `SlidePlaceholder` saying what is wrong in plain
language** — "No table chosen yet. Pick one in the control panel." Nothing
chosen, a deleted target and an empty result are ordinary states, not faults,
and someone walking past has to be able to fix it. The governing rule of this
app is that the sign must never go blank.

`onDrill` is absent on a sign with no touchscreen. Tapping content pushes a
target onto the drill stack; register a view per `kind` and a kind this build
does not know draws a message rather than crashing.

#### 7. The panel half

```tsx
// plugins/<id>/web/admin.tsx
import type { AdminPlugin, SlideEditorProps } from '../../web/types';
import './admin.css';

export const myAdminPlugin: AdminPlugin = {
  id: 'my-plugin',
  slides: { my_slide: MyEditor },
  tabs: [{ id: 'mine', label: 'Mine', page: MyPage }],  // optional; id is the hash route
  settings: [MySettingsCard],                            // optional
  conversions: [ … ],                                    // optional
};
```

An editor gets `{ config, onChange, slide, media }` and calls `onChange` with a
*patch*, not the whole config. Reuse `Field`, `Toggle`, `Banner`, `Spinner` and
`EmptyState` from `web/src/admin/components`, and `useAsync` for loading. Drop in
`SlidePreview` to show the real sign renderer against the unsaved draft — never
write a second implementation of a slide, because it lies the moment either copy
changes.

**Call your own routes from `plugins/<id>/web/client.ts`, using `apiRequest`
from `web/src/lib/api`** — the same error handling as everything else. Do *not*
add entries to the `api` object in that file. Keeping a plugin's endpoints in the
plugin is what makes deleting one a matter of removing its folder and its four
registry lines, with nothing left behind in core.

**Stylesheets are global, so namespace every class per plugin.**
`plugins/<id>/web/sign.css` is imported by the renderer, which lands it after
`sign.css` so it can lean on that file's variables. Both `main.tsx` files import
the host stylesheet *before* `App` for exactly this reason.

#### 8. Check it

```bash
npm run typecheck
docker compose up -d --build app
```

There are no tests. Verify by exercising the real thing: `curl` your routes,
check `GET /api/sign/playlist` carries what you expect, add a slide in the panel
at <http://localhost:3000/>, and watch it on the sign. Confirm the placeholder
path too — delete the thing the slide points at and make sure the sign says so
rather than going blank.

A finished plugin should be removable by deleting its folder and its four
registry lines, leaving core untouched. If something else has to be unpicked as
well, that is the thing to move back into the plugin.

One container serves the frontends and the API. Vite builds three entry points
from one project, so they share `shared/types.ts` and the sign bundle stays
small — the panel's code is never shipped to the player. The preview entry
imports the sign's renderers and stylesheet but is panel tooling, which is why
it is its own entry rather than a branch inside the sign.

React and Vite sit in `devDependencies` on purpose: the frontends are bundled at
build time, so the runtime image installs `--omit=dev` and does not carry them.

### Data model

`playlists` → `slides` (ordered, with type-specific JSONB `config`), plus
`media_assets`, `settings`, and a table per plugin that needs one —
`important_dates`, `data_tables`, `jira_cache`. A partial unique index enforces
that exactly one playlist is on air. Migrations stay one numbered sequence in
`server/migrations/` even for plugin tables: the runner applies them in a single
order, and 0001 already created the first of them.

Slide configs are validated with zod on write *and* normalized on read. Every
field has both a default and a catch, so a row written by an older version — or
edited by hand — degrades to something sensible instead of taking the sign down.

## Security

There is **no authentication**, by choice. Anyone who can reach the control
panel can change what the sign shows and upload files to it. Run it on a trusted
network segment, or put a reverse proxy with authentication in front of `/admin`
and `/api` before it goes anywhere less private.

That last sentence is load-bearing for the public deployment. The sign and the
panel are one origin and one process — there is no read-only mode to expose
instead. So a public hostname is only as private as the **Cloudflare Access**
policy sitting in front of it; the app behind it grants a stranger exactly what
it grants the owner. If that hostname ever needs to be genuinely open, the fix is
a second Deployment running the same image with the write routes never
registered, not a setting.

A sign's token is a bearer credential in a URL. That is deliberate — a player
on a shelf cannot log in — but it means the address is worth treating like a
password: it is ~99 bits of entropy, it never appears in a log the panel writes,
and deleting the sign is what revokes it. Anyone holding one sees that playlist
and nothing else; there is no route that turns a token into write access.

SVG uploads are rejected deliberately: they are served from the same origin as
the panel and can carry script, which an unauthenticated upload endpoint would
turn into stored XSS. Uploads are additionally restricted to a fixed MIME
allowlist, and filenames on disk are generated UUIDs — nothing user-supplied
reaches a filesystem path.

The image templates are the exception that proves the rule. They *are* SVG, and
they *are* on the server's disk — but they ship inside the image, are read-only,
and are never written by anyone. What comes out of the panel is a flat JPEG. The
line is not "no SVG anywhere", it is "nothing uploaded is ever served as
markup".
