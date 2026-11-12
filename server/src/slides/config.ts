import { z } from 'zod';
import { PLUGIN_SLIDE_SCHEMAS } from '../../../plugins/server';
import { normalizeConfig } from '../../../plugins/server/config';
import { SLIDE_SPECS, SLIDE_TYPES, type SlideConfigMap, type SlideType } from '../../../shared/types';

/**
 * Every field carries both a default and a `.catch`. A slide row written by an
 * older version of the panel, or hand-edited in psql, degrades to a sane value
 * instead of throwing — a sign that renders something imperfect beats a sign
 * showing a stack trace to the whole office.
 *
 * The two core types are here; every other schema comes from the plugin that
 * owns the slide type. See `plugins/index.ts`.
 */

const fit = z.enum(['cover', 'contain']).catch('cover');
const uuidOrNull = z.uuid().nullable().catch(null);

const imageConfig = z.object({
  mediaId: uuidOrNull.default(null),
  fit: fit.default('cover'),
  caption: z.string().max(280).catch('').default(''),
});

const videoConfig = z.object({
  mediaId: uuidOrNull.default(null),
  fit: fit.default('cover'),
  useVideoDuration: z.boolean().catch(true).default(true),
  loop: z.boolean().catch(false).default(false),
  muted: z.boolean().catch(true).default(true),
});

const schemas = {
  image: imageConfig,
  video: videoConfig,
  ...PLUGIN_SLIDE_SCHEMAS,
} as Record<SlideType, z.ZodType>;

export const slideTypeSchema = z.enum(SLIDE_TYPES as [SlideType, ...SlideType[]]);

/** Fills defaults and drops anything unrecognized. Never throws. */
export function normalizeSlideConfig<T extends SlideType>(type: T, raw: unknown): SlideConfigMap[T] {
  const schema = schemas[type];
  // A row whose type this build does not know about cannot be normalized, and
  // must not take the whole playlist query down. The sign draws a placeholder
  // for it either way.
  if (!schema) return {} as SlideConfigMap[T];
  return normalizeConfig<SlideConfigMap[T]>(schema, raw);
}

/** The config a freshly created slide of this type starts with. */
export function defaultSlideConfig<T extends SlideType>(type: T): SlideConfigMap[T] {
  return normalizeSlideConfig(type, {});
}

/** Sensible starting duration per type, in seconds. */
export function defaultDuration(type: SlideType): number {
  return SLIDE_SPECS[type].defaultDurationSeconds;
}
