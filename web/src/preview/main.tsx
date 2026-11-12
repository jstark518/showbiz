import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EMPTY_PLUGIN_SIGN_DATA, type PluginSignData } from '../../../plugins';
import type { AnySlide, MediaAsset } from '../../../shared/types';
import '../sign/sign.css';
import { SlideRenderer, slidePreviewLoader } from '../sign/slides';
import { SlidePlaceholder } from '../sign/slides/SlidePlaceholder';

/**
 * The control panel's slide preview, rendered with the sign's own components
 * and the sign's own stylesheet.
 *
 * Nothing here reimplements a slide. That is the point: a preview that is a
 * second implementation of the renderer is a preview that lies as soon as one
 * of the two changes, and the Jira slide alone is several hundred lines of CSS
 * to get wrong.
 *
 * This is panel tooling that happens to import sign code, so it is a third
 * entry point rather than a branch inside the sign's own bundle — the player
 * should never download it.
 */

export interface PreviewPayload {
  slide: AnySlide;
  media: Record<string, MediaAsset>;
  plugins: PluginSignData;
}

const MESSAGE = 'shwobiz:preview';
const READY = 'shwobiz:preview-ready';

function Preview() {
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [fetched, setFetched] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Same-origin only. This page can be framed, and it should not take
      // instructions about what to draw from whoever managed to frame it.
      if (event.origin !== window.location.origin) return;
      const message = event.data as { type?: string; payload?: PreviewPayload } | null;
      if (message?.type !== MESSAGE || !message.payload) return;
      setPayload(message.payload);
    };

    window.addEventListener('message', onMessage);
    // The parent cannot tell when this document is ready to listen, so say so.
    window.parent?.postMessage({ type: READY }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const slide = payload?.slide ?? null;
  // Set only for slide types that fetch something of their own — the Jira
  // board, today. Everything else draws from what the panel already posted.
  const load = slide ? slidePreviewLoader(slide.type) : undefined;

  // Refetch only when the parts the payload depends on change, not on every
  // message: the panel re-posts whenever any field of the draft moves, and
  // most of them are display options the upstream has never heard of.
  const key = useMemo(
    () => (load && slide ? JSON.stringify([slide.type, slide.config, slide.title]) : null),
    [load, slide],
  );

  useEffect(() => {
    if (!key || !slide || !load) return;
    const controller = new AbortController();
    setError(null);

    load(slide, controller.signal)
      .then((data) => setFetched(data))
      .catch((caught: Error) => {
        if (controller.signal.aborted) return;
        setFetched(null);
        setError(caught.message);
      });

    return () => controller.abort();
    // `slide` and `load` are read inside; `key` is what decides a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!slide) {
    return (
      <div className="sign sign--dark sign--message">
        <p className="sign__message">Waiting for the editor…</p>
      </div>
    );
  }

  return (
    <div className={`sign sign--${slide.theme ?? 'dark'}`}>
      {/* --none: the entry animation would replay on every keystroke. */}
      <div className="sign__stage sign__stage--none">
        {load && error ? (
          <SlidePlaceholder heading={slide.title || 'Preview'} detail={error} />
        ) : (
          <SlideRenderer
            slide={slide}
            media={payload?.media ?? {}}
            data={payload?.plugins ?? EMPTY_PLUGIN_SIGN_DATA}
            clockOffsetMs={0}
            onFinished={() => {}}
            // Present means "supplied from outside", which is what tells a
            // renderer not to fetch for itself; null means "still loading".
            {...(load ? { preview: { data: fetched } } : {})}
          />
        )}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
