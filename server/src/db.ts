import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { env } from './env';

export const sql = postgres(env.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  // Return bigint as a JS number. Every bigint column here is a file size, so
  // the 2^53 ceiling is not a practical concern.
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (value: number) => String(value),
      parse: (value: string) => Number(value),
    },
  },
});

/**
 * postgres.js types `sql.json` against its own JSONValue union, which plain
 * interfaces and Record types do not structurally satisfy. Everything passed
 * here has already been through a zod schema, so the cast is checked upstream.
 */
export function json(value: unknown) {
  return sql.json(value as Parameters<typeof sql.json>[0]);
}

/**
 * The database may still be starting when the app container comes up. compose
 * gates on a healthcheck, but retry anyway so a plain `docker run` also works.
 */
export async function waitForDatabase(attempts = 30, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await sql`select 1`;
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * The migrations live beside the source in dev and are copied next to the
 * bundle in the image. Probe both rather than branching on NODE_ENV, which is
 * easy to get wrong and fails at startup when it is.
 */
async function findMigrationsDir(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'server/migrations'),
    path.resolve(import.meta.dirname, '../migrations'),
    path.resolve(import.meta.dirname, '../../server/migrations'),
  ];
  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error(`Could not locate migrations directory. Tried: ${candidates.join(', ')}`);
}

export async function migrate(log: (message: string) => void): Promise<void> {
  const migrationsDir = await findMigrationsDir();

  await sql`
    create table if not exists _migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from _migrations`).map((row) => row.name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(migrationsDir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _migrations (name) values (${file})`;
    });
    log(`applied migration ${file}`);
  }
}

/** Guarantees exactly one playlist exists and is active on a fresh install. */
export async function seedDefaults(): Promise<void> {
  const [existing] = await sql<{ id: string }[]>`select id from playlists limit 1`;
  if (existing) return;
  await sql`insert into playlists (name, is_active) values ('Main loop', true)`;
}
