import { pino, type Logger } from 'pino';
import pretty from 'pino-pretty';
import type { Config } from './config';

export type { Logger };

/**
 * JSON logs to stdout. In development they go through pino-pretty for readability.
 * Request and collection bodies must never be logged: they contain credentials.
 */
export function createLogger(config: Pick<Config, 'env' | 'logLevel'>): Logger {
  const options = { level: config.logLevel, serializers: { err: serializeError } };
  if (config.env === 'development') {
    // A stream rather than a pino transport: transports run in a worker thread that loads
    // pino's files by path, and those files don't exist inside the bundled server.
    return pino(options, pretty({ ignore: 'pid,hostname', translateTime: 'HH:MM:ss' }));
  }
  return pino(options);
}

/** Fields of Node system errors (ECONNREFUSED and friends) that are safe and useful to log. */
const SYSTEM_ERROR_FIELDS = ['code', 'errno', 'syscall', 'address', 'port'] as const;

/** Fields of a postgres.js error that identify the failure without quoting any data. */
const POSTGRES_ERROR_FIELDS = [
  'code',
  'severity',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
] as const;

/**
 * Turns an error, and every error in its cause chain, into a loggable object that never
 * contains query data:
 * - Drizzle query errors repeat the bound parameters in their message, stack and `params`;
 *   only the SQL text is kept.
 * - postgres.js errors can quote whole rows in `detail`, `hint` or `where` ("Failing row
 *   contains (…)"); only the identifying fields are kept.
 * Pino's standard serializer is not used because it folds the causes' messages and stacks into
 * the outer error, which would bring the parameters back.
 */
export function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  if (depth > 8) {
    return { type: error.constructor.name, message: '(cause chain truncated)' };
  }

  const out: Record<string, unknown> = { type: error.constructor.name };

  if ('query' in error && 'params' in error) {
    out.message = `Failed query: ${String(error.query)}`;
  } else if (error.name === 'PostgresError') {
    out.message = error.message;
    copyFields(error, out, POSTGRES_ERROR_FIELDS);
  } else {
    out.message = error.message;
    out.stack = error.stack;
    copyFields(error, out, SYSTEM_ERROR_FIELDS);
  }

  if (error instanceof AggregateError) {
    out.errors = error.errors.map((inner) => serializeError(inner, depth + 1));
  }
  if (error.cause !== undefined) {
    out.cause = serializeError(error.cause, depth + 1);
  }
  return out;
}

function copyFields(from: Error, to: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    const value = (from as unknown as Record<string, unknown>)[field];
    if (value !== undefined) {
      to[field] = value;
    }
  }
}
