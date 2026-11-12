import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ImageTemplate } from '../../../shared/types';

/**
 * Image templates: annotated SVGs shipped with the app, rewritten in the panel
 * and rasterized there into an ordinary JPEG.
 *
 * The server only reads them. It never renders one and never stores one — a
 * template that reached the media library would be served from the panel's own
 * origin, which is exactly the stored-XSS shape `EXTENSIONS` in media.ts keeps
 * out. Rasterizing in the browser also keeps a headless Chrome out of the
 * runtime image, which would be larger than everything else in it put together.
 */

/**
 * Beside the source in dev, copied next to the bundle in the image. Probed
 * rather than branched on NODE_ENV, the same way migrations are found.
 */
async function findTemplatesDir(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'server/templates'),
    path.resolve(import.meta.dirname, '../templates'),
    path.resolve(import.meta.dirname, '../../server/templates'),
  ];
  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error(`Could not locate templates directory. Tried: ${candidates.join(', ')}`);
}

let cache: ImageTemplate[] | null = null;

/**
 * Every template, read once for the life of the process.
 *
 * Exported because the template slide needs them too: it sends the artwork
 * down with the playlist so the sign can draw it live, rather than the panel
 * flattening it to a JPEG. Read-only files baked into the image, so caching
 * them forever is safe — `npm run dev` restarts on change, which covers
 * editing one.
 */
export async function loadTemplates(): Promise<ImageTemplate[]> {
  if (cache) return cache;

  const dir = await findTemplatesDir();
  const files = (await readdir(dir)).filter((name) => name.endsWith('.svg')).sort();
  cache = await Promise.all(
    files.map(async (file) => ({
      id: file.replace(/\.svg$/, ''),
      svg: await readFile(path.join(dir, file), 'utf8'),
    })),
  );
  return cache;
}

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/templates', async () => loadTemplates());
}
