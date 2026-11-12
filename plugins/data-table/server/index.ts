import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { json, sql } from '../../../server/src/db';
import { broadcast } from '../../../server/src/events';
import { notFound, parseOrThrow } from '../../../server/src/http';
import type { ServerPlugin } from '../../server/types';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  type DataTable,
  type DataTableColumn,
  type DataTableRow,
  type DataTableSlideConfig,
} from '../shared';

const columnSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().max(60).default(''),
  align: z.enum(['left', 'center', 'right']).default('left'),
});

const rowSchema = z.object({
  id: z.string().min(1).max(40),
  // Cells for columns that no longer exist are kept rather than pruned: a
  // column deleted by accident and added back should not take its data with it.
  cells: z.record(z.string().max(40), z.string().max(500)).default({}),
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  columns: z.array(columnSchema).max(MAX_TABLE_COLUMNS),
  rows: z.array(rowSchema).max(MAX_TABLE_ROWS),
});

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });

const dataTableConfig = z.object({
  tableId: z.uuid().nullable().catch(null).default(null),
  heading: z.string().max(120).catch('').default(''),
  maxRows: z.number().int().min(1).max(MAX_TABLE_ROWS).catch(12).default(12),
  showHeader: z.boolean().catch(true).default(true),
  striped: z.boolean().catch(true).default(true),
});

interface TableRow {
  id: string;
  name: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  created_at: Date;
  updated_at: Date;
}

function toDataTable(row: TableRow): DataTable {
  return {
    id: row.id,
    name: row.name,
    // jsonb comes back as whatever was written. A hand-edited row that is not
    // an array would otherwise reach the sign and break `.map`.
    columns: Array.isArray(row.columns) ? row.columns : [],
    rows: Array.isArray(row.rows) ? row.rows : [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** What a new table starts as: enough of a grid to type into straight away. */
const STARTER_COLUMNS: DataTableColumn[] = [
  { id: 'c1', label: 'Name', align: 'left' },
  { id: 'c2', label: 'Value', align: 'left' },
];
const STARTER_ROWS: DataTableRow[] = [
  { id: 'r1', cells: {} },
  { id: 'r2', cells: {} },
  { id: 'r3', cells: {} },
];

async function routes(app: FastifyInstance): Promise<void> {
  app.get('/api/tables', async () => {
    const rows = await sql<TableRow[]>`select * from data_tables order by name asc`;
    return rows.map(toDataTable);
  });

  app.post('/api/tables', async (request, reply) => {
    const body = parseOrThrow(createSchema, request.body);
    const [row] = await sql<TableRow[]>`
      insert into data_tables (name, columns, rows)
      values (${body.name}, ${json(STARTER_COLUMNS)}, ${json(STARTER_ROWS)})
      returning *
    `;
    broadcast({ type: 'content-changed' });
    reply.code(201);
    return toDataTable(row!);
  });

  /*
   * The whole table is written at once rather than patched cell by cell.
   *
   * The editor is a grid: adding a column touches every row, and moving a row
   * touches the order of all of them. A per-cell API would mean a transaction
   * per keystroke and a merge rule for two people typing at once — for a table
   * one person maintains a few times a year.
   */
  app.put('/api/tables/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(saveSchema, request.body);

    const [row] = await sql<TableRow[]>`
      update data_tables set
        name       = ${body.name},
        columns    = ${json(body.columns)},
        rows       = ${json(body.rows)},
        updated_at = now()
      where id = ${id}
      returning *
    `;
    if (!row) throw notFound('Table');
    broadcast({ type: 'content-changed' });
    return toDataTable(row);
  });

  app.delete('/api/tables/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await sql`delete from data_tables where id = ${id} returning id`;
    if (rows.length === 0) throw notFound('Table');
    broadcast({ type: 'content-changed' });
    reply.code(204);
  });
}

export const dataTablePlugin: ServerPlugin = {
  id: 'data-table',
  slides: { data_table: dataTableConfig },
  routes,

  /**
   * Only the tables a slide in this playlist actually names.
   *
   * Unlike dates — where a slide with nothing ticked means "whatever is coming
   * up" — a table slide always names exactly one, so sending the rest would be
   * every row of every table down to a player on office wifi, every poll.
   */
  async signData({ slides }) {
    const ids = [
      ...new Set(
        slides
          .filter((slide) => slide.type === 'data_table')
          .map((slide) => (slide.config as DataTableSlideConfig).tableId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length === 0) return { data: { tables: [] }, revision: [] };

    const rows = await sql<TableRow[]>`select * from data_tables where id in ${sql(ids)}`;
    return {
      data: { tables: rows.map(toDataTable) },
      revision: rows.map((row) => [row.id, row.updated_at]),
    };
  },
};
