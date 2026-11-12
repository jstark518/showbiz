import type { JiraDashboardSlideConfig } from '../shared';
import type { JiraCredentials } from './client';
import { discoverFields } from './fields';
import { findActiveSprint, listSprints } from './metadata';

/**
 * Quotes a value for JQL. Keys and names come from Jira itself via the
 * dropdowns rather than free text, but a project named `O"Brien` should still
 * not be able to break the query it lands in.
 */
export function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface ResolvedQuery {
  jql: string;
  /** Human description of what is being tracked, for the sign's header. */
  label: string;
  /** Set when the config cannot produce a query, e.g. nothing picked yet. */
  problem: string | null;
  /**
   * The sprint this resolved to, for mode 'sprint'. Carried out because
   * "whichever sprint is open" is only known here, and the dashboard needs the
   * id to fetch the sprint's dates and goal.
   */
  sprintId?: number;
}

const UNRESOLVED = (problem: string): ResolvedQuery => ({ jql: '', label: '', problem });

/**
 * Turns the structured slide config into the JQL that will actually run.
 * Epic-portfolio mode has no single query — it is assembled in epics.ts — so
 * this reports the epic listing query for display purposes only.
 */
export async function resolveQuery(
  credentials: JiraCredentials,
  config: JiraDashboardSlideConfig,
): Promise<ResolvedQuery> {
  switch (config.mode) {
    case 'jql': {
      if (!config.jql.trim()) return UNRESOLVED('No JQL entered for this slide.');
      return { jql: config.jql.trim(), label: 'Custom query', problem: null };
    }

    case 'project': {
      if (!config.projectKey) return UNRESOLVED('No project selected for this slide.');
      const scope = config.includeDone ? '' : ' AND statusCategory != Done';
      return {
        jql: `project = ${quote(config.projectKey)}${scope} ORDER BY updated DESC`,
        label: config.includeDone ? config.projectKey : `${config.projectKey} · open work`,
        problem: null,
      };
    }

    case 'sprint': {
      if (!config.boardId) return UNRESOLVED('No board selected for this slide.');

      let sprintId = config.sprintId;
      let sprintName = '';
      if (sprintId === null) {
        // "Whichever sprint is open" has to be resolved at render time, not at
        // save time, or the board freezes on last month's sprint.
        const active = await findActiveSprint(credentials, config.boardId);
        if (!active) {
          const listing = await listSprints(credentials, config.boardId);
          return UNRESOLVED(
            listing.supported
              ? 'No sprint is currently active on that board.'
              : (listing.reason ?? 'That board does not use sprints.'),
          );
        }
        sprintId = active.id;
        sprintName = active.name;
      } else {
        const listing = await listSprints(credentials, config.boardId);
        sprintName = listing.sprints.find((sprint) => sprint.id === sprintId)?.name ?? `#${sprintId}`;
      }

      const prefix = config.projectKey ? `${config.projectKey} · ` : '';
      return {
        jql: `sprint = ${sprintId} ORDER BY status ASC, updated DESC`,
        label: `${prefix}${sprintName}`,
        problem: null,
        sprintId,
      };
    }

    case 'epic': {
      if (!config.epicKey) return UNRESOLVED('No epic selected for this slide.');
      return {
        jql: await epicChildrenJql(credentials, config.epicKey),
        label: config.epicKey,
        problem: null,
      };
    }

    case 'epics': {
      if (!config.projectKey) return UNRESOLVED('No project selected for this slide.');
      return {
        jql: `project = ${quote(config.projectKey)} AND issuetype = Epic ORDER BY duedate ASC`,
        label: `${config.projectKey} · epics`,
        problem: null,
      };
    }

    default:
      return UNRESOLVED('This slide has no source configured.');
  }
}

/**
 * Children of an epic. Team-managed projects use `parent`; older
 * company-managed ones still use the "Epic Link" custom field, and naming a
 * field that does not exist makes Jira reject the whole query — so the second
 * clause is only added when discovery found it.
 */
export async function epicChildrenJql(
  credentials: JiraCredentials,
  epicKey: string,
): Promise<string> {
  const fields = await discoverFields(credentials);
  const clause = fields.epicLink
    ? `(parent = ${quote(epicKey)} OR "Epic Link" = ${quote(epicKey)})`
    : `parent = ${quote(epicKey)}`;
  return `${clause} ORDER BY status ASC, updated DESC`;
}

/** Children of several epics at once, so a portfolio view costs one query. */
export async function epicsChildrenJql(
  credentials: JiraCredentials,
  epicKeys: string[],
): Promise<string> {
  const fields = await discoverFields(credentials);
  const list = epicKeys.map(quote).join(', ');
  const clause = fields.epicLink
    ? `(parent in (${list}) OR "Epic Link" in (${list}))`
    : `parent in (${list})`;
  return `${clause} ORDER BY updated DESC`;
}
