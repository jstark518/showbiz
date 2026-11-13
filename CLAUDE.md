# CLAUDE.md

Digital signage for a BrightSign player: a Fastify server serves both a
fullscreen **sign** and a **control panel** from one container, backed by
Postgres. See [README.md](README.md) for user-facing setup; this file covers
what is non-obvious when changing the code.

## Commands

```bash
npm run dev         # API with reload (:3000) + Vite dev server (:5173)
npm run build       # both frontends, then esbuild-bundles the server
npm run typecheck   # tsc over server and web as two separate projects
docker compose up -d --build app   # rebuild and redeploy just the app
```

There are no tests. Verify by running the stack and exercising the real API —
`curl` the endpoints, or drive the sign in a browser.

`docker compose up -d --build` takes no configuration — the Postgres
credentials default to a local-only set in `docker-compose.yml`, and every line
of `.env.example` is optional. Don't reintroduce a required variable for the
quick start; a clone that cannot start is the first thing a reader judges.
Override `POSTGRES_PASSWORD` and `DATABASE_URL` follows it, because each
component of that URL's default repeats the same default.

Dev without Docker for the app: `docker compose up -d db`, uncomment the `db`
service's `ports` block (already written, bound to `127.0.0.1`), point
`DATABASE_URL` at localhost. Panel is `/`, sign is `/sign.html` under Vite.

## Layout

```
shared/types.ts     The core wire contract. Server, sign and panel all import it.
server/src/         Fastify routes, db, migrations runner
server/migrations/  Numbered .sql, applied in order at boot, tracked in _migrations
server/templates/   Annotated SVGs; read at runtime, never rendered server-side
plugins/            Everything that is a feature rather than the machinery
web/src/sign/       Slideshow engine, core slide renderers, drill-in shell
web/src/admin/      Panel pages, playlist and media editing
web/src/admin/templates/  Template parsing, text fitting, rasterizing
```

Three Vite entry points build from one project — `web/index.html` = panel,
`web/sign.html` = sign, `web/preview.html` = the frame the panel embeds — so
they share `shared/types.ts` and the panel's code never ships to the player.
Keep it that way: the sign bundle is deliberately tiny, which is exactly why
the preview is a third entry rather than a branch inside the sign.

## Plugins

Important dates, Jira and data tables are **plugins**. Image and video are not:
they are the media library on screen and have nothing of their own to store,
fetch or configure.

```
plugins/index.ts          The registry: slide types, config map, sign payload
plugins/server/           ServerPlugin contract + the server-side registry
plugins/web/              SignPlugin / AdminPlugin contracts + both registries
plugins/<id>/shared.ts    Wire types this plugin owns
plugins/<id>/server/      Routes, schemas, upstream clients
plugins/<id>/web/         Renderer, editor, tab, drill views, stylesheets
```

A plugin may add slide types, panel tabs, Settings cards, Fastify routes, drill
views, and rows that travel with the playlist the sign polls for.

**The folder layout is a build boundary, not a filing preference.** The two
tsconfigs enforce it: the server project takes `plugins/**/*.ts` and excludes
`**/web/**`, the browser projects take both extensions and exclude
`**/server/**`. That is what keeps fastify and postgres.js out of a browser
project and React out of the server's. Put server-only code in `server/`, and
browser code in `web/` — a `.ts` file in the wrong folder fails typecheck in a
way that reads like a missing dependency.

**Registration is four static lines, not discovery.** `plugins/index.ts` for
the shared types, then one of the three side registries. esbuild and Vite both
need to see the import to bundle it, and a list you can read beats a glob.

**Nothing imports a plugin from core except a registry.** The dependency runs
core → registry → plugin, one way. That is why `shared/types.ts` composes
`SLIDE_TYPES` from `plugins/index.ts` rather than the reverse, and why a plugin
normalizes its own config (`plugins/server/config.ts`) instead of calling
`normalizeSlideConfig`, which would import the registry that imports it.

