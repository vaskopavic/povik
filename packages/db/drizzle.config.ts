import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './src/migrations',
  dbCredentials: {
    url: process.env.POVIK_DATABASE_URL ?? 'postgres://povik:povik@localhost:54329/povik',
  },
  strict: true,
  verbose: true,
});
