import { useCallback, useEffect, useRef, useState } from 'react';
import type { SignPlaylist } from '../../../shared/types';
import { api, signEventsUrl, type SignRef } from '../lib/api';

/**
 * How often to poll as a backstop. The server pushes changes over SSE, so this
 * only matters if that connection dies in a way the browser does not report.
 */
const POLL_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

export interface PlaylistState {
  playlist: SignPlaylist | null;
  /** True only before the first successful load. */
  loading: boolean;
  /** Set while the server is unreachable; the last good playlist keeps playing. */
  offline: boolean;
  /** serverNow minus the local clock, so a skewed player still counts down right. */
  clockOffsetMs: number;
  refresh: () => void;
}

/**
 * Which sign this page is, read out of its own address.
 *
 * `/s/<token>` is a registered sign and the only form the panel hands out.
 * `/sign/<uuid>` is the older address that names a playlist directly, kept
 * working for players already pointed at one. A bare `/sign` returns nothing,
 * which the server reads as "whichever playlist is on air" — so an
 * unconfigured player still shows something.
 */
export function signRefFromUrl(): SignRef {
  const path = window.location.pathname;

  const tokened = /^\/s\/([^/?#]+)/.exec(path);
  if (tokened) return { token: decodeURIComponent(tokened[1]!) };

  const pinned = /^\/sign\/([^/?#]+)/.exec(path);
  if (pinned) return { playlistId: decodeURIComponent(pinned[1]!) };

  return {};
}

export function usePlaylist(): PlaylistState {
  // Read once. The address of a sign does not change without a navigation,
  // and re-deriving it on every render would give `load` a new identity each
  // time and restart the polling effect.
  const [ref] = useState(signRefFromUrl);
  const [playlist, setPlaylist] = useState<SignPlaylist | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  const failuresRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const revisionRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.signPlaylist(ref);
      failuresRef.current = 0;
      setOffline(false);
      setLoading(false);
      setClockOffsetMs(Date.parse(next.serverNow) - Date.now());

      // Replacing the object on every poll would remount every slide and
      // restart the loop, so only publish when something actually changed.
      if (next.revision !== revisionRef.current) {
        revisionRef.current = next.revision;
        setPlaylist(next);
      }
    } catch {
      failuresRef.current += 1;
      setOffline(true);
      // `loading` is deliberately left alone: if a playlist was already showing
      // it keeps playing, and if none ever loaded the connecting screen stays.
      const delay = Math.min(1000 * 2 ** (failuresRef.current - 1), MAX_BACKOFF_MS);
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => void load(), delay);
    }
  }, [ref]);

  useEffect(() => {
    void load();

    const poll = window.setInterval(() => void load(), POLL_INTERVAL_MS);

    let source: EventSource | undefined;
    try {
      // The token rides along so the server can count this screen as connected
      // and show it that way in the panel. A sign on an older address has none,
      // and is simply an anonymous listener as before.
      source = new EventSource(signEventsUrl(ref));
      source.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type?: string };
          if (parsed.type === 'reload') {
            window.location.reload();
          } else if (parsed.type === 'content-changed') {
            void load();
          }
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };
      // EventSource reconnects on its own; the poll covers the rest.
      source.onerror = () => setOffline(true);
    } catch {
      // No EventSource support: polling alone still keeps the sign current.
    }

    return () => {
      window.clearInterval(poll);
      window.clearTimeout(retryTimerRef.current);
      source?.close();
    };
  }, [load]);

  /*
   * Ask again the moment the blackout schedule is due to flip.
   *
   * The 60s poll is what guarantees a boundary is honored; this is what makes
   * it land on the minute instead of up to one minute late. Corrected by
   * `clockOffsetMs`, because the whole point of that offset is that a player's
   * own clock cannot be trusted — and a screen going dark is exactly where
   * being an hour out would be noticed.
   */
  const nextChangeAt = playlist?.sleep?.nextChangeAt ?? null;
  useEffect(() => {
    if (!nextChangeAt) return;
    const dueAt = Date.parse(nextChangeAt);
    if (Number.isNaN(dueAt)) return;
    // A second past the boundary, so the server has certainly crossed it too.
    // Clamped below setTimeout's 32-bit ceiling, past which it fires at once.
    const delay = Math.min(Math.max(dueAt - (Date.now() + clockOffsetMs) + 1000, 0), 2_000_000_000);
    const timer = window.setTimeout(() => void load(), delay);
    return () => window.clearTimeout(timer);
  }, [nextChangeAt, clockOffsetMs, load]);

  return { playlist, loading, offline, clockOffsetMs, refresh: () => void load() };
}
