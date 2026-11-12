/**
 * Data table — the wire types this plugin owns.
 *
 * A table is a small hand-maintained grid: a lunch rota, a league ladder, who
 * is on call this week. The panel gets a tab to edit them and a slide type to
 * put one on the wall.
 *
 * Columns and rows are stored as JSON rather than as real columns, because
 * nothing ever queries inside a table — it is fetched whole, by id, and drawn.
 * See `plugins/data-table/server/index.ts`.
 */

export type DataTableAlign = 'left' | 'center' | 'right';

export interface DataTableColumn {
  /** Stable across renames, so a heading can be retyped without losing cells. */
  id: string;
  label: string;
  align: DataTableAlign;
}

export interface DataTableRow {
  id: string;
  /** Column id → cell text. A missing key renders as an empty cell. */
  cells: Record<string, string>;
}

export interface DataTable {
  id: string;
  name: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Ceilings, enforced by the server schema and by the editor's buttons.
 *
 * They are low on purpose. This is a thing read from across a room: a table
 * that needs a fortieth row is a table that needed a different slide.
 */
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_ROWS = 100;

export interface DataTableSlideConfig {
  tableId: string | null;
  /** Falls back to the table's name, then to the slide title. */
  heading: string;
  /** How many rows fit before the rest are dropped, newest last. */
  maxRows: number;
  showHeader: boolean;
  /** Shades alternate rows. Off reads calmer with very few rows. */
  striped: boolean;
}

export const TABLE_SLIDE_TYPES = {
  data_table: { label: 'Data table', defaultDurationSeconds: 20, usesTheme: true },
} as const;
