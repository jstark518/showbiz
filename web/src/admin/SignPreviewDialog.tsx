import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from './useAsync';

/**
 * The whole sign, playing, without leaving the panel.
 *
 * The frame is the real sign at `/sign/<playlistId>` — the same URL a player
 * loads — laid out at nominal sign size and scaled down, so `vmin` inside
 * resolves the way it does on the wall. It is deliberately interactive: the
 * nav bar, swiping and the drill-in stack are the parts most worth trying
 * before anyone walks over to the panel itself.
 *
 * The iframe is mounted only while the dialog is open. It holds an SSE
 * connection like any other sign, and leaving one open behind a closed dialog
 * would be a client the server keeps talking to for no reason.
 */

const NOMINAL = { w: 1600, h: 900 };

export function SignPreviewDialog({
  open,
  playlistId,
  onClose,
}: {
  open: boolean;
  /** Null falls back to whichever playlist is on air, exactly as `/sign` does. */
  playlistId: string | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  const playlists = useAsync(() => (open ? api.listPlaylists() : Promise.resolve([])), [open]);
  const named = playlists.data?.find((playlist) => playlist.id === playlistId) ?? null;
  const onAir = playlists.data?.find((playlist) => playlist.isActive) ?? null;

  const path = playlistId ? `/sign/${playlistId}` : '/sign';
  const url = `${window.location.origin}${path}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !open) return;
    const measure = () => setScale(box.clientWidth / NOMINAL.w);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="signpreview" onClose={onClose}>
      <header className="signpreview__head">
        <div>
          <h2>Preview sign</h2>
          <p className="muted">
            {named
              ? `${named.name}${named.isActive ? ' · on air' : ''}`
              : onAir
                ? `Whatever is on air, currently "${onAir.name}"`
                : 'Whatever is on air'}
          </p>
        </div>
        <div className="signpreview__actions">
          {/* Kept from the old link: a real fullscreen tab is still the way to
              check what a 1080p panel actually looks like. */}
          <a className="btn btn--small" href={path} target="_blank" rel="noreferrer">
            Open in a new tab ↗
          </a>
          <button type="button" className="btn btn--small" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div ref={boxRef} className="framestage">
        {open ? (
          <iframe
            className="framestage__frame"
            src={path}
            title="Sign preview"
            sandbox="allow-scripts allow-same-origin"
            style={{
              width: NOMINAL.w,
              height: NOMINAL.h,
              transform: `scale(${scale})`,
              visibility: scale > 0 ? 'visible' : 'hidden',
            }}
          />
        ) : null}
      </div>

      <p className="signpreview__foot muted">
        Live, and touch works — tap to wake the bar, swipe between slides, tap a card to drill in.
        A player loads <code>{url}</code>.
      </p>
    </dialog>
  );
}
