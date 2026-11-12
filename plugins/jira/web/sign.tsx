import { useEffect, useSyncExternalStore } from 'react';
import {
  calendarDaysUntil,
  formatRelativeTime,
  formatShortDate,
} from '../../../web/src/lib/format';
import { useNow } from '../../../web/src/lib/useNow';
import { SlidePlaceholder } from '../../../web/src/sign/slides/SlidePlaceholder';
import { NAV_ICON_PROPS, type DrillPush, type SignPlugin } from '../../web/types';
import type {
  JiraDashboardData,
  JiraIssueSummary,
  JiraSprintProgress,
  JiraStatusCategory,
} from '../shared';
import { jiraApi } from './client';
import { jiraDrillViews } from './drill';
import { read, subscribe, warm } from './store';
import { EpicDetail, EpicRow } from './epic-views';
import './sign.css';

interface Props {
  slideId: string;
  title: string;
  clockOffsetMs: number;
  onDrill?: DrillPush;
  /**
   * Data supplied from outside instead of fetched.
   *
   * The control panel's preview renders this component against a config that
   * has not been saved, so there is no slide id to fetch by. `undefined` means
   * "fetch it yourself" — the sign's own path; `null` means "supplied, but not
   * here yet", which draws the loading placeholder.
   */
  data?: JiraDashboardData | null;
}

/** The server caches Jira responses, so polling this often is cheap. */
const REFRESH_INTERVAL_MS = 60_000;

const CATEGORY_LABELS: Record<Exclude<JiraStatusCategory, 'unknown'>, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

