/**
 * The plugin registry — the sign half.
 *
 * Imported by `web/src/sign/slides/index.tsx`, and by the panel's preview
 * entry, which renders the same components. The control-panel registry is a
 * separate module on purpose: a player must never download panel tooling, and
 * two registries is what keeps Vite able to prove that.
 */

import { dataTableSignPlugin } from '../data-table/web/sign';
import { datesSignPlugin } from '../dates/web/sign';
import { jiraSignPlugin } from '../jira/web/sign';
import { templateSignPlugin } from '../template/web/sign';
import type { DrillView, SignPlugin, SignSlide } from './types';

export type {
  DrillContext,
  DrillPush,
  DrillTarget,
  DrillView,
  SignPlugin,
  SignSlide,
  SlideRenderContext,
} from './types';

const SIGN_PLUGINS: SignPlugin[] = [
  datesSignPlugin,
  jiraSignPlugin,
  dataTableSignPlugin,
  templateSignPlugin,
];

/** Slide type → how to draw it. Core types are added in sign/slides/index.tsx. */
export const PLUGIN_SLIDE_RENDERERS: Record<string, SignSlide> = Object.assign(
  {},
  ...SIGN_PLUGINS.map((plugin) => plugin.slides),
) as Record<string, SignSlide>;

/** Drill-in target `kind` → the view for it. */
export const DRILL_VIEWS: Record<string, DrillView> = Object.assign(
  {},
  ...SIGN_PLUGINS.map((plugin) => plugin.drill ?? {}),
) as Record<string, DrillView>;
