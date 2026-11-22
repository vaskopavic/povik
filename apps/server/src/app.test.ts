import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations, schema, type Database } from '@povik/db';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, hstsHeader } from './app';
import { hashToken, SESSION_COOKIE } from './auth/session';
import { createLogger } from './logger';

const logger = createLogger({ env: 'test', logLevel: 'silent' });
const devConfig = { webDir: undefined, publicUrl: 'http://localhost:5180' };

describe('hstsHeader', () => {
  it('is sent for a real HTTPS deployment', () => {
    expect(hstsHeader('https://povik.example.com')).toBe('max-age=31536000');
  });

  it('is not sent for plain HTTP or for localhost', () => {
    expect(hstsHeader('http://povik.example.com')).toBe(false);
    expect(hstsHeader('https://localhost')).toBe(false);
    expect(hstsHeader('https://app.localhost:8443')).toBe(false);
    expect(hstsHeader('https://127.0.0.1')).toBe(false);
  });
});

describe('serving the built web app', () => {
  const database = {} as Database;
  let webDir: string;

  beforeAll(async () => {
    webDir = await mkdtemp(join(tmpdir(), 'povik-web-'));
    await mkdir(join(webDir, 'assets'));
    await writeFile(join(webDir, 'index.html'), '<!doctype html><title>povik</title>');
    await writeFile(join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  });

  afterAll(async () => {
    await rm(webDir, { recursive: true, force: true });
  });

  const app = () => createApp({ config: { ...devConfig, webDir }, database, logger });

  it('serves hashed assets with a long cache lifetime', async () => {
    const res = await (await app()).request('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('sends the same cache header for HEAD requests', async () => {
    const res = await (await app()).request('/assets/app-abc123.js', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('returns 404 for a missing asset instead of index.html', async () => {
    const res = await (await app()).request('/assets/app-old999.js');
    expect(res.status).toBe(404);
  });

  it('falls back to index.html for client routes, revalidated on every load', async () => {
    const res = await (await app()).request('/w/acme');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>povik</title>');
  });
});

describe('without a database', () => {
  // These routes never touch the database, so a stand-in is enough.
  const database = {} as Database;

  it('reports liveness', async () => {
    const app = await createApp({ config: devConfig, database, logger });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns a signed-out /me without a session cookie', async () => {
    const app = await createApp({ config: devConfig, database, logger });
    const res = await app.request('/api/v1/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null, workspaces: [] });
  });

  it('serves the OpenAPI document', async () => {
    const app = await createApp({ config: devConfig, database, logger });
    const res = await app.request('/api/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain('/me');
  });

  it('returns JSON 404 for unknown API paths', async () => {
    const app = await createApp({ config: devConfig, database, logger });
    const res = await app.request('/api/v1/nope');
    expect(res.status).toBe(404);
  });
});

/**
 * Runs when POVIK_TEST_DATABASE_URL points at a Postgres 18 server. Each run creates its own
 * database, applies the migrations, and drops it afterwards.
 */
const testDatabaseUrl = process.env.POVIK_TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('with a database', () => {
  const dbName = `povik_test_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let database: Database;

  beforeAll(async () => {
    admin = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(testDatabaseUrl!);
    url.pathname = `/${dbName}`;
    database = createDb(url.toString(), { max: 2 });
    await runMigrations(database);
  });

  afterAll(async () => {
    await database?.sql.end();
    await admin?.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  it('reports readiness', async () => {
    const app = await createApp({ config: devConfig, database, logger });
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
  });

  it('returns the signed-in user and their workspaces for a valid session', async () => {
    const { db } = database;
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'ana@example.com', name: 'Ana' })
      .returning();
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ kind: 'personal', slug: `ana-${dbName}`, name: 'Ana', createdBy: user!.id })
      .returning();
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: workspace!.id, userId: user!.id, role: 'owner' });
    const token = randomBytes(32).toString('base64url');
    await db.insert(schema.sessions).values({
      userId: user!.id,
      tokenHash: hashToken(token),
      client: 'web',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const app = await createApp({ config: devConfig, database, logger });
    const res = await app.request('/api/v1/me', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });

    expect(await res.json()).toEqual({
      user: { id: user!.id, email: 'ana@example.com', name: 'Ana', avatarUrl: null },
      workspaces: [
        { id: workspace!.id, slug: workspace!.slug, name: 'Ana', kind: 'personal', role: 'owner' },
      ],
    });
  });

  it('treats an unknown session token as signed out', async () => {
    const app = await createApp({ config: devConfig, database, logger });
    const res = await app.request('/api/v1/me', {
      headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` },
    });
    expect(await res.json()).toEqual({ user: null, workspaces: [] });
  });
});
