-- The template plugin: artwork drawn live on the sign rather than flattened to
-- a JPEG in the media library, so anything the artwork animates can move.
--
-- No table of its own. A template slide stores the recipe in its own config —
-- the same {templateId, values} shape a media asset already records — and the
-- artwork itself is a read-only file baked into the image.

alter table slides drop constraint if exists slides_type_check;
alter table slides add constraint slides_type_check
  check (type in ('image', 'video', 'jira_dashboard', 'countdown', 'data_table', 'template'));
