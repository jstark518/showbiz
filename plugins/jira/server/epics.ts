import type {
  JiraDashboardSlideConfig,
  JiraEpicHealth,
  JiraEpicSummary,
  JiraProgressBasis,
} from '../shared';
import type { JiraCredentials } from './client';
import { dateField, discoverFields, epicFieldsFor, type DiscoveredFields } from './fields';
import {
  asObject,
  asString,
  searchWithFields,
  statusCategoryOf,
  toIssueSummary,
  type RawIssue,
} from './issues';
import { epicsChildrenJql, quote } from './jql';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Story points only beat issue counts when most issues actually carry an
 * estimate. Below this share, an unestimated backlog would read as "0% done"
 * forever, so the basis silently falls back to counting issues.
 */
const MIN_ESTIMATE_COVERAGE = 0.6;

interface Progress {
  basis: JiraProgressBasis;
  doneUnits: number;
  totalUnits: number;
  progressPct: number;
  issueCount: number;
  doneIssueCount: number;
}

function measureProgress(
  children: RawIssue[],
  fields: DiscoveredFields,
  requested: JiraProgressBasis,
): Progress {
  const issueCount = children.length;
  const doneIssueCount = children.filter((issue) => statusCategoryOf(issue) === 'done').length;

  if (requested === 'points' && fields.storyPoints) {
    const estimated = children.filter(
      (issue) => typeof issue.fields[fields.storyPoints!] === 'number',
    );
    if (issueCount > 0 && estimated.length / issueCount >= MIN_ESTIMATE_COVERAGE) {
      let total = 0;
      let done = 0;
      for (const issue of estimated) {
        const points = Number(issue.fields[fields.storyPoints!]) || 0;
        total += points;
        if (statusCategoryOf(issue) === 'done') done += points;
      }
      if (total > 0) {
        return {
          basis: 'points',
          doneUnits: done,
          totalUnits: total,
          progressPct: done / total,
          issueCount,
          doneIssueCount,
        };
      }
    }
  }

  return {
    basis: 'issues',
    doneUnits: doneIssueCount,
    totalUnits: issueCount,
    progressPct: issueCount > 0 ? doneIssueCount / issueCount : 0,
    issueCount,
    doneIssueCount,
  };
}

interface HealthVerdict {
  health: JiraEpicHealth;
  reason: string;
  timeElapsedPct: number | null;
  daysRemaining: number | null;
  forecastDate: string | null;
  forecastSlipDays: number | null;
}

/**
 * Compares how much of the schedule has been consumed against how much of the
 * work is finished. An epic 80% through its window with 40% of the work done
 * has slipped 40 points and is in trouble; the same epic at 75% done is fine.
 */
function assessHealth(
  progress: Progress,
  startMs: number | null,
  dueMs: number | null,
  now: number,
  config: JiraDashboardSlideConfig,
): HealthVerdict {
  const empty: HealthVerdict = {
    health: 'unknown',
    reason: '',
    timeElapsedPct: null,
    daysRemaining: null,
    forecastDate: null,
    forecastSlipDays: null,
  };

  if (progress.totalUnits === 0) {
    return { ...empty, reason: 'No tickets under this epic yet.' };
  }
  if (progress.progressPct >= 1) {
    return {
      ...empty,
      health: 'complete',
      reason: 'All tickets are done.',
      daysRemaining: dueMs === null ? null : Math.ceil((dueMs - now) / MS_PER_DAY),
    };
  }
  if (dueMs === null) {
    return { ...empty, reason: 'No due date set, so progress cannot be judged against a schedule.' };
  }

  const daysRemaining = Math.ceil((dueMs - now) / MS_PER_DAY);

  // Forecast the finish from the pace so far, which is what turns "behind" into
  // "behind by roughly this much".
  let forecastDate: string | null = null;
  let forecastSlipDays: number | null = null;
  if (startMs !== null && now > startMs && progress.progressPct > 0) {
    const projectedEnd = startMs + (now - startMs) / progress.progressPct;
    forecastDate = new Date(projectedEnd).toISOString();
    forecastSlipDays = Math.round((projectedEnd - dueMs) / MS_PER_DAY);
  }

  if (now > dueMs) {
    const daysOver = Math.abs(daysRemaining);
    return {
      health: 'overdue',
      reason: `Due date passed ${daysOver} day${daysOver === 1 ? '' : 's'} ago with ${Math.round(
        (1 - progress.progressPct) * 100,
      )}% of the work outstanding.`,
      timeElapsedPct: 1,
      daysRemaining,
      forecastDate,
      forecastSlipDays,
    };
  }

  if (startMs === null || dueMs <= startMs) {
    return {
      ...empty,
      reason: 'No usable date range, so only the due date is being tracked.',
      daysRemaining,
    };
  }

  const timeElapsedPct = Math.min(1, Math.max(0, (now - startMs) / (dueMs - startMs)));
  const slipPoints = (timeElapsedPct - progress.progressPct) * 100;
  const elapsed = Math.round(timeElapsedPct * 100);
  const done = Math.round(progress.progressPct * 100);

  const shared = { timeElapsedPct, daysRemaining, forecastDate, forecastSlipDays };

  if (slipPoints >= config.offTrackSlipPct) {
    return {
      ...shared,
      health: 'off_track',
      reason: `${elapsed}% of the time gone but only ${done}% of the work done.`,
    };
  }
  if (slipPoints >= config.atRiskSlipPct) {
    return {
      ...shared,
      health: 'at_risk',
      reason: `Work is ${Math.round(slipPoints)} points behind the schedule.`,
    };
  }
  return {
    ...shared,
    health: 'on_track',
    reason: `${done}% done with ${elapsed}% of the time used.`,
  };
}

