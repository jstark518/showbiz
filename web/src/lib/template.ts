import type { ImageTemplate } from '../../../shared/types';

/**
 * Reading and rewriting the annotated SVGs in server/templates/.
 *
 * Shared by both browser bundles: the panel edits a template into a JPEG, and
 * the template slide renders one live on the sign. Neither owns it, so it sits
 * in lib/ with the other things both sides use.
 *
 * The contract is entirely in `data-` attributes:
 *
 *   data-field   groups elements into one editable field (required)
 *   data-label   what the panel calls it; on the first element of a group
 *   data-hint    optional one-liner under the input
 *   data-fit     how wide the text may get, in the SVG's own units
 *   data-type    "text" (default) or "date"
 *
 * Two elements sharing a `data-field` are two *lines* of one field, in
 * document order. That is what lets a headline be one thing to type into and
 * still be two separately positioned lines on the artwork.
 *
 * A **date** field is one value across several elements, each rendering a piece
 * of it, so a date block is a date picker rather than three boxes that can
 * disagree about what day it is:
 *
 *   data-part    weekday · day · month · year · date  (which piece to draw)
 *   data-case    "upper" to match artwork set in capitals
 *   data-value   the date to open with, as YYYY-MM-DD; today if omitted
 *
 * A **color** field paints attributes instead of writing text, so it uses its
 * own attribute rather than `data-field` — an element can be a line of text and
 * take its color from a swatch at the same time:
 *
 *   data-paint-field   the field id
 *   data-paint         which attributes it sets; "fill" if omitted
 *   data-paint-label   what the panel calls it, on any one of the elements
 *   data-paint-swatch  space-separated presets offered before the picker
 *
 * The root `<svg>` carries one attribute of its own:
 *
 *   data-category  which section of the picker it appears under
 */

export type TemplateFieldKind = 'text' | 'date' | 'color';

export interface TemplateField {
  id: string;
  kind: TemplateFieldKind;
  label: string;
  hint: string;
  /** How many lines the artwork gives this field. Text fields only. */
  lines: number;
  /** Free text, an ISO `YYYY-MM-DD` date, or a `#rrggbb` color. */
  value: string;
  /** Color fields only: presets offered beside the picker. */
  swatches: string[];
}

export interface ParsedTemplate {
  id: string;
  name: string;
  description: string;
  /** Which section of the picker it belongs to. See `groupTemplates`. */
  category: string;
  width: number;
  height: number;
  /** Declares motion, so the template slide is worth using for it. */
  animated: boolean;
  fields: TemplateField[];
  /** A detached document, ready to clone. Never inserted as-is. */
  doc: SVGSVGElement;
}

/** Today as `YYYY-MM-DD`, in local time — not the UTC one `toISOString` gives. */
function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * `YYYY-MM-DD` as a date in *this* timezone.
 *
 * `new Date('2026-09-18')` is parsed as UTC midnight, which west of Greenwich
 * is the evening of the 17th — so a template would draw the day before the one
 * that was picked.
 */
function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function paintAttributes(node: Element): string[] {
  const declared = (node.getAttribute('data-paint') ?? '').split(/\s+/).filter(Boolean);
  return declared.length > 0 ? declared : ['fill'];
}

/**
 * Pinned rather than left to the machine's locale.
 *
 * The panel bakes the date into a JPEG that outlives the editing session, so
 * what the wall says should not depend on which desk it was made from. A
 * laptop set to en-GB would otherwise produce "3 November 2026" in an image
 * sitting beside one that reads "November 3, 2026".
 */
const DATE_LOCALE = 'en-US';