**Plugins own their stylesheets.** `plugins/<id>/web/sign.css` is imported by
the renderer, so it lands after `sign.css` and can lean on its variables. Both
`main.tsx` files import the host stylesheet *before* `App` for exactly that
reason — reorder those and a plugin's `.slide--countdown` starts losing to
`.slide`. Class names are namespaced per plugin because the sheet is global.

**A plugin does not own a migration.** `server/migrations/` is one numbered
sequence applied in order, and 0001 already created `important_dates`. Add a
numbered file there and say in its header which plugin it is for.

**Plugin failures are contained, not propagated.** `collectSignData` catches
per plugin and logs: a broken `signData` means one slide draws its placeholder,
not a playlist that 500s and takes every other slide down with it.

## Conventions that will bite you

**Imports.** `moduleResolution: bundler`, relative paths, no path aliases, no
extensions. `shared/` is reached with `../../../shared/types`, and a plugin
reaches the host the same way (`../../../web/src/admin/components`). Don't add
aliases; esbuild and Vite both resolve this as-is today.

**No ORM.** postgres.js with tagged templates. Use the `json()` helper from
`server/src/db.ts` rather than `sql.json()` directly — postgres.js types its
`JSONValue` union so plain interfaces and `Record`s don't satisfy it.

**Migrations are raw SQL.** Add a new numbered file; never edit an applied one.
Slide `config` is JSONB, so config shape changes usually need no migration —
only the `type` check constraint on `slides` does.

**Slide config schemas need both `.default()` and `.catch()`** on every field —
core types in `server/src/slides/config.ts`, everything else in the plugin that
owns the type. A row written by an older build, or edited by hand, must degrade
to something renderable. A sign showing a stack trace to the office is the
failure mode being designed against.

**No dotenv.** Node reads `.env` itself (`process.loadEnvFile`, 20.12+; the
image is on 24). It throws when the file is absent, which is the normal case in
a container, so the call is wrapped — see `env.ts`.

**react/react-dom are devDependencies on purpose** — Vite bundles them at build
time, so the runtime image installs `--omit=dev` without them.

## Image templates

`server/templates/*.svg` → edited in the panel → a JPEG in the media library.

**The rasterizing is client-side, and that is the design, not a shortcut.** The
panel draws the SVG into a canvas and `toBlob`s a JPEG (`rasterize.ts`). Doing
it on the server would mean a headless Chrome in the runtime image — larger
than everything else in it put together — and the browser already has the
fonts. Verified: a self-contained SVG blob does **not** taint the canvas, so
`toBlob` works; one that referenced an external resource would.

**The editing preview is a live inline SVG, not a picture of one.** It has to
be: `getComputedTextLength()` returns 0 on a detached document, and every fit
check silently passes. `applyField` in `template.ts` depends on it.

**Reset font-size to `data-base-size` before measuring.** Wrapping against the
size left over from the previous keystroke packs the first line too full, and
the error compounds as you type. This was a real bug.

**Ids are namespaced per template on parse.** Every one of these files calls its
gradient `bg` and its blur `soft`. Two inline in one document and `url(#bg)`
resolves to whichever came first, which reads as a broken template rather than
an id collision. Gallery thumbnails dodge this by being `<img>` — a separate
document per template.

**Highlighting the active field is done in `admin.css`, not in the SVG.** That
is what keeps it out of the exported image, which is serialized from the markup
alone and never sees the page's stylesheet.

`data-field` groups elements into one field; two elements sharing a name are two
*lines*. A newline in the value wins over auto-wrap, so the artwork's own line
break survives a round trip.

**A field has a kind, and the kind picks the control.** `data-type="date"` makes
one value drive several elements, each drawing a piece of it (`data-part` =
weekday · day · month · year · date, `data-case="upper"` for artwork set in
capitals). That is why the event notice is a date picker rather than three
boxes that can disagree about what day it is — and it caught the shipped
artwork claiming 18 September 2026 was a Thursday.

