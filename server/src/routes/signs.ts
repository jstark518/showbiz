import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db';
import { broadcast } from '../events';
import { notFound, parseOrThrow } from '../http';
import { toSign, type SignRow } from '../mappers';
import { connectedSignIds, generateToken } from '../signs';

const nameSchema = z.string().trim().min(1).max(120);
/** Null is meaningful — it is "follow whatever is on air", not "unset". */
const playlistSchema = z.uuid().nullable();

const createSchema = z.object({
  name: nameSchema,
  playlistId: playlistSchema.default(null),
});

const updateSchema = z
  .object({
    name: nameSchema.optional(),
    playlistId: playlistSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change.');

/**
 * The list query, with the playlist name joined in so the panel does not have
 * to reconcile two lists to render one row.
 */
const list = () => sql<SignRow[]>`
  select s.*, p.name as playlist_name
  from signs s
  left join playlists p on p.id = s.playlist_id
  order by s.created_at asc
`;

export async function registerSignAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/signs', async () => {
    const rows = await list();
    const live = connectedSignIds();
    return rows.map((row) => toSign(row, live.has(row.id)));
  });

  app.post('/api/signs', async (request, reply) => {
    const body = parseOrThrow(createSchema, request.body);

    if (body.playlistId) {
      const [playlist] = await sql`select id from playlists where id = ${body.playlistId}`;
      if (!playlist) throw notFound('Playlist');
    }

    const [row] = await sql<SignRow[]>`
      insert into signs (name, token, playlist_id)
      values (${body.name}, ${generateToken()}, ${body.playlistId})
      returning *
    `;
    reply.code(201);
    // No broadcast: a new sign changes nothing about what any *existing* screen
    // is showing, and the panel has the row back in the response.
    return toSign(row!, false);
  });

  app.patch('/api/signs/:id', async (request) => {
    const { id } = request.params as { id: string };
    const patch = parseOrThrow(updateSchema, request.body);

    if (patch.playlistId) {
      const [playlist] = await sql`select id from playlists where id = ${patch.playlistId}`;
      if (!playlist) throw notFound('Playlist');
    }

    // Two statements rather than one clever one: `playlistId: null` means
    // "follow what is on air" and absent means "leave it alone", and a
    // coalesce cannot tell those apart.
    const [row] =
      patch.playlistId !== undefined
        ? await sql<SignRow[]>`
            update signs set
              name        = coalesce(${patch.name ?? null}::text, name),
              playlist_id = ${patch.playlistId},
              updated_at  = now()
            where id = ${id}
            returning *
          `
        : await sql<SignRow[]>`
            update signs set name = ${patch.name!}, updated_at = now()
            where id = ${id}
            returning *
          `;
    if (!row) throw notFound('Sign');

    // Repointing a screen at another playlist has to reach that screen, and it
    // is holding an event stream open waiting to be told.
    broadcast({ type: 'content-changed' });
    return toSign(row, connectedSignIds().has(row.id));
  });

  app.delete('/api/signs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await sql<SignRow[]>`delete from signs where id = ${id} returning *`;
    if (!row) throw notFound('Sign');

    // The token is now dead. A player still pointed at it gets the empty
    // playlist and shows its placeholder rather than the last screen's content.
    broadcast({ type: 'content-changed' });
    reply.code(204);
  });
}
