/**
 * Important dates — the wire types this plugin owns.
 *
 * Nothing here imports the core wire contract, and that is deliberate: the
 * dependency runs one way, `shared/types.ts` → `plugins/index.ts` → here, so a
 * plugin can be read (or deleted) without unpicking the middle of the app.
 */

export interface ImportantDate {
  id: string;
  label: string;
  description: string;
  /** ISO 8601. For all-day entries the time component is midnight UTC. */
  occursAt: string;
  allDay: boolean;
  accent: string;
  createdAt: string;
  updatedAt: string;
}

export interface CountdownSlideConfig {
  heading: string;
  /** Empty means "every upcoming date". Otherwise only these, in date order. */
  dateIds: string[];
  maxItems: number;
  /** Keep showing a date for this many days after it passes. */
  showPastDays: number;
}

/**
 * The slide types this plugin adds. The label is what the panel offers in its
 * "add a slide" row, and the duration is what a freshly created one starts on.
 */
export const DATES_SLIDE_TYPES = {
  countdown: { label: 'Upcoming dates', defaultDurationSeconds: 20, usesTheme: true },
} as const;
