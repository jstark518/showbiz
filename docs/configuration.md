# Running it

[Quick start](../README.md#quick-start) is the short version: one command, nothing to
configure. This section is what you can change once it is up.

The database comes up with a local-only password baked into
[docker-compose.yml](../docker-compose.yml) and publishes no port, so nothing
outside the compose network can reach it.
[.env.example](../.env.example) lists everything you *can* override — ports,
Postgres credentials, upload limits, object storage, Jira — and every line of
it is optional, so copying it changes nothing until you uncomment something.
Override `POSTGRES_PASSWORD` and `DATABASE_URL` follows it automatically; there
is no pair to keep in step by hand.

The panel is the root. A sign is a screen you add on the **Signs** tab, which
hands back an address of its own to point a player at.

**Preview sign** in the top bar plays the selected playlist in a window over the
panel, without navigating away. It is the live sign, so touch works in it: tap
to wake the bottom bar, swipe between slides, tap a card to drill in. There is
still a link inside it to open the sign full-screen in its own tab, which is
what to use for a real check of how a 1080p panel looks.

The app applies its migrations at startup and seeds one empty playlist named
"Main loop", already on air. Add slides to it from the panel.

## Reaching it from other devices

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
change what the sign shows and upload files to it. See [Security](security.md).

To stop, keeping the database and uploads:

```bash
docker compose down
```

Add `-v` to that command to also delete the `db-data` and `media-data` volumes.
That erases every slide, date and uploaded file.
