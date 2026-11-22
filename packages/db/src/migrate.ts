/**
 * `pnpm db:migrate`: applies pending migrations to POVIK_DATABASE_URL (or the local dev database).
 */
import { createDb, runMigrations } from './index';

const url = process.env.POVIK_DATABASE_URL ?? 'postgres://povik:povik@localhost:54329/povik';
const database = createDb(url, { max: 2 });

try {
  await runMigrations(database);
  console.log('Migrations applied.');
} finally {
  await database.sql.end();
}
