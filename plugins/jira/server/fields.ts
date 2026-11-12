import { jiraFetch, type JiraCredentials } from './client';

/**
 * Jira's interesting fields are custom fields whose ids differ per site, so
 * they have to be discovered rather than hardcoded. On the instance this was
 * built against, story points are `customfield_10016` and start date is
 * `customfield_10015` — but neither is guaranteed anywhere else.
 */
export interface DiscoveredFields {
  /** "Story Points" (company-managed) or "Story point estimate" (team-managed). */
  storyPoints: string | null;
  startDate: string | null;
  /**
   * Only present on older company-managed projects. Team-managed projects use
   * the unified `parent` field instead, so this is usually null.
   */
  epicLink: string | null;
}

const EMPTY: DiscoveredFields = { storyPoints: null, startDate: null, epicLink: null };

interface RawField {
  id: string;
  name?: string;
  custom?: boolean;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { value: DiscoveredFields; expiresAt: number }>();

export async function discoverFields(credentials: JiraCredentials): Promise<DiscoveredFields> {
  const cached = cache.get(credentials.baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let fields: RawField[];
  try {
    fields = await jiraFetch<RawField[]>(credentials, '/rest/api/3/field');
  } catch {
    // Field discovery is an optimisation. Without it, progress falls back to
    // issue counts and start dates to the epic's creation date, which is
    // still a working board.
    return EMPTY;
  }

  const find = (predicate: (name: string) => boolean): string | null =>
    fields.find((field) => field.name && predicate(field.name.toLowerCase()))?.id ?? null;

  const value: DiscoveredFields = {
    storyPoints: find((name) => name.startsWith('story point')),
    startDate: find((name) => name === 'start date'),
    epicLink: find((name) => name === 'epic link'),
  };

  cache.set(credentials.baseUrl, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function clearFieldCache(): void {
  cache.clear();
}

/** The field list every issue query asks for, plus whatever was discovered. */
export function issueFieldsFor(fields: DiscoveredFields): string[] {
  const base = [
    'summary',
    'status',
    'assignee',
    'priority',
    'issuetype',
    'duedate',
    'parent',
    // Drives the burndown: when each issue was resolved reconstructs the
    // curve without a per-issue changelog fetch.
    'resolutiondate',
  ];
  if (fields.storyPoints) base.push(fields.storyPoints);
  return base;
}

export function epicFieldsFor(fields: DiscoveredFields): string[] {
  const base = ['summary', 'status', 'duedate', 'created', 'project'];
  if (fields.startDate) base.push(fields.startDate);
  return base;
}

/** Reads a numeric custom field, tolerating strings and nulls. */
export function numericField(
  raw: Record<string, unknown> | undefined,
  fieldId: string | null,
): number | null {
  if (!raw || !fieldId) return null;
  const value = raw[fieldId];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function dateField(
  raw: Record<string, unknown> | undefined,
  fieldId: string | null,
): string | null {
  if (!raw || !fieldId) return null;
  const value = raw[fieldId];
  return typeof value === 'string' && value ? value : null;
}
