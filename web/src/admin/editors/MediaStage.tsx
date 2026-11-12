import { useEffect, useRef, useState } from 'react';
import type { MediaAsset, MediaFit, MediaKind } from '../../../../shared/types';
import { api } from '../../lib/api';
import { TemplateDialog } from '../templates/TemplateDialog';

/*
 * Nominal sign geometry the preview lays out at, before the whole frame is
 * scaled down to whatever width the panel gives it.
 *
 * Laying out at sign size rather than preview size is the point: every length
 * inside the frame is then the same multiple of `--vmin` that sign.css uses,
 * so the two files can be compared line by line. Sizing the preview directly
 * would mean re-deriving each number and getting a preview that drifts.
 */
const SHAPES = {
  landscape: { w: 1600, h: 900 },
  portrait: { w: 900, h: 1600 },
} as const;

type Orientation = keyof typeof SHAPES;

interface Props {
  kind: MediaKind;
  /** Everything on the Media tab; filtered to `kind` for the picker. */
  media: MediaAsset[];
  mediaId: string | null;
  fit: MediaFit;
  /** Omit for slide types that have no caption. */
  caption?: string;
  /** Playback flags, previewed for video slides. */
  video?: { loop: boolean };
  onChange: (patch: Record<string, unknown>) => void;
  /** Ask the page to refetch the media list after an upload from here. */
  onMediaAdded?: () => void;
}