export function buildEpicSummary(
  epic: RawIssue,
  children: RawIssue[],
  fields: DiscoveredFields,
  baseUrl: string,
  config: JiraDashboardSlideConfig,
  now: number,
): JiraEpicSummary {
  const progress = measureProgress(children, fields, config.progressBy);

  const explicitStart = dateField(epic.fields, fields.startDate);
  const created = asString(epic.fields['created']);
  // Every epic on the instance this was built against had a due date but no
  // start date, so falling back to the creation date is what makes the risk
  // model work on real data at all. It is flagged so the sign can say so.
  const startDate = explicitStart ?? created;
  const startDateInferred = !explicitStart && Boolean(created);

  const dueDate = asString(epic.fields['duedate']);
  const startMs = startDate ? Date.parse(startDate) : null;
  const dueMs = dueDate ? Date.parse(`${dueDate}T23:59:59Z`) : null;

  const verdict = assessHealth(
    progress,
    Number.isFinite(startMs) ? startMs : null,
    Number.isFinite(dueMs) ? dueMs : null,
    now,
    config,
  );

  const status = asObject(epic.fields['status']);

  return {
    key: epic.key,
    url: `${baseUrl}/browse/${epic.key}`,
    summary: asString(epic.fields['summary']) ?? epic.key,
    status: asString(status?.['name']) ?? 'Unknown',
    statusCategory: statusCategoryOf(epic),
    startDate,
    startDateInferred,
    dueDate,
    progressBy: progress.basis,
    doneUnits: progress.doneUnits,
    totalUnits: progress.totalUnits,
    progressPct: progress.progressPct,
    issueCount: progress.issueCount,
    doneIssueCount: progress.doneIssueCount,
    timeElapsedPct: verdict.timeElapsedPct,
    daysRemaining: verdict.daysRemaining,
    forecastDate: verdict.forecastDate,
    forecastSlipDays: verdict.forecastSlipDays,
    health: verdict.health,
    healthReason: verdict.reason,
  };
}

/** Worst news first — the point of the board is to surface trouble. */
const HEALTH_RANK: Record<JiraEpicHealth, number> = {
  overdue: 0,
  off_track: 1,
  at_risk: 2,
  on_track: 3,
  unknown: 4,
  complete: 5,
};

export function sortByHealth(epics: JiraEpicSummary[]): JiraEpicSummary[] {
  return [...epics].sort((a, b) => {
    const byHealth = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
    if (byHealth !== 0) return byHealth;
    const aDue = a.dueDate ? Date.parse(a.dueDate) : Number.POSITIVE_INFINITY;
    const bDue = b.dueDate ? Date.parse(b.dueDate) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return a.key.localeCompare(b.key);
  });
}

export interface EpicPortfolio {
  epics: JiraEpicSummary[];
  /** Every child issue across all the epics, for the header counts. */
  allChildren: RawIssue[];
}

/**
 * Loads every epic in a project plus their children in two queries, rather
 * than one query per epic.
 */
export async function loadEpicPortfolio(
  credentials: JiraCredentials,
  config: JiraDashboardSlideConfig,
  projectKey: string,
  now: number,
): Promise<EpicPortfolio> {
  const fields = await discoverFields(credentials);
  const epics = await searchWithFields(
    credentials,
    `project = ${quote(projectKey)} AND issuetype = Epic ORDER BY duedate ASC`,
    epicFieldsFor(fields),
    100,
  );

  if (epics.length === 0) return { epics: [], allChildren: [] };

  const childrenJql = await epicsChildrenJql(
    credentials,
    epics.map((epic) => epic.key),
  );
  const allChildren = await searchWithFields(
    credentials,
    childrenJql,
    [...epicFieldsFor(fields), 'parent', 'assignee', 'priority', 'issuetype', 'status'].concat(
      fields.storyPoints ? [fields.storyPoints] : [],
    ),
    250,
  );

  const byParent = new Map<string, RawIssue[]>();
  for (const child of allChildren) {
    const parentKey = asString(asObject(child.fields['parent'])?.['key']);
    if (!parentKey) continue;
    const bucket = byParent.get(parentKey);
    if (bucket) bucket.push(child);
    else byParent.set(parentKey, [child]);
  }

  const summaries = epics.map((epic) =>
    buildEpicSummary(epic, byParent.get(epic.key) ?? [], fields, credentials.baseUrl, config, now),
  );

  return { epics: sortByHealth(summaries), allChildren };
}

/** Loads one epic and its children for the detailed single-epic view. */
export async function loadSingleEpic(
  credentials: JiraCredentials,
  config: JiraDashboardSlideConfig,
  epicKey: string,
  children: RawIssue[],
  now: number,
): Promise<JiraEpicSummary | null> {
  const fields = await discoverFields(credentials);
  const [epic] = await searchWithFields(
    credentials,
    `key = ${quote(epicKey)}`,
    epicFieldsFor(fields),
    1,
  );
  if (!epic) return null;
  return buildEpicSummary(epic, children, fields, credentials.baseUrl, config, now);
}

export { toIssueSummary };
