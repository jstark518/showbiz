import type { FastifyInstance } from 'fastify';
import { broadcast } from '../events';
import { parseOrThrow } from '../http';
import { getSignSettings, saveSignSettings, signSettingsSchema } from '../settings';

/**
 * Settings the sign itself uses. Anything a plugin needs configured — Jira
 * credentials, say — is a route and a card that plugin registers.
 */
export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/sign', async () => getSignSettings());

  app.put('/api/settings/sign', async (request) => {
    const body = parseOrThrow(signSettingsSchema, request.body);
    const saved = await saveSignSettings(body);
    broadcast({ type: 'content-changed' });
    return saved;
  });
}