function formatDatePart(date: Date, part: string): string {
  switch (part) {
    case 'weekday':
      return date.toLocaleDateString(DATE_LOCALE, { weekday: 'long' });
    case 'day':
      return String(date.getDate());
    case 'month':
      return date.toLocaleDateString(DATE_LOCALE, { month: 'long' });
    case 'year':
      return String(date.getFullYear());
    default:
      return date.toLocaleDateString(DATE_LOCALE, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
  }
}

function humanize(id: string): string {
  const spaced = id.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Every id in the file is prefixed with the template's own id.
 *
 * The panel renders one template inline while you edit it, and these files all
 * name their gradient `bg` and their blur `soft`. Two of them in one document
 * and `url(#bg)` silently resolves to whichever came first — which looks like
 * a rendering bug in the template rather than an id collision.
 */
function namespaceIds(root: SVGSVGElement, prefix: string): void {
  const ids = new Map<string, string>();
  for (const node of root.querySelectorAll('[id]')) {
    const old = node.id;
    const next = `${prefix}-${old}`;
    ids.set(old, next);
    node.id = next;
  }
  if (ids.size === 0) return;

  const rewrite = (value: string) =>
    value.replace(/url\(#([^)]+)\)/g, (whole, id: string) =>
      ids.has(id) ? `url(#${ids.get(id)})` : whole,
    );

  for (const node of root.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (attribute.value.includes('url(#')) {
        node.setAttribute(attribute.name, rewrite(attribute.value));
      } else if (
        (attribute.name === 'href' || attribute.name === 'xlink:href') &&
        attribute.value.startsWith('#')
      ) {
        const target = ids.get(attribute.value.slice(1));
        if (target) node.setAttribute(attribute.name, `#${target}`);
      }
    }
  }
}

/**
 * Where a template lands when it says nothing. Every file written before
 * categories existed is one of these, so the attribute is only ever added to
 * artwork that wants out of the general pile.
 */
const DEFAULT_CATEGORY = 'Everyday';

/**
 * The order sections appear in, for the categories this repo actually ships.
 *
 * A category not named here sorts after the ones that are, alphabetically —
 * so adding artwork under a new heading works without editing this list, it
 * just lands at the bottom until someone decides where it belongs.
 */
const CATEGORY_ORDER = [DEFAULT_CATEGORY, 'Holidays'];

export interface TemplateGroup {
  category: string;
  templates: ParsedTemplate[];
}

/**
 * Templates split into the picker's sections.
 *
 * Shared by both pickers — the media dialog's gallery of cards and the template
 * slide's dropdown — because a heading in one and a flat list in the other is
 * how the two drift apart. Within a section the server's alphabetical order is
 * kept: someone opening this already knows which holiday they want, and looking
 * it up by name beats guessing where in the calendar it was filed.
 */
export function groupTemplates(templates: ParsedTemplate[]): TemplateGroup[] {
  const groups = new Map<string, ParsedTemplate[]>();
  for (const template of templates) {
    const bucket = groups.get(template.category);
    if (bucket) bucket.push(template);
    else groups.set(template.category, [template]);
  }

  const rank = (category: string) => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };

  return [...groups.entries()]
    .map(([category, list]) => ({ category, templates: list }))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category));
}

export function parseTemplate(template: ImageTemplate, prefix?: string): ParsedTemplate | null {
  const parsed = new DOMParser().parseFromString(template.svg, 'image/svg+xml');
  const doc = parsed.documentElement as unknown as SVGSVGElement;
  // DOMParser reports XML errors as a document it happily hands back, so the
  // only reliable check is the tag it produced.
  if (parsed.querySelector('parsererror') || doc.tagName !== 'svg') return null;

  // Defaults to the template's own id, which is enough for the panel — it
  // shows one at a time. The sign can have two slides on the same template in
  // one playlist, so it passes something unique per slide instead.
  namespaceIds(doc, prefix ?? template.id);

  const fields: TemplateField[] = [];
  const seen = new Map<string, TemplateField>();

  // One pass in document order, so the form reads down the artwork rather than
  // grouping every color at the bottom.
  for (const node of doc.querySelectorAll('[data-field], [data-paint-field]')) {
    const id = node.getAttribute('data-field');
    if (id) {
      const existing = seen.get(id);
      if (existing) {
        // A date is one value drawn in pieces, so more elements do not make it
        // a taller box to type into.
        if (existing.kind === 'text') {
          existing.lines += 1;
          // Joined with a newline, not a space: the artwork's own line break is
          // a design decision, and the editor shows it as one, so "Quarterly /
          // all-hands" does not silently reflow onto a single line the first
          // time someone opens the template.
          const text = node.textContent?.trim() ?? '';
          existing.value = existing.value ? `${existing.value}\n${text}` : text;
        }
      } else {
        const kind: TemplateFieldKind = node.getAttribute('data-type') === 'date' ? 'date' : 'text';
        const field: TemplateField = {
          id,
          kind,
          label: node.getAttribute('data-label') ?? humanize(id),
          hint: node.getAttribute('data-hint') ?? '',
          lines: 1,
          value: kind === 'date'
            ? node.getAttribute('data-value') || today()
            : node.textContent?.trim() ?? '',
          swatches: [],
        };
        seen.set(id, field);
        fields.push(field);
      }
    }

    const paintId = node.getAttribute('data-paint-field');
    if (paintId && !seen.has(paintId)) {
      // The opening value is whatever the artwork already paints, so a template
      // nobody touches looks exactly as it was drawn.
      const first = paintAttributes(node)[0]!;
      const field: TemplateField = {
        id: paintId,
        kind: 'color',
        label: node.getAttribute('data-paint-label') ?? humanize(paintId),
        hint: node.getAttribute('data-hint') ?? '',
        lines: 1,
        value: node.getAttribute(first) ?? '#38bdf8',
        swatches: (node.getAttribute('data-paint-swatch') ?? '').split(/\s+/).filter(Boolean),
      };
      seen.set(paintId, field);
      fields.push(field);
    }
  }

  return {
    id: template.id,
    name: doc.querySelector('title')?.textContent?.trim() || humanize(template.id),
    description: doc.querySelector('desc')?.textContent?.trim() || '',
    category: doc.getAttribute('data-category')?.trim() || DEFAULT_CATEGORY,
    width: Number(doc.getAttribute('width')) || 1920,
    height: Number(doc.getAttribute('height')) || 1080,
    animated: doc.querySelector('[data-animate]') !== null,
    fields,
    doc,
  };
}

