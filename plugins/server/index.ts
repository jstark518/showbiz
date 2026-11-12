/**
 * The plugin registry — the server half.
 *
 * Bundled into `dist/server/index.js` by esbuild, so nothing here is loaded at
 * runtime and there is no discovery step: the list below is the install.
 */

import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { AnySlide } from '../../shared/types';
import { EMPTY_PLUGIN_SIGN_DATA, type PluginSignData, type PluginSlideType } from '../index';
import { dataTablePlugin } from '../data-table/server';
import { datesPlugin } from '../dates/server';
import { jiraPlugin } from '../jira/server';
import { templatePlugin } from '../template/server';
import type { ServerPlugin } from './types';

export type { ServerPlugin, SignDataContribution } from './types';

export const SERVER_PLUGINS: ServerPlugin[] = [
  datesPlugin,
  jiraPlugin,
  dataTablePlugin,
  templatePlugin,
];

/** Slide config schemas, merged. Core types are added in slides/config.ts. */
export const PLUGIN_SLIDE_SCHEMAS = SERVER_PLUGINS.reduce<Partial<Record<PluginSlideType, z.ZodType>>>(
  (all, plugin) => Object.assign(all, plugin.slides),
  {},
);

export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  for (const plugin of SERVER_PLUGINS) {
    if (plugin.routes) await app.register(plugin.routes);
  }
}

/**
 * Everything the installed plugins want the sign to have, in one object.
 *
 * A plugin that throws contributes nothing and is logged, rather than taking
 * the whole playlist down with it: a countdown slide with no dates draws its
 * "nothing upcoming" placeholder, and every other slide still plays. That is
 * the governing rule of this app — the sign must never go blank — applied to
 * the one place a plugin could break it for everyone.
 */
export async function collectSignData(
  slides: AnySlide[],
  log: (message: string, error: unknown) => void,
): Promise<{ data: PluginSignData; revision: unknown[] }> {
  const contributions = await Promise.all(
    SERVER_PLUGINS.map(async (plugin) => {
      if (!plugin.signData) return null;
      try {
        return await plugin.signData({ slides });
      } catch (error) {
        log(`plugin ${plugin.id} failed to supply sign data`, error);
        return null;
      }
    }),
  );

  const data: PluginSignData = { ...EMPTY_PLUGIN_SIGN_DATA };
  const revision: unknown[] = [];
  for (const contribution of contributions) {
    if (!contribution) continue;
    Object.assign(data, contribution.data);
    revision.push(contribution.revision);
  }
  return { data, revision };
}
