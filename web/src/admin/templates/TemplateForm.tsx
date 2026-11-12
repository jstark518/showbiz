import { useEffect, useRef, useState } from 'react';
import {
  applyField,
  fieldOverflows,
  type ParsedTemplate,
  type TemplateField,
} from '../../lib/template';

/**
 * The live artwork and the boxes that drive it.
 *
 * Shared by the two things that edit a template: the dialog that turns one
 * into a JPEG, and the template slide's editor. They differ only in what they
 * do afterwards, so everything up to that point lives here.
 *
 * The preview is the real SVG, live in the document — not a picture of one.
 * That is what lets the text be clicked to jump to its field, and it is also
 * what makes fitting long text possible at all, since `getComputedTextLength`
 * needs a laid-out element to measure.
 */
export function TemplateForm({
  template,
  values,
  onChange,
  svgRef,
  animate = false,
}: {
  template: ParsedTemplate;
  values: TemplateField[];
  onChange: (next: TemplateField[]) => void;
  /** Handed out so a caller can rasterize exactly what is on screen. */
  svgRef?: (node: SVGSVGElement | null) => void;
  /**
   * Run the artwork's motion here, the way the sign will.
   *
   * Off for the media dialog and that is not an oversight: what it produces is
   * one flat JPEG, so a preview that moved would be advertising something the
   * export cannot do. Only the template slide, which really does render live,
   * turns this on.
   */
  animate?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [overflowing, setOverflowing] = useState<string[]>([]);

  const holderRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<SVGSVGElement | null>(null);
  const inputsRef = useRef<Record<string, HTMLElement | null>>({});
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Mount the parsed SVG once, then mutate it in place. Re-rendering it from
  // React on every keystroke would throw away the measurements that fitting
  // depends on, and flicker while it did.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const node = template.doc.cloneNode(true) as SVGSVGElement;
    node.removeAttribute('width');
    node.removeAttribute('height');
    holder.replaceChildren(node);
    liveRef.current = node;
    svgRef?.(node);
    for (const field of valuesRef.current) applyField(node, field);
    setOverflowing(valuesRef.current.filter((f) => fieldOverflows(node, f.id)).map((f) => f.id));
    return () => {
      holder.replaceChildren();
      liveRef.current = null;
      svgRef?.(null);
    };
    // Mounting is keyed to the template; values are applied imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const edit = (id: string, value: string) => {
    const next = values.map((field) => (field.id === id ? { ...field, value } : field));
    const svg = liveRef.current;
    if (svg) {
      applyField(svg, next.find((field) => field.id === id)!);
      setOverflowing((previous) => {
        const spills = fieldOverflows(svg, id);
        if (spills === previous.includes(id)) return previous;
        return spills ? [...previous, id] : previous.filter((other) => other !== id);
      });
    }
    onChange(next);
  };

  // A click on the artwork focuses the field that drew it. Text wins over the
  // shape behind it, so clicking a card's caption edits the caption rather
  // than jumping to the color of the card it sits on.
  const onArtClick = (event: React.MouseEvent) => {
    const target = event.target as Element | null;
    const owner = target?.closest?.('[data-field], [data-paint-field]');
    const id = owner?.getAttribute('data-field') ?? owner?.getAttribute('data-paint-field');
    if (!id) return;
    setActive(id);
    const input = inputsRef.current[id];
    input?.focus();
    if (input instanceof HTMLTextAreaElement) input.select();
  };

  // Highlighting is a page-stylesheet concern, so it shows here and cannot
  // travel into the exported file, which is serialized without the page's CSS.
  useEffect(() => {
    const svg = liveRef.current;
    if (!svg) return;
    for (const node of svg.querySelectorAll('[data-field], [data-paint-field]')) {
      const id = node.getAttribute('data-field') ?? node.getAttribute('data-paint-field');
      node.classList.toggle('is-active', id === active);
    }
  }, [active]);

  /**
   * Entry motions are one-shot, so without this you see them once on mount and
   * never again — which is no use to someone deciding whether the stagger is
   * right. Toggling the class off, forcing a reflow and putting it back
   * restarts every animation without re-parsing or re-measuring the artwork.
   */
  const replay = () => {
    const holder = holderRef.current;
    if (!holder) return;
    holder.classList.remove('is-animated');
    void holder.offsetWidth;
    holder.classList.add('is-animated');
  };

  return (
    <>
      <div
        ref={holderRef}
        className={`tpledit__art${animate ? ' tplart is-animated' : ''}`}
        onClick={onArtClick}
        role="presentation"
        style={{ aspectRatio: `${template.width} / ${template.height}` }}
      />

      {animate ? (
        <div className="tpledit__replay">
          <button type="button" className="btn btn--small" onClick={replay}>
            ↻ Play again
          </button>
          <span className="muted">
            {template.animated
              ? 'This is the motion the sign will run.'
              : 'This artwork has no motion of its own — it will simply appear.'}
          </span>
        </div>
      ) : null}

      <div className="tpledit__form">
        {values.map((field) => (
          <label key={field.id} className={`tplfield ${active === field.id ? 'is-active' : ''}`}>
            <span className="tplfield__label">{field.label}</span>

            {field.kind === 'color' ? (
              <ColorRow
                field={field}
                onPick={(value) => edit(field.id, value)}
                onFocus={() => setActive(field.id)}
                onBlur={() => setActive((current) => (current === field.id ? null : current))}
                inputRef={(node) => {
                  inputsRef.current[field.id] = node;
                }}
              />
            ) : field.kind === 'date' ? (
              <input
                ref={(node) => {
                  inputsRef.current[field.id] = node;
                }}
                type="date"
                className="tplfield__input"
                value={field.value}
                onChange={(event) => edit(field.id, event.target.value)}
                onFocus={() => setActive(field.id)}
                onBlur={() => setActive((current) => (current === field.id ? null : current))}
              />
            ) : (
              <textarea
                ref={(node) => {
                  inputsRef.current[field.id] = node;
                }}
                className="tplfield__input"
                value={field.value}
                rows={field.lines > 1 ? 2 : 1}
                onChange={(event) => edit(field.id, event.target.value)}
                onFocus={() => setActive(field.id)}
                onBlur={() => setActive((current) => (current === field.id ? null : current))}
              />
            )}

            {overflowing.includes(field.id) ? (
              <span className="tplfield__warn">
                Too long for the space — it has been shrunk as far as it usefully goes.
              </span>
            ) : (
              <span className="tplfield__hint">
                {field.hint}
                {field.hint && field.lines > 1 ? ' ' : ''}
                {field.kind === 'text' && field.lines > 1
                  ? 'Enter breaks the line yourself; it wraps on its own otherwise.'
                  : ''}
                {field.kind === 'date' && !field.hint
                  ? 'The artwork writes the day, date and month from this.'
                  : ''}
              </span>
            )}
          </label>
        ))}
      </div>
    </>
  );
}

/**
 * The template's own suggestions, then the full picker.
 *
 * The swatches are what anyone actually wants — they are the palette the
 * artwork was drawn against, and picking one keeps a set of cards looking like
 * a set. The native input is there for the day someone needs the brand color
 * of a team that was not thought of.
 */
function ColorRow({
  field,
  onPick,
  onFocus,
  onBlur,
  inputRef,
}: {
  field: TemplateField;
  onPick: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  inputRef: (node: HTMLInputElement | null) => void;
}) {
  const chosen = field.value.toLowerCase();
  return (
    <span className="tplcolor">
      {field.swatches.map((swatch) => (
        <button
          key={swatch}
          type="button"
          className={`tplcolor__swatch ${swatch.toLowerCase() === chosen ? 'is-selected' : ''}`}
          style={{ background: swatch }}
          aria-label={swatch}
          title={swatch}
          onFocus={onFocus}
          onBlur={onBlur}
          onClick={() => onPick(swatch)}
        />
      ))}
      <input
        ref={inputRef}
        type="color"
        className="tplcolor__picker"
        value={field.value}
        aria-label={`${field.label} — any color`}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => onPick(event.target.value)}
      />
      <span className="tplcolor__value">{field.value}</span>
    </span>
  );
}
