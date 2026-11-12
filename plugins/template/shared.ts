/**
 * Template artwork — the wire types this plugin owns.
 *
 * The media library's template dialog flattens a template into a JPEG. This
 * slide does the opposite: it keeps the recipe and draws the artwork live on
 * the sign, which is the only way anything in a template can move.
 */

/**
 * One template's markup, as it travels to the sign.
 *
 * Structurally `ImageTemplate` from the core contract, declared here rather
 * than imported so the dependency stays one-way — core imports plugins, never
 * the reverse. See the note in `plugins/index.ts`.
 */
export interface TemplateArt {
  id: string;
  svg: string;
}

export interface TemplateSlideConfig {
  templateId: string | null;
  /** Field id → what was typed into it, exactly as a media recipe stores it. */
  values: Record<string, string>;
  /**
   * Play whatever motion the artwork declares. Off draws the same frame the
   * media library would have made of it.
   */
  animate: boolean;
}

export const TEMPLATE_SLIDE_TYPES = {
  template: { label: 'Template artwork', defaultDurationSeconds: 18 },
} as const;
