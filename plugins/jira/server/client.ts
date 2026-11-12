import type { JiraConnectionStatus, JiraTestResult } from '../shared';
import { json, sql } from '../../../server/src/db';
import { env } from '../../../server/src/env';

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  source: 'env' | 'database';
}

export interface StoredJiraSettings {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
}

async function readStoredSettings(): Promise<StoredJiraSettings> {
  const [row] = await sql<{ value: StoredJiraSettings }[]>`
    select value from settings where key = 'jira'
  `;
  return row?.value ?? {};
}

export async function getCredentials(): Promise<JiraCredentials | null> {
  if (env.jira.baseUrl && env.jira.email && env.jira.apiToken) {
    return {
      baseUrl: env.jira.baseUrl,
      email: env.jira.email,
      apiToken: env.jira.apiToken,
      source: 'env',
    };
  }
  const stored = await readStoredSettings();
  if (stored.baseUrl && stored.email && stored.apiToken) {
    return {
      baseUrl: stored.baseUrl.replace(/\/+$/, ''),
      email: stored.email,
      apiToken: stored.apiToken,
      source: 'database',
    };
  }
  return null;
}

export async function getConnectionStatus(): Promise<JiraConnectionStatus> {
  const credentials = await getCredentials();
  if (credentials) {
    return {
      configured: true,
      source: credentials.source,
      baseUrl: credentials.baseUrl,
      email: credentials.email,
      hasToken: true,
    };
  }
  // Report a partial configuration so the panel can show what is missing.
  const stored = await readStoredSettings();
  return {
    configured: false,
    source: 'none',
    baseUrl: env.jira.baseUrl ?? stored.baseUrl ?? null,
    email: env.jira.email ?? stored.email ?? null,
    hasToken: Boolean(env.jira.apiToken ?? stored.apiToken),
  };
}

export async function saveStoredSettings(input: StoredJiraSettings): Promise<void> {
  const current = await readStoredSettings();
  // An omitted token means "leave the existing one alone" — the panel never
  // receives the token back, so it cannot echo it to us.
  const merged: StoredJiraSettings = {
    baseUrl: input.baseUrl ?? current.baseUrl,
    email: input.email ?? current.email,
    apiToken: input.apiToken ?? current.apiToken,
  };
  await sql`
    insert into settings (key, value, updated_at)
    values ('jira', ${json(merged)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

// --- HTTP ------------------------------------------------------------------

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

export async function jiraFetch<T>(
  credentials: JiraCredentials,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64');
  const response = await fetch(`${credentials.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new JiraError(describeHttpError(response.status, body), response.status);
  }
  return (await response.json()) as T;
}

function describeHttpError(status: number, body: string): string {
  if (status === 401) return 'Jira rejected the credentials (401). Check the email and API token.';
  if (status === 403)
    return 'Jira denied access (403). The account may lack permission on that project.';
  if (status === 404) return 'Jira endpoint not found (404). Check the base URL is your Cloud site.';
  if (status === 429)
    return 'Jira rate limited the request (429). It will retry on the next refresh.';
  const detail = extractErrorMessages(body);
  return detail ? `Jira returned ${status}: ${detail}` : `Jira returned ${status}.`;
}

export function extractErrorMessages(body: string): string {
  try {
    const parsed = JSON.parse(body) as { errorMessages?: string[]; errors?: Record<string, string> };
    const messages = [...(parsed.errorMessages ?? []), ...Object.values(parsed.errors ?? {})].filter(
      Boolean,
    );
    return messages.join('; ').slice(0, 300);
  } catch {
    return body.slice(0, 200);
  }
}

// --- connection test -------------------------------------------------------

async function resolveForTest(override: StoredJiraSettings): Promise<JiraCredentials | null> {
  const saved = await getCredentials();
  const stored = await readStoredSettings();

  const baseUrl = override.baseUrl?.trim() || saved?.baseUrl || stored.baseUrl || env.jira.baseUrl;
  const email = override.email?.trim() || saved?.email || stored.email || env.jira.email;
  const apiToken = override.apiToken || saved?.apiToken || stored.apiToken || env.jira.apiToken;

  if (!baseUrl || !email || !apiToken) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    email,
    apiToken,
    source: saved?.source ?? 'database',
  };
}

function describeMissing(override: StoredJiraSettings, stored: StoredJiraSettings): string {
  const missing: string[] = [];
  if (!(override.baseUrl?.trim() || stored.baseUrl || env.jira.baseUrl)) missing.push('site URL');
  if (!(override.email?.trim() || stored.email || env.jira.email)) missing.push('account email');
  if (!(override.apiToken || stored.apiToken || env.jira.apiToken)) missing.push('API token');
  return `Nothing to test — still missing: ${missing.join(', ')}.`;
}

/**
 * Tests the values passed in, preferring them over what is stored, so the
 * panel's button can verify a token before it is committed.
 */
export async function testConnection(override: StoredJiraSettings = {}): Promise<JiraTestResult> {
  const credentials = await resolveForTest(override);
  if (!credentials) {
    return { ok: false, message: describeMissing(override, await readStoredSettings()) };
  }
  if (!/^https?:\/\/[^/\s]+$/i.test(credentials.baseUrl)) {
    return {
      ok: false,
      message: `"${credentials.baseUrl}" is not a valid site URL. It should look like https://your-org.atlassian.net`,
    };
  }
  try {
    const me = await jiraFetch<{ displayName?: string }>(credentials, '/rest/api/3/myself');
    return {
      ok: true,
      message: `Connected to ${credentials.baseUrl}`,
      ...(me.displayName ? { accountName: me.displayName } : {}),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unknown Jira error' };
  }
}
