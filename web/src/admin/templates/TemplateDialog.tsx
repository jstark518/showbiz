import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaAsset, MediaSource } from '../../../../shared/types';
import { api } from '../../lib/api';
import { Banner, Spinner } from '../components';
import { useAsync } from '../useAsync';
import {
  groupTemplates,
  parseTemplate,
  type ParsedTemplate,
  type TemplateField,
} from '../../lib/template';
import { rasterize } from './rasterize';
import { TemplateForm } from './TemplateForm';

/**
 * Pick a template, rewrite its text, get an image.
 *
 * The preview is the real SVG, live in the document — not a picture of one.
 * That is what lets the text be clicked to jump to its field, and it is also
 * what makes fitting long text possible at all, since `getComputedTextLength`
 * needs a laid-out element to measure.
 */
export function TemplateDialog({
  open,
  onClose,
  onCreated,
  attachesToSlide = false,
  editing = null,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (asset: MediaAsset) => void;
  /** Whether the caller puts the result straight onto a slide, or just files it. */
  attachesToSlide?: boolean;
  /**
   * An existing image made from a template, reopened with its own wording
   * already in the boxes. Skips the gallery — you came here to change a date,
   * not to pick a design again.
   */
  editing?: MediaAsset | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const reopening =
    editing?.source?.kind === 'template' ? editing.source : null;

  const templates = useAsync(() => (open ? api.listTemplates() : Promise.resolve([])), [open]);

  const parsed = useMemo(
    () => (templates.data ?? []).map((template) => parseTemplate(template)).filter((item): item is ParsedTemplate => item !== null),
    [templates.data],
  );

  // `showModal` gives Esc-to-close, the backdrop and a focus trap for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) setChosen(null);
    else if (reopening) setChosen(reopening.templateId);
  }, [open, reopening]);

  const current = parsed.find((template) => template.id === chosen) ?? null;

  // The saved wording, once the template it belongs to has been parsed. A
  // template that has since been edited may have gained or lost fields, so
  // this is applied over the template's own defaults rather than replacing
  // them — a field added later arrives with its stock text rather than blank.
  const startValues = reopening && current?.id === reopening.templateId ? reopening.values : null;

  return (
    <dialog ref={dialogRef} className="tpl" onClose={onClose}>
      <header className="tpl__head">
        <div>
          <h2>{current ? current.name : 'Start from a template'}</h2>
          <p className="muted">
            {current
              ? current.description
              : 'Change the words, and the panel makes an image out of it.'}
          </p>
        </div>
        <div className="tpl__headactions">
          {current && !reopening ? (
            <button type="button" className="btn btn--small" onClick={() => setChosen(null)}>
              ← All templates
            </button>
          ) : null}
          <button type="button" className="btn btn--small" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {templates.error ? <Banner kind="error">{templates.error}</Banner> : null}
      {templates.loading && !templates.data ? <Spinner /> : null}

      {current ? (
        <TemplateEditor
          key={`${current.id}-${editing?.id ?? 'new'}`}
          template={current}
          onCreated={onCreated}
          attachesToSlide={attachesToSlide}
          startValues={startValues}
          editing={reopening ? editing : null}
        />
      ) : (
        <Gallery templates={parsed} raw={templates.data ?? []} onPick={setChosen} />
      )}
    </dialog>
  );
}

// --- gallery ----------------------------------------------------------------

function Gallery({
  templates,
  raw,
  onPick,
}: {
  templates: ParsedTemplate[];
  raw: { id: string; svg: string }[];
  onPick: (id: string) => void;
}) {
  // Thumbnails are <img> rather than inline SVG on purpose: every template
  // names its gradient `bg`, and six inline copies in one document would fight
  // over the id. An <img> is its own document and cannot collide.
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const template of raw) {
      map.set(template.id, URL.createObjectURL(new Blob([template.svg], { type: 'image/svg+xml' })));
    }
    return map;
  }, [raw]);

  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);

  const groups = useMemo(() => groupTemplates(templates), [templates]);

  // One heading is no heading: a library that has not been categorized yet
  // reads as a plain grid rather than as a grid with a lone label over it.
  const labelled = groups.length > 1;

  return (
    <>
      {groups.map((group) => (
        <section key={group.category} className="tplsection">
          {labelled ? <h3 className="tplsection__head">{group.category}</h3> : null}
          <ul className="tplgrid">
            {group.templates.map((template) => (
              <li key={template.id}>
                <button type="button" className="tplcard" onClick={() => onPick(template.id)}>
                  <img className="tplcard__art" src={urls.get(template.id)} alt="" />
                  <span className="tplcard__name">{template.name}</span>
                  <span className="tplcard__desc">{template.description}</span>
                  <span className="tplcard__meta">
                    {template.width} × {template.height} ·{' '}
                    {template.fields.length === 1
                      ? '1 thing to change'
                      : `${template.fields.length} things to change`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// --- editor -----------------------------------------------------------------

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'template';
}

function TemplateEditor({
  template,
  onCreated,
  attachesToSlide,
  startValues,
  editing,
}: {
  template: ParsedTemplate;
  onCreated: (asset: MediaAsset) => void;
  attachesToSlide: boolean;
  /** Saved wording to open with, overlaid on the template's own defaults. */
  startValues: Record<string, string> | null;
  /** The asset being regenerated, if this is a second pass at one. */
  editing: MediaAsset | null;
}) {
  const [values, setValues] = useState<TemplateField[]>(() =>
    template.fields.map((field) => ({
      ...field,
      ...(startValues && field.id in startValues ? { value: startValues[field.id]! } : {}),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const create = async (mode: 'new' | 'replace') => {
    const svg = svgRef.current;
    if (!svg) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await rasterize(svg, template.width, template.height);
      const wording = values.filter((field) => field.kind === 'text' && field.value.trim());
      const headline =
        wording.find((field) => field.lines > 1)?.value ?? wording[0]?.value ?? template.name;
      const filename = `${slugify(headline)}.jpg`;

      // The recipe travels with the bytes, so this image can be reopened with
      // its own wording rather than retyped from scratch next quarter.
      const source: MediaSource = {
        kind: 'template',
        templateId: template.id,
        values: Object.fromEntries(values.map((field) => [field.id, field.value])),
      };

      const asset =
        mode === 'replace' && editing
          ? await api.replaceImageBlob(editing.id, blob, filename, source)
          : await api.uploadImageBlob(blob, filename, source);
      onCreated(asset);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not make the image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tpledit">
      <TemplateForm
        template={template}
        values={values}
        onChange={setValues}
        svgRef={(node) => {
          svgRef.current = node;
        }}
      />

      <div className="tpledit__form">
        {error ? <Banner kind="error">{error}</Banner> : null}

        {editing ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void create('replace')}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Update this image'}
            </button>
            <button type="button" className="btn" onClick={() => void create('new')} disabled={busy}>
              Save as a separate image
            </button>
            <p className="muted tplfield__hint">
              Updating keeps the same entry, so every slide already showing it picks up the new
              version. Saving separately leaves the original alone.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void create('new')}
              disabled={busy}
            >
              {busy ? 'Making it…' : 'Make the image'}
            </button>
            <p className="muted tplfield__hint">
              Saves a {template.width} × {template.height} JPEG to your media
              {attachesToSlide ? ', and puts it on this slide' : ''}. You can reopen it later and
              change the wording.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
