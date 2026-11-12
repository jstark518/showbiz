import { createHash } from 'node:crypto';
import type {
  JiraBurndownPoint,
  JiraDashboardData,
  JiraDashboardSlideConfig,
  JiraGroupBucket,
  JiraIssueSummary,
  JiraSprintProgress,
  JiraStatusCategory,
} from '../shared';
import { json, sql } from '../../../server/src/db';
import { env } from '../../../server/src/env';
import { getCredentials, type JiraCredentials } from './client';
import { clearFieldCache, discoverFields } from './fields';
import { approximateCount, scanIssues, toIssueSummary, withTone, type RawIssue } from './issues';
import { resolveQuery } from './jql';
import { clearMetadataCache, getSprint, type JiraSprintDetail } from './metadata';
import { loadEpicPortfolio, loadSingleEpic } from './epics';

/**
 * The full scan is kept alongside the trimmed display copy so the touchscreen
 * can drill into every issue without a second round trip to Jira.
 */
interface CachedBoard {
  data: JiraDashboardData;
  allIssues: JiraIssueSummary[];
}

const memoryCache = new Map<string, { value: CachedBoard; expiresAt: number }>();

function cacheKeyFor(config: JiraDashboardSlideConfig): string {
  const material = JSON.stringify([
    config.mode,
    config.projectKey,
    config.boardId,
    config.sprintId,
    config.epicKey,
    config.includeDone,
    config.jql,
    config.groupBy,
    config.dueSoonDays,
    config.progressBy,
    config.atRiskSlipPct,
    config.offTrackSlipPct,
    config.maxEpics,
  ]);
  return createHash('sha1').update(material).digest('hex');
}

async function readDbCache(key: string): Promise<CachedBoard | null> {
  const [row] = await sql<{ payload: CachedBoard }[]>`
    select payload from jira_cache where cache_key = ${key}
  `;
  return row?.payload ?? null;
}

async function writeDbCache(key: string, value: CachedBoard): Promise<void> {
  await sql`
    insert into jira_cache (cache_key, payload, fetched_at)
    values (${key}, ${json(value)}, now())
    on conflict (cache_key) do update
      set payload = excluded.payload, fetched_at = excluded.fetched_at
  `;
}

// --- shaping ---------------------------------------------------------------

