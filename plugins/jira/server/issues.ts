import type { JiraIssueSummary, JiraIssueTone, JiraStatusCategory } from '../shared';
import { jiraFetch, type JiraCredentials } from './client';
import { issueFieldsFor, numericField, type DiscoveredFields } from './fields';

/**
 * Issue fields are addressed dynamically because the interesting ones are
 * per-site custom field ids, so this stays an untyped bag with accessors
 * rather than an interface that would be a lie on half of all instances.
 */
export interface RawIssue {
  key: string;
  fields: Record<string, unknown>;
}

interface SearchResponse {
  issues?: RawIssue[];
  nextPageToken?: string;
}

/** Cap on how many issues one query scans, to bound Jira load and latency. */
export const MAX_SCAN = 250;
const PAGE_SIZE = 100;

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function mapStatusCategory(key: string | null): JiraStatusCategory {
  switch (key) {
    case 'new':
      return 'todo';
    case 'indeterminate':
      return 'in_progress';
    case 'done':
      return 'done';
    default:
      return 'unknown';
  }
}

export function statusCategoryOf(issue: RawIssue): JiraStatusCategory {
  const status = asObject(issue.fields['status']);
  const category = asObject(status?.['statusCategory']);
  return mapStatusCategory(asString(category?.['key']));
}

export function toIssueSummary(
  issue: RawIssue,
  baseUrl: string,
  fields: DiscoveredFields,
): JiraIssueSummary {
  const status = asObject(issue.fields['status']);
  const assignee = asObject(issue.fields['assignee']);
  const avatars = asObject(assignee?.['avatarUrls']) ?? {};
  const issueType = asObject(issue.fields['issuetype']);
  const parent = asObject(issue.fields['parent']);
  const parentFields = asObject(parent?.['fields']);

  return {
    key: issue.key,
    url: `${baseUrl}/browse/${issue.key}`,
    summary: asString(issue.fields['summary']) ?? '',
    status: asString(status?.['name']) ?? 'Unknown',
    statusCategory: statusCategoryOf(issue),
    assignee: asString(assignee?.['displayName']),
    assigneeAvatarUrl: asString(avatars['48x48']) ?? asString(avatars['32x32']),
    priority: asString(asObject(issue.fields['priority'])?.['name']),
    issueType: asString(issueType?.['name']),
    issueTypeIconUrl: asString(issueType?.['iconUrl']),
    dueDate: asString(issue.fields['duedate']),
    epic: asString(parentFields?.['summary']) ?? asString(parent?.['key']),
    storyPoints: numericField(issue.fields, fields.storyPoints),
    parentKey: asString(parent?.['key']),
    resolvedAt: asString(issue.fields['resolutiondate']),
    // Without a due-soon window this can only ever resolve to done, overdue,
    // in progress or to do. `withTone` refines it once the slide's window is
    // known — this default keeps the field valid at every point in between.
    tone: toneOf(statusCategoryOf(issue), asString(issue.fields['duedate']), 0),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toneOf(
  category: JiraStatusCategory,
  dueDate: string | null | undefined,
  dueSoonDays: number,
  now: number = Date.now(),
): JiraIssueTone {
  if (category === 'done') return 'done';

  const due = dueDate ? Date.parse(dueDate) : Number.NaN;
  if (Number.isFinite(due)) {
    // A Jira due date is a whole day, so something due today is not late until
    // that day is over. Marking it red at 00:01 would cry wolf every morning.
    if (due + DAY_MS <= now) return 'overdue';
    if (dueSoonDays > 0 && due <= now + dueSoonDays * DAY_MS) return 'due_soon';
  }

  return category === 'in_progress' ? 'in_progress' : 'todo';
}

/** Applies the slide's own due-soon window to a list of already-mapped issues. */
export function withTone(issues: JiraIssueSummary[], dueSoonDays: number): JiraIssueSummary[] {
  const now = Date.now();
  return issues.map((issue) => ({
    ...issue,
    tone: toneOf(issue.statusCategory, issue.dueDate, dueSoonDays, now),
  }));
}

export interface ScanResult {
  issues: RawIssue[];
  truncated: boolean;
}

/** Pages through a JQL query up to `max` issues. */
export async function scanIssues(
  credentials: JiraCredentials,
  jql: string,
  fields: DiscoveredFields,
  max = MAX_SCAN,
): Promise<ScanResult> {
  const issues: RawIssue[] = [];
  let nextPageToken: string | undefined;

  while (issues.length < max) {
    const body: Record<string, unknown> = {
      jql,
      maxResults: Math.min(PAGE_SIZE, max - issues.length),
      fields: issueFieldsFor(fields),
    };
    if (nextPageToken) body['nextPageToken'] = nextPageToken;

    const page = await jiraFetch<SearchResponse>(credentials, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    for (const issue of page.issues ?? []) issues.push(issue);

    nextPageToken = page.nextPageToken;
    if (!nextPageToken || !page.issues?.length) break;
  }

  return { issues, truncated: Boolean(nextPageToken) };
}

/** Runs a query with an explicit field list, for epics and other odd shapes. */
export async function searchWithFields(
  credentials: JiraCredentials,
  jql: string,
  fieldList: string[],
  max = MAX_SCAN,
): Promise<RawIssue[]> {
  const issues: RawIssue[] = [];
  let nextPageToken: string | undefined;

  while (issues.length < max) {
    const body: Record<string, unknown> = {
      jql,
      maxResults: Math.min(PAGE_SIZE, max - issues.length),
      fields: fieldList,
    };
    if (nextPageToken) body['nextPageToken'] = nextPageToken;

    const page = await jiraFetch<SearchResponse>(credentials, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    for (const issue of page.issues ?? []) issues.push(issue);
    nextPageToken = page.nextPageToken;
    if (!nextPageToken || !page.issues?.length) break;
  }

  return issues;
}

export async function approximateCount(
  credentials: JiraCredentials,
  jql: string,
): Promise<number | null> {
  try {
    const result = await jiraFetch<{ count?: number }>(
      credentials,
      '/rest/api/3/search/approximate-count',
      { method: 'POST', body: JSON.stringify({ jql }) },
    );
    return typeof result.count === 'number' ? result.count : null;
  } catch {
    return null;
  }
}
