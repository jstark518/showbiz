# Deploying to a cluster

The GitLab mirror of this repo **is** the deployment: a push to `main` builds
the image with Kaniko, pushes it to `$REGISTRY/sign`, and applies `k8s/` from
inside the cluster. Nothing is applied from a laptop.

The private coordinates — registry hostname, ingress hostname — are CI/CD
variables rather than literals in this repo, which is public. `REGISTRY` and
`SIGN_HOST` are the two that matter; see
[Registries](development.md#registries) and [.gitlab-ci.yml](../.gitlab-ci.yml).

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

## Uploads in the cluster

Images and videos go to the cluster MinIO rather than to a volume. `S3_BUCKET`
is what selects it; with that unset the app writes to `MEDIA_DIR`, which is what
`docker compose` does.

**There is nothing to set up by hand.** The deploy does it, following the same
pattern the cluster's own MinIO deployment uses, so this is the house style
rather than something invented here.

On the first deploy it generates a key and then applies
[`k8s/minio-bootstrap.yaml`](../k8s/minio-bootstrap.yaml), a Job that creates:

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

## Moving uploads to MinIO

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
[k8s/sign.yaml](../k8s/sign.yaml) does.

`k8s/sign.yaml` no longer declares the PVC, but `kubectl apply` only touches
what a file contains, so **the claim and its data survive the deploy**. Delete
it deliberately once you are satisfied:

```bash
kubectl -n sign delete pvc sign-media
```

## Jira credentials in the cluster

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

## Going public

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
[Security](security.md).
