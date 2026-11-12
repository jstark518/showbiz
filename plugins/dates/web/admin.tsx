import { useState } from 'react';
import { Banner, EmptyState, Field, Spinner, Toggle } from '../../../web/src/admin/components';
import { useAsync } from '../../../web/src/admin/useAsync';
import {
  calendarDaysUntil,
  formatDayCount,
  formatEventDate,
  isoToLocalInput,
  localInputToIso,
} from '../../../web/src/lib/format';
import type { AdminPlugin, SlideEditorProps } from '../../web/types';
import type { CountdownSlideConfig, ImportantDate } from '../shared';
import { datesApi } from './client';
import './admin.css';

const ACCENTS = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'];

interface Draft {
  label: string;
  description: string;
  when: string;
  allDay: boolean;
  accent: string;
}

function emptyDraft(): Draft {
  return { label: '', description: '', when: '', allDay: true, accent: ACCENTS[0]! };
}

function draftFrom(date: ImportantDate): Draft {
  return {
    label: date.label,
    description: date.description,
    when: isoToLocalInput(date.occursAt, date.allDay),
    allDay: date.allDay,
    accent: date.accent,
  };
}

function DatesPage() {
  const dates = useAsync(() => datesApi.list(), []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const now = Date.now();

  const startNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const startEdit = (date: ImportantDate) => {
    setEditingId(date.id);
    setDraft(draftFrom(date));
  };

  const save = async () => {
    if (!draft.label.trim() || !draft.when) {
      setError('A label and a date are both required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        label: draft.label.trim(),
        description: draft.description.trim(),
        occursAt: localInputToIso(draft.when, draft.allDay),
        allDay: draft.allDay,
        accent: draft.accent,
      };
      if (editingId) await datesApi.update(editingId, payload);
      else await datesApi.create(payload);
      await dates.reload();
      startNew();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (date: ImportantDate) => {
    if (!window.confirm(`Delete "${date.label}"?`)) return;
    try {
      await datesApi.remove(date.id);
      if (editingId === date.id) startNew();
      await dates.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete');
    }
  };

  return (
    <div className="page page--split">
      <header className="page__header">
        <h1>Important dates</h1>
        <p className="muted">
          Countdown slides draw from this list. A slide can show all of them or a chosen few.
        </p>
      </header>

      <section className="column column--list">

        {dates.loading && !dates.data ? <Spinner /> : null}
        {dates.data && dates.data.length === 0 ? (
          <EmptyState title="No dates yet" detail="Add one on the right to start a countdown." />
        ) : null}

        <ul className="datelist">
          {(dates.data ?? []).map((date) => {
            const days = formatDayCount(calendarDaysUntil(date.occursAt, now));
            const past = Date.parse(date.occursAt) < now;
            return (
              <li
                key={date.id}
                className={`datelist__item ${editingId === date.id ? 'is-selected' : ''} ${
                  past ? 'is-past' : ''
                }`}
              >
                <span className="datelist__swatch" style={{ background: date.accent }} />
                <button type="button" className="datelist__main" onClick={() => startEdit(date)}>
                  <span className="datelist__label">{date.label}</span>
                  <span className="datelist__meta">
                    {formatEventDate(date.occursAt, date.allDay)} ·{' '}
                    {days.unit ? `${days.value} ${days.unit}` : days.value}
                  </span>
                </button>
                <button
                  type="button"
                  className="iconbtn danger"
                  title="Delete"
                  onClick={() => void remove(date)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="column column--detail">
        <form
          className="editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <header className="editor__header">
            <h2>{editingId ? 'Edit date' : 'New date'}</h2>
            <div className="editor__actions">
              {editingId ? (
                <button type="button" className="btn btn--small" onClick={startNew}>
                  Cancel
                </button>
              ) : null}
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save' : 'Add date'}
              </button>
            </div>
          </header>

          {error ? <Banner kind="error">{error}</Banner> : null}

          <Field label="Label" hint="Kept short — this is read from across a room.">
            <input
              type="text"
              maxLength={160}
              value={draft.label}
              placeholder="Product launch"
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </Field>

          <Toggle
            label="All day"
            checked={draft.allDay}
            onChange={(allDay) =>
              setDraft({
                ...draft,
                allDay,
                // The two input types take different value formats, so trim or
                // pad the existing value rather than leaving it invalid.
                when: allDay ? draft.when.slice(0, 10) : `${draft.when.slice(0, 10)}T09:00`,
              })
            }
            hint="All-day dates count in whole days. Timed ones tick down to the minute on the last day."
          />

          <Field label={draft.allDay ? 'Date' : 'Date and time'}>
            <input
              type={draft.allDay ? 'date' : 'datetime-local'}
              value={draft.when}
              onChange={(e) => setDraft({ ...draft, when: e.target.value })}
            />
          </Field>

          <Field label="Description" hint="Optional second line.">
            <input
              type="text"
              maxLength={500}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>

          <Field label="Accent color">
            <div className="swatches">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  className={`swatch ${draft.accent === accent ? 'is-selected' : ''}`}
                  style={{ background: accent }}
                  aria-label={accent}
                  onClick={() => setDraft({ ...draft, accent })}
                />
              ))}
            </div>
          </Field>
        </form>
      </section>
    </div>
  );
}

// --- slide editor -----------------------------------------------------------

function CountdownEditor({ config, onChange }: SlideEditorProps) {
  const value = config as unknown as CountdownSlideConfig;
  // Fetched here rather than handed down: the editor is the only thing that
  // needs the full list, and the page hosting it should not have to know that.
  const dates = useAsync(() => datesApi.list(), []);
  const available = dates.data ?? [];

  const toggleDate = (id: string) => {
    const selected = new Set(value.dateIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange({ dateIds: [...selected] });
  };

  return (
    <>
      <Field label="Heading">
        <input
          type="text"
          maxLength={120}
          value={value.heading}
          onChange={(e) => onChange({ heading: e.target.value })}
        />
      </Field>

      <Field label="Show at most" hint="The soonest dates are shown first.">
        <input
          type="number"
          min={1}
          max={12}
          value={value.maxItems}
          onChange={(e) => onChange({ maxItems: Number(e.target.value) })}
        />
      </Field>

      <Field
        label="Keep showing a date for (days) after it passes"
        hint="0 removes each date the moment it arrives."
      >
        <input
          type="number"
          min={0}
          max={30}
          value={value.showPastDays}
          onChange={(e) => onChange({ showPastDays: Number(e.target.value) })}
        />
      </Field>

      <Field
        label="Which dates"
        hint={
          value.dateIds.length === 0
            ? 'Nothing ticked means every upcoming date, newest additions included automatically.'
            : `${value.dateIds.length} date(s) pinned to this slide.`
        }
      >
        <div className="checklist">
          {dates.loading && !dates.data ? <Spinner /> : null}
          {dates.data && available.length === 0 ? (
            <p className="muted">No dates yet — add some on the Important dates tab.</p>
          ) : (
            available.map((date) => (
              <label key={date.id} className="checklist__item">
                <input
                  type="checkbox"
                  checked={value.dateIds.includes(date.id)}
                  onChange={() => toggleDate(date.id)}
                />
                <span className="checklist__swatch" style={{ background: date.accent }} />
                <span className="checklist__label">{date.label}</span>
                <span className="checklist__meta">
                  {formatEventDate(date.occursAt, date.allDay)}
                </span>
              </label>
            ))
          )}
        </div>
      </Field>
    </>
  );
}

export const datesAdminPlugin: AdminPlugin = {
  id: 'dates',
  tabs: [{ id: 'dates', label: 'Important dates', page: DatesPage }],
  slides: { countdown: CountdownEditor },
};
