/**
 * Jira Cloud — the wire types this plugin owns.
 *
 * Everything the sign and the panel know about Jira is in here. The server's
 * half of the plugin (`plugins/jira/server/`) is what actually talks to the
 * API; credentials never cross this boundary.
 */

export type JiraGrouping = 'status' | 'assignee' | 'epic';

/**
 * What a Jira slide follows. Everything but `jql` is assembled from dropdowns
 * in the control panel; raw JQL stays available as an escape hatch and is what
 * slides created before the query builder existed still use.
 */
export const JIRA_TRACK_MODES = ['project', 'sprint', 'epic', 'epics', 'jql'] as const;
export type JiraTrackMode = (typeof JIRA_TRACK_MODES)[number];

export const JIRA_TRACK_MODE_LABELS: Record<JiraTrackMode, string> = {
  project: 'A whole project',
  sprint: 'One sprint',
  epic: 'One epic, in detail',
  epics: 'Every epic in a project',
  jql: 'A custom JQL query',
};

export type JiraProgressBasis = 'issues' | 'points';

export interface JiraDashboardSlideConfig {
  mode: JiraTrackMode;
  projectKey: string | null;
  boardId: number | null;
  /** null with mode 'sprint' means "whichever sprint is currently open". */
  sprintId: number | null;
  epicKey: string | null;
  /** Project mode only. Including done work is what makes the bar meaningful. */
  includeDone: boolean;
  /** Used when mode is 'jql'; also carries the generated query for display. */
  jql: string;
  /** Heading shown above the board. Falls back to the slide title. */
  heading: string;
  groupBy: JiraGrouping;
  /** How many individual issues to list under the summary. 0 hides the list. */
  showAssignees: boolean;
  showProgressBar: boolean;
  /** Highlight issues whose due date is within this many days. 0 disables. */
  dueSoonDays: number;
  /** Falls back to issue counts when too few issues carry an estimate. */
  progressBy: JiraProgressBasis;
  /** Percentage points a epic may slip behind schedule before it is flagged. */
  atRiskSlipPct: number;
  offTrackSlipPct: number;
  /** Portfolio mode: how many epics to show. */
  maxEpics: number;
}

export const JIRA_SLIDE_TYPES = {
  jira_dashboard: { label: 'Jira project dashboard', defaultDurationSeconds: 25, usesTheme: true },
} as const;

// --- resolved payloads ------------------------------------------------------

export type JiraStatusCategory = 'todo' | 'in_progress' | 'done' | 'unknown';

/**
 * How an issue is doing, for color coding. Derived from its status category
 * and its due date on the server, so a player with a drifted clock cannot
 * disagree with the sign about what is overdue.
 */
export const JIRA_ISSUE_TONES = ['done', 'overdue', 'due_soon', 'in_progress', 'todo'] as const;
export type JiraIssueTone = (typeof JIRA_ISSUE_TONES)[number];

export interface JiraIssueSummary {
  key: string;
  url: string;
  summary: string;
  status: string;
  statusCategory: JiraStatusCategory;
  assignee: string | null;
  assigneeAvatarUrl: string | null;
  priority: string | null;
  issueType: string | null;
  issueTypeIconUrl: string | null;
  dueDate: string | null;
  epic: string | null;
  /** Null when the site has no estimate field, or the issue carries no value. */
  storyPoints: number | null;
  parentKey: string | null;
  tone: JiraIssueTone;
  /** When Jira resolved it. Drives the burndown without a changelog fetch. */
  resolvedAt: string | null;
}

export interface JiraGroupBucket {
  key: string;
  label: string;
  count: number;
  category: JiraStatusCategory;
  avatarUrl?: string | null;
}

/**
 * How an epic is tracking against its dates. `unknown` means there is not
 * enough information to judge — no due date, or no issues under the epic.
 */
export type JiraEpicHealth =
  | 'complete'
  | 'on_track'
  | 'at_risk'
  | 'off_track'
  | 'overdue'
  | 'unknown';

export const JIRA_EPIC_HEALTH_LABELS: Record<JiraEpicHealth, string> = {
  complete: 'Complete',
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  overdue: 'Overdue',
  unknown: 'No target date',
};

