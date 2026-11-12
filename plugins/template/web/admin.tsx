import { useEffect, useMemo, useState } from 'react';
import { Banner, Field, Spinner, Toggle } from '../../../web/src/admin/components';
import { TemplateForm } from '../../../web/src/admin/templates/TemplateForm';
import { useAsync } from '../../../web/src/admin/useAsync';
import { api } from '../../../web/src/lib/api';
import {
  groupTemplates,
  parseTemplate,
  type ParsedTemplate,
  type TemplateField,
} from '../../../web/src/lib/template';
import type { AdminPlugin, SlideEditorProps } from '../../web/types';
import type { ImageSlideConfig, MediaTemplateSource } from '../../../shared/types';
import type { TemplateSlideConfig } from '../shared';
import './admin.css';
// The motion vocabulary itself, so the editor's artwork moves the way the sign
// will. It is the sign's stylesheet by name and by home, but the rules are
// keyed on `.tplart.is-animated` rather than on anything slide-shaped, so the
// panel can borrow them without a second copy to keep in step.
import './sign.css';

/**
 * The same artwork and the same boxes as the media dialog, saving to a slide
 * instead of to a JPEG.
 *
 * There is no separate preview frame here: the form's own artwork *is* the
 * preview, at the size it will be on the wall. What it cannot show is the
 * motion — that only exists once the sign renders it — which is what the note
 * under the toggle says.
 */
function TemplateEditor({ config, onChange }: SlideEditorProps) {
  const value = config as unknown as TemplateSlideConfig;
  const templates = useAsync(() => api.listTemplates(), []);

  const parsed = useMemo(
    () =>
      (templates.data ?? [])
        .map((template) => parseTemplate(template))
        .filter((item): item is ParsedTemplate => item !== null)
        // Only artwork that declares motion. A still template is what the media
        // library is for — it makes a JPEG, which is cheaper for the player and
        // reusable on any image slide. Whatever this slide already points at
        // stays listed either way, so an existing choice is never dropped
        // silently because the artwork changed.
        .filter((item) => item.animated || item.id === value.templateId),
    [templates.data, value.templateId],
  );

  const current = parsed.find((template) => template.id === value.templateId) ?? null;

  // Sectioned the same way the media gallery is, so the two pickers name the
  // same groups. A single section stays a flat list — an <optgroup> holding
  // every option is a label for nothing.
  const groups = useMemo(() => groupTemplates(parsed), [parsed]);

  // The template's own defaults, overlaid with whatever this slide has saved.
  // Applied in that order so artwork that gained a field since the slide was
  // made arrives with its stock wording rather than blank.
  const fields: TemplateField[] = useMemo(
    () =>
      current
        ? current.fields.map((field) => ({
            ...field,
            ...(field.id in value.values ? { value: value.values[field.id]! } : {}),
          }))
        : [],
    [current, value.values],
  );

  // A freshly chosen template contributes its defaults straight away, so the
  // slide saves something renderable even if nothing is typed.
  useEffect(() => {
    if (!current || Object.keys(value.values).length > 0) return;
    onChange({ values: Object.fromEntries(current.fields.map((f) => [f.id, f.value])) });
    // Only when the chosen template changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  return (
    <>
      <Field
        label="Artwork"
        hint="Only artwork that animates. Anything still is better made into an image on the Media tab."
      >
        <select
          value={value.templateId ?? ''}
          onChange={(event) =>
            // Wording belongs to the artwork it was typed into, so switching
            // starts clean rather than carrying over fields that no longer
            // exist.
            onChange({ templateId: event.target.value || null, values: {} })
          }
        >
          <option value="">Choose artwork…</option>
          {groups.length > 1
            ? groups.map((group) => (
                <optgroup key={group.category} label={group.category}>
                  {group.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </optgroup>
              ))
            : parsed.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
        </select>
      </Field>

      {templates.loading && !templates.data ? <Spinner /> : null}
      {templates.error ? <Banner kind="error">{templates.error}</Banner> : null}

      {current ? (
        <>
          <Toggle
            label="Play the artwork's animation"
            checked={value.animate}
            onChange={(animate) => onChange({ animate })}
            hint="The artwork below runs it too, so what you see here is what the sign shows."
          />

          <div className="tpledit tpledit--slide">
            <TemplateForm
              template={current}
              values={fields}
              animate={value.animate}
              onChange={(next) =>
                onChange({ values: Object.fromEntries(next.map((f) => [f.id, f.value])) })
              }
            />
          </div>
        </>
      ) : (
        <p className="muted">Choose artwork and its wording appears here.</p>
      )}
    </>
  );
}

export const templateAdminPlugin: AdminPlugin = {
  id: 'template',
  slides: { template: TemplateEditor },

  /**
   * An image made from a template is a flattened recipe, and the recipe is
   * still on the asset — so the slide can be turned back into live artwork
   * without retyping a word of it.
   *
   * Offered for any template-made image, not only the artwork that animates.
   * The picker's animation rule is about choosing *new* artwork, where a still
   * template is better made into a JPEG; converting an image you already have
   * is a different act, and live text that reflows and a date that is written
   * from a real date are worth having either way.
   */
  conversions: [
    {
      to: 'template',
      label: 'Turn into live artwork',
      hint: 'Keeps the wording. The sign draws it live from then on, so the text stays sharp at any size and any motion in the artwork plays.',
      from: (slide, media) => {
        if (slide.type !== 'image') return null;
        const { mediaId } = slide.config as ImageSlideConfig;
        const asset = media.find((item) => item.id === mediaId);
        const source = asset?.source;
        if (source?.kind !== 'template') return null;
        const recipe = source as MediaTemplateSource;
        return { templateId: recipe.templateId, values: recipe.values, animate: true };
      },
    },
  ],
};
