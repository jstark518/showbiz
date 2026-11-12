import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { MediaStore, StoredObject } from './index';

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Uploads in an S3 bucket. MinIO in the cluster; any S3 would do.
 *
 * Two things about MinIO in particular:
 *
 * `forcePathStyle` is mandatory. Virtual-host addressing puts the bucket in
 * the hostname, so the SDK would look up `sign.minio.minio.svc`, which does not
 * exist — and the failure arrives as a DNS error that reads like a network
 * problem rather than a configuration one.
 *
 * The endpoint has no Ingress: it is reachable from inside the cluster only.
 * That is why nothing here hands out presigned URLs — a player on the office
 * network could not open one. The bytes are proxied back through the app,
 * which also keeps `/media/<file>` stable across a change of backend.
 */
export class S3Store implements MediaStore {
  readonly describe: string;
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.describe = `s3 (${config.endpoint}, bucket ${config.bucket})`;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Readable, contentType: string): Promise<number> {
    // `Upload` rather than PutObjectCommand: the body is a request stream of
    // unknown length, and PutObject would need Content-Length up front. This
    // does a multipart upload instead, so a 500 MB video never has to be
    // buffered anywhere first.
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      },
    });

    let bytes = 0;
    upload.on('httpUploadProgress', (progress) => {
      if (typeof progress.loaded === 'number') bytes = progress.loaded;
    });

    await upload.done();
    return bytes;
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!result.Body) return null;
      return {
        stream: result.Body as Readable,
        contentType: result.ContentType ?? 'application/octet-stream',
        contentLength: typeof result.ContentLength === 'number' ? result.ContentLength : null,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch (error) {
      // S3 delete is already idempotent, but a bucket with versioning on can
      // answer differently; a missing object is still the wanted outcome.
      if (!isMissing(error)) throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  return (
    error.name === 'NoSuchKey' ||
    error.name === 'NotFound' ||
    error.$metadata?.httpStatusCode === 404
  );
}
