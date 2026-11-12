import { useMemo } from 'react';
import {
  calendarDaysUntil,
  countdownTo,
  formatDayCount,
  formatEventDate,
} from '../../../web/src/lib/format';
import { useNow } from '../../../web/src/lib/useNow';
import { SlidePlaceholder } from '../../../web/src/sign/slides/SlidePlaceholder';
import { NAV_ICON_PROPS, drillView, type DrillPush, type SignPlugin } from '../../web/types';
import type { CountdownSlideConfig, ImportantDate } from '../shared';
import './sign.css';

/** This plugin's one drill-in target: a single date, opened from a card. */
interface DateDrillTarget {
  kind: 'date';
  date: ImportantDate;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Props {
  config: CountdownSlideConfig;
  dates: ImportantDate[];
  clockOffsetMs: number;
  title: string;
  onDrill?: DrillPush;
}

function CountdownSlide({ config, dates, clockOffsetMs, title, onDrill }: Props) {
  const now = useNow(1000, clockOffsetMs);
  // Which dates qualify only changes on the scale of minutes, so the list is
  // rebuilt on a minute tick rather than with every second of the clock.
  const minuteTick = Math.floor(now / 60_000);

  const visible = useMemo(() => {
    const floor = minuteTick * 60_000 - config.showPastDays * MS_PER_DAY;
    const selected = config.dateIds.length
      ? dates.filter((date) => config.dateIds.includes(date.id))
      : dates;

    return selected
      .filter((date) => Date.parse(date.occursAt) >= floor)
      .sort((a, b) => Date.parse(a.occursAt) - Date.parse(b.occursAt))
      .slice(0, config.maxItems);
  }, [dates, config.dateIds, config.maxItems, config.showPastDays, minuteTick]);

  if (visible.length === 0) {
    return (
      <SlidePlaceholder
        heading={config.heading || title || 'Upcoming'}
        detail="No upcoming dates. Add some in the control panel."
      />
    );
  }

  return (
    <div className="slide slide--countdown">
      <h1 className="countdown__heading">{config.heading || title || 'Upcoming'}</h1>
      <ul className={`countdown__list countdown__list--${visible.length > 3 ? 'compact' : 'roomy'}`}>
        {visible.map((date) => (
          <CountdownCard
            key={date.id}
            date={date}
            now={now}
            {...(onDrill ? { onOpen: () => onDrill({ kind: 'date', date } satisfies DateDrillTarget) } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

function CountdownCard({
  date,
  now,
  onOpen,
}: {
  date: ImportantDate;
  now: number;
  onOpen?: () => void;
}) {
  const remaining = countdownTo(date.occursAt, now);

  // All-day events count in whole calendar days; a timed event ticks down to
  // the minute, which is what makes a "doors open in 02:14" board useful.
  const dayCount = formatDayCount(calendarDaysUntil(date.occursAt, now));
  const showLiveClock = !date.allDay && !remaining.past && remaining.days < 2;

  return (
    <li
      className={`countdown__card ${onOpen ? 'is-tappable' : ''}`}
      style={{ borderColor: date.accent }}
      onClick={onOpen}
    >
      <div className="countdown__value" style={{ color: date.accent }}>
        {showLiveClock ? (
          <span className="countdown__clock">
            {String(remaining.hours + remaining.days * 24).padStart(2, '0')}
            <span className="countdown__sep">:</span>
            {String(remaining.minutes).padStart(2, '0')}
            <span className="countdown__sep">:</span>
            {String(remaining.seconds).padStart(2, '0')}
          </span>
        ) : (
          <>
            {dayCount.value}
            {dayCount.unit ? <span className="countdown__unit">{dayCount.unit}</span> : null}
          </>
        )}
      </div>
      <div className="countdown__body">
        <div className="countdown__label">{date.label}</div>
        <div className="countdown__when">{formatEventDate(date.occursAt, date.allDay)}</div>
        {date.description ? (
          <div className="countdown__description">{date.description}</div>
        ) : null}
      </div>
    </li>
  );
}

// --- drill-in ---------------------------------------------------------------

function DateView({ date, clockOffsetMs }: { date: ImportantDate; clockOffsetMs: number }) {
  const now = useNow(1000, clockOffsetMs);
  const remaining = countdownTo(date.occursAt, now);
  const days = formatDayCount(calendarDaysUntil(date.occursAt, now));

  return (
    <div className="dateview">
      <div className="dateview__count" style={{ color: date.accent }}>
        {date.allDay || remaining.past || remaining.days >= 2 ? (
          <>
            {days.value}
            {days.unit ? <span className="dateview__unit">{days.unit}</span> : null}
          </>
        ) : (
          `${String(remaining.hours + remaining.days * 24).padStart(2, '0')}:${String(
            remaining.minutes,
          ).padStart(2, '0')}:${String(remaining.seconds).padStart(2, '0')}`
        )}
      </div>
      <h1 className="dateview__label">{date.label}</h1>
      <p className="dateview__when">{formatEventDate(date.occursAt, date.allDay)}</p>
      {date.description ? <p className="dateview__description">{date.description}</p> : null}
    </div>
  );
}

export const datesSignPlugin: SignPlugin = {
  id: 'dates',
  slides: {
    countdown: {
      nav: {
        label: 'Dates',
        icon: (
          <svg {...NAV_ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2M9 2h6" />
          </svg>
        ),
      },
      render: ({ slide, data, clockOffsetMs, onDrill }) => (
        <CountdownSlide
          config={slide.config as CountdownSlideConfig}
          dates={data.dates}
          clockOffsetMs={clockOffsetMs}
          title={slide.title}
          {...(onDrill ? { onDrill } : {})}
        />
      ),
    },
  },
  drill: {
    date: drillView<DateDrillTarget>({
      title: (target) => target.date.label,
      render: (target, { clockOffsetMs }) => (
        <DateView date={target.date} clockOffsetMs={clockOffsetMs} />
      ),
    }),
  },
};
