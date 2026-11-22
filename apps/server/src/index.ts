import { serve } from '@hono/node-server';
import { createDb, runMigrations } from '@povik/db';
import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

const USAGE = 'Usage: node dist/index.mjs [serve|migrate]';

if (process.env.NODE_ENV !== 'production') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: the dev defaults in config.ts apply.
  }
}

const command = process.argv[2] ?? 'serve';
const config = loadConfigOrExit();
const logger = createLogger(config);
const database = createDb(config.databaseUrl);

switch (command) {
  case 'migrate': {
    await runMigrations(database);
    logger.info('Migrations applied');
    await database.sql.end();
    break;
  }

  case 'serve': {
    if (config.autoMigrate) {
      await runMigrations(database);
      logger.info('Migrations applied');
    }

    const app = await createApp({ config, database, logger });
    const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
      logger.info(`povik server listening on http://${info.address}:${info.port}`);
    });

    const shutdown = (signal: string) => {
      logger.info(`${signal} received, shutting down`);
      server.close(async () => {
        await database.sql.end({ timeout: 5 });
        process.exit(0);
      });
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    break;
  }

  default: {
    console.error(`Unknown command "${command}". ${USAGE}`);
    await database.sql.end();
    process.exit(1);
  }
}

/** Bad configuration is an operator mistake, not a crash: print what's wrong, without a stack. */
function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
