import {
  JIRA_EPIC_HEALTH_LABELS,
  type JiraEpicSummary,
} from '../shared';
import { formatShortDate } from '../../../web/src/lib/format';

export function EpicHealthBadge({ epic, size = 'normal' }: { epic: JiraEpicSummary; size?: 'normal' | 'large' }) {
  return (
    <span className={`health health--${epic.health} health--${size}`}>
      {JIRA_EPIC_HEALTH_LABELS[epic.health]}
    </span>
  );
}

/**
 * Progress against schedule. The fill is work completed; the notch is how much
 * of the epic's time window has been consumed. Fill behind the notch is the
 * whole "at risk" story in one glance, without reading a single number.
 */
export function EpicProgressBar({ epic }: { epic: JiraEpicSummary }) {
  const donePct = Math.round(epic.progressPct * 100);
  const elapsedPct = epic.timeElapsedPct === null ? null : Math.round(epic.timeElapsedPct * 100);

  return (
    <div className="epicbar">
      <div className="epicbar__track">
        <div className={`epicbar__fill epicbar__fill--${epic.health}`} style={{ width: `${donePct}%` }} />
        {elapsedPct !== null ? (
          <div
            className="epicbar__marker"
            style={{ left: `${elapsedPct}%` }}
            title={`${elapsedPct}% of the time used`}
          />
        ) : null}
      </div>
      <span className="epicbar__label">{donePct}%</span>
    </div>
  );
}

function unitLabel(epic: JiraEpicSummary): string {
  return epic.progressBy === 'points'
    ? `${epic.doneUnits}/${epic.totalUnits} pts`
    : `${epic.doneUnits}/${epic.totalUnits} tickets`;
}

function remainingLabel(epic: JiraEpicSummary): string {
  if (epic.daysRemaining === null) return 'No due date';
  if (epic.daysRemaining < 0) return `${Math.abs(epic.daysRemaining)}d overdue`;
  if (epic.daysRemaining === 0) return 'Due today';
  return `${epic.daysRemaining}d left`;
}

/**
 * The row's supporting numbers as one string rather than three spans.
 *
 * Separate elements with a gap between them read as three columns of equal
 * importance, which is what made the row busy — the eye had four things to
 * rank on one line. Joined, they are one piece of quiet metadata sitting
 * under the badge that actually matters.
 *
 * A missing due date drops out rather than rendering as a dash, so an epic
 * with no target says "0/0 tickets · No due date" instead of trailing an em
 * dash that stands for nothing.
 */
function factsLabel(epic: JiraEpicSummary): string {
  const parts = [unitLabel(epic)];
  if (epic.dueDate) parts.push(formatShortDate(epic.dueDate));
  parts.push(remainingLabel(epic));
  return parts.join(' · ');
}

/** One row in the portfolio view. */
export function EpicRow({ epic, onOpen }: { epic: JiraEpicSummary; onOpen?: () => void }) {
  return (
    <li className={`epicrow epicrow--${epic.health} ${onOpen ? 'is-tappable' : ''}`}>
      <button type="button" className="epicrow__button" onClick={onOpen} disabled={!onOpen}>
        <span className="epicrow__head">
          <span className="epicrow__key">{epic.key}</span>
          <span className="epicrow__summary">{epic.summary}</span>
          <EpicHealthBadge epic={epic} />
        </span>
        <span className="epicrow__meta">
          <EpicProgressBar epic={epic} />
          <span className="epicrow__facts">{factsLabel(epic)}</span>
        </span>
      </button>
    </li>
  );
}

/** The detailed single-epic panel, used both as a slide and as a drill-in view. */
export function EpicDetail({ epic, compact = false }: { epic: JiraEpicSummary; compact?: boolean }) {
  const slip = epic.forecastSlipDays;

  return (
    <div className={`epicdetail ${compact ? 'epicdetail--compact' : ''}`}>
      <div className="epicdetail__top">
        <div className="epicdetail__identity">
          <span className="epicdetail__key">{epic.key}</span>
          <h1 className="epicdetail__summary">{epic.summary}</h1>
        </div>
        <EpicHealthBadge epic={epic} size="large" />
      </div>

      <EpicProgressBar epic={epic} />

      <div className="epicdetail__stats">
        <Stat label="Progress" value={`${Math.round(epic.progressPct * 100)}%`} sub={unitLabel(epic)} />
        <Stat
          label="Schedule used"
          value={epic.timeElapsedPct === null ? '—' : `${Math.round(epic.timeElapsedPct * 100)}%`}
          sub={remainingLabel(epic)}
        />
        <Stat
          label="Due"
          value={epic.dueDate ? formatShortDate(epic.dueDate) : '—'}
          sub={epic.startDate ? `from ${formatShortDate(epic.startDate)}` : ''}
        />
        {epic.forecastDate ? (
          <Stat
            label="Forecast"
            value={formatShortDate(epic.forecastDate)}
            sub={
              slip === null
                ? ''
                : slip > 0
                  ? `${slip}d late at this pace`
                  : `${Math.abs(slip)}d early at this pace`
            }
            tone={slip !== null && slip > 0 ? 'bad' : 'good'}
          />
        ) : null}
      </div>

      <p className={`epicdetail__reason epicdetail__reason--${epic.health}`}>
        {epic.healthReason}
      </p>

      {epic.startDateInferred ? (
        <p className="epicdetail__caveat">
          No start date is set on this epic, so elapsed time is measured from when it was created.
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value ${tone ? `stat__value--${tone}` : ''}`}>{value}</span>
      {sub ? <span className="stat__sub">{sub}</span> : null}
    </div>
  );
}
