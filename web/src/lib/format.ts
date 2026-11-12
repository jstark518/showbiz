const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface Countdown {
  /** Negative once the date has passed. */
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  past: boolean;
}

export function countdownTo(target: string | Date, now: number): Countdown {
  const targetMs = target instanceof Date ? target.getTime() : Date.parse(target);
  const totalMs = targetMs - now;
  const abs = Math.abs(totalMs);
  return {
    totalMs,
    days: Math.floor(abs / MS_PER_DAY),
    hours: Math.floor(abs / (60 * 60 * 1000)) % 24,
    minutes: Math.floor(abs / (60 * 1000)) % 60,
    seconds: Math.floor(abs / 1000) % 60,
    past: totalMs < 0,
  };
}

/**
 * Whole days between today and an all-day date, counted on calendar boundaries.
 * An event tomorrow reads "1 day" all through today rather than flipping to
 * "0 days" the moment it is less than 24 hours away.
 *
 * All-day dates are stored at midnight UTC, so the comparison is done in UTC
 * on both sides to keep a sign west of Greenwich from reading a day early.
 */
export function calendarDaysUntil(target: string, now: number): number {
  const targetMs = Date.parse(target);
  const targetDay = Math.floor(targetMs / MS_PER_DAY);
  const todayDay = Math.floor(now / MS_PER_DAY);
  return targetDay - todayDay;
}

export function formatDayCount(days: number): { value: string; unit: string } {
  if (days === 0) return { value: 'Today', unit: '' };
  if (days === 1) return { value: '1', unit: 'day' };
  if (days === -1) return { value: 'Yesterday', unit: '' };
  if (days < 0) return { value: `${Math.abs(days)}`, unit: 'days ago' };
  return { value: `${days}`, unit: 'days' };
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatEventDate(iso: string, allDay: boolean): string {
  const date = new Date(iso);
  return allDay ? dateFormatter.format(date) : dateTimeFormatter.format(date);
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
});

export function formatShortDate(iso: string): string {
  return shortDateFormatter.format(new Date(iso));
}

export function formatClock(now: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function formatRelativeTime(iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return formatter.format(Math.round(seconds), 'second');
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  return formatter.format(Math.round(seconds / 86400), 'day');
}

/**
 * Converts a datetime-local input value to an ISO instant, and back. All-day
 * entries are pinned to midnight UTC so every sign agrees on which day it is.
 */
export function localInputToIso(value: string, allDay: boolean): string {
  if (allDay) {
    const [datePart] = value.split('T');
    return `${datePart}T00:00:00.000Z`;
  }
  return new Date(value).toISOString();
}

export function isoToLocalInput(iso: string, allDay: boolean): string {
  const date = new Date(iso);
  if (allDay) return date.toISOString().slice(0, 10);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * A wall-clock moment written in a named zone — "Mon, 7:00 AM".
 *
 * Used wherever a blackout boundary is shown. The zone is explicit because the
 * schedule's times are not the reader's: someone checking the panel from home
 * needs to see when the office screens come back, not when their laptop thinks
 * they do.
 */
export function formatInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    // An unusable zone should not take a whole page down over a caption.
    return new Date(iso).toLocaleString();
  }
}
