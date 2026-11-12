import { z } from 'zod';
import { loadTemplates } from '../../../server/src/routes/templates';
import type { ServerPlugin } from '../../server/types';
import type { TemplateSlideConfig } from '../shared';

const templateConfig = z.object({
  templateId: z.string().max(80).nullable().catch(null).default(null),
  // Deliberately loose: the fields a template offers are declared in the SVG
  // and change when the artwork does, so a config written against an older
  // version has to survive rather than be rejected. Anything unrecognized is
  // simply never read.
  values: z.record(z.string().max(80), z.string().max(2000)).catch({}).default({}),
  animate: z.boolean().catch(true).default(true),
});

export const templatePlugin: ServerPlugin = {
  id: 'template',
  slides: { template: templateConfig },

  /**
   * The artwork travels with the playlist rather than being fetched.
   *
   * These are a few kB of markup each and they never change between deploys,
   * so a separate request would buy nothing and cost the sign a loading state
   * on a slide whose whole point is that it draws immediately.
   *
   * Only what the playlist references: sending all fourteen on every poll
   * would be most of a megabyte a day to a player on office wifi, for artwork
   * nothing is showing.
   */
  async signData({ slides }) {
    const wanted = new Set(
      slides
        .filter((slide) => slide.type === 'template')
        .map((slide) => (slide.config as TemplateSlideConfig).templateId)
        .filter((id): id is string => Boolean(id)),
    );
    if (wanted.size === 0) return { data: { templates: [] }, revision: [] };

    const templates = (await loadTemplates()).filter((template) => wanted.has(template.id));
    return {
      data: { templates },
      // The files are read-only and baked into the image, so which ones are
      // present is the whole of what can change here.
      revision: templates.map((template) => template.id),
    };
  },
};
