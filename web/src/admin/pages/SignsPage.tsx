import { useEffect, useRef, useState } from 'react';
import type { Playlist, Sign } from '../../../../shared/types';
import { api } from '../../lib/api';
import { formatRelativeTime } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { evaluateBlackout } from '../../../../shared/blackout';
import { formatInZone } from '../../lib/format';
import { Banner, EmptyState, Field, Spinner } from '../components';
import { useAsync } from '../useAsync';

/**
 * The screens, and whether they are actually playing.
 *
 * A sign used to be nothing but a URL you assembled from a playlist id. It is a
 * row now, for two reasons: the address needs to be an unguessable token rather
 * than a uuid that leaks out of the panel, and a row is the only thing the
 * server can hang "last heard from" off. See `server/src/signs.ts`.
 */

/**
 * How often the list refreshes to pick up connection changes. A screen going
 * dark is not urgent, but a minute of staring at a stale badge while power
 * cycling a player is long enough to make you doubt the panel.
 */
const REFRESH_MS = 10_000;

/** The dropdown entry for a sign that follows whatever playlist is on air. */
const ON_AIR = '';

export function SignsPage() {
  const signs = useAsync(() => api.listSigns(), []);
  const playlists = useAsync(() => api.listPlaylists(), []);
  // Only for the notice below. A screen showing nothing is the first thing
  // anyone comes to this page about, and "it is asleep on purpose" should be
  // the answer before they start unplugging things.
  const settings = useAsync(() => api.getSignSettings(), []);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(30_000);

  const reload = signs.reload;
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  if (signs.loading && !signs.data) return <Spinner />;
  if (signs.error) return <Banner kind="error">{signs.error}</Banner>;

  const rows = signs.data ?? [];
  const options = playlists.data ?? [];
  const sleep = evaluateBlackout(settings.data?.blackout, new Date(now));

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await signs.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    }
  };

  return (
    <div className="signs">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {sleep.asleep ? (
        <Banner kind="info">
          The blackout schedule has every screen dark right now
          {sleep.nextChangeAt
            ? `, back at ${formatInZone(sleep.nextChangeAt, settings.data?.blackout.timeZone ?? '')}`
            : ' with nothing scheduled to bring them back'}
          . A blank screen is doing as it was told; turn the schedule off in Settings to bring
          them back early.
        </Banner>
      ) : null}

      <section className="card">
        <div className="signs__head">
          <div>
            <h2>Screens</h2>
            <p className="card__hint">
              Each one gets its own address. Load it on the player as a plain web page — nothing
              else is needed there, no presentation and no local content.
            </p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            <span aria-hidden="true">+</span> Add sign
          </button>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No signs yet"
            detail="Add one to get an address you can point a player at."
          />
        ) : (
          <div className="signlist">
            {rows.map((sign) => (
              <SignCard
                key={sign.id}
                sign={sign}
                playlists={options}
                now={now}
                onRepoint={(playlistId) =>
                  void act(() => api.updateSign(sign.id, { playlistId }))
                }
                onRename={(name) => void act(() => api.updateSign(sign.id, { name }))}
                onDelete={() => {
                  if (
                    !window.confirm(
                      `Delete "${sign.name}"? Its address stops working immediately, so a player still pointed at it will show a placeholder until you give it the new one.`,
                    )
                  ) {
                    return;
                  }
                  void act(() => api.deleteSign(sign.id));
                }}
              />
            ))}
          </div>
        )}
      </section>

      <AddSignDialog
        open={adding}
        playlists={options}
        onClose={() => setAdding(false)}
        onCreate={async (input) => {
          await act(() => api.createSign(input));
          setAdding(false);
        }}
      />
    </div>
  );
}

function SignCard({
  sign,
  playlists,
  now,
  onRepoint,
  onRename,
  onDelete,
}: {
  sign: Sign;
  playlists: Playlist[];
  now: number;
  onRepoint: (playlistId: string | null) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const url = `${window.location.origin}${sign.path}`;

  return (
    <div className="signcard">
      <div className="signcard__head">
        <input
          type="text"
          className="signcard__name"
          defaultValue={sign.name}
          maxLength={120}
          aria-label="Sign name"
          // On blur rather than on change: this list reloads every few seconds
          // for the connection badges, and a controlled input saving per
          // keystroke would fight the reload for the cursor.
          onBlur={(event) => {
            const next = event.currentTarget.value.trim();
            if (next && next !== sign.name) onRename(next);
            else event.currentTarget.value = sign.name;
          }}
        />
        <Presence sign={sign} now={now} />
      </div>

      <div className="signcard__row">
        <label className="signcard__playlist">
          <span>Shows</span>
          <select
            value={sign.playlistId ?? ON_AIR}
            onChange={(event) => onRepoint(event.target.value || null)}
          >
            <option value={ON_AIR}>Whatever is on air</option>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
                {playlist.isActive ? ' (on air)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="signcard__row">
        <CopyableUrl url={url} label={sign.name} />
        <a className="btn btn--small" href={url} target="_blank" rel="noreferrer">
          Open
        </a>
        <button type="button" className="btn btn--small btn--danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

/**
 * Connected / last seen.
 *
 * "Connected" means an event stream from this sign is open right now, which is
 * the same connection an edit travels down — so it answers the question you
 * actually have, which is whether a change will reach that screen.
 */
function Presence({ sign, now }: { sign: Sign; now: number }) {
  if (sign.connected) {
    return (
      <span className="presence presence--on" title={sign.lastSeenIp ?? undefined}>
        <span className="presence__dot" aria-hidden="true" />
        Connected
      </span>
    );
  }
  return (
    <span className="presence" title={sign.lastSeenIp ?? undefined}>
      <span className="presence__dot" aria-hidden="true" />
      {sign.lastSeenAt ? `Last seen ${formatRelativeTime(sign.lastSeenAt, now)}` : 'Never connected'}
    </span>
  );
}

function CopyableUrl({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard API needs a secure context, and a plain-http LAN address
      // is not one. Falling back to a prompt beats failing silently.
      window.prompt('Copy the sign URL', url);
    }
  };

  return (
    <>
      <input
        type="text"
        className="signcard__url"
        value={url}
        readOnly
        aria-label={`Address for ${label}`}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="btn btn--small" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </>
  );
}

function AddSignDialog({
  open,
  playlists,
  onClose,
  onCreate,
}: {
  open: boolean;
  playlists: Playlist[];
  onClose: () => void;
  onCreate: (input: { name: string; playlistId: string | null }) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [playlistId, setPlaylistId] = useState<string>(ON_AIR);
  const [saving, setSaving] = useState(false);

  // `showModal` gives Esc-to-close, the backdrop and a focus trap for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setName('');
      setPlaylistId(playlists.find((playlist) => playlist.isActive)?.id ?? ON_AIR);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, playlists]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onCreate({ name: trimmed, playlistId: playlistId || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="signadd" onClose={onClose}>
      <form
        method="dialog"
        className="signadd__body"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2>Add a sign</h2>
        <p className="card__hint">
          Naming it after where it hangs is what makes the list readable later — “Reception”,
          “Kitchen”, “Warehouse door”.
        </p>

        <Field label="Name">
          <input
            type="text"
            maxLength={120}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Shows"
          hint="Following what is on air lets one switch in the panel change every screen set to it."
        >
          <select value={playlistId} onChange={(event) => setPlaylistId(event.target.value)}>
            <option value={ON_AIR}>Whatever is on air</option>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
                {playlist.isActive ? ' (on air)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="signadd__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!name.trim() || saving}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
