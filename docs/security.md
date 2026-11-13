# Security

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
