-- Light or dark moves from one setting for the whole sign to a choice per
-- slide. A loop that mixes a dark Jira board with light artwork was the case
-- the single setting could never answer.
--
-- Existing slides take 'dark', which is what the old default was, so nothing
-- on a wall changes when this is applied.

alter table slides add column if not exists theme text not null default 'dark'
  check (theme in ('dark', 'light'));