function JiraSlide({ slideId, title, clockOffsetMs, onDrill, data: supplied }: Props) {
  const now = useNow(30_000, clockOffsetMs);

  const external = supplied !== undefined;
  // The store outlives the component, which the component does not: the stage
  // is keyed by slide id, so coming round the loop is a remount. Reading it
  // here is what puts last lap's numbers on screen in the first frame.
  const cached = useSyncExternalStore(
    (onChange) => subscribe(slideId, onChange),
    () => read(slideId),
  );
  const data = external ? supplied : cached.data;
  const failed = external ? false : cached.failed;

  useEffect(() => {
    if (external) return;
    // A no-op when the slideshow already prefetched this one; a background
    // refresh when the loop is long enough that it has gone stale.
    void warm(slideId);
    const timer = window.setInterval(() => void warm(slideId, { force: true }), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [slideId, external]);

  if (!data) {
    return (
      <SlidePlaceholder
        heading={title || 'Project status'}
        detail={failed ? 'Could not reach the server.' : 'Loading project data…'}
      />
    );
  }

  if (data.error && data.total === 0 && !data.epic) {
    return <SlidePlaceholder heading={data.heading} detail={data.error} />;
  }

  const header = (
    <header className="jira__header">
      <div>
        <h1 className="jira__heading">{data.heading}</h1>
        {data.sourceLabel ? <p className="jira__source">{data.sourceLabel}</p> : null}
      </div>
      <div className="jira__meta">
        {data.stale ? <span className="jira__badge jira__badge--stale">Cached</span> : null}
        <span className="jira__updated">Updated {formatRelativeTime(data.fetchedAt, now)}</span>
      </div>
    </header>
  );

  if (data.mode === 'epics') {
    return (
      <div className="slide slide--jira slide--epics">
        {header}
        <ul className="epiclist">
          {data.epics.map((epic) => (
            <EpicRow
              key={epic.key}
              epic={epic}
              {...(onDrill
                ? { onOpen: () => onDrill({ kind: 'jira-epic', slideId, epic }) }
                : {})}
            />
          ))}
        </ul>
      </div>
    );
  }

  if (data.mode === 'epic' && data.epic) {
    const epic = data.epic;
    return (
      <div className="slide slide--jira slide--epic">
        {header}

        {/* No drill-in from here: this slide *is* the epic detail, so opening a
            view of the same thing was a navigation step that showed nothing
            new. Tapping a ticket below still drills into that ticket. The epic
            portfolio is where the epic drill-in earns its place. */}
        <EpicDetail epic={epic} />

        {data.issues.length > 0 ? (
          <ul className="jira__issue-list jira__issue-list--flush">
            {data.issues.map((issue) => (
              <li key={issue.key} className={`jira__issue jira__issue--${issue.tone}`}>
                <button
                  type="button"
                  className="jira__issue-button"
                  disabled={!onDrill}
                  onClick={() => onDrill?.({ kind: 'jira-issue', issue })}
                >
                  <span className={`jira__dot jira__dot--${issue.statusCategory}`} />
                  <span className="jira__issue-key">{issue.key}</span>
                  <span className="jira__issue-summary">{issue.summary}</span>
                  {issue.assignee ? (
                    <span className="jira__issue-assignee">{issue.assignee}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const completion = data.total > 0 ? Math.round((data.counts.done / data.total) * 100) : 0;

  return (
    <div className="slide slide--jira">
      {header}

      {data.sprint ? <SprintBand sprint={data.sprint} /> : null}

      <section className="jira__summary">
        <button
          type="button"
          className="jira__total"
          disabled={!onDrill}
          onClick={() =>
            onDrill?.({ kind: 'jira-issues', slideId, title: data.heading })
          }
        >
          <span className="jira__total-value">{data.total}</span>
          <span className="jira__total-label">tickets</span>
        </button>
        <div className="jira__counts">
          {(['todo', 'in_progress', 'done'] as const).map((category) => (
            <div key={category} className={`jira__count jira__count--${category}`}>
              <span className="jira__count-value">{data.counts[category]}</span>
              <span className="jira__count-label">{CATEGORY_LABELS[category]}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="jira__progress" role="img" aria-label={`${completion}% complete`}>
        <div className="jira__progress-track">
          {(['done', 'in_progress', 'todo'] as const).map((category) => {
            const share = data.total > 0 ? (data.counts[category] / data.total) * 100 : 0;
            return share > 0 ? (
              <div
                key={category}
                className={`jira__progress-fill jira__progress-fill--${category}`}
                style={{ width: `${share}%` }}
              />
            ) : null;
          })}
        </div>
        <span className="jira__progress-label">{completion}% done</span>
      </div>

      <div className="jira__columns">
        {data.groups.length > 0 ? (
          <section className="jira__groups">
            <h2 className="jira__section-title">Breakdown</h2>
            <ul className="jira__group-list">
              {data.groups.slice(0, 8).map((group) => (
                <li key={group.key} className="jira__group">
                  <button
                    type="button"
                    className="jira__group-button"
                    disabled={!onDrill}
                    onClick={() =>
                      onDrill?.({
                        kind: 'jira-issues',
                        slideId,
                        title: data.heading,
                        group: { by: data.groupBy, label: group.label },
                      })
                    }
                  >
                    {group.avatarUrl ? (
                      <img className="jira__avatar" src={group.avatarUrl} alt="" />
                    ) : (
                      <span className={`jira__dot jira__dot--${group.category}`} />
                    )}
                    <span className="jira__group-label">{group.label}</span>
                    <span className="jira__group-count">{group.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.issues.length > 0 ? (
          <section className="jira__issues">
            <h2 className="jira__section-title">Tickets</h2>
            <ul className="jira__issue-list">
              {data.issues.map((issue) => (
                <li key={issue.key} className={`jira__issue jira__issue--${issue.tone}`}>
                  <button
                    type="button"
                    className="jira__issue-button"
                    disabled={!onDrill}
                    onClick={() => onDrill?.({ kind: 'jira-issue', issue })}
                  >
                    <span className={`jira__dot jira__dot--${issue.statusCategory}`} />
                    <span className="jira__issue-key">{issue.key}</span>
                    <span className="jira__issue-summary">{issue.summary}</span>
                    <DueChip issue={issue} now={now} />
                    {issue.assignee ? (
                      <span className="jira__issue-assignee">{issue.assignee}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {data.dueSoon.length > 0 ? (
        <footer className="jira__due-soon">
          <span className="jira__due-soon-label">Due soon</span>
          {data.dueSoon.map((issue) => (
            <span key={issue.key} className="jira__due-soon-item">
              <strong>{issue.key}</strong> {formatShortDate(issue.dueDate!)}
            </span>
          ))}
        </footer>
      ) : null}

      {data.error ? <div className="jira__error">{data.error}</div> : null}
    </div>
  );
}

/**
 * The due date carries the warning rather than the row background. A warm wash
 * at low alpha over the navy panel comes out brown, which reads as "dirty"
 * instead of "due soon"; a word plus a saturated hue survives both the panel
 * and a glance from the far side of the room.
 */
function DueChip({ issue, now }: { issue: JiraIssueSummary; now: number }) {
  if (!issue.dueDate) return null;

  const days = calendarDaysUntil(issue.dueDate, now);
  const delta =
    issue.tone === 'overdue'
      ? `${Math.abs(days)}d late`
      : issue.tone === 'due_soon'
        ? days <= 0
          ? 'today'
          : `${days}d`
        : null;

  return (
    <span className={`jira__due jira__due--${issue.tone}`}>
      <span className="jira__due-date">{formatShortDate(issue.dueDate)}</span>
      {delta ? <span className="jira__due-delta">{delta}</span> : null}
    </span>
  );
}

function sprintDayLabel(sprint: JiraSprintProgress): string {
  if (sprint.daysRemaining === null) return 'No dates set';
  if (sprint.daysRemaining < 0) return `${Math.abs(sprint.daysRemaining)}d over`;
  if (sprint.daysRemaining === 0) return 'Ends today';
  return `${sprint.daysRemaining}d left`;
}

/**
 * The burndown. The straight line is the ideal pace; the stepped line is what
 * actually happened, rebuilt from resolution dates. Above the ideal means
 * behind, below means ahead — no axis labels needed to read that.
 */
function Burndown({ sprint }: { sprint: JiraSprintProgress }) {
  const { burndown, totalUnits, totalDays } = sprint;
  if (burndown.length < 2 || totalUnits <= 0 || !totalDays) return null;

  const width = 100;
  const height = 36;
  const at = (index: number) => (Math.min(index, totalDays) / totalDays) * width;
  const level = (remaining: number) => height - (remaining / totalUnits) * height;
  const actual = burndown.map((point, index) => `${at(index)},${level(point.remaining)}`).join(' ');
  const todayX = at(burndown.length - 1);

  return (
    <svg
      className="burndown"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${sprint.remainingUnits} ${sprint.progressBy === 'points' ? 'points' : 'tickets'} remaining`}
    >
      <polyline className="burndown__ideal" points={`0,0 ${width},${height}`} />
      <polyline className="burndown__actual" points={actual} />
      <line className="burndown__today" x1={todayX} y1="0" x2={todayX} y2={height} />
    </svg>
  );
}

function SprintBand({ sprint }: { sprint: JiraSprintProgress }) {
  const unit = sprint.progressBy === 'points' ? 'pts' : 'tickets';
  const elapsed = sprint.timeElapsedPct === null ? null : Math.round(sprint.timeElapsedPct * 100);

  return (
    <section className="sprint">
      <div className="sprint__facts">
        <div className="sprint__dates">
          <span className="sprint__window">
            {sprint.startDate ? formatShortDate(sprint.startDate) : '—'}
            <span className="sprint__arrow">→</span>
            {sprint.endDate ? formatShortDate(sprint.endDate) : '—'}
          </span>
          <span className="sprint__remaining">{sprintDayLabel(sprint)}</span>
        </div>
        <div className="sprint__stat">
          <span className="sprint__stat-value">
            {sprint.remainingUnits}
            <span className="sprint__stat-unit">{unit} left</span>
          </span>
          <span className="sprint__stat-sub">
            {sprint.doneUnits} of {sprint.totalUnits} done
            {elapsed === null ? '' : ` · ${elapsed}% of the sprint used`}
          </span>
        </div>
      </div>
      {sprint.goal ? <p className="sprint__goal">{sprint.goal}</p> : null}
      <Burndown sprint={sprint} />
    </section>
  );
}

export const jiraSignPlugin: SignPlugin = {
  id: 'jira',
  slides: {
    jira_dashboard: {
      nav: {
        label: 'Jira',
        icon: (
          <svg {...NAV_ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
          </svg>
        ),
      },
      render: ({ slide, clockOffsetMs, onDrill, preview }) => (
        <JiraSlide
          slideId={slide.id}
          title={slide.title}
          clockOffsetMs={clockOffsetMs}
          {...(onDrill ? { onDrill } : {})}
          // Absent on the sign, which fetches for itself. The panel's preview
          // supplies it, and passes null while the fetch is in flight.
          {...(preview ? { data: preview.data as JiraDashboardData | null } : {})}
        />
      ),
      loadPreview: (slide, signal) => jiraApi.dashboardPreview(slide.config, slide.title, signal),
      // Called for the slides coming up, so a board is on screen with real
      // numbers rather than a loading placeholder someone has time to read.
      prefetch: (slide) => void warm(slide.id),
    },
  },
  drill: jiraDrillViews,
};
