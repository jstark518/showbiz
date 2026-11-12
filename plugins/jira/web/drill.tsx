import { useEffect, useState } from 'react';
import { formatShortDate } from '../../../web/src/lib/format';
import { drillView, type DrillPush, type DrillView } from '../../web/types';
import type { JiraEpicSummary, JiraGrouping, JiraIssueSummary } from '../shared';
import { jiraApi } from './client';
import { EpicDetail } from './epic-views';

/**
 * The levels this plugin pushes onto the sign's drill-in stack.
 *
 * Everything needed to render a level travels in the target itself, except
 * issue lists: a slide only carries the handful it displays, so those are
 * fetched — from the same cached scan the slide used, which costs no extra
 * Jira call.
 */
export interface JiraIssuesTarget {
  kind: 'jira-issues';
  slideId: string;
  title: string;
  /** Restricts the list to one breakdown bucket, matching how it was grouped. */
  group?: { by: JiraGrouping; label: string };
  /** Restricts the list to the children of one epic. */
  parentKey?: string;
}

export interface JiraEpicTarget {
  kind: 'jira-epic';
  slideId: string;
  epic: JiraEpicSummary;
  /**
   * The epic's children, when the slide already has them. Passing them makes
   * the drill-in render the same list the slide shows, instantly; the
   * portfolio view has no per-epic issues, so there it is omitted and the view
   * fetches them.
   */
  issues?: JiraIssueSummary[];
}

export interface JiraIssueTarget {
  kind: 'jira-issue';
  issue: JiraIssueSummary;
}

// --- issue list -------------------------------------------------------------

function matchesGroup(issue: JiraIssueSummary, target: JiraIssuesTarget) {
  if (target.parentKey && issue.parentKey !== target.parentKey) return false;
  if (!target.group) return true;
  const { by, label } = target.group;
  if (by === 'status') return issue.status === label;
  if (by === 'assignee') return (issue.assignee ?? 'Unassigned') === label;
  return (issue.epic ?? 'No epic') === label;
}

function issuesTitle(target: JiraIssuesTarget): string {
  if (target.group) return target.group.label;
  // The parent is already the previous crumb, so repeating its key here would
  // read "CRM-1 › CRM-1".
  return target.parentKey ? 'Tickets' : target.title;
}

function IssueListView({ target, onPush }: { target: JiraIssuesTarget; onPush: DrillPush }) {
  const [issues, setIssues] = useState<JiraIssueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    jiraApi
      .slideIssues(target.slideId, controller.signal)
      .then(setIssues)
      .catch((caught: Error) => {
        if (caught.name !== 'AbortError') setError(caught.message);
      });
    return () => controller.abort();
  }, [target.slideId]);

  if (error) return <p className="drill__message">Could not load tickets: {error}</p>;
  if (!issues) return <p className="drill__message">Loading tickets…</p>;

  const filtered = issues.filter((issue) => matchesGroup(issue, target));
  if (filtered.length === 0) return <p className="drill__message">Nothing here.</p>;

  return (
    <>
      <h1 className="drill__heading">
        {issuesTitle(target)} <span className="drill__count">{filtered.length}</span>
      </h1>
      <ul className="drilllist">
        {filtered.map((issue) => (
          <li key={issue.key} className={`drilllist__item drilllist__item--${issue.tone}`}>
            <button
              type="button"
              className="drilllist__button"
              onClick={() => onPush({ kind: 'jira-issue', issue } satisfies JiraIssueTarget)}
            >
              <span className={`jira__dot jira__dot--${issue.statusCategory}`} />
              <span className="drilllist__key">{issue.key}</span>
              <span className="drilllist__summary">{issue.summary}</span>
              {issue.dueDate ? (
                <span className="drilllist__meta">{formatShortDate(issue.dueDate)}</span>
              ) : null}
              <span className="drilllist__meta">{issue.assignee ?? 'Unassigned'}</span>
              <span className="drilllist__chevron">›</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- one issue --------------------------------------------------------------

function IssueView({ issue }: { issue: JiraIssueSummary }) {
  return (
    <div className="issueview">
      <div className="issueview__head">
        <span className="issueview__key">{issue.key}</span>
        <span className={`issueview__status issueview__status--${issue.statusCategory}`}>
          {issue.status}
        </span>
      </div>
      <h1 className="issueview__summary">{issue.summary}</h1>
      <dl className="issueview__facts">
        <Fact label="Assignee" value={issue.assignee ?? 'Unassigned'} />
        <Fact label="Type" value={issue.issueType ?? '—'} />
        <Fact label="Priority" value={issue.priority ?? '—'} />
        <Fact label="Due" value={issue.dueDate ? formatShortDate(issue.dueDate) : '—'} />
        <Fact label="Epic" value={issue.epic ?? '—'} />
        {issue.storyPoints !== null ? (
          <Fact label="Points" value={String(issue.storyPoints)} />
        ) : null}
      </dl>
      <p className="issueview__link">{issue.url}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// --- one epic ---------------------------------------------------------------

function EpicView({ target, onPush }: { target: JiraEpicTarget; onPush: DrillPush }) {
  const { slideId, epic, issues } = target;
  // The epic slide hands its children over, so this renders with no spinner and
  // looks like the slide it was opened from. The portfolio view has no issues
  // loaded per epic, so there they are fetched.
  const [fetched, setFetched] = useState<JiraIssueSummary[] | null>(null);
  const needsFetch = issues === undefined;

  useEffect(() => {
    if (!needsFetch) return;
    const controller = new AbortController();
    jiraApi
      .slideIssues(slideId, controller.signal)
      .then((all) => setFetched(all.filter((issue) => issue.parentKey === epic.key)))
      .catch(() => setFetched([]));
    return () => controller.abort();
  }, [needsFetch, slideId, epic.key]);

  // Not capped: the overlay body scrolls, so a cap would only hide work behind
  // another tap.
  const children = issues ?? fetched;
  const shown = children ?? [];

  return (
    <div className="epicview">
      <EpicDetail epic={epic} />

      {children === null ? <p className="drill__message">Loading tickets…</p> : null}

      {shown.length > 0 ? (
        <ul className="jira__issue-list jira__issue-list--flush">
          {shown.map((issue) => (
            <li key={issue.key} className={`jira__issue jira__issue--${issue.tone}`}>
              <button
                type="button"
                className="jira__issue-button"
                onClick={() => onPush({ kind: 'jira-issue', issue } satisfies JiraIssueTarget)}
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

export const jiraDrillViews: Record<string, DrillView> = {
  'jira-issues': drillView<JiraIssuesTarget>({
    title: issuesTitle,
    render: (target, { onPush }) => <IssueListView target={target} onPush={onPush} />,
  }),
  'jira-epic': drillView<JiraEpicTarget>({
    title: (target) => target.epic.key,
    render: (target, { onPush }) => <EpicView target={target} onPush={onPush} />,
  }),
  'jira-issue': drillView<JiraIssueTarget>({
    title: (target) => target.issue.key,
    render: (target) => <IssueView issue={target.issue} />,
  }),
};
