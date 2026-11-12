-- Initial schema for the signage slideshow.

create table if not exists playlists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one playlist may be active. Every row reaching this partial index
-- has is_active = true, so uniqueness on that column allows only one.
create unique index if not exists playlists_one_active
  on playlists (is_active) where is_active;

create table if not exists media_assets (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null unique,
  original_name text not null,
  mime_type     text not null,
  kind          text not null check (kind in ('image', 'video')),
  size_bytes    bigint not null,
  created_at    timestamptz not null default now()
);

create table if not exists slides (
  id               uuid primary key default gen_random_uuid(),
  playlist_id      uuid not null references playlists (id) on delete cascade,
  type             text not null check (type in ('image', 'video', 'jira_dashboard', 'countdown')),
  title            text not null default '',
  position         integer not null default 0,
  duration_seconds integer not null default 15 check (duration_seconds between 1 and 3600),
  enabled          boolean not null default true,
  starts_at        timestamptz,
  ends_at          timestamptz,
  config           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists slides_playlist_position on slides (playlist_id, position);

create table if not exists important_dates (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  description text not null default '',
  occurs_at   timestamptz not null,
  all_day     boolean not null default true,
  accent      text not null default '#38bdf8',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists important_dates_occurs_at on important_dates (occurs_at);

create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Last known-good Jira response per slide. The sign keeps showing this if
-- Jira is unreachable, rather than going blank in front of the office.
create table if not exists jira_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);
