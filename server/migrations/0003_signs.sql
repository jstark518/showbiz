-- Registered screens.
--
-- A sign used to be nothing but a URL you assembled by hand, which kept the
-- server free of device records. The cost was that every address was guessable
-- (`/sign/<playlist uuid>`, and uuids leak out of the panel) and the panel could
-- not tell you whether anything was actually playing. Both of those matter once
-- the panel is reachable from outside the office.
--
-- The token is the address. It is a bearer credential: whoever has it sees that
-- playlist, which is exactly what a player on a shelf needs, and deleting the
-- row revokes it immediately.
create table if not exists signs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  token        text not null unique,
  -- Null means "follow whichever playlist is on air", which is what the old
  -- bare /sign address did. `on delete set null` rather than cascade for the
  -- same reason: deleting a playlist must not silently delete a screen's
  -- address and send someone out to the player with a new one.
  playlist_id  uuid references playlists (id) on delete set null,
  last_seen_at timestamptz,
  last_seen_ip text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
