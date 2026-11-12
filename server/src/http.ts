import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(what: string): HttpError {
  return new HttpError(404, `${what} not found`);
}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.map(String).join('.');
      return where ? `${where}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/** Validates a request body or query, turning failures into a 400 with detail. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(formatIssues(result.error));
  return result.data;
}
