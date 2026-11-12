import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db';
import { broadcast } from '../events';
import { HttpError, notFound, parseOrThrow } from '../http';
import { toPlaylist, type PlaylistRow } from '../mappers';

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.literal(true).optional(),
});

export async function registerPlaylistRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playlists', async () => {
    const rows = await sql<PlaylistRow[]>`
      select p.*, count(s.id) as slide_count
      from playlists p
      left join slides s on s.playlist_id = p.id
      group by p.id
      order by p.is_active desc, p.name asc
    `;
    return rows.map(toPlaylist);
  });

  app.post('/api/playlists', async (request, reply) => {
    const body = parseOrThrow(createSchema, request.body);
    const [row] = await sql<PlaylistRow[]>`
      insert into playlists (name) values (${body.name}) returning *
    `;
    broadcast({ type: 'content-changed' });
    reply.code(201);
    return toPlaylist(row!);
  });

  app.patch('/api/playlists/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(updateSchema, request.body);

    const updated = await sql.begin(async (tx) => {
      if (body.isActive) {
        // The partial unique index rejects a second active row, so the old one
        // has to be stood down inside the same transaction.
        await tx`update playlists set is_active = false, updated_at = now() where is_active`;
        await tx`update playlists set is_active = true, updated_at = now() where id = ${id}`;
      }
      if (body.name !== undefined) {
        await tx`update playlists set name = ${body.name}, updated_at = now() where id = ${id}`;
      }
      return tx<PlaylistRow[]>`select * from playlists where id = ${id}`;
    });

    const row = updated[0];
    if (!row) throw notFound('Playlist');
    broadcast({ type: 'content-changed' });
    return toPlaylist(row);
  });

  app.delete('/api/playlists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [target] = await sql<{ is_active: boolean }[]>`
      select is_active from playlists where id = ${id}
    `;
    if (!target) throw notFound('Playlist');

    const counted = await sql<{ count: number }[]>`select count(*)::int as count from playlists`;
    if ((counted[0]?.count ?? 0) <= 1) {
      throw new HttpError(409, 'Cannot delete the only playlist. Create another one first.');
    }
    if (target.is_active) {
      throw new HttpError(409, 'Cannot delete the active playlist. Activate another one first.');
    }

    await sql`delete from playlists where id = ${id}`;
    broadcast({ type: 'content-changed' });
    reply.code(204);
  });
}
