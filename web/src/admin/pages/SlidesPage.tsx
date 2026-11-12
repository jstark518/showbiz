import { useEffect, useMemo, useState } from 'react';
import {
  SLIDE_SPECS,
  SLIDE_TYPES,
  slideTypeLabel,
  type AnySlide,
  type MediaAsset,
  type SignTheme,
  type SlideType,
} from '../../../../shared/types';
import { api } from '../../lib/api';
import { isoToLocalInput } from '../../lib/format';
import { Banner, EmptyState, Field, Spinner } from '../components';
import { PLUGIN_CONVERSIONS } from '../../../../plugins/web/admin';
import { SlideConfigEditor } from '../editors';
import { useAsync } from '../useAsync';

export function SlidesPage({ onPlaylistChange }: { onPlaylistChange?: (id: string | null) => void }) {
  const playlists = useAsync(() => api.listPlaylists(), []);
  const media = useAsync(() => api.listMedia(), []);

  const [chosenPlaylistId, setChosenPlaylistId] = useState<string | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playlistId =
    chosenPlaylistId ??
    playlists.data?.find((playlist) => playlist.isActive)?.id ??
    playlists.data?.[0]?.id ??
    null;

  // The resolved id, not the explicitly chosen one — most of the time nobody
  // has chosen anything and it is whatever is on air. The top bar's Preview
  // sign needs to know which playlist that is, from any tab.
  useEffect(() => {
    onPlaylistChange?.(playlistId);
  }, [playlistId, onPlaylistChange]);

  const slides = useAsync(
    () => (playlistId ? api.listSlides(playlistId) : Promise.resolve([])),
    [playlistId],
  );

  const selected = useMemo(
    () => slides.data?.find((slide) => slide.id === selectedSlideId) ?? null,
    [slides.data, selectedSlideId],
  );

  // Keep the selection valid when the list changes underneath it.
  useEffect(() => {
    if (!slides.data) return;
    if (selectedSlideId && !slides.data.some((slide) => slide.id === selectedSlideId)) {
      setSelectedSlideId(null);
    }
  }, [slides.data, selectedSlideId]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await slides.reload();
      await playlists.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    }
  };

  /**
   * Selecting has to wait for the reload.
   *
   * The effect below drops a selection that is not in `slides.data`, and
   * between creating the slide and the list coming back it is not — so
   * selecting first meant the new slide was chosen and then immediately
   * deselected, and you landed on "Nothing selected" every time.
   */
  const addSlide = async (type: SlideType) => {
    if (!playlistId) return;
    setError(null);
    try {
      const created = await api.createSlide({
        playlistId,
        type,
        title: SLIDE_SPECS[type].label,
      });
      await slides.reload();
      await playlists.reload();
      setSelectedSlideId(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    }
  };

  /** Same reasoning: a copy is a new slide, and you made it to edit it. */
  const duplicateSlide = async (id: string) => {
    setError(null);
    try {
      const copy = await api.duplicateSlide(id);
      await slides.reload();
      await playlists.reload();
      setSelectedSlideId(copy.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    }
  };

  const move = (slide: AnySlide, direction: -1 | 1) =>
    run(async () => {
      if (!playlistId || !slides.data) return;
      const ordered = [...slides.data];
      const from = ordered.findIndex((item) => item.id === slide.id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ordered.length) return;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved!);
      await api.reorderSlides(
        playlistId,
        ordered.map((item) => item.id),
      );
    });

  if (playlists.loading && !playlists.data) return <Spinner />;

  return (
    <div className="page page--split">
      <section className="column column--list">
        <PlaylistBar
          playlists={playlists.data ?? []}
          selectedId={playlistId}
          onSelect={setChosenPlaylistId}
          onChanged={() => run(async () => {})}
          onError={setError}
        />

        {error ? <Banner kind="error">{error}</Banner> : null}

        <div className="addbar">
          {SLIDE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="btn btn--small"
              onClick={() => void addSlide(type)}
              disabled={!playlistId}
            >
              + {SLIDE_SPECS[type].label}
            </button>
          ))}
        </div>

        {slides.loading && !slides.data ? <Spinner /> : null}

        {slides.data && slides.data.length === 0 ? (
          <EmptyState
            title="No slides yet"
            detail="Add one above. Slides play top to bottom, then start again."
          />
        ) : null}

        <ol className="slidelist">
          {(slides.data ?? []).map((slide, index) => (
            <li
              key={slide.id}
              className={`slidelist__item ${selectedSlideId === slide.id ? 'is-selected' : ''} ${
                slide.enabled ? '' : 'is-disabled'
              }`}
            >
              <button
                type="button"
                className="slidelist__main"
                onClick={() => setSelectedSlideId(slide.id)}
              >
                <span className="slidelist__index">{index + 1}</span>
                <span className="slidelist__text">
                  <span className="slidelist__title">{slide.title || '(untitled)'}</span>
                  <span className="slidelist__meta">
                    {slideTypeLabel(slide.type)} · {slide.durationSeconds}s
                    {slide.enabled ? '' : ' · hidden'}
                  </span>
                </span>
              </button>
              <div className="slidelist__actions">
                <button
                  type="button"
                  title="Move up"
                  onClick={() => move(slide, -1)}
                  disabled={index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Move down"
                  onClick={() => move(slide, 1)}
                  disabled={index === (slides.data?.length ?? 0) - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  title={slide.enabled ? 'Hide from the sign' : 'Show on the sign'}
                  onClick={() => run(() => api.updateSlide(slide.id, { enabled: !slide.enabled }))}
                >
                  {slide.enabled ? '👁' : '🚫'}
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  onClick={() => void duplicateSlide(slide.id)}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  title="Delete"
                  className="danger"
                  onClick={() => {
                    if (window.confirm(`Delete "${slide.title || 'this slide'}"?`)) {
                      void run(() => api.deleteSlide(slide.id));
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="column column--detail">
        {selected ? (
          <SlideEditor
            key={`${selected.id}-${selected.type}`}
            slide={selected}
            media={media.data ?? []}
            onSaved={() => void slides.reload()}
            onMediaAdded={() => void media.reload()}
          />
        ) : (
          <EmptyState title="Nothing selected" detail="Pick a slide on the left to edit it." />
        )}
      </section>
    </div>
  );
}

// --- playlist controls ------------------------------------------------------

function PlaylistBar({
  playlists,
  selectedId,
  onSelect,
  onChanged,
  onError,
}: {
  playlists: { id: string; name: string; isActive: boolean; slideCount?: number }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const current = playlists.find((playlist) => playlist.id === selectedId);

  const guard = async (action: () => Promise<unknown>) => {
    try {
      await action();
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Something went wrong');
    }
  };

  return (
    <div className="playlistbar">
      <select value={selectedId ?? ''} onChange={(e) => onSelect(e.target.value)}>
        {playlists.map((playlist) => (
          <option key={playlist.id} value={playlist.id}>
            {playlist.name}
            {playlist.isActive ? ' (on air)' : ''} · {playlist.slideCount ?? 0} slides
          </option>
        ))}
      </select>

      {current && !current.isActive ? (
        <button
          type="button"
          className="btn btn--small btn--primary"
          onClick={() => guard(() => api.updatePlaylist(current.id, { isActive: true }))}
        >
          Put on air
        </button>
      ) : (
        <span className="pill pill--live">On air</span>
      )}

      <button
        type="button"
        className="btn btn--small"
        onClick={() => {
          const name = window.prompt('Name for the new playlist');
          if (name?.trim()) void guard(() => api.createPlaylist(name.trim()));
        }}
      >
        New
      </button>

      {current && !current.isActive ? (
        <button
          type="button"
          className="btn btn--small btn--danger"
          onClick={() => {
            if (window.confirm(`Delete the playlist "${current.name}" and all its slides?`)) {
              void guard(() => api.deletePlaylist(current.id));
            }
          }}
        >
          Delete
        </button>
      ) : null}
    </div>
  );
}

/**
 * JSON with object keys in a fixed order.
 *
 * Config round-trips through a jsonb column, and Postgres does not preserve the
 * key order of a jsonb object — it stores them sorted by length, then bytewise.
 * So a config with a free-form record in it, like the template slide's field
 * values, comes back reordered and an ordinary `JSON.stringify` comparison
 * calls it changed. The slide saved fine and then sat there marked "Unsaved"
 * forever.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}

// --- slide detail form ------------------------------------------------------

function SlideEditor({
  slide,
  media,
  onSaved,
  onMediaAdded,
}: {
  slide: AnySlide;
  media: MediaAsset[];
  onSaved: () => void;
  onMediaAdded: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    title: slide.title,
    theme: slide.theme,
    durationSeconds: slide.durationSeconds,
    startsAt: slide.startsAt,
    endsAt: slide.endsAt,
    config: { ...(slide.config as unknown as Record<string, unknown>) },
  }));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  const dirty =
    draft.title !== slide.title ||
    draft.theme !== slide.theme ||
    draft.durationSeconds !== slide.durationSeconds ||
    draft.startsAt !== slide.startsAt ||
    draft.endsAt !== slide.endsAt ||
    stableJson(draft.config) !== stableJson(slide.config);

  /**
   * Offers that apply to this slide, as decided by the plugin providing them.
   * Recomputed against the saved row rather than the draft: converting sends
   * the server a new type and a new config, and doing that from a form with
   * unsaved edits in it would quietly throw them away.
   */
  const conversions = PLUGIN_CONVERSIONS.filter(
    (conversion) => conversion.from(slide, media) !== null,
  );

  const convert = async (conversion: (typeof PLUGIN_CONVERSIONS)[number]) => {
    const config = conversion.from(slide, media);
    if (!config) return;
    setSaving(true);
    setStatus(null);
    try {
      await api.updateSlide(slide.id, { type: conversion.to, config });
      setStatus({ kind: 'success', message: 'Converted. Its own settings are below.' });
      onSaved();
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not convert',
      });
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await api.updateSlide(slide.id, draft);
      setStatus({ kind: 'success', message: 'Saved. The sign updates within a second.' });
      onSaved();
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not save',
      });
    } finally {
      setSaving(false);
    }
  };

  // The slide as the form currently has it, for editors that preview live.
  // Built from the saved row so nothing is fabricated, then overlaid with the
  // unsaved edits — which are the whole reason to have a preview.
  const draftSlide = useMemo(
    () =>
      ({
        ...slide,
        title: draft.title,
        theme: draft.theme,
        durationSeconds: draft.durationSeconds,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        config: draft.config,
        // The form holds config as a loose bag — it is mid-edit, and the
        // server is what normalizes it on save. The preview renders it with
        // the same tolerance the sign has for a config written by an older
        // build, so a half-filled draft draws a placeholder, not a crash.
      }) as unknown as AnySlide,
    [slide, draft],
  );

  const durationDisabled =
    slide.type === 'video' &&
    Boolean((draft.config as { useVideoDuration?: boolean; loop?: boolean }).useVideoDuration) &&
    !(draft.config as { loop?: boolean }).loop;

  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="editor__header">
        <h2>{slideTypeLabel(slide.type)}</h2>
        <div className="editor__actions">
          {dirty ? <span className="pill pill--dirty">Unsaved</span> : null}
          <button type="submit" className="btn btn--primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {status ? <Banner kind={status.kind}>{status.message}</Banner> : null}

      {conversions.map((conversion) => (
        <div key={conversion.to} className="convert">
          <button
            type="button"
            className="btn btn--small"
            disabled={saving || dirty}
            onClick={() => void convert(conversion)}
            title={dirty ? 'Save first — converting reloads the slide' : undefined}
          >
            {conversion.label}
          </button>
          {conversion.hint ? <span className="field__hint">{conversion.hint}</span> : null}
        </div>
      ))}

      <Field label="Title" hint="Shown in this list, and used as a fallback heading.">
        <input
          type="text"
          maxLength={160}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </Field>

      <Field
        label="Seconds on screen"
        hint={
          durationDisabled
            ? 'Ignored: this video plays to the end before advancing.'
            : 'How long before the sign moves to the next slide.'
        }
      >
        <input
          type="number"
          min={1}
          max={3600}
          value={draft.durationSeconds}
          disabled={durationDisabled}
          onChange={(e) => setDraft({ ...draft, durationSeconds: Number(e.target.value) })}
        />
      </Field>

      {SLIDE_SPECS[slide.type]?.usesTheme ? (
        <Field
          label="Theme"
          hint="This slide only. A loop can mix a dark board with light artwork."
        >
          <select
            value={draft.theme}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value as SignTheme })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Field>
      ) : null}

      <SlideConfigEditor
        type={slide.type}
        config={draft.config}
        media={media}
        slide={draftSlide}
        onMediaAdded={onMediaAdded}
        onChange={(patch) => setDraft({ ...draft, config: { ...draft.config, ...patch } })}
      />

      <details className="editor__schedule">
        <summary>Scheduling</summary>
        <p className="muted">
          Leave both empty to play this slide indefinitely. Times are in this browser&apos;s
          timezone.
        </p>
        <Field label="Start showing">
          <input
            type="datetime-local"
            value={draft.startsAt ? isoToLocalInput(draft.startsAt, false) : ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                startsAt: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
          />
        </Field>
        <Field label="Stop showing">
          <input
            type="datetime-local"
            value={draft.endsAt ? isoToLocalInput(draft.endsAt, false) : ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                endsAt: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
          />
        </Field>
      </details>
    </form>
  );
}
