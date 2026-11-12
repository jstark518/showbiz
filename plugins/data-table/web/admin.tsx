import { useEffect, useMemo, useState } from 'react';
import { Banner, EmptyState, Field, Spinner, Toggle } from '../../../web/src/admin/components';
import { SlidePreview } from '../../../web/src/admin/editors/SlidePreview';
import { useAsync } from '../../../web/src/admin/useAsync';
import type { AdminPlugin, SlideEditorProps } from '../../web/types';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  type DataTable,
  type DataTableAlign,
  type DataTableColumn,
  type DataTableRow,
  type DataTableSlideConfig,
} from '../shared';
import { tablesApi } from './client';
import './admin.css';

/**
 * A fresh id for a column or a row.
 *
 * Numbered from whatever is already there rather than randomly: these end up
 * as jsonb keys someone may well read in psql, and `c3` is friendlier than a
 * uuid. Ids are never reused, so a deleted column cannot inherit the cells of
 * one that shared its number.
 */
function nextId(prefix: string, existing: { id: string }[]): string {
  const highest = existing.reduce((max, item) => {
    const parsed = Number.parseInt(item.id.replace(prefix, ''), 10);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

interface Draft {
  name: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
}

function draftFrom(table: DataTable): Draft {
  return { name: table.name, columns: table.columns, rows: table.rows };
}

function TablesPage() {
  const tables = useAsync(() => tablesApi.list(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = tables.data?.find((table) => table.id === selectedId) ?? null;

  // Keep the selection valid when the list changes underneath it.
  useEffect(() => {
    if (!tables.data) return;
    if (selectedId && !tables.data.some((table) => table.id === selectedId)) setSelectedId(null);
  }, [tables.data, selectedId]);

  const create = async () => {
    const name = window.prompt('Name for the new table');
    if (!name?.trim()) return;
    try {
      const created = await tablesApi.create(name.trim());
      await tables.reload();
      setSelectedId(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the table');
    }
  };

  const remove = async (table: DataTable) => {
    if (!window.confirm(`Delete "${table.name}"? Slides using it will say so on the sign.`)) return;
    try {
      await tablesApi.remove(table.id);
      await tables.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the table');
    }
  };

  return (
    <div className="page page--split">
      <header className="page__header">
        <h1>Tables</h1>
        <p className="muted">
          Small grids kept by hand — a rota, a leaderboard, who is on call. A table slide puts
          one on the sign.
        </p>
      </header>

      <section className="column column--list">

        <div className="addbar">
          <button type="button" className="btn btn--small" onClick={() => void create()}>
            + New table
          </button>
        </div>

        {error ? <Banner kind="error">{error}</Banner> : null}
        {tables.loading && !tables.data ? <Spinner /> : null}
        {tables.data && tables.data.length === 0 ? (
          <EmptyState title="No tables yet" detail="Make one above and start typing into it." />
        ) : null}

        <ul className="tablelist">
          {(tables.data ?? []).map((table) => (
            <li
              key={table.id}
              className={`tablelist__item ${selectedId === table.id ? 'is-selected' : ''}`}
            >
              <button
                type="button"
                className="tablelist__main"
                onClick={() => setSelectedId(table.id)}
              >
                <span className="tablelist__name">{table.name}</span>
                <span className="tablelist__meta">
                  {table.columns.length} column{table.columns.length === 1 ? '' : 's'} ·{' '}
                  {table.rows.length} row{table.rows.length === 1 ? '' : 's'}
                </span>
              </button>
              <button
                type="button"
                className="iconbtn danger"
                title="Delete"
                onClick={() => void remove(table)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="column column--detail">
        {selected ? (
          <TableEditor key={selected.id} table={selected} onSaved={() => void tables.reload()} />
        ) : (
          <EmptyState title="Nothing selected" detail="Pick a table on the left to edit it." />
        )}
      </section>
    </div>
  );
}

// --- the grid ---------------------------------------------------------------

function TableEditor({ table, onSaved }: { table: DataTable; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(table));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(table));

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await tablesApi.save(table.id, draft);
      setStatus({ kind: 'success', message: 'Saved. The sign updates within a second.' });
      onSaved();
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not save',
      });
    } finally {
      setSaving(false);
    }
  };

  const setColumn = (id: string, patch: Partial<DataTableColumn>) =>
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.id === id ? { ...column, ...patch } : column)),
    }));

  const setCell = (rowId: string, columnId: string, text: string) =>
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: text } } : row,
      ),
    }));

  const addColumn = () =>
    setDraft((current) => ({
      ...current,
      columns: [
        ...current.columns,
        { id: nextId('c', current.columns), label: '', align: 'left' as DataTableAlign },
      ],
    }));

  const addRow = () =>
    setDraft((current) => ({
      ...current,
      rows: [...current.rows, { id: nextId('r', current.rows), cells: {} }],
    }));

  const removeColumn = (id: string) =>
    setDraft((current) => ({
      ...current,
      columns: current.columns.filter((column) => column.id !== id),
      // Cells are left alone: the column can be added back, and until this is
      // saved nothing has been lost anyway.
    }));

  const removeRow = (id: string) =>
    setDraft((current) => ({ ...current, rows: current.rows.filter((row) => row.id !== id) }));

  const moveRow = (index: number, direction: -1 | 1) =>
    setDraft((current) => {
      const to = index + direction;
      if (to < 0 || to >= current.rows.length) return current;
      const rows = [...current.rows];
      const [moved] = rows.splice(index, 1);
      rows.splice(to, 0, moved!);
      return { ...current, rows };
    });

  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="editor__header">
        <h2>Table</h2>
        <div className="editor__actions">
          {dirty ? <span className="pill pill--dirty">Unsaved</span> : null}
          <button type="submit" className="btn btn--primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {status ? <Banner kind={status.kind}>{status.message}</Banner> : null}

      <Field label="Name" hint="Used as the slide heading unless the slide sets its own.">
        <input
          type="text"
          maxLength={120}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </Field>

      <div className="grid">
        <table className="grid__table">
          <thead>
            <tr>
              <th className="grid__gutter" />
              {draft.columns.map((column) => (
                <th key={column.id}>
                  <div className="grid__head">
                    <input
                      type="text"
                      className="grid__label"
                      placeholder="Heading"
                      maxLength={60}
                      value={column.label}
                      onChange={(event) => setColumn(column.id, { label: event.target.value })}
                    />
                    <div className="grid__headtools">
                      <select
                        value={column.align}
                        title="Alignment on the sign"
                        onChange={(event) =>
                          setColumn(column.id, { align: event.target.value as DataTableAlign })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                      <button
                        type="button"
                        className="iconbtn danger"
                        title="Delete this column"
                        onClick={() => removeColumn(column.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, index) => (
              <tr key={row.id}>
                <td className="grid__gutter">
                  <div className="grid__rowtools">
                    <button
                      type="button"
                      className="iconbtn"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => moveRow(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      title="Move down"
                      disabled={index === draft.rows.length - 1}
                      onClick={() => moveRow(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="iconbtn danger"
                      title="Delete this row"
                      onClick={() => removeRow(row.id)}
                    >
                      ✕
                    </button>
                  </div>
                </td>
                {draft.columns.map((column) => (
                  <td key={column.id}>
                    <input
                      type="text"
                      maxLength={500}
                      value={row.cells[column.id] ?? ''}
                      onChange={(event) => setCell(row.id, column.id, event.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {draft.columns.length === 0 ? (
          <p className="muted">No columns yet. Add one to start typing.</p>
        ) : null}
      </div>

      <div className="grid__actions">
        <button
          type="button"
          className="btn btn--small"
          onClick={addColumn}
          disabled={draft.columns.length >= MAX_TABLE_COLUMNS}
        >
          + Column
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={addRow}
          disabled={draft.rows.length >= MAX_TABLE_ROWS || draft.columns.length === 0}
        >
          + Row
        </button>
        <span className="muted">
          Up to {MAX_TABLE_COLUMNS} columns and {MAX_TABLE_ROWS} rows. A wall panel runs out of
          room long before that.
        </span>
      </div>
    </form>
  );
}

// --- slide editor -----------------------------------------------------------

function DataTableEditor({ config, onChange, slide }: SlideEditorProps) {
  const value = config as unknown as DataTableSlideConfig;
  const tables = useAsync(() => tablesApi.list(), []);
  const available = tables.data ?? [];
  const chosen = available.find((table) => table.id === value.tableId);

  // Only what this slide draws. The preview renders the sign's own component
  // against it, so the frame below is not a second implementation of the slide.
  const previewData = useMemo(() => ({ tables: chosen ? [chosen] : [] }), [chosen]);

  return (
    <>
      <Field
        label="Table"
        hint={
          tables.data && available.length === 0
            ? 'No tables yet — make one on the Tables tab.'
            : 'Edit the contents on the Tables tab; this slide follows whatever is in it.'
        }
      >
        <select
          value={value.tableId ?? ''}
          onChange={(event) => onChange({ tableId: event.target.value || null })}
        >
          <option value="">Choose a table…</option>
          {available.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Heading" hint="Leave blank to use the table's name.">
        <input
          type="text"
          maxLength={120}
          value={value.heading}
          placeholder={chosen?.name ?? ''}
          onChange={(event) => onChange({ heading: event.target.value })}
        />
      </Field>

      <Field label="Show at most (rows)" hint="Anything past this is counted under the table.">
        <input
          type="number"
          min={1}
          max={MAX_TABLE_ROWS}
          value={value.maxRows}
          onChange={(event) => onChange({ maxRows: Number(event.target.value) })}
        />
      </Field>

      <Toggle
        label="Show the column headings"
        checked={value.showHeader}
        onChange={(showHeader) => onChange({ showHeader })}
      />
      <Toggle
        label="Shade alternate rows"
        checked={value.striped}
        onChange={(striped) => onChange({ striped })}
        hint="Easier to follow across a wide table; calmer without it on a short one."
      />

      <SlidePreview
        slide={value.tableId ? slide : null}
        data={previewData}
        waitingFor="Choose a table and the preview will show what the sign will show."
      />
    </>
  );
}

export const dataTableAdminPlugin: AdminPlugin = {
  id: 'data-table',
  tabs: [{ id: 'tables', label: 'Tables', page: TablesPage }],
  slides: { data_table: DataTableEditor },
};
