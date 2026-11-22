import { OpenAPIGenerator } from '@orpc/openapi';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { onError, ORPCError } from '@orpc/server';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { contract } from '@povik/contract';
import type { Database } from '@povik/db';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { SESSION_COOKIE } from './auth/session';
import type { Config } from './config';
import type { Logger } from './logger';
import { router } from './router';
import { mountSpa } from './spa';

export interface AppDeps {
  config: Pick<Config, 'webDir' | 'publicUrl'>;
  database: Database;
  logger: Logger;
}

/**
 * HSTS only for a real HTTPS deployment. Sent from https://localhost (the Compose stack), it
 * would make the browser insist on HTTPS for localhost, including the Vite dev server.
 * No includeSubDomains: a self-hosted install shouldn't force HTTPS on its sibling hosts.
 */
export function hstsHeader(publicUrl: string): string | false {
  const { protocol, hostname } = new URL(publicUrl);
  const isLocal =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';
  return protocol === 'https:' && !isLocal ? 'max-age=31536000' : false;
}

export async function createApp({ config, database, logger }: AppDeps): Promise<Hono> {
  const app = new Hono();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        // The browser transport calls whatever API the user enters, and the agent is a WebSocket.
        connectSrc: ['*', 'ws:', 'wss:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: hstsHeader(config.publicUrl),
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/readyz', async (c) => {
    try {
      await database.sql`select 1`;
      return c.json({ ok: true });
    } catch (error) {
      logger.warn({ err: error }, 'Readiness check failed');
      return c.json({ ok: false }, 503);
    }
  });

  const openApiDocument = await new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  }).generate(contract, {
    info: { title: 'povik API', version: '0.0.0' },
    servers: [{ url: '/api/v1' }],
  });
  app.get('/api/v1/openapi.json', (c) => c.json(openApiDocument));

  const handler = new OpenAPIHandler(router, {
    interceptors: [
      onError((error) => {
        if (!(error instanceof ORPCError) || error.status >= 500) {
          logger.error({ err: error }, 'API error');
        }
      }),
    ],
  });

  app.use('/api/v1/*', async (c, next) => {
    const { matched, response } = await handler.handle(c.req.raw, {
      prefix: '/api/v1',
      context: { db: database.db, sessionToken: getCookie(c, SESSION_COOKIE) },
    });
    if (matched) {
      return c.newResponse(response.body, response);
    }
    await next();
  });

  app.all('/api/*', (c) => c.json({ code: 'NOT_FOUND', message: 'Not found' }, 404));

  if (config.webDir) {
    mountSpa(app, config.webDir);
  }

  return app;
}
