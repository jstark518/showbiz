import type { Readable } from 'node:stream';
import { env } from '../env';
import { FilesystemStore } from './filesystem';
import { S3Store } from './s3';

/**
 * Where uploaded images and videos live.
 *
 * Two backends, chosen by configuration rather than by environment: a
 * directory for `docker compose` and for running the server on a laptop, and
 * an S3 bucket (MinIO) for the cluster. Everything above this interface is
 * identical either way — the route that accepts an upload and the route that
 * serves it back never learn which one they are talking to.
 */

export interface StoredObject {
  stream: Readable;
  contentType: string;
  /** Null when the backend cannot say, which keeps Content-Length off. */
  contentLength: number | null;
}

export interface MediaStore {
  /** For the startup log, so a misconfigured deploy is visible immediately. */
  readonly describe: string;
  /** Returns the number of bytes stored. */
  put(key: string, body: Readable, contentType: string): Promise<number>;
  get(key: string): Promise<StoredObject | null>;
  /** Succeeds when the object is already gone. */
  delete(key: string): Promise<void>;
}

/**
 * S3 wins when a bucket is configured. There is no flag to set: naming a
 * bucket is the decision, and a half-configured S3 block fails loudly in
 * `env.ts` rather than silently writing to a container filesystem that
 * disappears with the pod.
 */
export const mediaStore: MediaStore = env.s3
  ? new S3Store(env.s3)
  : new FilesystemStore(env.mediaDir);
