import type {
  JiraBoardOption,
  JiraEpicOption,
  JiraProjectOption,
  JiraSprintListing,
  JiraSprintOption,
} from '../shared';
import { jiraFetch, JiraError, type JiraCredentials } from './client';
import { discoverFields, epicFieldsFor } from './fields';
import { asObject, asString, searchWithFields } from './issues';
import { quote } from './jql';

/**
 * Lookups that feed the control panel's dropdowns. Cached briefly: the editor
 * fires several of these as the user works through the pickers, and none of it
 * changes minute to minute.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function clearMetadataCache(): void {
  cache.clear();
}

export async function listProjects(credentials: JiraCredentials): Promise<JiraProjectOption[]> {
  return cached(`projects:${credentials.baseUrl}`, async () => {
    const response = await jiraFetch<{ values?: Record<string, unknown>[] }>(
      credentials,
      '/rest/api/3/project/search?maxResults=100&orderBy=key',
    );
    return (response.values ?? []).map((project) => ({
      key: asString(project['key']) ?? '',
      name: asString(project['name']) ?? '',
      avatarUrl: asString(asObject(project['avatarUrls'])?.['24x24']),
    }));
  });
}

export async function listBoards(
  credentials: JiraCredentials,
  projectKey?: string,
): Promise<JiraBoardOption[]> {
  const suffix = projectKey ? `&projectKeyOrId=${encodeURIComponent(projectKey)}` : '';
  return cached(`boards:${credentials.baseUrl}:${projectKey ?? '*'}`, async () => {
    const response = await jiraFetch<{ values?: Record<string, unknown>[] }>(
      credentials,
      `/rest/agile/1.0/board?maxResults=100${suffix}`,
    );
    return (response.values ?? []).map((board) => {
      const type = asString(board['type']) ?? 'unknown';
      return {
        id: Number(board['id']),
        name: asString(board['name']) ?? '',
        type,
        projectKey: asString(asObject(board['location'])?.['projectKey']),
        // Only a classic kanban board is reliably sprintless. Team-managed
        // scrum boards report type "simple", not "scrum", so requiring "scrum"
        // here hid real, running sprints behind a "this board has no sprints"
        // banner. The authoritative answer comes from listSprints, which reads
        // a 400 from the sprint endpoint as "not applicable".
        supportsSprints: type !== 'kanban',
      };
    });
  });
}

export async function listSprints(
  credentials: JiraCredentials,
  boardId: number,
): Promise<JiraSprintListing> {
  return cached(`sprints:${credentials.baseUrl}:${boardId}`, async () => {
    try {
      const response = await jiraFetch<{ values?: Record<string, unknown>[] }>(
        credentials,
        `/rest/agile/1.0/board/${boardId}/sprint?maxResults=100`,
      );
      const sprints = (response.values ?? [])
        .map((sprint) => ({
          id: Number(sprint['id']),
          name: asString(sprint['name']) ?? '',
          state: (asString(sprint['state']) ?? 'future') as JiraSprintOption['state'],
          startDate: asString(sprint['startDate']),
          endDate: asString(sprint['endDate']),
        }))
        // Active first, then upcoming, then the most recently closed.
        .sort((a, b) => {
          const rank = { active: 0, future: 1, closed: 2 } as const;
          const byState = rank[a.state] - rank[b.state];
          if (byState !== 0) return byState;
          return (b.startDate ?? '').localeCompare(a.startDate ?? '');
        });
      return { supported: true, reason: null, sprints };
    } catch (error) {
      // A kanban board answers this endpoint with a 400, which is a normal
      // answer meaning "not applicable" rather than a failure to report.
      if (error instanceof JiraError && error.status === 400) {
        return {
          supported: false,
          reason: 'This board does not use sprints. Track the project or an epic instead.',
          sprints: [],
        };
      }
      throw error;
    }
  });
}

export interface JiraSprintDetail {
  id: number;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** Full sprint record, which unlike the board listing carries the goal. */
export async function getSprint(
  credentials: JiraCredentials,
  sprintId: number,
): Promise<JiraSprintDetail | null> {
  return cached(`sprint:${credentials.baseUrl}:${sprintId}`, async () => {
    try {
      const sprint = await jiraFetch<Record<string, unknown>>(
        credentials,
        `/rest/agile/1.0/sprint/${sprintId}`,
      );
      return {
        id: Number(sprint['id']) || sprintId,
        name: asString(sprint['name']) ?? `#${sprintId}`,
        goal: asString(sprint['goal']),
        startDate: asString(sprint['startDate']),
        endDate: asString(sprint['endDate']),
      };
    } catch {
      // A sprint the board can query but not read individually should degrade
      // to a board with no dates, not to a blank slide.
      return null;
    }
  });
}

export async function findActiveSprint(
  credentials: JiraCredentials,
  boardId: number,
): Promise<JiraSprintOption | null> {
  const listing = await listSprints(credentials, boardId);
  return listing.sprints.find((sprint) => sprint.state === 'active') ?? null;
}

export async function listEpics(
  credentials: JiraCredentials,
  projectKey: string,
): Promise<JiraEpicOption[]> {
  return cached(`epics:${credentials.baseUrl}:${projectKey}`, async () => {
    const fields = await discoverFields(credentials);
    const issues = await searchWithFields(
      credentials,
      `project = ${quote(projectKey)} AND issuetype = Epic ORDER BY created DESC`,
      epicFieldsFor(fields),
      100,
    );
    return issues.map((issue) => ({
      key: issue.key,
      summary: asString(issue.fields['summary']) ?? issue.key,
      status: asString(asObject(issue.fields['status'])?.['name']) ?? 'Unknown',
      dueDate: asString(issue.fields['duedate']),
    }));
  });
}