**Color is its own attribute, not a `data-type`.** A color paints attributes
instead of writing text, and an element often needs to be a line of text *and*
take its color from a swatch — a card's caption, say. So it is
`data-paint-field` alongside `data-field`, with `data-paint` naming the
attributes to set (default `fill`), `data-paint-label` for the form and
`data-paint-swatch` for the presets offered before the full picker.

**`data-category` on the root `<svg>` sections the picker**, defaulting to
`Everyday`. Both pickers share `groupTemplates` in `web/src/lib/template.ts` —
the media gallery's cards and the template slide's dropdown — because a heading
in one and a flat list in the other is how the two drift apart. A single
category renders as a plain list, so the label only appears once it separates
something. The holiday set is the reason this exists: it doubled the library.

**Never put a `transform` attribute on an element carrying `data-animate`.** The
motions animate the `transform` property, and a CSS animation beats a
presentation attribute outright rather than composing with it — so the attribute
is discarded for the life of the animation. Confetti written as `<rect
transform="rotate(…)" data-animate="drift">` sits tilted in the panel and snaps
upright on the sign. Placement goes on a wrapper `<g>`, motion on the child.
This shipped broken in `celebration.svg` and was only caught by measuring.

**The recipe stores the value, not the rendering.** `mood3: "#a78bfa"` and
`when: "2026-11-03"`, never `"NOVEMBER"` — so reopening an image gives a picker
holding what was picked, and restyling the template regenerates it correctly.

**The recipe is stored, not the drawing.** `media_assets.source` holds
`{kind:'template', templateId, values}` so an image can be reopened and
regenerated. Storing the SVG instead would put markup back in the media table,
which is the thing the upload allowlist exists to prevent, and it would freeze
each image against the artwork of the day it was made.

**Regenerating writes a new filename.** `/media` is served `immutable` with a
30-day max-age, so reusing the path would leave a player showing the old image
until something evicted it. `PUT /api/media/:id` keeps the row id — which is
what slides reference — and swaps the file underneath.

**`source` must be appended to the FormData before the file.** Multipart is a
stream and `upload.fields` only holds what arrived ahead of the file.

## Media storage

`server/src/storage/` — a directory locally, an S3 bucket (MinIO) in the
cluster. **Naming a bucket is what selects S3**; `S3_BUCKET` set makes the
other three required, because a pod that quietly wrote uploads into its own
container would lose them all at the next rollout and nobody would notice for
weeks.

**Bytes are proxied through `/media/:filename`, never redirected to.** The
cluster's MinIO has no Ingress, so a presigned URL would point somewhere a
player on the office network cannot reach. One route over both backends also
means `/media/<file>` survives a change of backend with no stored URL rewritten.

**`forcePathStyle: true` is mandatory for MinIO.** Virtual-host addressing puts
the bucket in the hostname and the SDK looks up `sign.minio.minio.svc`, which
does not exist — and it surfaces as a DNS error that reads like a network fault.

**Uploads use `@aws-sdk/lib-storage`'s `Upload`, not `PutObjectCommand`.** The
body is a request stream of unknown length; PutObject would need Content-Length
up front, so a 500 MB video would have to be buffered somewhere first.

**The filesystem store maps extension → content type itself.** Dropping
`@fastify/static` for a route that serves both backends took that with it, and
everything came back `application/octet-stream` — which a browser may download
rather than display, and which stops a `<video>` playing. S3 keeps the type as
object metadata, so only the directory backend needs the table.

Malformed keys are rejected in the route, not the backend: a directory refuses a
separator and a bucket takes it as an ordinary character, and the difference
showed up as a logged 502 anyone could trigger at will.

## Live slide preview

`web/preview.html` → `web/src/preview/main.tsx`, framed by the panel.

**It has to be an iframe.** The sign is sized in `vmin`, and viewport units
resolve against the browser window — inside a div, or inside a shadow root, a
`3.4vmin` heading is sized against the whole panel page. An iframe is the only
container with a viewport of its own. The frame is laid out at 1600×900 and
scaled, so `vmin` inside is 9px and matches a real panel exactly.

