import type { z } from 'zod';

/**
 * Parses a stored slide config, and never throws.
 *
 * Anything unrecognized is dropped and anything missing takes its default, so
 * a row written by an older build — or edited by hand in psql — degrades to
 * something renderable. A sign showing an imperfect slide beats a sign showing
 * a stack trace to the whole office.
 *
 * It lives here rather than in `server/src/slides/config.ts` so a plugin can
 * normalize its own config without importing the registry that imports it.
 */
export function normalizeConfig<T>(schema: z.ZodType, raw: unknown): T {
  const input = raw && typeof raw === 'object' ? raw : {};
  const result = schema.safeParse(input);
  return (result.success ? result.data : schema.parse({})) as T;
}
