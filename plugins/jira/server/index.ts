import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../../server/src/db';
import { broadcast } from '../../../server/src/events';
import { HttpError, notFound, parseOrThrow } from '../../../server/src/http';
import { normalizeConfig } from '../../server/config';
import type { ServerPlugin } from '../../server/types';
import { JIRA_TRACK_MODES, type JiraDashboardSlideConfig } from '../shared';
import {
  getConnectionStatus,
  getCredentials,
  saveStoredSettings,
  testConnection,
} from './client';
import { clearMemoryCache, getDashboardData, getDrillIssues, previewConfig } from './dashboard';
import { listBoards, listEpics, listProjects, listSprints } from './metadata';

const jiraDashboardConfig = z.object({
  mode: z.enum(JIRA_TRACK_MODES).catch('project').default('project'),
  projectKey: z.string().max(50).nullable().catch(null).default(null),
  boardId: z.number().int().positive().nullable().catch(null).default(null),
  sprintId: z.number().int().positive().nullable().catch(null).default(null),
  epicKey: z.string().max(50).nullable().catch(null).default(null),
  includeDone: z.boolean().catch(true).default(true),
  jql: z.string().max(2000).catch('').default(''),
  heading: z.string().max(120).catch('').default(''),
  groupBy: z.enum(['status', 'assignee', 'epic']).catch('status').default('status'),
  showAssignees: z.boolean().catch(true).default(true),
  showProgressBar: z.boolean().catch(true).default(true),
  dueSoonDays: z.number().int().min(0).max(90).catch(7).default(7),
  progressBy: z.enum(['issues', 'points']).catch('issues').default('issues'),
  atRiskSlipPct: z.number().int().min(1).max(80).catch(10).default(10),
  offTrackSlipPct: z.number().int().min(2).max(90).catch(25).default(25),
  maxEpics: z.number().int().min(1).max(12).catch(6).default(6),
});

/**
 * Slides written before the query builder existed carry a JQL string and no
 * mode. Defaulting those to 'project' would silently blank a working board, so
 * infer 'jql' whenever a query is present and no mode was recorded.
 */
const jiraDashboardConfigWithLegacy = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const value = raw as Record<string, unknown>;
  if (value['mode'] === undefined && typeof value['jql'] === 'string' && value['jql'].trim()) {
    return { ...value, mode: 'jql' };
  }
  return value;
}, jiraDashboardConfig);

/**
 * Lenient on purpose: a typo in the site URL should come back as a readable
 * connection failure from the test, not a schema rejection.
 */
const jiraTestSchema = z.object({
  baseUrl: z.string().max(300).optional(),
  email: z.string().max(200).optional(),
  apiToken: z.string().max(500).optional(),
});

const jiraSettingsSchema = z.object({
  baseUrl: z.url().max(300).optional(),
  email: z.email().max(200).optional(),
  // Omitted entirely means "keep the stored token". An empty string clears it.
  apiToken: z.string().max(500).optional(),
});

/** Turns a Jira failure into a 502, since the fault is upstream, not ours. */
async function upstream<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, error instanceof Error ? error.message : 'Jira request failed');
  }
}

async function requireCredentials() {
  const credentials = await getCredentials();
  if (!credentials) {
    throw new HttpError(400, 'Jira is not configured. Add credentials on the Settings tab.');
  }
  return credentials;
}

interface JiraSlideRow {
  title: string;
  config: unknown;
}

/**
 * Loads a jira_dashboard slide and normalizes its config with this plugin's
 * own schema, rather than going through the slide mapper. That keeps the
 * import graph one-way — the registry imports plugins, never the reverse.
 */
async function loadSlide(id: string): Promise<{ config: JiraDashboardSlideConfig; title: string }> {
  const [row] = await sql<JiraSlideRow[]>`
    select title, config from slides where id = ${id} and type = 'jira_dashboard'
  `;
  if (!row) throw notFound('Jira slide');
  return {
    config: normalizeConfig<JiraDashboardSlideConfig>(jiraDashboardConfigWithLegacy, row.config),
    title: row.title,
  };
}