**It is a third Vite entry, not a branch in the sign.** It imports the sign's
renderers and `sign.css`, but the player must never download panel tooling.
Vite shares the chunks, so the preview entry itself is under 2 kB.

**Nothing here reimplements a slide**, and nothing should. A preview that is a
second implementation lies the moment either copy changes, and the Jira slide
alone is several hundred lines of CSS to get wrong.

**The preview knows nothing about Jira**, and that is the point of `loadPreview`
on a plugin's slide spec. The panel posts the draft slide over `postMessage`,
debounced; if the type declares a loader the preview calls it and passes the
result down as `context.preview` — absent means "fetch for yourself", which is
the sign's path, and `null` means "supplied but not here yet". Jira's loader
hits `POST /api/jira/dashboard`, the same cache as the sign's endpoint, so
previewing a board already on air costs no Jira call.

A slide that only draws stored rows needs no loader: its editor hands the rows
to `SlidePreview` through `data`, the same shape `signData` contributes.

**Preview sign** in the top bar is the same scaled-iframe trick (`.framestage`)
pointed at the real `/sign/<playlistId>` instead. Two things it depends on:

- The iframe is mounted only while the dialog is open. It holds an SSE stream
  like any other sign, and one left behind a closed dialog is a client the
  server keeps talking to for nothing.
- Which playlist it shows is lifted to `App`, because the top bar outlives the
  Slides page that knows the answer. `SlidesPage` reports its *resolved* id —
  usually nobody has chosen anything and it is whatever is on air.

## Adding a slide type

It belongs in a plugin. `plugins/data-table/` is the whole shape in about 700
lines and is the one to copy.

**The step-by-step is [docs/writing-a-plugin.md](docs/writing-a-plugin.md)**
— the six registration points, the contracts, the migration, the helpers. It is
written to be followed start to finish without reading anything else, so it is
not repeated here; two copies of the same checklist is how one of them ends up
wrong. Likewise [docs/writing-a-template.md](docs/writing-a-template.md) for the
annotated SVGs.

What follows is only the part that is judgement rather than procedure.

Two things worth copying rather than reinventing:

**A slide that fetches something of its own** follows Jira. Credentials stay
server-side; expose `GET /api/sign/slides/:id/<kind>` so the slide refreshes on
its own cadence and one slow upstream cannot delay the loop; cache in memory
**and** in a table so an outage serves a stale copy instead of a blank panel;
and declare `loadPreview` so the panel's preview draws an unsaved draft with
the sign's own component rather than a second implementation.

**A slide that draws stored rows** follows data tables: contribute them from
`signData` so they arrive with the playlist, and send only what the playlist's
slides actually reference.

## Blackout schedule

The one place a sign is blanked on purpose, and therefore the one place that
needs the most care about failing in the right direction.

`SignSettings.blackout` is a weekly timetable — seven days, Sunday first, each
with an on/off flag and `HH:MM` bounds in a named IANA zone. It is off by
default.

- **`shared/blackout.ts` is the only implementation**, called by the server to
  fill `SignPlaylist.sleep` and by the panel to show what the schedule is doing
  right now. Two copies of a weekly timetable disagree about a Sunday night
  eventually, and the symptom is a wall panel that is dark while the panel
  insists it is awake.
- **Every failure resolves to awake.** Unusable timezone, unparseable time,
  wrong number of days: all stay on. A sign that fails to sleep wastes
  backlight; a sign that sleeps when it should not gets reported as broken.
- **`sleep` is part of the revision hash.** The sign only republishes a payload
  whose revision changed, so a wake that altered nothing else would be fetched
  and thrown away.
- **The 60s poll is the guarantee; `nextChangeAt` is a hint.** The sign also
  sets a timer for the boundary so a flip lands on the minute, but that instant
  is computed with minute arithmetic and can be an hour out on the two days a
  year a zone shifts. The poll catches it either way.
