import { useEffect, useRef, useState } from 'react';
import { Banner, Field, Spinner, Toggle } from '../../../web/src/admin/components';
import { SlidePreview } from '../../../web/src/admin/editors/SlidePreview';
import { useAsync } from '../../../web/src/admin/useAsync';
import { formatShortDate } from '../../../web/src/lib/format';
import type { AdminPlugin, SlideEditorProps } from '../../web/types';
import {
  JIRA_TRACK_MODES,
  JIRA_TRACK_MODE_LABELS,
  type JiraBoardOption,
  type JiraDashboardSlideConfig,
  type JiraEpicOption,
  type JiraPreviewResult,
  type JiraProjectOption,
  type JiraSprintListing,
  type JiraTrackMode,
} from '../shared';
import { jiraApi } from './client';
import './admin.css';

type Props = SlideEditorProps;

/**
 * Whether the pickers hold enough to draw a board.
 *
 * Below this the preview would only ever be the "pick a project" placeholder,
 * and every keystroke would spend a Jira request finding that out.
 */
function isRenderable(config: JiraDashboardSlideConfig): boolean {
  switch (config.mode) {
    case 'project':
    case 'epics':
      return Boolean(config.projectKey);
    case 'sprint':
      // A sprint id is optional: "whichever is open" is a valid answer.
      return Boolean(config.boardId);
    case 'epic':
      return Boolean(config.epicKey);
    case 'jql':
      return config.jql.trim().length > 0;
    default:
      return false;
  }
}

const WAITING_FOR: Record<JiraTrackMode, string> = {
  project: 'Choose a project and the preview will show what the sign will show.',
  sprint: 'Choose a board and the preview will show what the sign will show.',
  epic: 'Choose an epic and the preview will show what the sign will show.',
  epics: 'Choose a project and the preview will show what the sign will show.',
  jql: 'Write a query and the preview will show what the sign will show.',
};

const MODE_HINTS: Record<JiraTrackMode, string> = {
  project: 'Every ticket in one project. Good for a general "how are we doing" board.',
  sprint: 'The work committed to one sprint. Only available on scrum boards.',
  epic: 'One epic in depth, with its dates, progress and whether it is slipping.',
  epics: 'Every epic in a project ranked by health, so trouble surfaces first.',
  jql: 'Write the query yourself. Everything above is easier.',
};

/** Which pickers a mode needs, so the form only shows what is relevant. */
const NEEDS = {
  project: { project: true, board: false, sprint: false, epic: false },
  sprint: { project: true, board: true, sprint: true, epic: false },
  epic: { project: true, board: false, sprint: false, epic: true },
  epics: { project: true, board: false, sprint: false, epic: false },
  jql: { project: false, board: false, sprint: false, epic: false },
} satisfies Record<JiraTrackMode, Record<string, boolean>>;

