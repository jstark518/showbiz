import { apiRequest, jsonBody } from '../../../web/src/lib/api';
import type { DataTable, DataTableColumn, DataTableRow } from '../shared';

export const tablesApi = {
  list: () => apiRequest<DataTable[]>('/api/tables'),

  create: (name: string) =>
    apiRequest<DataTable>('/api/tables', { method: 'POST', body: jsonBody({ name }) }),

  /** The whole grid in one write — see the route for why. */
  save: (id: string, table: { name: string; columns: DataTableColumn[]; rows: DataTableRow[] }) =>
    apiRequest<DataTable>(`/api/tables/${id}`, { method: 'PUT', body: jsonBody(table) }),

  remove: (id: string) => apiRequest<void>(`/api/tables/${id}`, { method: 'DELETE' }),
};
