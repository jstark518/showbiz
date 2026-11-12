import path from 'node:path';

/*
 * Node reads .env itself — `process.loadEnvFile` since 20.12, and the runtime
 * image is on 24. No dependency for this.
 *
 * It throws when the file is absent, which is the normal case everywhere the
 * environment comes from somewhere else: Compose passes variables in directly,
 * and in Kubernetes they come from the Deployment and its Secrets.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env here; real environment variables are the only source.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * S3 is opt-in by naming a bucket. Half-configuring it is an error rather than
 * a silent fall back to the filesystem: a pod that quietly writes uploads to
 * its own container loses every one of them at the next rollout, and the only
 * symptom is images going missing days later.
 */
function s3Config() {
  const bucket = process.env['S3_BUCKET'];
  if (!bucket) return null;
  return {
    endpoint: required('S3_ENDPOINT'),
    bucket,
    region: process.env['S3_REGION'] ?? 'us-east-1',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  };
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: int('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Only used when `s3` is null. */
  mediaDir: process.env.MEDIA_DIR ?? path.resolve(process.cwd(), 'media'),
  s3: s3Config(),
  maxUploadBytes: int('MAX_UPLOAD_MB', 512) * 1024 * 1024,
  isProduction: process.env.NODE_ENV === 'production',

  jira: {
    baseUrl: process.env.JIRA_BASE_URL?.replace(/\/+$/, '') || null,
    email: process.env.JIRA_EMAIL || null,
    apiToken: process.env.JIRA_API_TOKEN || null,
    cacheTtlMs: int('JIRA_CACHE_TTL_SECONDS', 120) * 1000,
  },
} as const;
