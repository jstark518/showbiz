-- How an image was made, for the ones the panel made itself.
--
-- Storing the recipe rather than the SVG is the point: the values are a few
-- hundred bytes, they carry no markup that could be served back as script, and
-- they are what you actually want next quarter — reopen the template with last
-- time's wording already in the boxes and change the date.
--
-- Null for anything uploaded from a file, which is most of it.
alter table media_assets add column if not exists source jsonb;

comment on column media_assets.source is
  'Recipe for a panel-generated image, e.g. {"kind":"template","templateId":"all-hands","values":{...}}. Null for uploads.';
