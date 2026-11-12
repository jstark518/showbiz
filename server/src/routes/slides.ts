import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { json, sql } from '../db';
import { broadcast } from '../events';
import { notFound, parseOrThrow } from '../http';
import { toSlide, type SlideRow } from '../mappers';
import { defaultDuration, defaultSlideConfig, normalizeSlideConfig, slideTypeSchema } from '../slides/config';

const isoOrNull = z.iso.datetime({ offset: true }).nullable();

const createSchema = z.object({
  playlistId: z.uuid(),
  type: slideTypeSchema,
  title: z.string().trim().max(160).default(''),
  durationSeconds: z.number().int().min(1).max(3600).optional(),
  config: z.unknown().optional(),
});

const themeSchema = z.enum(['dark', 'light']);

const updateSchema = z.object({
  title: z.string().trim().max(160).optional(),
  theme: themeSchema.optional(),
  /**
   * Converting one slide into another kind of slide, keeping its id, position
   * and schedule. The panel offers this for an image built from a template,
   * which can become artwork drawn live instead.
   */
  type: slideTypeSchema.optional(),
  durationSeconds: z.number().int().min(1).max(3600).optional(),
  enabled: z.boolean().optional(),
  startsAt: isoOrNull.optional(),
  endsAt: isoOrNull.optional(),
  config: z.unknown().optional(),
});

const reorderSchema = z.object({
  playlistId: z.uuid(),
  orderedIds: z.array(z.uuid()).min(1),
});

export async function registerSlideRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/slides', async (request) => {
    const query = parseOrThrow(z.object({ playlistId: z.uuid() }), request.query);
    const rows = await sql<SlideRow[]>`
      select * from slides where playlist_id = ${query.playlistId} order by position asc, created_at asc
    `;
    return rows.map(toSlide);
  });

  app.post('/api/slides', async (request, reply) => {
    const body = parseOrThrow(createSchema, request.body);

    const config = body.config === undefined
      ? defaultSlideConfig(body.type)
      : normalizeSlideConfig(body.type, body.config);

    const [row] = await sql<SlideRow[]>`
      insert into slides (playlist_id, type, title, position, duration_seconds, config)
      values (
        ${body.playlistId},
        ${body.type},
        ${body.title},
        coalesce((select max(position) + 1 from slides where playlist_id = ${body.playlistId}), 0),
        ${body.durationSeconds ?? defaultDuration(body.type)},
        ${json(config)}
      )
      returning *
    `;
    broadcast({ type: 'content-changed' });
    reply.code(201);
    return toSlide(row!);
  });

  // Registered before /api/slides/:id so the literal path wins the match.
  app.patch('/api/slides/reorder', async (request) => {
    const body = parseOrThrow(reorderSchema, request.body);
    await sql.begin(async (tx) => {
      for (const [index, id] of body.orderedIds.entries()) {
        await tx`
          update slides set position = ${index}, updated_at = now()
          where id = ${id} and playlist_id = ${body.playlistId}
        `;
      }
    });
    broadcast({ type: 'content-changed' });
    const rows = await sql<SlideRow[]>`
      select * from slides where playlist_id = ${body.playlistId} order by position asc, created_at asc
    `;
    return rows.map(toSlide);
  });

  app.patch('/api/slides/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(updateSchema, request.body);

    const [existing] = await sql<SlideRow[]>`select * from slides where id = ${id}`;
    if (!existing) throw notFound('Slide');

    // Config is merged into the stored object rather than replacing it, so a
    // form that only knows about some fields cannot silently drop the rest.
    //
    // Except when the type changes: the old config describes a different kind
    // of slide, so merging it in would leave fields the new type never asked
    // for and, worse, take defaults from them.
    const type = body.type ?? existing.type;
    const changingType = type !== existing.type;
    const nextConfig = changingType
      ? normalizeSlideConfig(type, body.config ?? {})
      : body.config === undefined
        ? normalizeSlideConfig(existing.type, existing.config)
        : normalizeSlideConfig(existing.type, {
            ...(existing.config as Record<string, unknown>),
            ...(body.config as Record<string, unknown>),
          });

    const [row] = await sql<SlideRow[]>`
      update slides set
        type             = ${type},
        title            = ${body.title ?? existing.title},
        duration_seconds = ${body.durationSeconds ?? existing.duration_seconds},
        theme            = ${body.theme ?? existing.theme ?? 'dark'},
        enabled          = ${body.enabled ?? existing.enabled},
        starts_at        = ${body.startsAt === undefined ? existing.starts_at : body.startsAt},
        ends_at          = ${body.endsAt === undefined ? existing.ends_at : body.endsAt},
        config           = ${json(nextConfig)},
        updated_at       = now()
      where id = ${id}
      returning *
    `;
    broadcast({ type: 'content-changed' });
    return toSlide(row!);
  });

  app.delete('/api/slides/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await sql`delete from slides where id = ${id} returning id`;
    if (rows.length === 0) throw notFound('Slide');
    broadcast({ type: 'content-changed' });
    reply.code(204);
  });

  app.post('/api/slides/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await sql<SlideRow[]>`
      insert into slides (playlist_id, type, title, position, duration_seconds, theme, enabled, starts_at, ends_at, config)
      select
        playlist_id,
        type,
        left(title || ' (copy)', 160),
        coalesce((select max(position) + 1 from slides s2 where s2.playlist_id = slides.playlist_id), 0),
        duration_seconds,
        theme,
        enabled,
        starts_at,
        ends_at,
        config
      from slides where id = ${id}
      returning *
    `;
    if (!row) throw notFound('Slide');
    broadcast({ type: 'content-changed' });
    reply.code(201);
    return toSlide(row);
  });
}
