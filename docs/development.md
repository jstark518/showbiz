# Development

Requires Node 22+ and a reachable Postgres. Easiest is to run the database from
compose and the app on the host:

```bash
docker compose up -d db
```

Uncomment the `ports` block on the `db` service in
[docker-compose.yml](../docker-compose.yml) — it is already written, bound to
`127.0.0.1` so the database stays on your machine — and put this in `.env`:

```bash
DATABASE_URL=postgres://showbiz:local-dev-only@localhost:5432/showbiz
```

Then:

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

## Registries

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
[.gitlab-ci.yml](../.gitlab-ci.yml). `REGISTRY` is the single CI/CD variable the
deployment needs; its default there is a `.invalid` host, so a fork that has not
set it fails on a name it can read instead of reaching anything real.

One consequence worth knowing when changing the Dockerfile: the public node
images have no uid 10001 `app` account, which is what `runAsUser` in
[k8s/sign.yaml](../k8s/sign.yaml) names. The runtime stage creates it when absent
and runs `USER 10001` numerically, so the image starts on either base.

## Layout

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

## Data model

`playlists` → `slides` (ordered, with type-specific JSONB `config`), plus
`media_assets`, `settings`, and a table per plugin that needs one —
`important_dates`, `data_tables`, `jira_cache`. A partial unique index enforces
that exactly one playlist is on air. Migrations stay one numbered sequence in
`server/migrations/` even for plugin tables: the runner applies them in a single
order, and 0001 already created the first of them.

Slide configs are validated with zod on write *and* normalized on read. Every
field has both a default and a catch, so a row written by an older version — or
edited by hand — degrades to something sensible instead of taking the sign down.
