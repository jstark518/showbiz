-- The data_table plugin: small hand-maintained grids shown on a slide.
--
-- Columns and rows are jsonb rather than real tables. Nothing queries inside
-- one — a table is fetched whole, by id, and drawn — and the editor saves the
-- whole grid in one write, so a relational shape would buy nothing and cost a
-- join plus an ordering column.

create table if not exists data_tables (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  columns    jsonb not null default '[]'::jsonb,
  rows       jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The check constraint from 0001_init is inline and so carries Postgres's
-- generated name. Dropping and re-adding it is how a slide type gets added;
-- editing the applied migration is not.
alter table slides drop constraint if exists slides_type_check;
alter table slides add constraint slides_type_check
  check (type in ('image', 'video', 'jira_dashboard', 'countdown', 'data_table'));
