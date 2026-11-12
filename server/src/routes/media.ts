import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from '../db';
import { env } from '../env';
import { broadcast } from '../events';
import { z } from 'zod';
import type { MediaSource } from '../../../shared/types';
import { json } from '../db';
import { HttpError, badRequest, notFound } from '../http';
import { toMediaAsset, type MediaRow } from '../mappers';
import type { MediaStore } from '../storage';

/**
 * Extensions are derived from the declared MIME type rather than the uploaded
 * filename, so nothing user-supplied ever reaches the filesystem path.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  // SVG is deliberately absent: it is served from the same origin as the
  // control panel and can carry script, which an unauthenticated upload
  // endpoint turns into stored XSS.
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
};

/**
 * The recipe field that rides along with a panel-generated image.
 *
 * Deliberately narrow: this is written by an unauthenticated endpoint and read
 * back into the panel, so it holds identifiers and typed-in strings and
 * nothing that could be interpreted as anything else.
 */
const sourceSchema = z.object({
  kind: z.literal('template'),
  templateId: z.string().max(80),
  values: z.record(z.string().max(80), z.string().max(500)),
});

/**
 * Reads the optional `source` field off a multipart upload.
 *
 * @fastify/multipart streams in order, so `upload.fields` only holds what
 * arrived *before* the file — the client must append `source` first. A missing
 * or unparseable one is not an error: the image is still perfectly good, it
 * just will not be re-editable.
 */
function readSource(upload: { fields: Record<string, unknown> }): MediaSource | null {
  const field = upload.fields['source'] as { value?: unknown } | undefined;
  if (!field || typeof field.value !== 'string') return null;
  try {
    return sourceSchema.parse(JSON.parse(field.value));
  } catch {
    return null;
  }
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  options: { store: MediaStore },
): Promise<void> {
  const { store } = options;

  app.get('/api/media', async () => {
    const rows = await sql<MediaRow[]>`select * from media_assets order by created_at desc`;
    return rows.map(toMediaAsset);
  });

  /** Validates and stores one uploaded file. Shared by create and replace. */
  const accept = async (request: FastifyRequest) => {
    const upload = await request.file();
    if (!upload) throw badRequest('Expected a multipart upload with a file field.');

    const mimeType = upload.mimetype.toLowerCase();
    const extension = EXTENSIONS[mimeType];
    if (!extension) {
      // Drain the stream so the connection closes cleanly rather than hanging.
      upload.file.resume();
      throw badRequest(
        `Unsupported file type "${upload.mimetype}". Accepted: ${Object.keys(EXTENSIONS).join(', ')}`,
      );
    }

    const kind: 'image' | 'video' = mimeType.startsWith('video/') ? 'video' : 'image';
    const filename = `${randomUUID()}${extension}`;

    let bytesWritten: number;
    try {
      bytesWritten = await store.put(filename, upload.file, mimeType);
    } catch (error) {
      await store.delete(filename);
      throw error;
    }

    // @fastify/multipart sets this once the limit trips. The object that got
    // stored is a truncated file, so drop it and report the limit rather than
    // keeping something that will not play.
    if (upload.file.truncated) {
      await store.delete(filename);
      throw new HttpError(413, `File exceeds the ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB limit.`);
    }

    return {
      filename,
      mimeType,
      kind,
      bytesWritten,
      originalName: upload.filename ?? filename,
      source: readSource(upload),
    };
  };

  app.post('/api/media', async (request, reply) => {
    const file = await accept(request);

    const [row] = await sql<MediaRow[]>`
      insert into media_assets (filename, original_name, mime_type, kind, size_bytes, source)
      values (
        ${file.filename}, ${file.originalName}, ${file.mimeType}, ${file.kind},
        ${file.bytesWritten}, ${file.source ? json(file.source) : null}
      )
      returning *
    `;
    broadcast({ type: 'content-changed' });
    reply.code(201);
    return toMediaAsset(row!);
  });

  /**
   * New bytes for an existing asset, keeping its id.
   *
   * This is what "regenerate" uses, so every slide already pointing at the
   * image picks the new one up without being re-edited. The filename is a
   * fresh UUID rather than the old one: `/media` is served immutable and
   * cached for a month, so reusing the path would leave players showing last
   * quarter's date until something evicted it.
   */
  app.put('/api/media/:id', async (request) => {
    const { id } = request.params as { id: string };
    const [existing] = await sql<MediaRow[]>`select * from media_assets where id = ${id}`;
    if (!existing) throw notFound('Media asset');

    const file = await accept(request);
    if (file.kind !== existing.kind) {
      await store.delete(file.filename);
      throw badRequest(`This asset is ${existing.kind}; the replacement is ${file.kind}.`);
    }

    const [row] = await sql<MediaRow[]>`
      update media_assets set
        filename = ${file.filename},
        mime_type = ${file.mimeType},
        size_bytes = ${file.bytesWritten},
        source = ${file.source ? json(file.source) : null}
      where id = ${id}
      returning *
    `;

    // The row already points at the new object; an orphan would be harmless,
    // but leaving one on every regenerate adds up.
    await store.delete(existing.filename);
    broadcast({ type: 'content-changed' });
    return toMediaAsset(row!);
  });

  app.delete('/api/media/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await sql<MediaRow[]>`select * from media_assets where id = ${id}`;
    if (!row) throw notFound('Media asset');

    await sql.begin(async (tx) => {
      // Clear the reference from any slide pointing at it, so the sign shows a
      // clean "no media selected" placeholder rather than a broken element.
      await tx`
        update slides
        set config = jsonb_set(config, '{mediaId}', 'null'::jsonb), updated_at = now()
        where config->>'mediaId' = ${id}
      `;
      await tx`delete from media_assets where id = ${id}`;
    });

    // The row is gone either way; a leftover object must not 500 the request.
    await store.delete(row.filename);
    broadcast({ type: 'content-changed' });
    reply.code(204);
  });
}