- **An end time earlier than the start wraps past midnight**, and equal times
  mean all day. Adjacent windows are merged, or a sign blinks at midnight
  between two on-days.
- **Asleep suspends the slideshow** the same way a drill-in does, and skips
  plugin prefetching — otherwise a dark sign polls Jira all night and wakes to
  a slide chosen by how long the office was empty.
- Nothing is drawn while asleep: no clock, no name, no offline dot. Fourteen
  hours is long enough to burn in. Ground is `#000` rather than `--sign-bg`,
  whose dark navy reads as a fault rather than as off.
- **There is no touch override, by choice.** A dark screen has no handler at
  all, so the schedule is the only thing that ends a blackout. Turning it off
  in the panel is how you bring screens back early.

## The sign must never go blank

This is the governing constraint; it explains most of the defensive code. The
blackout schedule above is the sole deliberate exception, and it is written to
fail back to this rule.

- Unreachable server → keep playing the last playlist, retry with backoff
- Unreachable Jira → serve the last good payload with `stale: true` and a
  "Cached" badge
- Misconfigured slide → a placeholder that says what is wrong, in plain language
- Unknown slide type → placeholder, not a crash

Live updates ride SSE (`/api/events`); the sign also polls once a minute as a
backstop. The playlist payload carries a `revision` hash so an unchanged poll
doesn't remount slides and restart the loop.

Countdowns use `serverNow` to correct a drifted player clock.

## Touch

Optional throughout — with no touchscreen nothing below is reachable.

- The bottom nav bar (`SlideNav.tsx`) is `pointer-events: none` while hidden, so
  the **first tap only wakes it** (10s window). This is intentional; don't
  "fix" it. It is transient rather than permanent because the panel runs for
  months and burn-in is real.
- Its chip track is the one horizontal scroller on the sign, and it centers the
  current chip by setting `scrollLeft` — not `scrollIntoView`, which can scroll
  an ancestor of a fullscreen layout.
- **A swipe must not also fire the tap under it.** A browser still emits `click`
  after a drag when press and release share an element, so a swipe across a
  countdown card used to change slide *and* drill into that card. `useSlideshow`
  sets a flag on a recognized swipe and swallows the next click in the capture
  phase. Most slides are wall-to-wall tappable cards, so without this swipe is
  effectively unusable.
- The drag transform lives on a `.sign__drag` wrapper, not on `.sign__stage`:
  the stage's entry animation also animates transform and holds its end value
  (`animation-fill-mode: both`), which would override an inline transform. It is
  written straight to the DOM node via a ref so a drag does not re-render the
  slide tree every frame.
- Gestures starting inside `.sign-nav` are ignored, or dragging the chip track
  sideways would change slide as well as scroll.
- Tapping content pushes onto a **drill stack** (`web/src/sign/drill/`), which
  fully suspends the loop via `useSlideshow(..., suspended)`. Back pops one
  level; an idle timeout unwinds everything and resumes. The overlay is the
  chrome only — what a level *contains* is a `DrillView` registered by the
  plugin whose slide pushed it, keyed by the target's `kind`.
- `.sign-body` blocks scrolling. Two places opt back in: `.drill__body`, and a
  Jira slide's `.jira__issues`, which sets `touch-action: pan-y` so the browser
  scrolls it vertically while horizontal movement still reaches the slideshow's
  swipe handler. `overscroll-behavior: contain` stops a flick at the end of the
  list chaining anywhere else.
- The horizontal drag transform is only applied while `|dx| > |dy|`, or the
  slide wobbles sideways as someone scrolls that list.
- The sign sets `cursor: none`, undone by `@media (any-pointer: fine)`. A parked
  mouse arrow looks like a fault on a wall panel, but hiding it in a desktop
  browser makes the thing unusable during setup. Hide-by-default with an opt-out,
  not the reverse, so a player too old for the query still hides it.

## Jira

A plugin (`plugins/jira/`). Cloud only, REST v3, basic auth with email + API
token.

