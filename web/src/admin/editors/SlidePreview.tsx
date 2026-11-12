import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_PLUGIN_SIGN_DATA, type PluginSignData } from '../../../../plugins';
import type { AnySlide, MediaAsset } from '../../../../shared/types';

/**
 * A live preview of a slide, drawn by the sign's own code.
 *
 * It is an iframe, and that is not incidental. The sign sizes everything in
 * `vmin`, which resolves against the browser window — inside a div, or inside
 * a shadow root, a 3.4vmin heading would be sized against the whole panel
 * page. An iframe is the only container that brings its own viewport, so it is
 * the only way to show a 1920×1080 sign at a third of the size with the type
 * in the right proportion.
 *
 * The frame lays out at the nominal sign size and is scaled to fit, the same
 * trick `MediaStage` uses, so the two previews agree.
 */

const NOMINAL = { w: 1600, h: 900 };
const MESSAGE = 'shwobiz:preview';
const READY = 'shwobiz:preview-ready';

/**
 * Long enough that working through a row of dropdowns is one refresh rather
 * than four, short enough that it still feels like it is following you.
 */
const SETTLE_MS = 400;

interface Props {
  /** Null while the editor has too little to draw anything. */
  slide: AnySlide | null;
  media?: Record<string, MediaAsset>;
  /**
   * The plugin rows this slide draws from — the tables a table slide names,
   * say. An editor sends only what its own slide needs, which is why this is
   * partial: the preview is not the sign and has no playlist behind it.
   */
  data?: Partial<PluginSignData>;
  /** Shown in place of the frame when there is no slide yet. */
  waitingFor?: string;
}

export function SlidePreview({ slide, media, data, waitingFor }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setScale(box.clientWidth / NOMINAL.w);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [slide === null]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: string } | null)?.type === READY) setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const payload = useMemo(
    () => ({ slide, media: media ?? {}, plugins: { ...EMPTY_PLUGIN_SIGN_DATA, ...data } }),
    [slide, media, data],
  );
  // Comparing the payload by value, not identity: the editor rebuilds the
  // draft object on every keystroke, and posting on identity would refetch
  // Jira for a change to a field Jira has never heard of.
  const key = JSON.stringify(payload);

  useEffect(() => {
    if (!ready || !slide) return;
    const timer = window.setTimeout(() => {
      frameRef.current?.contentWindow?.postMessage(
        { type: MESSAGE, payload },
        window.location.origin,
      );
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  if (!slide) {
    return (
      <div className="framestage framestage--waiting">
        <p className="muted">{waitingFor ?? 'Nothing to preview yet.'}</p>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="framestage">
      <iframe
        ref={frameRef}
        className="framestage__frame"
        src="/preview.html"
        title="Slide preview"
        // No allow-* beyond scripts and same-origin: the preview needs to run
        // the sign's code and call the API, and nothing else.
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: NOMINAL.w,
          height: NOMINAL.h,
          transform: `scale(${scale})`,
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      />
    </div>
  );
}
