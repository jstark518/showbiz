import type { JiraDashboardData } from '../shared';
import { jiraApi } from './client';

/**
 * The last payload fetched for each Jira slide, kept outside React.
 *
 * The slideshow remounts a slide every time it comes round — the stage is keyed
 * by slide id so the entry animation replays — so component state cannot
 * survive a lap. Without this, every visit to a Jira slide showed "Loading
 * project data…" for as long as the round trip took, which on a wall panel is
 * the first thing anyone sees and the last thing they should.
 *
 * Holding it here means a slide renders its previous payload on the frame it
 * mounts, and the refresh happens behind it. Combined with `prefetch` on the
 * slide spec — the slideshow warms what is coming next — a board is usually on
 * screen with real numbers before anyone could notice it arriving.
 */

export interface JiraSnapshot {
  data: JiraDashboardData | null;
  /** The last fetch failed. Only worth showing when there is no data at all. */
  failed: boolean;
}

interface Entry {
  /** Replaced, never mutated: `useSyncExternalStore` compares by identity. */
  snapshot: JiraSnapshot;
  fetchedAt: number;
  inFlight: Promise<void> | null;
  listeners: Set<() => void>;
}

/**
 * How long a payload is considered fresh enough to skip a refetch.
 *
 * Shorter than the slide's own refresh interval, so arriving at a slide that
 * was prefetched a moment ago costs nothing, while a slide the loop has not
 * reached for a couple of minutes is refreshed before it appears.
 */
const STALE_AFTER_MS = 30_000;

const EMPTY: JiraSnapshot = { data: null, failed: false };

const entries = new Map<string, Entry>();

function entryFor(slideId: string): Entry {
  let entry = entries.get(slideId);
  if (!entry) {
    entry = { snapshot: EMPTY, fetchedAt: 0, inFlight: null, listeners: new Set() };
    entries.set(slideId, entry);
  }
  return entry;
}

function publish(entry: Entry, snapshot: JiraSnapshot): void {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

export function read(slideId: string): JiraSnapshot {
  return entries.get(slideId)?.snapshot ?? EMPTY;
}

export function subscribe(slideId: string, listener: () => void): () => void {
  const entry = entryFor(slideId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

/**
 * Fetches this slide's payload unless a fresh copy is already in hand.
 *
 * Never rejects, and takes no abort signal on purpose. A prefetch is started
 * for a slide that is not on screen and may never be — cancelling it when the
 * current slide moves on would throw away work that is nearly done and is
 * about to be wanted. Concurrent callers share the one request.
 */
export function warm(slideId: string, options: { force?: boolean } = {}): Promise<void> {
  const entry = entryFor(slideId);
  if (entry.inFlight) return entry.inFlight;

  const fresh = entry.snapshot.data !== null && Date.now() - entry.fetchedAt < STALE_AFTER_MS;
  if (fresh && !options.force) return Promise.resolve();

  const request = jiraApi
    .slideData(slideId)
    .then((data) => {
      entry.fetchedAt = Date.now();
      publish(entry, { data, failed: false });
    })
    .catch(() => {
      // Whatever was last fetched keeps rendering. The server already serves a
      // stale copy when Jira itself is unreachable, so a failure here is the
      // sign's own connection — and the playlist poll reports that already.
      publish(entry, { data: entry.snapshot.data, failed: true });
    })
    .finally(() => {
      entry.inFlight = null;
    });

  entry.inFlight = request;
  return request;
}
