import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };

/**
 * Where the SQL migrations live. In dev this is `packages/db/src/migrations`. When the server
 * is bundled, this module's code moves into `apps/server/dist/index.mjs` and the server's build
 * copies the migrations to `apps/server/dist/migrations`, so the same relative path works.
 */
export const defaultMigrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** Any fixed number works; it only has to be the same for every server instance. */
const MIGRATION_LOCK_ID = 7_412_093_551;

export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Database = ReturnType<typeof createDb>;
export type Db = Database['db'];

/**
 * Applies pending migrations while holding a Postgres advisory lock, so two server instances
 * starting at the same time don't race. The lock lives on one reserved connection, because a
 * session-level advisory lock must be released on the connection that took it. The migrations
 * run on a second connection, so the pool needs at least two.
 *
 * Drizzle only applies migrations newer than the last one applied. A migration from an older
 * branch that lands after a newer one is skipped silently, so regenerate it after rebasing.
 */
export async function runMigrations(
  { db, sql }: Database,
  migrationsFolder: string = defaultMigrationsFolder,
): Promise<void> {
  if (sql.options.max < 2) {
    throw new Error('runMigrations needs a connection pool of at least 2 (one holds the lock).');
  }
  const lockConnection = await sql.reserve();
  try {
    await lockConnection`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await migrate(db, { migrationsFolder });
  } finally {
    // If unlocking fails, the connection is dropped below and Postgres releases the lock with
    // it. Don't let that error hide whatever made the migration fail.
    await lockConnection`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => {});
    lockConnection.release();
  }
}
