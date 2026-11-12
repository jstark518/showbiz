import { z } from 'zod';
import { DEFAULT_BLACKOUT, DEFAULT_SIGN_SETTINGS, type SignSettings } from '../../shared/types';
import { json, sql } from './db';

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Every field catches, the same way a slide config does: a row written by an
 * older build, or edited by hand, has to degrade to something a screen can act
 * on rather than throwing. Here the stake is higher than a placeholder slide —
 * an unparseable schedule that threw would take the whole playlist response
 * down with it.
 */
const blackoutDaySchema = z.object({
  on: z.boolean().catch(true),
  from: z.string().regex(TIME).catch('07:00'),
  until: z.string().regex(TIME).catch('19:00'),
});

const blackoutSchema = z
  .object({
    enabled: z.boolean().catch(false),
    // Not validated as a real IANA name here. The panel picks from the zones
    // the browser knows, so nothing else should reach this, and `blackout.ts`
    // treats an unusable zone as "stay awake" rather than as a reason to fail.
    timeZone: z.string().max(64).catch(''),
    days: z.array(blackoutDaySchema).length(7).catch(DEFAULT_BLACKOUT.days),
  })
  .catch(DEFAULT_BLACKOUT);

export const signSettingsSchema = z.object({
  transition: z.enum(['fade', 'slide', 'none']).catch(DEFAULT_SIGN_SETTINGS.transition),
  transitionMs: z.number().int().min(0).max(3000).catch(DEFAULT_SIGN_SETTINGS.transitionMs),
  resumeAfterIdleSeconds: z
    .number()
    .int()
    .min(5)
    .max(600)
    .catch(DEFAULT_SIGN_SETTINGS.resumeAfterIdleSeconds),
  showClock: z.boolean().catch(DEFAULT_SIGN_SETTINGS.showClock),
  signName: z.string().max(60).catch(''),
  blackout: blackoutSchema,
});

export async function getSignSettings(): Promise<SignSettings> {
  const [row] = await sql<{ value: unknown }[]>`select value from settings where key = 'sign'`;
  const merged = { ...DEFAULT_SIGN_SETTINGS, ...(row?.value as object | undefined) };
  const result = signSettingsSchema.safeParse(merged);
  return result.success ? result.data : DEFAULT_SIGN_SETTINGS;
}

export async function saveSignSettings(input: SignSettings): Promise<SignSettings> {
  const value = signSettingsSchema.parse({ ...DEFAULT_SIGN_SETTINGS, ...input });
  await sql`
    insert into settings (key, value, updated_at)
    values ('sign', ${json(value)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  return value;
}
