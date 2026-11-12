/**
 * What a plugin may contribute to the server.
 *
 * Kept apart from the registry in `./index.ts` so a plugin can import the
 * contract without importing its siblings.
 */

import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { AnySlide } from '../../shared/types';
import type { PluginSignData, PluginSlideType } from '../index';

export interface SignDataContribution {
  /** Merged into `SignPlaylist.plugins`. */
  data: Partial<PluginSignData>;
  /**
   * Folded into the playlist's revision hash. Anything stable that changes
   * when the payload does — row ids and `updated_at` is the usual shape. Get
   * this wrong in the lazy direction and an edit never reaches the wall; get
   * it wrong in the other and every poll restarts the loop from slide one.
   */
  revision: unknown;
}

export interface ServerPlugin {
  /** Also the log prefix when one of this plugin's hooks fails. */
  id: string;

  /**
   * Config schema per slide type this plugin adds.
   *
   * Every field needs both `.default()` and `.catch()`. A row written by an
   * older build, or edited by hand, has to degrade to something renderable —
   * a sign showing a stack trace to the office is the failure being designed
   * against. See `server/src/slides/config.ts`.
   */
  slides: Partial<Record<PluginSlideType, z.ZodType>>;

  /** Registered as a Fastify plugin at boot, after the core routes. */
  routes?: (app: FastifyInstance) => Promise<void>;

  /**
   * Rows to travel with the playlist the sign polls for.
   *
   * `slides` is the enabled, in-window set the sign is about to play, so a
   * plugin can send only what is referenced rather than its whole table.
   */
  signData?: (context: { slides: AnySlide[] }) => Promise<SignDataContribution>;
}