- Search is `POST /rest/api/3/search/jql` — the old `/search` is gone. It is
  token-paginated with no total, so `approximate-count` supplies the total when
  a scan is truncated at 250.
- **Custom field ids differ per site** and are discovered from `/rest/api/3/field`
  (`fields.ts`), never hardcoded. Story points and start date are both custom.
- Team-managed projects use `parent = KEY` for epic children; only older
  company-managed sites have "Epic Link", and naming a field that doesn't exist
  makes Jira reject the whole query — hence the discovery guard in `jql.ts`.
- **Kanban boards 400 on the sprint endpoint.** That is a normal "not
  applicable" answer, surfaced as `supported: false`, not an error.
- Slide sources are built from dropdowns; `jql.ts` turns the structured config
  into the query. Raw JQL remains as an escape hatch and is what pre-builder
  slides use — `config.ts` infers `mode: 'jql'` for configs with a query and no
  mode. Don't break that inference.

**Epic health** (`epics.ts`) compares schedule consumed against work completed;
the gap in percentage points drives At risk / Off track. Two real-world
concessions: epics commonly have a due date but no start date, so creation date
is the fallback and is flagged `startDateInferred`; and story-point progress
falls back to issue counts below 60% estimate coverage, or an unestimated
backlog reads 0% forever.

## Security posture

The panel has **no authentication**, by the owner's choice. Consequences to keep
in mind when adding endpoints:

- Anything writable via the panel is writable by anyone on the network
- Prefer env vars over DB storage for secrets; env wins over stored settings
- Never return the Jira token to the client — status reports `hasToken` only
- SVG uploads are rejected deliberately (same-origin stored XSS); uploads use a
  MIME allowlist and UUID filenames, so nothing user-supplied reaches a path
- The rule is "nothing **uploaded** is ever served as markup", not "no SVG".
  `server/templates/` is SVG on disk and that is fine: it ships in the image,
  is read-only, and leaves the panel as a JPEG. If you ever add SVG to
  `EXTENSIONS`, send `Content-Disposition: attachment` with media too

## BrightSign

The player's embedded Chromium trails the desktop badly and is rarely updated.
Vite targets `chrome79`. Be conservative with modern CSS and JS; a blank screen
with a console syntax error is the usual symptom of overreaching. Videos are
muted by default because players block autoplay with sound.

## Deployment

`git push` to `main` on the GitLab mirror is the deploy — Kaniko builds,
`kubectl apply`s `k8s/` from inside the cluster, rolls `deploy/sign`. Nothing is
applied from a laptop. Full runbook in [docs/cluster.md](docs/cluster.md).