function buildGroups(
  issues: JiraIssueSummary[],
  groupBy: JiraDashboardSlideConfig['groupBy'],
): JiraGroupBucket[] {
  const buckets = new Map<string, JiraGroupBucket>();

  for (const issue of issues) {
    let label: string;
    let avatarUrl: string | null = null;

    if (groupBy === 'assignee') {
      label = issue.assignee ?? 'Unassigned';
      avatarUrl = issue.assigneeAvatarUrl;
    } else if (groupBy === 'epic') {
      label = issue.epic ?? 'No epic';
    } else {
      label = issue.status;
    }

    const existing = buckets.get(label);
    if (existing) {
      existing.count += 1;
      // A status bucket has one category by definition; for assignee and epic
      // buckets the category is only meaningful when every issue agrees.
      if (existing.category !== issue.statusCategory) existing.category = 'unknown';
    } else {
      buckets.set(label, {
        key: label,
        label,
        count: 1,
        category: issue.statusCategory,
        avatarUrl,
      });
    }
  }

  const categoryOrder: Record<JiraStatusCategory, number> = {
    todo: 0,
    in_progress: 1,
    done: 2,
    unknown: 3,
  };

  return [...buckets.values()].sort((a, b) => {
    if (groupBy === 'status') {
      const byCategory = categoryOrder[a.category] - categoryOrder[b.category];
      if (byCategory !== 0) return byCategory;
    }
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
}

function pickDueSoon(issues: JiraIssueSummary[], withinDays: number): JiraIssueSummary[] {
  if (withinDays <= 0) return [];
  const cutoff = Date.now() + withinDays * 24 * 60 * 60 * 1000;
  return issues
    .filter((issue) => {
      if (!issue.dueDate || issue.statusCategory === 'done') return false;
      const due = Date.parse(issue.dueDate);
      return Number.isFinite(due) && due <= cutoff;
    })
    .sort((a, b) => Date.parse(a.dueDate!) - Date.parse(b.dueDate!))
    .slice(0, 6);
}

/**
 * Issues most worth showing: in-progress and overdue work first, so a
 * truncated list is the interesting end of the backlog rather than whatever
 * Jira happened to return first.
 */
function rankIssues(issues: JiraIssueSummary[]): JiraIssueSummary[] {
  const weight: Record<JiraStatusCategory, number> = {
    in_progress: 0,
    todo: 1,
    unknown: 2,
    done: 3,
  };
  return [...issues].sort((a, b) => {
    const byCategory = weight[a.statusCategory] - weight[b.statusCategory];
    if (byCategory !== 0) return byCategory;
    const aDue = a.dueDate ? Date.parse(a.dueDate) : Number.POSITIVE_INFINITY;
    const bDue = b.dueDate ? Date.parse(b.dueDate) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return a.key.localeCompare(b.key);
  });
}

function countByCategory(issues: JiraIssueSummary[]) {
  const counts = { todo: 0, in_progress: 0, done: 0 };
  for (const issue of issues) {
    if (issue.statusCategory !== 'unknown') counts[issue.statusCategory] += 1;
  }
  return counts;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Below this share of issues carrying an estimate, points are not worth trusting. */
const MIN_ESTIMATE_COVERAGE = 0.6;
/** Guards the burndown loop against a sprint with absurd dates. */
const MAX_BURNDOWN_DAYS = 90;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Sprint dates, progress and a burndown curve.
 *
 * The curve is reconstructed from each issue's resolution date rather than from
 * Jira's changelog, which would be a request per issue. The trade is that it
 * uses the sprint's *current* scope for every day: an issue added yesterday is
 * drawn as though it had been there since day one. For a wall display that is
 * the right trade — the shape of the line is what people read, and it costs
 * nothing beyond the search that already ran.
 */
function buildSprintProgress(
  sprint: JiraSprintDetail,
  issues: JiraIssueSummary[],
  progressBy: JiraDashboardSlideConfig['progressBy'],
  now: number,
): JiraSprintProgress {
  const estimated = issues.filter((issue) => issue.storyPoints !== null).length;
  const coverage = issues.length > 0 ? estimated / issues.length : 0;
  // Same concession as epic health: an unestimated sprint would read 0% done
  // forever, so fall back to counting issues.
  const basis: JiraDashboardSlideConfig['progressBy'] =
    progressBy === 'points' && coverage >= MIN_ESTIMATE_COVERAGE ? 'points' : 'issues';
  const unitsOf = (issue: JiraIssueSummary) =>
    basis === 'points' ? (issue.storyPoints ?? 0) : 1;

  const totalUnits = issues.reduce((sum, issue) => sum + unitsOf(issue), 0);
  const doneUnits = issues
    .filter((issue) => issue.statusCategory === 'done')
    .reduce((sum, issue) => sum + unitsOf(issue), 0);

  const start = sprint.startDate ? Date.parse(sprint.startDate) : Number.NaN;
  const end = sprint.endDate ? Date.parse(sprint.endDate) : Number.NaN;
  const dated = Number.isFinite(start) && Number.isFinite(end) && end > start;

  const burndown: JiraBurndownPoint[] = [];
  if (dated) {
    const firstDay = startOfDay(start);
    const lastDay = Math.min(startOfDay(end), startOfDay(now));
    for (let day = firstDay, guard = 0; day <= lastDay && guard < MAX_BURNDOWN_DAYS; day += DAY_MS, guard += 1) {
      const burned = issues.reduce((sum, issue) => {
        if (!issue.resolvedAt) return sum;
        const resolved = Date.parse(issue.resolvedAt);
        return Number.isFinite(resolved) && startOfDay(resolved) <= day ? sum + unitsOf(issue) : sum;
      }, 0);
      burndown.push({
        day: new Date(day).toISOString().slice(0, 10),
        remaining: Math.max(0, totalUnits - burned),
      });
    }
  }

  return {
    id: sprint.id,
    name: sprint.name,
    goal: sprint.goal,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    timeElapsedPct: dated ? Math.min(1, Math.max(0, (now - start) / (end - start))) : null,
    daysRemaining: dated ? Math.ceil((end - now) / DAY_MS) : null,
    totalDays: dated ? Math.round((end - start) / DAY_MS) : null,
    progressBy: basis,
    totalUnits,
    doneUnits,
    remainingUnits: Math.max(0, totalUnits - doneUnits),
    burndown,
  };
}

function emptyBoard(
  config: JiraDashboardSlideConfig,
  heading: string,
  error: string | null,
): CachedBoard {
  return {
    data: {
      mode: config.mode,
      heading,
      sourceLabel: '',
      resolvedJql: '',
      groupBy: config.groupBy,
      total: 0,
      counts: { todo: 0, in_progress: 0, done: 0 },
      groups: [],
      issues: [],
      dueSoon: [],
      sprint: null,
      epic: null,
      epics: [],
      fetchedAt: new Date().toISOString(),
      stale: false,
      error,
    },
    allIssues: [],
  };
}

// --- assembly --------------------------------------------------------------

async function loadBoard(
  credentials: JiraCredentials,
  config: JiraDashboardSlideConfig,
  heading: string,
): Promise<CachedBoard> {
  const now = Date.now();
  const fields = await discoverFields(credentials);
  const query = await resolveQuery(credentials, config);
  if (query.problem) return emptyBoard(config, heading, query.problem);

  // Portfolio mode is assembled from the epics themselves rather than from a
  // single issue search.
  if (config.mode === 'epics') {
    const portfolio = await loadEpicPortfolio(credentials, config, config.projectKey!, now);
    const children = withTone(
      portfolio.allChildren.map((issue) => toIssueSummary(issue, credentials.baseUrl, fields)),
      config.dueSoonDays,
    );
    return {
      data: {
        mode: 'epics',
        heading,
        sourceLabel: query.label,
        resolvedJql: query.jql,
        groupBy: config.groupBy,
        total: portfolio.epics.length,
        counts: countByCategory(children),
        groups: [],
        issues: [],
        dueSoon: pickDueSoon(children, config.dueSoonDays),
        sprint: null,
        epic: null,
        epics: portfolio.epics.slice(0, config.maxEpics),
        fetchedAt: new Date().toISOString(),
        stale: false,
        error: portfolio.epics.length === 0 ? 'No epics found in that project.' : null,
      },
      allIssues: children,
    };
  }

  const { issues: raw, truncated } = await scanIssues(credentials, query.jql, fields);
  const issues = withTone(
    raw.map((issue) => toIssueSummary(issue, credentials.baseUrl, fields)),
    config.dueSoonDays,
  );
  const total = truncated
    ? ((await approximateCount(credentials, query.jql)) ?? issues.length)
    : issues.length;

  const epic =
    config.mode === 'epic'
      ? await loadSingleEpic(credentials, config, config.epicKey!, raw as RawIssue[], now)
      : null;

  // The sprint's dates and goal are not in the issue search, so they cost one
  // extra request — cached, and only for sprint mode.
  const sprintDetail =
    config.mode === 'sprint' && query.sprintId ? await getSprint(credentials, query.sprintId) : null;
  const sprint = sprintDetail
    ? buildSprintProgress(sprintDetail, issues, config.progressBy, now)
    : null;

  return {
    data: {
      mode: config.mode,
      heading,
      sourceLabel: epic ? `${epic.key} · ${epic.summary}` : query.label,
      resolvedJql: query.jql,
      groupBy: config.groupBy,
      total,
      counts: countByCategory(issues),
      groups: buildGroups(issues, config.groupBy),
      // Not truncated: the sign's ticket list scrolls, and the scan is
      // already capped at MAX_SCAN, so the payload stays bounded anyway.
      issues: rankIssues(issues),
      dueSoon: pickDueSoon(issues, config.dueSoonDays),
      sprint,
      epic,
      epics: [],
      fetchedAt: new Date().toISOString(),
      stale: false,
      error:
        config.mode === 'epic' && !epic ? `Epic ${config.epicKey} could not be loaded.` : null,
    },
    allIssues: rankIssues(issues),
  };
}

async function getBoard(
  config: JiraDashboardSlideConfig,
  fallbackHeading: string,
): Promise<CachedBoard> {
  const heading = config.heading || fallbackHeading || 'Project status';
  const key = cacheKeyFor(config);

  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, data: { ...cached.value.data, heading } };
  }

  const credentials = await getCredentials();
  if (!credentials) {
    return emptyBoard(
      config,
      heading,
      'Jira is not configured. Add credentials in the control panel.',
    );
  }

  try {
    const board = await loadBoard(credentials, config, heading);
    memoryCache.set(key, { value: board, expiresAt: Date.now() + env.jira.cacheTtlMs });
    await writeDbCache(key, board).catch(() => {
      // Losing the durable copy is not worth failing the request over.
    });
    return board;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Jira error';
    const previous = await readDbCache(key).catch(() => null);
    if (previous) {
      return { ...previous, data: { ...previous.data, heading, stale: true, error: message } };
    }
    return emptyBoard(config, heading, message);
  }
}

/**
 * Resolves one jira_dashboard slide. Fresh data if the cache has expired and
 * Jira answers; otherwise the last good copy flagged `stale`. Only throws for
 * programmer error — a Jira outage is reported in the payload instead.
 */
export async function getDashboardData(
  config: JiraDashboardSlideConfig,
  fallbackHeading: string,
): Promise<JiraDashboardData> {
  return (await getBoard(config, fallbackHeading)).data;
}

/** The full issue list behind a slide, for drilling in from the touchscreen. */
export async function getDrillIssues(
  config: JiraDashboardSlideConfig,
  fallbackHeading: string,
): Promise<JiraIssueSummary[]> {
  return (await getBoard(config, fallbackHeading)).allIssues;
}

/** Preview for the editor: what the pickers resolve to, and how many match. */
export async function previewConfig(
  config: JiraDashboardSlideConfig,
): Promise<{ ok: boolean; count?: number; jql?: string; label?: string; message: string }> {
  const credentials = await getCredentials();
  if (!credentials) return { ok: false, message: 'Jira is not configured.' };

  try {
    const query = await resolveQuery(credentials, config);
    if (query.problem) return { ok: false, message: query.problem };

    if (config.mode === 'epics') {
      const portfolio = await loadEpicPortfolio(
        credentials,
        config,
        config.projectKey!,
        Date.now(),
      );
      return {
        ok: true,
        count: portfolio.epics.length,
        jql: query.jql,
        label: query.label,
        message: `${portfolio.epics.length} epic${portfolio.epics.length === 1 ? '' : 's'} found.`,
      };
    }

    const fields = await discoverFields(credentials);
    const { issues, truncated } = await scanIssues(credentials, query.jql, fields);
    const count = truncated
      ? ((await approximateCount(credentials, query.jql)) ?? issues.length)
      : issues.length;
    return {
      ok: true,
      count,
      jql: query.jql,
      label: query.label,
      message: `${count} ticket${count === 1 ? '' : 's'} match.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unknown Jira error' };
  }
}

/** Drops every memoised lookup so the next refresh refetches from Jira. */
export function clearMemoryCache(): void {
  memoryCache.clear();
  clearMetadataCache();
  clearFieldCache();
}
