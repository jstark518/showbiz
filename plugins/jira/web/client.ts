import { apiRequest, jsonBody } from '../../../web/src/lib/api';
import type {
  JiraBoardOption,
  JiraConnectionStatus,
  JiraDashboardData,
  JiraEpicOption,
  JiraIssueSummary,
  JiraPreviewResult,
  JiraProjectOption,
  JiraSprintListing,
  JiraTestResult,
} from '../shared';

interface Credentials {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
}

/**
 * This plugin's endpoints, shared by the sign and the panel.
 *
 * Kept with the plugin rather than added to the app's `api` object: removing
 * the folder should remove the feature, not leave a dozen dead calls behind.
 */
export const jiraApi = {
  // --- what the sign asks for ---------------------------------------------
  slideData: (slideId: string, signal?: AbortSignal) =>
    apiRequest<JiraDashboardData>(
      `/api/sign/slides/${slideId}/jira`,
      signal ? { signal } : undefined,
    ),

  /** Full issue list behind a slide, for drilling in on the touchscreen. */
  slideIssues: (slideId: string, signal?: AbortSignal) =>
    apiRequest<JiraIssueSummary[]>(
      `/api/sign/slides/${slideId}/jira/issues`,
      signal ? { signal } : undefined,
    ),

  // --- the panel -----------------------------------------------------------
  /** The sign's payload for a config that has not been saved, for the preview. */
  dashboardPreview: (config: unknown, title: string, signal?: AbortSignal) =>
    apiRequest<JiraDashboardData>('/api/jira/dashboard', {
      method: 'POST',
      body: jsonBody({ config, title }),
      ...(signal ? { signal } : {}),
    }),

  /** Resolves a slide config to the query it will run, and counts the matches. */
  previewConfig: (config: unknown, signal?: AbortSignal) =>
    apiRequest<JiraPreviewResult>('/api/jira/preview', {
      method: 'POST',
      body: jsonBody({ config }),
      ...(signal ? { signal } : {}),
    }),

  refresh: () => apiRequest<{ ok: boolean }>('/api/jira/refresh', { method: 'POST' }),

  status: () => apiRequest<JiraConnectionStatus>('/api/settings/jira'),
  saveSettings: (input: Credentials) =>
    apiRequest<JiraConnectionStatus>('/api/settings/jira', {
      method: 'PUT',
      body: jsonBody(input),
    }),
  /** Tests the values passed in, falling back to whatever is already stored. */
  test: (input: Credentials = {}) =>
    apiRequest<JiraTestResult>('/api/settings/jira/test', {
      method: 'POST',
      body: jsonBody(input),
    }),

  // --- metadata, for the slide editor's dropdowns --------------------------
  projects: () => apiRequest<JiraProjectOption[]>('/api/jira/projects'),
  boards: (projectKey?: string) =>
    apiRequest<JiraBoardOption[]>(
      `/api/jira/boards${projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : ''}`,
    ),
  sprints: (boardId: number) => apiRequest<JiraSprintListing>(`/api/jira/sprints?boardId=${boardId}`),
  epics: (projectKey: string) =>
    apiRequest<JiraEpicOption[]>(`/api/jira/epics?projectKey=${encodeURIComponent(projectKey)}`),
};
