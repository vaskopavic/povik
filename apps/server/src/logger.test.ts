import { describe, expect, it } from 'vitest';
import { serializeError } from './logger';

const SECRET = 's3cret-token';

/** Shaped like drizzle-orm's DrizzleQueryError. */
function queryError(cause?: unknown) {
  return Object.assign(
    new Error(`Failed query: select * from nodes where spec = $1\nparams: ${SECRET}`),
    { query: 'select * from nodes where spec = $1', params: [SECRET], cause },
  );
}

/** Shaped like postgres.js's PostgresError for a NOT NULL violation. */
function postgresError() {
  return Object.assign(new Error('null value in column "name" violates not-null constraint'), {
    name: 'PostgresError',
    code: '23502',
    severity: 'ERROR',
    table_name: 'nodes',
    column_name: 'name',
    detail: `Failing row contains (019a…, {"auth":{"token":"${SECRET}"}}).`,
    where: `SQL statement with ${SECRET}`,
  });
}

describe('serializeError', () => {
  it('drops the bound parameters of a failed query but keeps the SQL and the cause', () => {
    const logged = JSON.stringify(
      serializeError(queryError(new Error('connect ECONNREFUSED 127.0.0.1:54329'))),
    );
    expect(logged).not.toContain(SECRET);
    expect(logged).toContain('select * from nodes where spec = $1');
    expect(logged).toContain('ECONNREFUSED');
  });

  it('drops row data that Postgres quotes in detail and where', () => {
    const logged = JSON.stringify(serializeError(queryError(postgresError())));
    expect(logged).not.toContain(SECRET);
    expect(logged).toContain('23502');
    expect(logged).toContain('not-null constraint');
  });

  it('scrubs a query error that is the cause of another error', () => {
    const wrapper = new Error('Internal server error', { cause: queryError() });
    const logged = JSON.stringify(serializeError(wrapper));
    expect(logged).not.toContain(SECRET);
    expect(logged).toContain('Internal server error');
  });

  it('keeps the useful parts of connection errors', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:54329'), {
      code: 'ECONNREFUSED',
      port: 54329,
    });
    const serialized = serializeError(new AggregateError([refused], 'all attempts failed')) as {
      errors: { code: string; port: number }[];
    };
    expect(serialized.errors[0]).toMatchObject({ code: 'ECONNREFUSED', port: 54329 });
  });

  it('serializes other errors normally', () => {
    const serialized = serializeError(new TypeError('boom')) as { type: string; message: string };
    expect(serialized).toMatchObject({ type: 'TypeError', message: 'boom' });
  });
});
