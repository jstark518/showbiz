import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MediaStore, StoredObject } from './index';

/**
 * Extension → content type.
 *
 * A directory stores no metadata, so the type has to come from the name. The
 * inverse of `EXTENSIONS` in routes/media.ts, which derives the extension from
 * the declared MIME on upload — so this round-trips exactly for anything this
 * app wrote.
 *
 * It matters more than it looks: without it every file comes back as
 * `application/octet-stream`, which a browser is entitled to download instead
 * of display, and which stops a `<video>` playing outright. `@fastify/static`
 * used to do this, and dropping it for a single route that serves both
 * backends is what put the hole there.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
};

const FALLBACK_TYPE = 'application/octet-stream';

/**
 * Uploads in a directory. What `docker compose` uses, and what the cluster used
 * before MinIO.
 *
 * Keys are the UUID filenames the media route generates, so they are already
 * safe to join onto a path — but this rejects anything with a separator in it
 * anyway, because the whole value of a single choke point is that it does not
 * depend on every caller having been careful.
 */
export class FilesystemStore implements MediaStore {
  readonly describe: string;

  constructor(private readonly directory: string) {
    this.describe = `filesystem (${directory})`;
  }

  private resolve(key: string): string {
    if (!key || key.includes('/') || key.includes('\\') || key.includes('..')) {
      throw new Error(`Refusing to use "${key}" as a media key.`);
    }
    return path.join(this.directory, key);
  }

  async put(key: string, body: Readable, _contentType: string): Promise<number> {
    await mkdir(this.directory, { recursive: true });
    const destination = this.resolve(key);
    let bytes = 0;
    body.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    try {
      await pipeline(body, createWriteStream(destination));
    } catch (error) {
      await unlink(destination).catch(() => {});
      throw error;
    }
    return bytes;
  }

  async get(key: string): Promise<StoredObject | null> {
    const source = this.resolve(key);
    try {
      const info = await stat(source);
      if (!info.isFile()) return null;
      return {
        stream: createReadStream(source),
        contentType: CONTENT_TYPES[path.extname(key).toLowerCase()] ?? FALLBACK_TYPE,
        contentLength: info.size,
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => {
      // Already gone is the outcome the caller wanted.
    });
  }
}
