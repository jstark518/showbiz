import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../../server/src/db';
import { broadcast } from '../../../server/src/events';
import { notFound, parseOrThrow } from '../../../server/src/http';
import type { ServerPlugin } from '../../server/types';
import type { ImportantDate } from '../shared';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color');

const createSchema = z.object({
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).default(''),
  occursAt: z.iso.datetime({ offset: true }),
  allDay: z.boolean().default(true),
  accent: hexColor.default('#38bdf8'),
});

const updateSchema = createSchema.partial();

const countdownConfig = z.object({
  heading: z.string().max(120).catch('Upcoming').default('Upcoming'),
  dateIds: z.array(z.uuid()).max(50).catch([]).default([]),
  maxItems: z.number().int().min(1).max(12).catch(5).default(5),
  showPastDays: z.number().int().min(0).max(30).catch(0).default(0),
});

/** How far back a past date may still appear, matching the config's ceiling. */
const MAX_PAST_DAYS = 30;

interface DateRow {
  id: string;
  label: string;
  description: string;
  occurs_at: Date;
  all_day: boolean;
  accent: string;
  created_at: Date;
  updated_at: Date;
}

function toImportantDate(row: DateRow): ImportantDate {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    occursAt: row.occurs_at.toISOString(),
    allDay: row.all_day,
    accent: row.accent,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function routes(app: FastifyInstance): Promise<void> {
  app.get('/api/dates', async () => {
    const rows = await sql<DateRow[]>`select * from important_dates order by occurs_at asc`;
    return rows.map(toImportantDate);
  });

  app.post('/api/dates', async (request, reply) => {
    const body = parseOrThrow(createSchema, request.body);
    const [row] = await sql<DateRow[]>`
      insert into important_dates (label, description, occurs_at, all_day, accent)
      values (${body.label}, ${body.description}, ${body.occursAt}, ${body.allDay}, ${body.accent})
      returning *
    `;
    broadcast({ type: 'content-changed' });
    reply.code(201);
    return toImportantDate(row!);
  });

  app.patch('/api/dates/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(updateSchema, request.body);

    const [existing] = await sql<DateRow[]>`select * from important_dates where id = ${id}`;
    if (!existing) throw notFound('Date');

    const [row] = await sql<DateRow[]>`
      update important_dates set
        label       = ${body.label ?? existing.label},
        description = ${body.description ?? existing.description},
        occurs_at   = ${body.occursAt ?? existing.occurs_at},
        all_day     = ${body.allDay ?? existing.all_day},
        accent      = ${body.accent ?? existing.accent},
        updated_at  = now()
      where id = ${id}
      returning *
    `;
    broadcast({ type: 'content-changed' });
    return toImportantDate(row!);
  });

  app.delete('/api/dates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await sql`delete from important_dates where id = ${id} returning id`;
    if (rows.length === 0) throw notFound('Date');
    broadcast({ type: 'content-changed' });
    reply.code(204);
  });
}

export const datesPlugin: ServerPlugin = {
  id: 'dates',
  slides: { countdown: countdownConfig },
  routes,

  /**
   * Every date in the window goes to the sign, not just the ones a slide names.
   * Countdown slides filter the list themselves — a slide with nothing ticked
   * means "whatever is coming up", including dates added after it was saved —
   * so the payload has to be wide enough to satisfy any of their settings.
   */
  async signData() {
    const rows = await sql<DateRow[]>`
      select * from important_dates
      where occurs_at > now() - ${`${MAX_PAST_DAYS} days`}::interval
      order by occurs_at asc
      limit 200
    `;
    return {
      data: { dates: rows.map(toImportantDate) },
      revision: rows.map((row) => [row.id, row.updated_at]),
    };
  },
};
