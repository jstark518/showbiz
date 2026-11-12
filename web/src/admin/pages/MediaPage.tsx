import { useRef, useState } from 'react';
import type { MediaAsset } from '../../../../shared/types';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { Banner, EmptyState, Spinner } from '../components';
import { TemplateDialog } from '../templates/TemplateDialog';
import { useAsync } from '../useAsync';

export function MediaPage() {
  const media = useAsync(() => api.listMedia(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [editing, setEditing] = useState<MediaAsset | null>(null);

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;
    setError(null);
    setUploading(list.length);
    try {
      // Sequential rather than parallel: a handful of large videos over office
      // wifi is friendlier to the server than all of them at once.
      for (const file of list) {
        await api.uploadMedia(file);
        setUploading((count) => count - 1);
      }
      await media.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed');
    } finally {
      setUploading(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? Slides using it will lose their image or video.`)) return;
    setError(null);
    try {
      await api.deleteMedia(id);
      await media.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete');
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <h1>Media</h1>
        <p className="muted">
          Images and videos available to slides. JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, OGG and MOV.
        </p>
      </header>

      {error ? <Banner kind="error">{error}</Banner> : null}

      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
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
        <p>Drop files here, or</p>
        <div className="dropzone__actions">
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            Choose files
          </button>
          <button type="button" className="btn" onClick={() => setTemplating(true)}>
            Make one from a template
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(event) => event.target.files && void upload(event.target.files)}
        />
        {uploading > 0 ? <p className="muted">Uploading… {uploading} left</p> : null}
      </div>

      {media.loading && !media.data ? <Spinner /> : null}

      {media.data && media.data.length === 0 ? (
        <EmptyState title="No media yet" detail="Upload an image or video to use it on a slide." />
      ) : null}

      <ul className="mediagrid">
        {(media.data ?? []).map((asset) => (
          <li key={asset.id} className="mediacard">
            <div className="mediacard__preview">
              {asset.kind === 'image' ? (
                <img src={asset.url} alt="" loading="lazy" />
              ) : (
                // No autoplay and no preload: a grid of videos should not start
                // pulling hundreds of megabytes the moment the tab opens.
                <video src={asset.url} muted preload="metadata" controls />
              )}
            </div>
            <div className="mediacard__body">
              <span className="mediacard__name" title={asset.originalName}>
                {asset.originalName}
              </span>
              <span className="mediacard__meta">
                {asset.kind} · {formatBytes(asset.sizeBytes)}
              </span>
              {asset.source?.kind === 'template' ? (
                <button
                  type="button"
                  className="btn btn--small mediacard__edit"
                  onClick={() => setEditing(asset)}
                >
                  Edit wording
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="mediacard__delete"
              title="Delete"
              onClick={() => void remove(asset.id, asset.originalName)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <TemplateDialog
        open={templating || editing !== null}
        editing={editing}
        onClose={() => {
          setTemplating(false);
          setEditing(null);
        }}
        onCreated={() => {
          void media.reload();
          setTemplating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