async function routes(app: FastifyInstance): Promise<void> {
  // --- credentials ---------------------------------------------------------

  app.get('/api/settings/jira', async () => getConnectionStatus());

  app.put('/api/settings/jira', async (request) => {
    const body = parseOrThrow(jiraSettingsSchema, request.body);
    await saveStoredSettings(body);
    clearMemoryCache();
    broadcast({ type: 'content-changed' });
    return getConnectionStatus();
  });

  // Accepts the values currently in the form so the button can verify
  // credentials before they are saved. An empty body tests what is stored.
  app.post('/api/settings/jira/test', async (request) => {
    const body = parseOrThrow(jiraTestSchema, request.body ?? {});
    return testConnection(body);
  });

  // --- metadata for the slide editor's dropdowns ---------------------------

  app.get('/api/jira/projects', async () =>
    upstream(async () => listProjects(await requireCredentials())),
  );

  app.get('/api/jira/boards', async (request) => {
    const query = parseOrThrow(
      z.object({ projectKey: z.string().max(50).optional() }),
      request.query,
    );
    return upstream(async () => listBoards(await requireCredentials(), query.projectKey));
  });

  app.get('/api/jira/sprints', async (request) => {
    const query = parseOrThrow(z.object({ boardId: z.coerce.number().int().positive() }), request.query);
    return upstream(async () => listSprints(await requireCredentials(), query.boardId));
  });

  app.get('/api/jira/epics', async (request) => {
    const query = parseOrThrow(z.object({ projectKey: z.string().max(50) }), request.query);
    return upstream(async () => listEpics(await requireCredentials(), query.projectKey));
  });

  /**
   * Resolves a slide config to the query it will actually run and counts the
   * matches, so the editor can show what the pickers produced before saving.
   */
  app.post('/api/jira/preview', async (request) => {
    const body = parseOrThrow(z.object({ config: z.unknown() }), request.body);
    return previewConfig(
      normalizeConfig<JiraDashboardSlideConfig>(jiraDashboardConfigWithLegacy, body.config),
    );
  });

  /**
   * The same payload the sign gets, for a config that has not been saved yet.
   *
   * The panel's preview renders the real slide component against this, so what
   * the editor shows and what goes on the wall cannot drift. It reads the same
   * cache as `/api/sign/slides/:id/jira`, so previewing a board the sign is
   * already showing costs no Jira call at all.
   */
  app.post('/api/jira/dashboard', async (request) => {
    const body = parseOrThrow(
      z.object({ config: z.unknown(), title: z.string().max(160).optional() }),
      request.body,
    );
    return upstream(async () =>
      getDashboardData(
        normalizeConfig<JiraDashboardSlideConfig>(jiraDashboardConfigWithLegacy, body.config),
        body.title?.trim() || 'Project status',
      ),
    );
  });

  /** Forces the next sign refresh to refetch instead of using the cache. */
  app.post('/api/jira/refresh', async () => {
    clearMemoryCache();
    broadcast({ type: 'content-changed' });
    return { ok: true };
  });

  // --- what the sign asks for ----------------------------------------------

  /**
   * Live data for one Jira slide. Kept off the playlist document so the sign
   * can refresh a board on its own cadence without refetching everything, and
   * so one unreachable Jira never delays the rest of the loop.
   */
  app.get('/api/sign/slides/:id/jira', async (request) => {
    const { id } = request.params as { id: string };
    const slide = await loadSlide(id);
    return getDashboardData(slide.config, slide.title);
  });

  /**
   * The full issue list behind a Jira slide. Served separately from the board
   * so the loop stays light, and only fetched when someone drills in on the
   * touchscreen. It reads the same cache entry, so it costs no extra Jira call.
   */
  app.get('/api/sign/slides/:id/jira/issues', async (request) => {
    const { id } = request.params as { id: string };
    const slide = await loadSlide(id);
    return getDrillIssues(slide.config, slide.title);
  });
}

/**
 * No `signData`: a Jira board is fetched per slide on the sign's own cadence,
 * so an unreachable Jira degrades to a "Cached" badge on one slide instead of
 * holding up the playlist every other slide travels in.
 */
export const jiraPlugin: ServerPlugin = {
  id: 'jira',
  slides: { jira_dashboard: jiraDashboardConfigWithLegacy },
  routes,
};
