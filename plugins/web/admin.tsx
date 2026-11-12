/**
 * The plugin registry — the control panel half.
 *
 * Never imported by the sign entry: everything reachable from here is panel
 * tooling, and the player should not download a byte of it.
 */

import type { ComponentType } from 'react';
import { dataTableAdminPlugin } from '../data-table/web/admin';
import { datesAdminPlugin } from '../dates/web/admin';
import { jiraAdminPlugin } from '../jira/web/admin';
import { templateAdminPlugin } from '../template/web/admin';
import type { AdminPlugin, AdminTab, SlideConversion, SlideEditorProps } from './types';

export type { AdminPlugin, AdminTab, SlideConversion, SlideEditorProps } from './types';

const ADMIN_PLUGINS: AdminPlugin[] = [
  datesAdminPlugin,
  jiraAdminPlugin,
  dataTableAdminPlugin,
  templateAdminPlugin,
];

/** Slide type → its editor. Core types are added in admin/editors/index.tsx. */
export const PLUGIN_SLIDE_EDITORS: Record<string, ComponentType<SlideEditorProps>> = Object.assign(
  {},
  ...ADMIN_PLUGINS.map((plugin) => plugin.slides),
) as Record<string, ComponentType<SlideEditorProps>>;

/** Tabs, in registry order. The top bar puts these between Media and Signs. */
export const PLUGIN_TABS: AdminTab[] = ADMIN_PLUGINS.flatMap((plugin) => plugin.tabs ?? []);

/** Every offer to turn one kind of slide into another, in registry order. */
export const PLUGIN_CONVERSIONS: SlideConversion[] = ADMIN_PLUGINS.flatMap(
  (plugin) => plugin.conversions ?? [],
);

/** Cards to append to the Settings tab. */
export const PLUGIN_SETTINGS_CARDS: ComponentType[] = ADMIN_PLUGINS.flatMap(
  (plugin) => plugin.settings ?? [],
);
