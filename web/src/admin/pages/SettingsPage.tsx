import { useEffect, useMemo, useState } from 'react';
import { PLUGIN_SETTINGS_CARDS } from '../../../../plugins/web/admin';
import { evaluateBlackout } from '../../../../shared/blackout';
import {
  DEFAULT_SIGN_SETTINGS,
  type BlackoutDay,
  type BlackoutSchedule,
  type SignSettings,
} from '../../../../shared/types';
import { api } from '../../lib/api';
import { formatInZone } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { Banner, Field, Spinner, Toggle } from '../components';
import { useAsync } from '../useAsync';

export function SettingsPage() {
  return (
    <div className="page">
      <header className="page__header">
        <h1>Settings</h1>
      </header>
      <div className="cards">
        <SignSettingsCard />
        {/* Anything a plugin needs configured, in registry order. */}
        {PLUGIN_SETTINGS_CARDS.map((Card, index) => (
          <Card key={index} />
        ))}
      </div>
    </div>
  );
}

function SignSettingsCard() {
  const settings = useAsync(() => api.getSignSettings(), []);
  const [draft, setDraft] = useState<SignSettings>(DEFAULT_SIGN_SETTINGS);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const saved = await api.saveSignSettings(draft);
      settings.set(saved);
      setStatus({ kind: 'success', message: 'Saved. Connected signs pick this up immediately.' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not save',
      });
    } finally {
      setSaving(false);
    }
  };

  if (settings.loading && !settings.data) return <Spinner />;

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="card__header">
        <h2>Sign display</h2>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {status ? <Banner kind={status.kind}>{status.message}</Banner> : null}

      <Field label="Sign name" hint="Shown in the corner. Handy when you run more than one panel.">
        <input
          type="text"
          maxLength={60}
          value={draft.signName}
          placeholder="Reception"
          onChange={(e) => setDraft({ ...draft, signName: e.target.value })}
        />
      </Field>

      <Field label="Transition">
        <select
          value={draft.transition}
          onChange={(e) =>
            setDraft({ ...draft, transition: e.target.value as SignSettings['transition'] })
          }
        >
          <option value="fade">Fade</option>
          <option value="slide">Slide</option>
          <option value="none">None</option>
        </select>
      </Field>

      <Field label="Transition length (ms)">
        <input
          type="number"
          min={0}
          max={3000}
          step={50}
          value={draft.transitionMs}
          onChange={(e) => setDraft({ ...draft, transitionMs: Number(e.target.value) })}
        />
      </Field>

      <Field
        label="Resume autoplay after (seconds)"
        hint="How long the sign waits after someone touches it before carrying on by itself."
      >
        <input
          type="number"
          min={5}
          max={600}
          value={draft.resumeAfterIdleSeconds}
          onChange={(e) => setDraft({ ...draft, resumeAfterIdleSeconds: Number(e.target.value) })}
        />
      </Field>

      <Toggle
        label="Show the clock"
        checked={draft.showClock}
        onChange={(showClock) => setDraft({ ...draft, showClock })}
      />

      <BlackoutFields
        value={draft.blackout}
        onChange={(blackout) => setDraft({ ...draft, blackout })}
      />
    </form>
  );
}

// --- blackout schedule -------------------------------------------------------

/** Sunday first, matching `Date#getDay` and the stored array. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Every zone the browser knows, so an invalid name cannot be typed and the
 * server never has to validate one. `supportedValuesOf` is recent; where it is
 * missing the local zone alone is still the answer almost everyone wants.
 */
function timeZoneOptions(local: string): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    if (supported?.length) return supported;
  } catch {
    // Older browser; fall through.
  }
  return [local];
}

/**
 * The weekly timetable, plus what it is doing at this moment.
 *
 * The live line reads the *draft*, not what is saved, so the answer to "what
 * would this do" arrives before anyone commits to it — which matters more here
 * than anywhere else in the panel, because getting it wrong means a wall of
 * black screens during working hours.
 */
function BlackoutFields({
  value,
  onChange,
}: {
  value: BlackoutSchedule;
  onChange: (next: BlackoutSchedule) => void;
}) {
  const now = useNow(30_000);
  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const zones = useMemo(() => timeZoneOptions(localZone), [localZone]);

  const state = evaluateBlackout(value, new Date(now));
  const everyDayOff = value.days.every((day) => !day.on);

  const setDay = (index: number, patch: Partial<BlackoutDay>) =>
    onChange({
      ...value,
      days: value.days.map((day, i) => (i === index ? { ...day, ...patch } : day)),
    });

  return (
    <>
      <h3 className="card__section">Blackout schedule</h3>

      <Toggle
        label="Turn the screen off outside set hours"
        checked={value.enabled}
        onChange={(enabled) =>
          onChange({
            ...value,
            enabled,
            // Blank means "wherever the server happens to run", which in a
            // container is UTC and would put an office schedule hours out.
            // Fill it the moment the schedule starts to matter.
            timeZone: value.timeZone || localZone,
          })
        }
        hint="Every sign follows this. Nothing on the screen itself can override it — the panel is how you bring one back early."
      />

      {value.enabled ? (
        <>
          <p className={`sched__state ${state.asleep ? 'is-asleep' : 'is-awake'}`}>
            {state.asleep ? 'Screens are dark right now' : 'Screens are on right now'}
            {state.nextChangeAt
              ? ` · ${state.asleep ? 'back at' : 'off at'} ${formatInZone(state.nextChangeAt, value.timeZone)}`
              : ''}
          </p>

          {everyDayOff ? (
            <Banner kind="error">
              Every day is switched off, so the screens will stay dark until someone taps one or
              this changes.
            </Banner>
          ) : null}

          <Field label="Timezone" hint="The times below are read in this zone.">
            <select
              value={value.timeZone || localZone}
              onChange={(e) => onChange({ ...value, timeZone: e.target.value })}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>

          <div className="sched">
            {value.days.map((day, index) => (
              <div key={DAY_NAMES[index]} className={`sched__row ${day.on ? '' : 'is-off'}`}>
                <label className="sched__day">
                  <input
                    type="checkbox"
                    checked={day.on}
                    onChange={(e) => setDay(index, { on: e.target.checked })}
                  />
                  <span>{DAY_NAMES[index]}</span>
                </label>
                {day.on ? (
                  <span className="sched__times">
                    <input
                      type="time"
                      value={day.from}
                      onChange={(e) => setDay(index, { from: e.target.value })}
                      aria-label={`${DAY_NAMES[index]} on from`}
                    />
                    <span className="sched__to">to</span>
                    <input
                      type="time"
                      value={day.until}
                      onChange={(e) => setDay(index, { until: e.target.value })}
                      aria-label={`${DAY_NAMES[index]} on until`}
                    />
                  </span>
                ) : (
                  <span className="sched__times muted">Dark all day</span>
                )}
              </div>
            ))}
          </div>

          <p className="muted sched__note">
            An end time earlier than the start runs past midnight, so 6:00 PM to 2:00 AM is one
            evening. Setting both the same leaves that day on around the clock.
          </p>

        </>
      ) : null}
    </>
  );
}
