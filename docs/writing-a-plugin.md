# Writing a plugin

This section is meant to be enough on its own. Copy
[plugins/data-table/](../plugins/data-table/) — it is the smallest complete
example, with a slide type, a panel tab, routes, a table of its own and rows
that travel with the playlist.

**What belongs in a plugin.** Anything that is a *feature*: a slide type, a tab,
a set of credentials, an upstream integration. Image and video are deliberately
not plugins — they are the media library on screen and have nothing of their own
to store, fetch or configure. Machinery (playlists, slides, media, signs,
settings, the blackout schedule) is core.

## 1. Lay out the folder

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

## 2. Declare the wire types

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

## 3. Register it — six places, all static

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

## 4. Add the migration

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

## 5. The server half

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

## 6. The sign half

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

## 7. The panel half

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

## 8. Check it

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
