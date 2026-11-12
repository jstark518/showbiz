import type { BlackoutSchedule, SignSleepState } from './types';

/**
 * Working out whether a screen should be dark right now.
 *
 * Lives in `shared/` because three places need the same answer: the server,
 * which puts the verdict in the playlist payload; the panel, which shows what
 * the schedule is doing at this moment; and — through the payload — the sign.
 * Two implementations of a weekly timetable would disagree about a Sunday
 * night at some point, and the symptom would be a wall panel that is dark when
 * the panel insists it is awake.
 *
 * **Every failure here resolves to awake.** An unusable timezone, a time that
 * does not parse, a schedule with the wrong number of days: all of them leave
 * the screen on. This is the one feature in the codebase allowed to blank a
 * sign deliberately, so it is the one that most needs a bug in it to fail
 * toward the governing constraint rather than away from it. A sign that stays
 * on when it should have slept wastes some backlight. A sign that sleeps when
 * it should be on gets reported as broken and unplugged.
 */

const DAY_MINUTES = 1440;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** `HH:MM` to minutes past midnight, or null if it is not a time. */
function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The weekday and wall-clock minute in the schedule's own zone.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which reports midnight as
 * hour 24 in some engines and would put every overnight boundary a day out.
 */
function localNow(at: Date, timeZone: string): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);

    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const day = WEEKDAY_INDEX[get('weekday')];
    const hours = Number(get('hour'));
    const minutes = Number(get('minute'));
    if (day === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return { day, minutes: hours * 60 + minutes };
  } catch {
    // An invalid IANA name throws here rather than at configuration time.
    return null;
  }
}

/**
 * Every awake window near today, as minutes relative to local midnight today.
 *
 * Yesterday through a week out, so a window that wraps past midnight is caught
 * whichever side of it "now" falls, and so there is always a next boundary to
 * find even when today is a day off.
 */
function awakeRanges(schedule: BlackoutSchedule, todayIndex: number): [number, number][] {
  const ranges: [number, number][] = [];

  for (let offset = -1; offset <= 7; offset += 1) {
    const day = schedule.days[(((todayIndex + offset) % 7) + 7) % 7];
    if (!day) continue;
    const base = offset * DAY_MINUTES;

    if (!day.on) continue;

    const from = parseTime(day.from);
    const until = parseTime(day.until);
    if (from === null || until === null) {
      // Unreadable times mean an on-day stays on, all of it.
      ranges.push([base, base + DAY_MINUTES]);
    } else if (until > from) {
      ranges.push([base + from, base + until]);
    } else if (until < from) {
      // Wraps past midnight: 18:00 → 02:00 runs into the following day.
      ranges.push([base + from, base + DAY_MINUTES + until]);
    } else {
      ranges.push([base, base + DAY_MINUTES]);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);

  // Merge anything touching, so a run of on-days is one window. Without this a
  // Monday ending at 24:00 and a Tuesday starting at 00:00 are two windows with
  // a boundary between them, and the sign blinks at midnight.
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

const AWAKE: SignSleepState = { asleep: false, nextChangeAt: null };

export function evaluateBlackout(
  schedule: BlackoutSchedule | undefined,
  at: Date,
): SignSleepState {
  if (!schedule?.enabled || !Array.isArray(schedule.days) || schedule.days.length !== 7) {
    return AWAKE;
  }

  const local = localNow(at, schedule.timeZone);
  if (!local) return AWAKE;

  const ranges = awakeRanges(schedule, local.day);
  // Every day switched off. Honored rather than overridden — it is what the
  // schedule plainly says — but the panel warns about it, because a screen
  // with no scheduled wake is indistinguishable from a dead one.
  if (ranges.length === 0) return { asleep: true, nextChangeAt: null };

  const current = ranges.find(([start, end]) => local.minutes >= start && local.minutes < end);
  const boundary = current
    ? current[1]
    : (ranges.find(([start]) => start > local.minutes)?.[0] ?? null);

  return {
    asleep: !current,
    nextChangeAt:
      boundary === null
        ? null
        : new Date(
            at.getTime() +
              (boundary - local.minutes) * 60_000 -
              at.getSeconds() * 1000 -
              at.getMilliseconds(),
          ).toISOString(),
  };
}
