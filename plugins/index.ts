/**
 * The plugin registry — the shared half.
 *
 * A plugin is a folder under `plugins/` that adds slide types, and usually a
 * tab in the control panel and some routes to back it. Each one is split by
 * where its code runs, because the three bundles are built separately and a
 * BrightSign player must never download panel tooling:
 *
 *   plugins/<id>/shared.ts    wire types, imported by every side
 *   plugins/<id>/server/      Fastify routes, database access, upstream calls
 *   plugins/<id>/web/         slide renderer, editor, panel tab, stylesheets
 *
 * The rule the two tsconfigs enforce is exactly that: `server/` is invisible to
 * the browser projects and `web/` is invisible to the server project. Nothing
 * stops a `shared.ts` from being imported by both, which is the point of it.
 *
 * This file is the one place that lists what is installed. There is no dynamic
 * discovery: esbuild and Vite both need to see the imports to bundle them, and
 * a registry you can read top to bottom is worth more than one you cannot.
 *
 * Registering a plugin means adding it here and to the three side registries:
 * `plugins/server/index.ts`, `plugins/web/sign.tsx`, `plugins/web/admin.tsx`.
 */

import {
  DATES_SLIDE_TYPES,
  type CountdownSlideConfig,
  type ImportantDate,
} from './dates/shared';
import { TABLE_SLIDE_TYPES, type DataTable, type DataTableSlideConfig } from './data-table/shared';
import { JIRA_SLIDE_TYPES, type JiraDashboardSlideConfig } from './jira/shared';
import {
  TEMPLATE_SLIDE_TYPES,
  type TemplateArt,
  type TemplateSlideConfig,
} from './template/shared';

/** What every slide type declares, plugin-supplied or core. */
export interface SlideTypeSpec {
  /** Shown on the "add a slide" button and in the slide list. */
  label: string;
  /** What a freshly created slide of this type starts on. */
  defaultDurationSeconds: number;
  /**
   * This type draws its own chrome, so light or dark is a real choice for it.
   *
   * False for anything that fills the panel with artwork of its own — a photo,
   * a video, a template — where the theme would change nothing but the edges
   * of a letterboxed frame, and the control would be a question with no
   * answer.
   */
  usesTheme?: boolean;
}

/**
 * Slide type id → its config shape. Adding a slide type to a plugin means
 * adding a line here; that is what makes `Slide<'countdown'>` know its own
 * config across all three bundles.
 */
export interface PluginSlideConfigMap {
  countdown: CountdownSlideConfig;
  jira_dashboard: JiraDashboardSlideConfig;
  data_table: DataTableSlideConfig;
  template: TemplateSlideConfig;
}

export type PluginSlideType = keyof PluginSlideConfigMap;

/**
 * Ordered by the spread, and the order is visible: it decides the sequence of
 * the panel's "add a slide" buttons.
 */
export const PLUGIN_SLIDE_SPECS = {
  ...DATES_SLIDE_TYPES,
  ...JIRA_SLIDE_TYPES,
  ...TABLE_SLIDE_TYPES,
  ...TEMPLATE_SLIDE_TYPES,
} satisfies Record<PluginSlideType, SlideTypeSpec>;

export const PLUGIN_SLIDE_TYPES = Object.keys(PLUGIN_SLIDE_SPECS) as PluginSlideType[];

/**
 * What plugins add to the playlist document the sign polls for.
 *
 * A plugin whose slides need rows from the database contributes them here, so
 * the sign has everything it draws in one request — see the `signData` hook in
 * `plugins/server/types.ts`. Jira is absent on purpose: its payload is fetched
 * per slide on its own cadence, so one unreachable Jira cannot hold up the
 * rest of the loop.
 */
export interface PluginSignData {
  dates: ImportantDate[];
  tables: DataTable[];
  templates: TemplateArt[];
}

export const EMPTY_PLUGIN_SIGN_DATA: PluginSignData = { dates: [], tables: [], templates: [] };