/**
 * Where a field's text breaks across the lines the artwork gives it.
 *
 * Typing Enter wins: someone who has decided a headline reads better broken
 * after the second word should get that, and auto-wrapping over the top of it
 * would look like the editor ignoring them. Otherwise it wraps on its own.
 */
function splitLines(
  value: string,
  lines: number,
  measure: (candidate: string) => number,
  max: number,
): string[] {
  if (lines === 1) return [value.replace(/\s+/g, ' ').trim()];

  if (value.includes('\n')) {
    const manual = value.split('\n').map((line) => line.replace(/[^\S\n]+/g, ' ').trim());
    // More breaks than the artwork has lines: the surplus joins the last one
    // rather than vanishing, and shrink-to-fit takes it from there.
    const kept = manual.slice(0, lines - 1);
    kept.push(manual.slice(lines - 1).filter(Boolean).join(' '));
    while (kept.length < lines) kept.push('');
    return kept;
  }

  return wrap(value.replace(/\s+/g, ' ').trim(), lines, measure, max);
}

/** Greedy wrap into at most `lines` lines, measured at the given width. */
function wrap(text: string, lines: number, measure: (candidate: string) => number, max: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    // The last available line takes everything that is left; shrink-to-fit
    // deals with the overflow, which beats dropping words on the floor.
    if (current && out.length < lines - 1 && measure(candidate) > max) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  while (out.length < lines) out.push('');
  return out;
}

const MIN_SCALE = 0.45;

/**
 * Writes one field's text into a live (in-document) SVG.
 *
 * Live matters: the fitting below calls `getComputedTextLength()`, which needs
 * a laid-out element. On a detached document every measurement is 0 and every
 * line silently "fits".
 */
export function applyField(root: SVGSVGElement, field: TemplateField): void {
  if (field.kind === 'color') {
    for (const node of root.querySelectorAll(`[data-paint-field="${CSS.escape(field.id)}"]`)) {
      for (const attribute of paintAttributes(node)) node.setAttribute(attribute, field.value);
    }
    return;
  }

  const nodes = [...root.querySelectorAll(`[data-field="${CSS.escape(field.id)}"]`)];
  if (nodes.length === 0) return;

  const texts = nodes as SVGTextElement[];
  resetToBaseSize(texts);

  if (field.kind === 'date') {
    const date = parseLocalDate(field.value);
    // An unparseable value leaves the artwork as it was rather than blanking
    // the date block: clearing the picker should not wipe the design.
    if (!date) return;
    for (const text of texts) {
      const part = formatDatePart(date, text.getAttribute('data-part') ?? 'date');
      text.textContent = text.getAttribute('data-case') === 'upper' ? part.toUpperCase() : part;
      // Each piece is its own line and shrinks alone — a long month name should
      // not shrink the day number beside it.
      shrinkToFit([text]);
    }
    return;
  }

  const first = texts[0]!;
  const measure = (candidate: string) => {
    const previous = first.textContent;
    first.textContent = candidate;
    const width = first.getComputedTextLength();
    first.textContent = previous;
    return width;
  };

  const parts = splitLines(field.value, texts.length, measure, Number(first.getAttribute('data-fit')) || 0);

  texts.forEach((text, index) => {
    text.textContent = parts[index] ?? '';
  });
  // A single scale shared by the whole group, so two headline lines stay the
  // same size as each other when only one of them is long.
  shrinkToFit(texts);
}

/**
 * Back to full size before anything is measured.
 *
 * Wrapping against the shrunken size left over from the previous keystroke
 * packs too many words onto the first line, and the error compounds as you
 * type. This was a real bug.
 */
function resetToBaseSize(texts: SVGTextElement[]): void {
  for (const text of texts) {
    if (!text.dataset.baseSize) {
      text.dataset.baseSize = String(Number(text.getAttribute('font-size')) || 16);
    }
    text.setAttribute('font-size', text.dataset.baseSize);
  }
}

/** Shrinks a group to the narrowest scale any of its members needs. */
function shrinkToFit(texts: SVGTextElement[]): void {
  let scale = 1;
  for (const text of texts) {
    const max = Number(text.getAttribute('data-fit')) || 0;
    if (max > 0) {
      const width = text.getComputedTextLength();
      if (width > max) scale = Math.min(scale, max / width);
    }
  }
  if (scale >= 1) return;

  // Floor it, then let the rest overflow: text shrunk past about half size is
  // unreadable on a wall anyway, and seeing it spill is a clearer signal to cut
  // words than a caption that quietly becomes microscopic.
  const applied = Math.max(scale, MIN_SCALE);
  for (const text of texts) {
    text.setAttribute('font-size', String(Number(text.dataset.baseSize) * applied));
  }
}

/** True when a field's text still spills past its box at the minimum size. */
export function fieldOverflows(root: SVGSVGElement, fieldId: string): boolean {
  const nodes = [...root.querySelectorAll(`[data-field="${CSS.escape(fieldId)}"]`)];
  return nodes.some((node) => {
    const text = node as SVGTextElement;
    const max = Number(text.getAttribute('data-fit')) || 0;
    return max > 0 && text.getComputedTextLength() > max + 1;
  });
}