export interface JiraEpicSummary {
  key: string;
  url: string;
  summary: string;
  status: string;
  statusCategory: JiraStatusCategory;
  startDate: string | null;
  /**
   * True when `startDate` came from the epic's creation date because no start
   * date was set. Worth surfacing: it makes the elapsed-time figure a guess.
   */
  startDateInferred: boolean;
  dueDate: string | null;
  /** Units are issues or story points, per `progressBy`. */
  progressBy: JiraProgressBasis;
  doneUnits: number;
  totalUnits: number;
  progressPct: number;
  issueCount: number;
  doneIssueCount: number;
  /** Null when the epic has no usable date range. */
  timeElapsedPct: number | null;
  daysRemaining: number | null;
  /** Extrapolated finish date from the pace so far. */
  forecastDate: string | null;
  /** Positive means the forecast lands after the due date. */
  forecastSlipDays: number | null;
  health: JiraEpicHealth;
  healthReason: string;
}

/** One day of the burndown: work still outstanding at the end of that day. */
export interface JiraBurndownPoint {
  /** `YYYY-MM-DD`. */
  day: string;
  remaining: number;
}

export interface JiraSprintProgress {
  id: number;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  /** 0–1 of the sprint window used, null when Jira has no dates for it. */
  timeElapsedPct: number | null;
  /** Whole days left, negative once the sprint has run over. Null without dates. */
  daysRemaining: number | null;
  totalDays: number | null;
  /** Whether the numbers below count story points or issues. */
  progressBy: JiraProgressBasis;
  totalUnits: number;
  doneUnits: number;
  remainingUnits: number;
  /**
   * Actual work outstanding per day, oldest first. Reconstructed from each
   * issue's resolution date against the sprint's *current* scope, so issues
   * added or removed mid-sprint are counted as if they were always there.
   */
  burndown: JiraBurndownPoint[];
}

/** Payload for one jira_dashboard slide, resolved server side. */
export interface JiraDashboardData {
  mode: JiraTrackMode;
  heading: string;
  /** Human description of what is being tracked, e.g. "SAM1 · Sprint 4". */
  sourceLabel: string;
  /** The JQL actually run, so the editor can show what the pickers produced. */
  resolvedJql: string;
  /** How `groups` was bucketed, so a drill-in can filter the same way. */
  groupBy: JiraGrouping;
  total: number;
  counts: Record<Exclude<JiraStatusCategory, 'unknown'>, number>;
  groups: JiraGroupBucket[];
  issues: JiraIssueSummary[];
  dueSoon: JiraIssueSummary[];
  /** Set for mode 'sprint'. */
  sprint: JiraSprintProgress | null;
  /** Set for mode 'epic'. */
  epic: JiraEpicSummary | null;
  /** Set for mode 'epics', worst health first. */
  epics: JiraEpicSummary[];
  fetchedAt: string;
  /** True when Jira could not be reached and this is a cached copy. */
  stale: boolean;
  error: string | null;
}

// --- editor metadata --------------------------------------------------------

export interface JiraProjectOption {
  key: string;
  name: string;
  avatarUrl: string | null;
}

export interface JiraBoardOption {
  id: number;
  name: string;
  type: string;
  projectKey: string | null;
  /** False for kanban boards, which have no sprints to offer. */
  supportsSprints: boolean;
}

export interface JiraSprintOption {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed';
  startDate: string | null;
  endDate: string | null;
}

export interface JiraEpicOption {
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
}

export interface JiraSprintListing {
  supported: boolean;
  /** Why sprints are unavailable, when `supported` is false. */
  reason: string | null;
  sprints: JiraSprintOption[];
}

/** What the editor gets back when it resolves the pickers to a real query. */
export interface JiraPreviewResult {
  ok: boolean;
  count?: number;
  jql?: string;
  label?: string;
  message: string;
}

export interface JiraConnectionStatus {
  configured: boolean;
  source: 'env' | 'database' | 'none';
  baseUrl: string | null;
  email: string | null;
  hasToken: boolean;
}

export interface JiraTestResult {
  ok: boolean;
  message: string;
  accountName?: string;
}
