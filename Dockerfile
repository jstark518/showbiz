# syntax=docker/dockerfile:1

# The defaults are public Docker Hub images, so a clone of this repo builds with
# nothing but a Docker daemon and an internet connection.
#
# The private deployment overrides both from CI, because anything deployed to
# that cluster is built FROM its own base images: they carry the TLS trust
# store, tzdata and the unprivileged `app` user (uid 10001). See
# .gitlab-ci.yml, which passes:
#
#   --build-arg NODE_IMAGE=$REGISTRY/docker-base-node:24
#   --build-arg NODE_BUILD_IMAGE=$REGISTRY/docker-base-node-build:24
#
# $REGISTRY is a CI/CD variable, not a literal in this repo.
#
# Keep the defaults public and the private values in CI, not the reverse — a
# private default is what makes an outside clone fail, and it fails at the
# `FROM` with a DNS error that reads like the user's own network is broken.
ARG NODE_IMAGE=node:24.22.3-slim
ARG NODE_BUILD_IMAGE=node:24.22.3

# ---- build (sign + control panel + server bundle) ------------------------
FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /app
# Declared so Kaniko's injected build-arg is visible to the RUN below and npm
# goes to the on-prem Verdaccio. A RUN cannot see an ARG its stage never named.
ARG NPM_CONFIG_REGISTRY
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- deps (production node_modules) --------------------------------------
# Separate stage on the *build* base so anything with a native addon compiles
# here; the runtime image below ships no toolchain.
FROM ${NODE_BUILD_IMAGE} AS deps
WORKDIR /app
ARG NPM_CONFIG_REGISTRY
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime -------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    MEDIA_DIR=/data/media

COPY package.json ./
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/migrations ./server/migrations
# Read at runtime rather than bundled: they are data the panel fetches, and
# keeping them as files means editing one is not a rebuild of the server.
COPY server/templates ./server/templates

# In the cluster a PVC is mounted here and fsGroup owns it; creating it up front
# means the image also works standalone with `docker run` or compose.
#
# uid 10001 is `app` in docker-base-node, and is what k8s/sign.yaml names in
# runAsUser/runAsGroup. The public node images have no such account — they stop
# at `node` (uid 1000) — so it is created when absent. Without this the image
# built from Docker Hub defaults builds *successfully* and then dies at startup
# with "unable to find user app", which is a poor way to find out.
USER root
RUN set -eu; \
    if ! getent passwd 10001 >/dev/null 2>&1; then \
      groupadd -g 10001 app; \
      useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin app; \
    fi; \
    mkdir -p /data/media; \
    chown -R 10001:10001 /data

# Numeric rather than `app`: it is the same identity either way, it matches
# runAsUser exactly, and it does not depend on what the base image called it.
USER 10001

EXPOSE 3000

# For compose and `docker run`. Kubernetes ignores this and uses the probes on
# the same path in k8s/sign.yaml.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The base image's ENTRYPOINT is tini, so this runs under a real PID 1.
CMD ["node", "dist/server/index.js"]
