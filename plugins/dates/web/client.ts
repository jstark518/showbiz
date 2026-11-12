import { apiRequest, jsonBody } from '../../../web/src/lib/api';
import type { ImportantDate } from '../shared';

/**
 * This plugin's endpoints, kept with the plugin rather than added to the app's
 * `api` object — the point of the split is that removing the folder removes
 * the feature.
 */
export const datesApi = {
  list: () => apiRequest<ImportantDate[]>('/api/dates'),

  create: (input: {
    label: string;
    description?: string;
    occursAt: string;
    allDay?: boolean;
    accent?: string;
  }) => apiRequest<ImportantDate>('/api/dates', { method: 'POST', body: jsonBody(input) }),

  update: (id: string, patch: Partial<ImportantDate>) =>
    apiRequest<ImportantDate>(`/api/dates/${id}`, { method: 'PATCH', body: jsonBody(patch) }),

  remove: (id: string) => apiRequest<void>(`/api/dates/${id}`, { method: 'DELETE' }),
};
