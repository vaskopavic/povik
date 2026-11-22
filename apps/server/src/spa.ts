import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves the built web app.
 * - Hashed files under /assets are cached forever. Everything else, index.html included, is
 *   revalidated on every load, so a deploy shows up immediately.
 * - A missing /assets file is a 404, not index.html: after a deploy, an open tab asking for an
 *   old chunk must fail loudly rather than receive HTML.
 * - Any other GET that isn't an API or auth path gets index.html, and the client router takes over.
 */
export function mountSpa(app: Hono, webDir: string): void {
  let indexHtml: Promise<string> | undefined;
  const loadIndexHtml = () => {
    indexHtml ??= readFile(join(webDir, 'index.html'), 'utf8').catch((error: unknown) => {
      indexHtml = undefined; // Try again on the next request instead of caching the failure.
      throw error;
    });
    return indexHtml;
  };

  // Set Cache-Control after the static handler has built its response. serveStatic's onFound
  // callback runs after the response object exists, so headers set there don't reliably stick.
  app.use('*', async (c, next) => {
    await next();
    const isRead = c.req.method === 'GET' || c.req.method === 'HEAD';
    if (isRead && c.res.status === 200 && !c.req.path.startsWith('/api/')) {
      c.header('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
    }
  });

  app.use('*', serveStatic({ root: webDir }));

  app.get('*', async (c) => {
    const path = c.req.path;
    if (path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/assets/')) {
      return c.notFound();
    }
    return c.html(await loadIndexHtml());
  });
}
