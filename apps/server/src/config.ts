import { resolve } from 'node:path';
import { z } from 'zod';

/** Values used when NODE_ENV isn't `production`, so `pnpm dev` works without a .env file. */
const DEV_DEFAULTS = {
  POVIK_DATABASE_URL: 'postgres://povik:povik@localhost:54329/povik',
  POVIK_PUBLIC_URL: 'http://localhost:5180',
};

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  POVIK_HOST: z.string().default('127.0.0.1'),
  POVIK_PORT: z.coerce.number().int().positive().default(8080),
  POVIK_DATABASE_URL: z.string().min(1),
  POVIK_PUBLIC_URL: z.url(),
  /** Directory holding the built web app. Unset in dev, where Vite serves it. */
  POVIK_WEB_DIR: z.string().optional(),
  POVIK_AUTO_MIGRATE: z.stringbool().default(true),
  POVIK_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),
});

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databaseUrl: string;
  publicUrl: string;
  webDir: string | undefined;
  autoMigrate: boolean;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const input = env.NODE_ENV === 'production' ? env : { ...DEV_DEFAULTS, ...env };
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  const e = result.data;
  return {
    env: e.NODE_ENV,
    host: e.POVIK_HOST,
    port: e.POVIK_PORT,
    databaseUrl: e.POVIK_DATABASE_URL,
    publicUrl: e.POVIK_PUBLIC_URL,
    webDir: e.POVIK_WEB_DIR ? resolve(e.POVIK_WEB_DIR) : undefined,
    autoMigrate: e.POVIK_AUTO_MIGRATE,
    logLevel: e.POVIK_LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
  };
}
