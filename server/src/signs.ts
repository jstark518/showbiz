import { randomInt } from 'node:crypto';
import { sql } from './db';

/**
 * Tokens, and knowing which screens are actually playing.
 *
 * Both live here rather than in the route file because the sign routes need
 * them too: a player hits `/api/sign/playlist` and `/api/events` with its
 * token, and those are the only two moments the server ever hears from a
 * screen.
 */

/*
 * No i, l, o, 0 or 1. A token is meant to be copied, but the one time it is
 * read off a screen and typed into a player by hand is exactly the time an
 * ambiguous glyph costs someone half an hour.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const TOKEN_LENGTH = 20;

/** ~99 bits. Unguessable, and short enough to fit on one line of the panel. */
export function generateToken(): string {
  let token = '';
  // randomInt rejects out-of-range draws internally, so this is unbiased —
  // which `randomBytes()[i] % 31` would not be.
  for (let i = 0; i < TOKEN_LENGTH; i += 1) token += ALPHABET[randomInt(ALPHABET.length)];
  return token;
}

export function signPath(token: string): string {
  return `/s/${token}`;
}

/*
 * Which signs have an event stream open right now.
 *
 * In-process, and that is sound only because the deployment runs a single
 * replica — the same constraint that makes `broadcast` in events.ts work at
 * all. If this ever runs wider, presence has to move to the database along
 * with the event bus, and the honest reading in the meantime is "connected to
 * *this* server".
 */
const streams = new Map<string, number>();

export function openStream(signId: string): void {
  streams.set(signId, (streams.get(signId) ?? 0) + 1);
}

export function closeStream(signId: string): void {
  const next = (streams.get(signId) ?? 1) - 1;
  if (next <= 0) streams.delete(signId);
  else streams.set(signId, next);
}

export function connectedSignIds(): Set<string> {
  return new Set(streams.keys());
}

/**
 * How long a sign may go without a write before the next contact records one.
 *
 * A sign polls every minute and heartbeats every 25 seconds, so writing on
 * every contact would be a few thousand pointless updates a day per screen.
 * The panel only ever renders this to the minute.
 */
const TOUCH_INTERVAL_MS = 60_000;
const lastWrite = new Map<string, number>();

/**
 * Records that a sign was heard from. `force` is for the moment a stream opens,
 * where the panel should see the change immediately rather than a minute later.
 */
export async function touchSign(signId: string, ip: string | null, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastWrite.get(signId) ?? 0) < TOUCH_INTERVAL_MS) return;
  lastWrite.set(signId, now);
  try {
    await sql`
      update signs set last_seen_at = now(), last_seen_ip = ${ip} where id = ${signId}
    `;
  } catch {
    // Presence is decoration. A screen must keep playing through a failed
    // bookkeeping write, so this never propagates.
  }
}
