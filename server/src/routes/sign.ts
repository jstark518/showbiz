import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { collectSignData } from '../../../plugins/server';
import { EMPTY_PLUGIN_SIGN_DATA } from '../../../plugins';
import { evaluateBlackout } from '../../../shared/blackout';
import type {
  AnySlide,
  ImageSlideConfig,
  MediaAsset,
  SignPlaylist,
  VideoSlideConfig,
} from '../../../shared/types';
import { sql } from '../db';
import { subscribe } from '../events';
import {
  toMediaAsset,
  toSlide,
  type MediaRow,
  type PlaylistRow,
  type SignRow,
  type SlideRow,
} from '../mappers';
import { getSignSettings } from '../settings';
import { closeStream, openStream, touchSign } from '../signs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mediaIdOf(slide: AnySlide): string | null {
  if (slide.type === 'image') return (slide.config as ImageSlideConfig).mediaId;
  if (slide.type === 'video') return (slide.config as VideoSlideConfig).mediaId;
  return null;
}

/**
 * A short digest of everything the sign renders. When it is unchanged the sign
 * leaves the running slideshow alone, so a poll or reconnect does not restart
 * the loop from slide one.
 */
function computeRevision(parts: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** What a player's request resolves to, once its token or id has been read. */
type Target =
  | { kind: 'playlist'; id: string }
  | { kind: 'on-air' }
  /** Nothing to show — an unknown token, or a playlist id that never existed. */
  | { kind: 'none' };

/**
 * Works out which playlist a request is asking for, and records that the sign
 * behind it is alive.
 *
 * Three shapes reach here:
 *
 * - `?token=` — a registered sign. This is what `/s/<token>` uses.
 * - `?playlistId=` — the older hand-assembled `/sign/<uuid>` address, kept
 *   working because the panel's own preview uses it and players may be on it.
 * - neither — the bare `/sign`, which follows whatever is on air.
 *
 * A token that resolves to nothing deliberately does **not** fall back to the
 * playlist on air. Deleting a sign is how you revoke its address, and a
 * revoked address that quietly keeps showing the current playlist would not be
 * a revocation at all.
 */
async function resolveTarget(request: FastifyRequest): Promise<Target> {
  const { playlistId, token } = request.query as { playlistId?: string; token?: string };

  if (typeof token === 'string' && token.length > 0) {
    const [sign] = await sql<SignRow[]>`select * from signs where token = ${token}`;
    if (!sign) return { kind: 'none' };
    // Not awaited: presence is bookkeeping, and a screen should never wait on
    // it to find out what to play.
    void touchSign(sign.id, request.ip);
    return sign.playlist_id ? { kind: 'playlist', id: sign.playlist_id } : { kind: 'on-air' };
  }

  if (typeof playlistId === 'string' && playlistId.length > 0) {
    // An id that is not a uuid is treated as "not found" rather than handed to
    // Postgres, which would raise on the comparison and 500 the sign.
    return UUID.test(playlistId) ? { kind: 'playlist', id: playlistId } : { kind: 'none' };
  }

  return { kind: 'on-air' };
}

export async function registerSignRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sign/playlist', async (request): Promise<SignPlaylist> => {
    const now = new Date();

    const target = await resolveTarget(request);

    const [playlist] =
      target.kind === 'playlist'
        ? await sql<PlaylistRow[]>`select * from playlists where id = ${target.id}`
        : target.kind === 'on-air'
          ? await sql<PlaylistRow[]>`select * from playlists where is_active limit 1`
          : [];

    if (!playlist) {
      const settings = await getSignSettings();
      const sleep = evaluateBlackout(settings.blackout, now);
      return {
        playlistId: null,
        playlistName: '',
        // Still distinguishes asleep from awake: a screen with nothing to show
        // must still go dark on schedule rather than sit on its placeholder.
        revision: sleep.asleep ? 'empty-asleep' : 'empty',
        serverNow: now.toISOString(),
        slides: [],
        media: {},
        plugins: EMPTY_PLUGIN_SIGN_DATA,
        settings,
        sleep,
      };
    }

    const slideRows = await sql<SlideRow[]>`
      select * from slides
      where playlist_id = ${playlist.id}
        and enabled
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at > now())
      order by position asc, created_at asc
    `;
    const slides = slideRows.map(toSlide);

    const mediaIds = [...new Set(slides.map(mediaIdOf).filter((id): id is string => Boolean(id)))];
    const mediaRows = mediaIds.length
      ? await sql<MediaRow[]>`select * from media_assets where id in ${sql(mediaIds)}`
      : [];
    const media: Record<string, MediaAsset> = {};
    for (const row of mediaRows) media[row.id] = toMediaAsset(row);

    // Whatever the installed plugins want to travel with the playlist: the
    // dates a countdown draws from, the tables a table slide names. Each one
    // also hands back the part of the revision hash that covers its rows.
    const contributed = await collectSignData(slides, (message, error) =>
      request.log.error({ err: error }, message),
    );
    const settings = await getSignSettings();
    const sleep = evaluateBlackout(settings.blackout, now);

    return {
      playlistId: playlist.id,
      playlistName: playlist.name,
      revision: computeRevision([
        playlist.id,
        playlist.updated_at,
        slideRows.map((row) => [row.id, row.updated_at, row.position]),
        contributed.revision,
        mediaRows.map((row) => row.id),
        settings,
        sleep.asleep,
        sleep.nextChangeAt,
      ]),
      serverNow: now.toISOString(),
      slides,
      media,
      plugins: contributed.data,
      settings,
      sleep,
    };
  });

  /**
   * Server-sent events. The sign holds this open and reloads its playlist when
   * the panel changes something, so an edit lands on the wall in about a
   * second without anyone touching the player.
   */
  app.get('/api/events', (request, reply) => {
    // A stream from a registered sign carries its token; one from the control
    // panel does not. Only the former counts as a screen being connected.
    const { token } = request.query as { token?: string };

    let closed = false;
    let signId: string | null = null;

    if (typeof token === 'string' && token.length > 0) {
      void sql<{ id: string }[]>`select id from signs where token = ${token}`
        .then(([row]) => {
          // The player may already have gone away while this was in flight;
          // opening the stream then would leak a permanently connected sign.
          if (!row || closed) return;
          signId = row.id;
          openStream(signId);
          // Forced, so the panel shows the screen as connected now rather than
          // at the next heartbeat.
          void touchSign(signId, request.ip, true);
        })
        .catch(() => {
          // An unresolvable token just means the stream is anonymous.
        });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeats proxy buffering, which otherwise holds events until timeout.
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    const send = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = subscribe(send);
    // Keeps intermediaries from reaping an idle connection, and doubles as the
    // liveness tick that keeps `last_seen_at` moving for a screen nobody is
    // editing. `touchSign` throttles the write down to once a minute.
    const heartbeat = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
      if (signId) void touchSign(signId, request.ip);
    }, 25_000);

    request.raw.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (signId) closeStream(signId);
    });
  });

  app.get('/api/health', async () => {
    await sql`select 1`;
    return { status: 'ok', time: new Date().toISOString() };
  });
}
