import { access } from 'node:fs/promises';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { registerPluginRoutes } from '../../plugins/server';
import { migrate, seedDefaults, sql, waitForDatabase } from './db';
import { env } from './env';
import { HttpError } from './http';
import { registerMediaRoutes } from './routes/media';
import { registerPlaylistRoutes } from './routes/playlists';
import { registerSettingsRoutes } from './routes/settings';
import { registerSignRoutes } from './routes/sign';
import { registerSignAdminRoutes } from './routes/signs';
import { registerSlideRoutes } from './routes/slides';
import { registerTemplateRoutes } from './routes/templates';
import { mediaStore } from './storage';

const app = Fastify({
  logger: { level: env.logLevel },
  // BrightSign players sit behind whatever the office network provides; trust
  // proxy headers so request logs show a useful address.
  trustProxy: true,
  bodyLimit: 2 * 1024 * 1024,
});

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a stored media key may look like. Every one this app writes is a UUID
 * plus an extension from the MIME allowlist, so this is generous rather than
 * exact — it exists to exclude separators and traversal, not to re-derive the
 * naming scheme.
 */
const MEDIA_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type HandledError = Error & { statusCode?: number; code?: string };

app.setErrorHandler((error: HandledError, request, reply) => {
  if (error instanceof HttpError) {
    reply.code(error.statusCode).send({ error: error.message });
    return;
  }
  // @fastify/multipart signals an oversized upload with this code.
  if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
    reply
      .code(413)
      .send({ error: `File exceeds the ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB limit.` });
    return;
  }
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status >= 500) request.log.error({ err: error }, 'request failed');
  reply.code(status).send({ error: status >= 500 ? 'Internal server error' : error.message });
});

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate((message) => app.log.info(message));
  await seedDefaults();
  app.log.info(`media storage: ${mediaStore.describe}`);

  if (!env.isProduction) {
    // Only needed when the Vite dev server runs on its own origin.
    await app.register(cors, { origin: true });
  }

  await app.register(multipart, {
    limits: { fileSize: env.maxUploadBytes, files: 1 },
  });

  await app.register(registerSignRoutes);
  await app.register(registerSignAdminRoutes);
  await app.register(registerPlaylistRoutes);
  await app.register(registerSlideRoutes);
  await app.register(registerMediaRoutes, { store: mediaStore });
  await app.register(registerTemplateRoutes);
  await app.register(registerSettingsRoutes);

  // Last, so a plugin cannot shadow a core route by accident: Fastify refuses
  // a duplicate path outright, which turns that mistake into a failed boot
  // rather than a sign quietly serving the wrong thing.
  await registerPluginRoutes(app);

  /*
   * Uploads are streamed back through the app rather than served from disk or
   * redirected to.
   *
   * One route covers both backends, so `/media/<file>` means the same thing
   * whether the bytes are in a directory or in a bucket, and moving between
   * them does not rewrite a single stored URL. It is also the only option that
   * works for MinIO here: the cluster's endpoint has no Ingress, so a presigned
   * URL would point somewhere a player on the office network cannot reach.
   *
   * The filename is a fresh UUID on every upload, so these really are
   * immutable and a player can cache them hard and survive a network blip.
   */
  app.get('/media/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };

    // Rejected here rather than in a backend, so both answer the same thing.
    // A directory would refuse a separator and an S3 bucket would take it as
    // an ordinary key character, and the difference used to surface as a 502
    // with a logged error — a free way for anyone to fill the log.
    if (!MEDIA_KEY.test(filename)) throw new HttpError(404, 'Not found');

    let object;
    try {
      object = await mediaStore.get(filename);
    } catch (error) {
      request.log.error({ err: error, filename }, 'media read failed');
      throw new HttpError(502, 'Could not read that file from storage.');
    }
    if (!object) throw new HttpError(404, 'Not found');

    reply.header('Cache-Control', 'public, max-age=2592000, immutable');
    reply.type(object.contentType);
    if (object.contentLength !== null) reply.header('Content-Length', object.contentLength);
    return reply.send(object.stream);
  });

  const webRoot = path.resolve(process.cwd(), 'dist/web');
  if (await exists(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: '/' });

    /*
     * `/` is the control panel, served as index.html by the static handler.
     *
     * Every sign address serves the same second Vite entry point and the page
     * works out which playlist it is from its own path:
     *
     *   /s/<token>        a registered sign — what the panel hands out
     *   /sign/<uuid>      the older hand-assembled address, still honored
     *   /sign             follows whichever playlist is on air
     *
     * The `/sign` forms are kept because players may be pointed at them and
     * the panel's own preview dialog uses one. Nothing new generates them.
     */
    const sign = (_request: unknown, reply: { sendFile: (name: string) => unknown }) =>
      reply.sendFile('sign.html');

    app.get('/s/:token', sign);

    app.get('/sign', sign);
    app.get('/sign/', sign);
    app.get('/sign/:playlistId', sign);

    // Bookmarks and any player pointed at the old panel URL.
    app.get('/admin', (_request, reply) => reply.sendFile('index.html'));
    app.get('/admin/', (_request, reply) => reply.sendFile('index.html'));
  } else {
    app.log.warn(
      `No built frontend at ${webRoot}. Run "npm run build:web", or use "npm run dev" for the Vite dev server.`,
    );
  }

  await app.listen({ port: env.port, host: env.host });
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
    await sql.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((error) => {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
});