export function MediaStage({
  kind,
  media,
  mediaId,
  fit,
  caption,
  video,
  onChange,
  onMediaAdded,
}: Props) {
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [scale, setScale] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An upload is selected immediately, before the page's media list has
  // refetched, so the preview must be able to draw an asset it was not given.
  const [uploaded, setUploaded] = useState<MediaAsset[]>([]);

  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const shape = SHAPES[orientation];

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setScale(box.clientWidth / shape.w);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [shape.w]);

  // A textarea does not grow with its content, and the caption has to wrap the
  // way it will on the sign or the preview is lying about how much it covers.
  useEffect(() => {
    const field = captionRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [caption, orientation, scale]);

  const byId = new Map<string, MediaAsset>();
  for (const asset of [...media, ...uploaded]) byId.set(asset.id, asset);
  const options = [...byId.values()].filter((asset) => asset.kind === kind);
  const chosen = mediaId ? byId.get(mediaId) : undefined;

  const upload = async (files: FileList | File[]) => {
    const [file] = [...files];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const asset = await api.uploadMedia(file);
      setUploaded((current) => [asset, ...current]);
      if (asset.kind === kind) {
        onChange({ mediaId: asset.id });
      } else {
        // It is on the Media tab now either way; saying so beats a bare
        // refusal, since the usual cause is dropping on the wrong slide.
        setError(`That is a ${asset.kind}, so it cannot go on this slide. It is on the Media tab.`);
      }
      onMediaAdded?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const noun = kind === 'image' ? 'image' : 'video';

  return (
    <div className="stagewrap">
      <div className="stagebar">
        <div className="seg" role="group" aria-label="Scaling">
          <button
            type="button"
            className={fit === 'cover' ? 'is-on' : ''}
            onClick={() => onChange({ fit: 'cover' })}
            title="Fill the panel, cropping whatever does not fit"
          >
            Cover
          </button>
          <button
            type="button"
            className={fit === 'contain' ? 'is-on' : ''}
            onClick={() => onChange({ fit: 'contain' })}
            title="Show the whole frame, with bars down the sides"
          >
            Contain
          </button>
        </div>

        {/* Preview-only: a sign's orientation is however the panel is hung,
            not something stored on the slide. It matters here because `cover`
            crops the two shapes quite differently. */}
        <div className="seg" role="group" aria-label="Preview shape">
          <button
            type="button"
            className={orientation === 'landscape' ? 'is-on' : ''}
            onClick={() => setOrientation('landscape')}
          >
            16:9
          </button>
          <button
            type="button"
            className={orientation === 'portrait' ? 'is-on' : ''}
            onClick={() => setOrientation('portrait')}
          >
            9:16
          </button>
        </div>

        {kind === 'image' ? (
          chosen?.source?.kind === 'template' ? (
            // Regenerating in place is the common case for a template image:
            // the event moved, the wording is otherwise right, and every slide
            // showing it should follow.
            <button
              type="button"
              className="btn btn--small stagebar__end"
              onClick={() => setEditingSource(true)}
            >
              Edit wording
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--small stagebar__end"
              onClick={() => setTemplating(true)}
            >
              Make one from a template
            </button>
          )
        ) : null}

        {chosen ? (
          <button
            type="button"
            className={`btn btn--small ${kind === 'image' ? '' : 'stagebar__end'}`}
            onClick={() => onChange({ mediaId: null })}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div
        ref={boxRef}
        className={`stage stage--${orientation} ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
      >
        <div
          className="stage__frame"
          style={{
            width: shape.w,
            height: shape.h,
            transform: `scale(${scale})`,
            // The one number the preview owns. Everything else is a multiple.
            ['--vmin' as string]: `${Math.min(shape.w, shape.h) / 100}px`,
            // Hide the frame until it has been measured, or it flashes at full
            // sign size on first paint.
            visibility: scale > 0 ? 'visible' : 'hidden',
          }}
        >
          {chosen ? (
            chosen.kind === 'video' ? (
              <video
                key={`${chosen.id}-${String(video?.loop)}`}
                className={`stage__media stage__media--${fit}`}
                src={chosen.url}
                // Always silent regardless of the slide's Muted setting: a
                // control panel that makes noise while you edit is its own bug.
                muted
                autoPlay
                loop={video?.loop ?? false}
                playsInline
              />
            ) : (
              <img
                className={`stage__media stage__media--${fit}`}
                src={chosen.url}
                alt=""
                draggable={false}
              />
            )
          ) : (
            <div className="stage__empty">
              <strong>No {noun} chosen</strong>
              <span>
                {kind === 'image'
                  ? 'Pick one below, drop a file here, or start from a template'
                  : 'Pick one below, or drop a file here'}
              </span>
            </div>
          )}

          {caption === undefined ? null : (
            <div className={`stage__caption ${caption ? '' : 'is-empty'}`}>
              <textarea
                ref={captionRef}
                className="stage__caption-input"
                value={caption}
                placeholder="Caption…"
                maxLength={280}
                rows={1}
                aria-label="Caption"
                onChange={(event) => onChange({ caption: event.target.value })}
              />
            </div>
          )}
        </div>

        {dragging ? <div className="stage__drop">Drop to upload</div> : null}
      </div>

      {caption === undefined ? null : (
        <p className="stage__note">
          Type on the image to caption it. The dark band only appears on the sign when there is
          something to read.
        </p>
      )}

      {error ? <p className="stage__error">{error}</p> : null}

      <div className="stagerail">
        {options.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className={`stagerail__item ${asset.id === mediaId ? 'is-current' : ''}`}
            title={asset.originalName}
            onClick={() => onChange({ mediaId: asset.id })}
          >
            {asset.kind === 'image' ? (
              <img className="stagerail__thumb" src={asset.url} alt="" loading="lazy" />
            ) : (
              // preload="metadata" so a rail of clips shows a first frame
              // without pulling every file in full.
              <video className="stagerail__thumb" src={asset.url} muted preload="metadata" />
            )}
            <span className="stagerail__name">{asset.originalName}</span>
          </button>
        ))}

        <button
          type="button"
          className="stagerail__add"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <span aria-hidden="true">＋</span>
          <span className="stagerail__name">{uploading ? 'Uploading…' : 'Upload'}</span>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept={kind === 'image' ? 'image/*' : 'video/*'}
          hidden
          onChange={(event) => event.target.files && void upload(event.target.files)}
        />
      </div>

      <TemplateDialog
        open={templating || editingSource}
        attachesToSlide
        editing={editingSource ? (chosen ?? null) : null}
        onClose={() => {
          setTemplating(false);
          setEditingSource(false);
        }}
        onCreated={(asset) => {
          setUploaded((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
          onChange({ mediaId: asset.id });
          onMediaAdded?.();
          setTemplating(false);
          setEditingSource(false);
        }}
      />
    </div>
  );
}