function JiraEditor({ config, onChange, slide }: Props) {
  const value = config as unknown as JiraDashboardSlideConfig;
  const needs = NEEDS[value.mode] ?? NEEDS.project;

  const [projects, setProjects] = useState<JiraProjectOption[]>([]);
  const [boards, setBoards] = useState<JiraBoardOption[]>([]);
  const [sprints, setSprints] = useState<JiraSprintListing | null>(null);
  const [epics, setEpics] = useState<JiraEpicOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<JiraPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // --- metadata loading -----------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    jiraApi
      .projects()
      .then((list) => !cancelled && setProjects(list))
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!needs.board) return;
    let cancelled = false;
    jiraApi
      .boards(value.projectKey ?? undefined)
      .then((list) => !cancelled && setBoards(list))
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, [needs.board, value.projectKey]);

  useEffect(() => {
    if (!needs.sprint || !value.boardId) {
      setSprints(null);
      return;
    }
    let cancelled = false;
    jiraApi
      .sprints(value.boardId)
      .then((listing) => !cancelled && setSprints(listing))
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, [needs.sprint, value.boardId]);

  useEffect(() => {
    if (!needs.epic || !value.projectKey) {
      setEpics([]);
      return;
    }
    let cancelled = false;
    jiraApi
      .epics(value.projectKey)
      .then((list) => !cancelled && setEpics(list))
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, [needs.epic, value.projectKey]);

  // --- live preview ---------------------------------------------------------

  // Debounced so typing in the JQL box does not fire a query per keystroke.
  const sourceKey = JSON.stringify([
    value.mode,
    value.projectKey,
    value.boardId,
    value.sprintId,
    value.epicKey,
    value.includeDone,
    value.jql,
    value.progressBy,
  ]);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setPreviewing(true);
      jiraApi
        .previewConfig(config, controller.signal)
        .then((result) => setPreview(result))
        .catch((error: Error) => {
          if (error.name !== 'AbortError') setPreview({ ok: false, message: error.message });
        })
        .finally(() => setPreviewing(false));
    }, 600);
    return () => window.clearTimeout(timer);
    // `config` is intentionally not a dependency: display-only options such as
    // the issue limit do not change what the query returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const selectedBoard = boards.find((board) => board.id === value.boardId);
  const isEpicMode = value.mode === 'epic' || value.mode === 'epics';

  return (
    <>
      {loadError ? (
        <Banner kind="error">
          Could not load Jira options: {loadError}. Check the connection on the Settings tab.
        </Banner>
      ) : null}

      <Field label="What should this slide follow?" hint={MODE_HINTS[value.mode]}>
        <select
          value={value.mode}
          onChange={(event) => {
            const mode = event.target.value as JiraTrackMode;
            // Clear selections the new mode cannot use, so a stale board id
            // cannot quietly survive a switch to epic tracking.
            const next: Record<string, unknown> = { mode };
            if (!NEEDS[mode].board) next['boardId'] = null;
            if (!NEEDS[mode].sprint) next['sprintId'] = null;
            if (!NEEDS[mode].epic) next['epicKey'] = null;
            onChange(next);
          }}
        >
          {JIRA_TRACK_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {JIRA_TRACK_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </Field>

      {needs.project ? (
        <Field
          label="Project"
          hint={projects.length === 0 && !loadError ? 'Loading projects…' : undefined}
        >
          <select
            value={value.projectKey ?? ''}
            onChange={(event) =>
              onChange({ projectKey: event.target.value || null, epicKey: null, boardId: null })
            }
          >
            <option value="">— choose a project —</option>
            {projects.map((project) => (
              <option key={project.key} value={project.key}>
                {project.key} · {project.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {needs.board ? (
        <Field label="Board">
          <select
            value={value.boardId ?? ''}
            onChange={(event) =>
              onChange({ boardId: event.target.value ? Number(event.target.value) : null, sprintId: null })
            }
          >
            <option value="">— choose a board —</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name} ({board.type})
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {needs.sprint && selectedBoard && !selectedBoard.supportsSprints ? (
        <Banner kind="info">
          <strong>{selectedBoard.name}</strong> is a {selectedBoard.type} board and has no sprints.
          Track the whole project or an epic instead.
        </Banner>
      ) : null}

      {needs.sprint && sprints?.supported ? (
        <Field
          label="Sprint"
          hint="Leaving this on the open sprint means the board follows each new sprint automatically."
        >
          <select
            value={value.sprintId ?? ''}
            onChange={(event) =>
              onChange({ sprintId: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">Whichever sprint is open</option>
            {sprints.sprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}
                {sprint.state === 'active' ? ' (active)' : sprint.state === 'closed' ? ' (closed)' : ''}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {/* Only when the board type did not already explain it above, so the
          same sentence does not appear twice. */}
      {needs.sprint && sprints && !sprints.supported && selectedBoard?.supportsSprints !== false ? (
        <Banner kind="info">{sprints.reason}</Banner>
      ) : null}

      {needs.epic ? (
        <Field
          label="Epic"
          hint={
            value.projectKey
              ? epics.length === 0
                ? 'No epics found in that project.'
                : undefined
              : 'Choose a project first.'
          }
        >
          <select
            value={value.epicKey ?? ''}
            onChange={(event) => onChange({ epicKey: event.target.value || null })}
          >
            <option value="">— choose an epic —</option>
            {epics.map((epic) => (
              <option key={epic.key} value={epic.key}>
                {epic.key} · {epic.summary}
                {epic.dueDate ? ` (due ${formatShortDate(epic.dueDate)})` : ''}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {value.mode === 'project' ? (
        <Toggle
          label="Include finished work"
          checked={value.includeDone}
          onChange={(includeDone) => onChange({ includeDone })}
          hint="Leave on for a meaningful progress bar. Turning it off shows only open tickets, which always reads 0% done."
        />
      ) : null}

      {value.mode === 'jql' ? (
        <Field label="JQL query" hint="Everything the dropdowns above produce, but by hand.">
          <textarea
            rows={3}
            spellCheck={false}
            value={value.jql}
            placeholder="project = ABC AND statusCategory != Done"
            onChange={(event) => onChange({ jql: event.target.value })}
          />
        </Field>
      ) : null}

      <PreviewStrip preview={preview} previewing={previewing} />

      {/* The sign's own renderer, in an iframe, following the unsaved draft.
          Below the count rather than above it: the count answers "did the
          pickers find anything", which is the question you have first. */}
      <SlidePreview
        slide={isRenderable(value) ? slide : null}
        waitingFor={WAITING_FOR[value.mode] ?? WAITING_FOR.project}
      />

      {/* --- display options -------------------------------------------- */}

      <Field label="Heading" hint="Shown at the top of the board. Defaults to the slide title.">
        <input
          type="text"
          maxLength={120}
          value={value.heading}
          onChange={(event) => onChange({ heading: event.target.value })}
        />
      </Field>

      {isEpicMode ? (
        <>
          <Field
            label="Measure progress by"
            hint="Story points fall back to ticket counts when too few tickets carry an estimate."
          >
            <select
              value={value.progressBy}
              onChange={(event) => onChange({ progressBy: event.target.value })}
            >
              <option value="issues">Tickets completed</option>
              <option value="points">Story points completed</option>
            </select>
          </Field>

          <Field
            label="Flag as “At risk” when behind by (percentage points)"
            hint="An epic 60% through its dates with 45% of the work done is 15 points behind."
          >
            <input
              type="number"
              min={1}
              max={80}
              value={value.atRiskSlipPct}
              onChange={(event) => onChange({ atRiskSlipPct: Number(event.target.value) })}
            />
          </Field>

          <Field label="Flag as “Off track” when behind by (percentage points)">
            <input
              type="number"
              min={2}
              max={90}
              value={value.offTrackSlipPct}
              onChange={(event) => onChange({ offTrackSlipPct: Number(event.target.value) })}
            />
          </Field>
        </>
      ) : null}

      {value.mode === 'epics' ? (
        <Field label="Epics to show" hint="The least healthy are shown first.">
          <input
            type="number"
            min={1}
            max={12}
            value={value.maxEpics}
            onChange={(event) => onChange({ maxEpics: Number(event.target.value) })}
          />
        </Field>
      ) : (
        <>
          <Field label="Group the breakdown by">
            <select
              value={value.groupBy}
              onChange={(event) => onChange({ groupBy: event.target.value })}
            >
              <option value="status">Status</option>
              <option value="assignee">Assignee</option>
              <option value="epic">Epic / parent</option>
            </select>
          </Field>
        </>
      )}

      <Field label="Highlight tickets due within (days)" hint="0 turns the due-soon strip off.">
        <input
          type="number"
          min={0}
          max={90}
          value={value.dueSoonDays}
          onChange={(event) => onChange({ dueSoonDays: Number(event.target.value) })}
        />
      </Field>

      <Toggle
        label="Show the progress bar"
        checked={value.showProgressBar}
        onChange={(showProgressBar) => onChange({ showProgressBar })}
      />
      <Toggle
        label="Show assignee names"
        checked={value.showAssignees}
        onChange={(showAssignees) => onChange({ showAssignees })}
      />
    </>
  );
}

/** Live feedback on what the pickers resolve to, so nothing is a surprise. */
function PreviewStrip({
  preview,
  previewing,
}: {
  preview: JiraPreviewResult | null;
  previewing: boolean;
}) {
  if (previewing && !preview) return <p className="muted">Checking Jira…</p>;
  if (!preview) return null;

  return (
    <div className={`jira-source ${preview.ok ? 'is-ok' : 'is-error'}`}>
      <div className="jira-source__headline">
        <span className="jira-source__dot" />
        {previewing ? 'Checking…' : preview.message}
      </div>
      {preview.jql ? (
        <details className="jira-source__query">
          <summary>Query this runs</summary>
          <code>{preview.jql}</code>
        </details>
      ) : null}
    </div>
  );
}

// --- credentials, as a card on the Settings tab ------------------------------

function JiraSettingsCard() {
  const status = useAsync(() => jiraApi.status(), []);
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!status.data) return;
    setBaseUrl(status.data.baseUrl ?? '');
    setEmail(status.data.email ?? '');
  }, [status.data]);

  const fromEnv = status.data?.source === 'env';

  // Whether the form holds values the server has not been told about yet. A
  // test can succeed against these while the sign still has nothing to use.
  const unsaved =
    !fromEnv &&
    (baseUrl.trim() !== (status.data?.baseUrl ?? '') ||
      email.trim() !== (status.data?.email ?? '') ||
      apiToken.length > 0);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await jiraApi.saveSettings({
        baseUrl: baseUrl.trim() || undefined,
        email: email.trim() || undefined,
        // Left blank means "keep the token already stored".
        ...(apiToken ? { apiToken } : {}),
      });
      setApiToken('');
      await status.reload();
      setMessage({ kind: 'success', text: 'Saved.' });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not save',
      });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Send what is on screen, so the button works before anything is saved.
      const result = await jiraApi.test({
        baseUrl: baseUrl.trim() || undefined,
        email: email.trim() || undefined,
        ...(apiToken ? { apiToken } : {}),
      });
      const detail = result.accountName ? `${result.message} as ${result.accountName}` : result.message;
      setMessage({
        kind: result.ok ? 'success' : 'error',
        text:
          result.ok && unsaved
            ? `${detail} — now press Save to start using these credentials.`
            : detail,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Test failed' });
    } finally {
      setBusy(false);
    }
  };

  if (status.loading && !status.data) return <Spinner />;

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="card__header">
        <h2>Jira Cloud</h2>
        <div className="editor__actions">
          {unsaved ? <span className="pill pill--dirty">Unsaved</span> : null}
          <span className={`pill ${status.data?.configured ? 'pill--live' : 'pill--muted'}`}>
            {status.data?.configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
      </header>

      {message ? <Banner kind={message.kind}>{message.text}</Banner> : null}

      {fromEnv ? (
        <Banner kind="info">
          Credentials are coming from the container environment, which takes precedence over
          anything saved here. Change them in <code>.env</code> and restart to update.
        </Banner>
      ) : (
        <Banner kind="info">
          This panel has no login. Anyone who can reach it can change these values, so prefer
          setting <code>JIRA_BASE_URL</code>, <code>JIRA_EMAIL</code> and{' '}
          <code>JIRA_API_TOKEN</code> in <code>.env</code>.
        </Banner>
      )}

      <Field label="Site URL">
        <input
          type="url"
          value={baseUrl}
          disabled={fromEnv}
          placeholder="https://your-org.atlassian.net"
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </Field>

      <Field label="Account email">
        <input
          type="email"
          value={email}
          disabled={fromEnv}
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field
        label="API token"
        hint={
          fromEnv
            ? 'Set from the environment.'
            : status.data?.hasToken
              ? 'A token is stored. Leave blank to keep it, or paste a new one to replace it.'
              : 'Create one at id.atlassian.com → Security → API tokens.'
        }
      >
        <input
          type="password"
          value={apiToken}
          disabled={fromEnv}
          autoComplete="off"
          placeholder={status.data?.hasToken ? '•••••••• (unchanged)' : ''}
          onChange={(e) => setApiToken(e.target.value)}
        />
      </Field>

      <div className="card__actions">
        {!fromEnv ? (
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Working…' : 'Save'}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={test} disabled={busy}>
          Test connection
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void jiraApi
              .refresh()
              .then(() =>
                setMessage({ kind: 'success', text: 'Cache cleared; boards refetch on the next refresh.' }),
              )
          }
        >
          Clear cache
        </button>
      </div>
    </form>
  );
}

/** No tab of its own: Jira is configured on Settings and used from a slide. */
export const jiraAdminPlugin: AdminPlugin = {
  id: 'jira',
  slides: { jira_dashboard: JiraEditor },
  settings: [JiraSettingsCard],
};