- **Public registries are the committed default; the private ones are overrides
  supplied by CI.** The repo is public, so a private default is a build everyone
  but you cannot run. The Dockerfile's `NODE_IMAGE` / `NODE_BUILD_IMAGE` default
  to Docker Hub and `.gitlab-ci.yml` passes `$REGISTRY/docker-base-node*` as
  `--build-arg`s; those carry the
  `app` user at uid 10001 that the manifest's `runAsUser` names. The runtime
  stage creates uid 10001 when the base lacks it and runs `USER 10001`
  numerically, so the image starts on either base — the public node images stop
  at `node` (uid 1000), and `USER app` against them builds clean and then dies
  at startup. See [docs/development.md → Registries](docs/development.md#registries).
- **The committed lockfile must resolve to `registry.npmjs.org`.** `npm ci`
  rewrites a `resolved` URL pointing at the default registry to whatever
  registry is configured, so a public lockfile installs fine from Verdaccio; it
  does *not* rewrite the other way, so a lockfile pinned to the private mirror
  fails every outside clone with `ENOTFOUND`. The project `.npmrc` is what holds
  this — it beats `~/.npmrc`, which on the LAN points at the mirror. Don't
  delete it, and after any dependency change check that
  `grep -c registry.npmjs.org package-lock.json` matches the `resolved` count.
- Every stage that runs npm must declare `ARG NPM_CONFIG_REGISTRY`. Kaniko
  injects the value; a `RUN` cannot see an `ARG` its own stage never named.
- `readOnlyRootFilesystem: true`, so every writable path is an explicit mount:
  the media PVC and an `emptyDir` on `/tmp`.
- **Liveness points at `/sign`, not `/api/health`.** The health route runs a
  `select 1`, so using it for liveness turns a transient Postgres blip into a
  restart loop — the opposite of "the sign must never go blank". Readiness does
  use it, which is what gates the rollout on migrations having run.
- **One replica is a correctness constraint, not a capacity one.** SSE fans out
  in-process (`events.ts`) and the media PVC is RWO. Two pods means half the
  signs never hear about an edit. Widening needs `cephfs`/RWX plus a Postgres
  `LISTEN`/`NOTIFY` event bus.
- The `sign-jira` Secret is optional (`optional: true` on every key) and not
  owned by CI, so a first deploy comes up before anyone has created it and a
  redeploy never rotates it.
- Public access is a Cloudflare Tunnel hostname configured in the Cloudflare
  dashboard — there is no k8s resource for it, so it is the one part of the
  deploy that is not in this repo.

## Routing

**The panel is the root.** `/` serves `web/index.html` (the panel). Every sign
address serves `web/sign.html`, and the page works out which playlist it is from
`location.pathname` (`signRefFromUrl` in `usePlaylist.ts`):

| Address | Resolves to |
|---|---|
| `/s/:token` | The registered sign holding that token. What the panel hands out. |
| `/sign/:playlistId` | That playlist directly. Legacy, still honored. |
| `/sign` | Whatever playlist is `is_active`. |

`signRefFromUrl` is read **once** into state, not on every render — it returns a
fresh object, and re-deriving it would give `load` a new identity each render and
restart the polling effect.

A bare `/sign` falling back to the active playlist is what keeps an unconfigured
player showing something. A playlist id that is not a uuid is treated as
not-found rather than handed to Postgres, which would raise on the comparison and
500 the sign.

**An unknown token resolves to nothing, and must not fall back to the playlist
on air.** Deleting a sign is how its address is revoked; a revoked address that
quietly kept showing the current playlist would not be a revocation. The sign
renders its "Nothing to show yet" placeholder, which is the one case where the
never-go-blank rule and revocation agree.

### Signs

A sign *was* deliberately not a stored entity. It is a row now (`0003_signs.sql`,
`server/src/signs.ts`), for two reasons that only appeared once the panel became
reachable from outside the office: the address needed to be unguessable rather
than a playlist uuid that leaks out of the panel, and only a row gives the panel
somewhere to record "last heard from".

- **The token is the credential.** 20 characters from a 31-character alphabet
  with no `i`, `l`, `o`, `0` or `1` — ~99 bits, and survives being read off a
  screen and typed into a player by hand. Generated with `randomInt`, which is
  unbiased; `randomBytes()[i] % 31` would not be.
- **`playlist_id` is nullable and means "follow what is on air"**, so `null` in a
  PATCH is a value, not "unchanged". That is why the update is two statements
  rather than one `coalesce`.
- **`on delete set null`, not cascade.** Deleting a playlist must not silently
  delete a screen's address and send someone out to the player with a new one.
- **Presence is in-process** (`streams` in `signs.ts`), sound only because the
  deployment runs one replica — the same constraint `broadcast` already depends
  on. `connected` means "an event stream is open to *this* server", which is the
  useful question: it is the same connection an edit travels down.
- `last_seen_at` writes are throttled to once a minute per sign. A screen polls
  every 60s and heartbeats every 25s, so writing on every contact would be a few
  thousand pointless updates a day per screen, and the panel renders it to the
  minute anyway.
- **Only a stream carrying `?token=` counts as a screen.** The panel holds an
  `/api/events` connection too, and counting it would show every sign as
  connected the moment anyone opened the panel.
