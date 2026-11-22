import type { EnvironmentVariable, WorkspaceKind, WorkspaceRole } from '@povik/spec';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** Postgres `bytea`, used for SHA-256 token hashes. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Text compared byte by byte (`COLLATE "C"`), so fractional-index sort keys order the same
 * in Postgres as in JavaScript.
 */
const sortKey = customType<{ data: string; driverData: string }>({
  dataType: () => 'text COLLATE "C"',
});

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const version = () => bigint('version', { mode: 'number' }).notNull().default(1);

const workspaceKinds = ['personal', 'team', 'sandbox'] as const satisfies readonly WorkspaceKind[];
const workspaceRoles = [
  'owner',
  'admin',
  'editor',
  'viewer',
] as const satisfies readonly WorkspaceRole[];

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)],
);

export const identities = pgTable(
  'identities',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['github', 'google'] }).notNull(),
    providerUserId: text('provider_user_id').notNull(),
    email: text('email').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('identities_provider_user_key').on(t.provider, t.providerUserId),
    check('identities_provider_check', sql`${t.provider} in ('github', 'google')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique('sessions_token_hash_key'),
    client: text('client', { enum: ['web', 'desktop'] }).notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('sessions_client_check', sql`${t.client} in ('web', 'desktop')`),
    index('sessions_user_id_idx').on(t.userId),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    kind: text('kind', { enum: workspaceKinds }).notNull(),
    slug: text('slug').notNull().unique('workspaces_slug_key'),
    name: text('name').notNull(),
    /** NULL for anonymous sandboxes. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Sandboxes only. */
    editTokenHash: bytea('edit_token_hash'),
    /** Anonymous sandboxes only. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('workspaces_kind_check', sql`${t.kind} in ('personal', 'team', 'sandbox')`),
    check(
      'workspaces_sandbox_token_check',
      sql`(${t.kind} = 'sandbox') = (${t.editTokenHash} is not null)`,
    ),
    check('workspaces_expiry_check', sql`${t.kind} = 'sandbox' or ${t.expiresAt} is null`),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: workspaceRoles }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    check('workspace_members_role_check', sql`${t.role} in ('owner', 'admin', 'editor', 'viewer')`),
    uniqueIndex('one_owner_per_workspace')
      .on(t.workspaceId)
      .where(sql`${t.role} = 'owner'`),
    index('workspace_members_user_id_idx').on(t.userId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique('invites_token_hash_key'),
    role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** NULL means unlimited. */
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check('invites_role_check', sql`${t.role} in ('admin', 'editor', 'viewer')`)],
);

export const collections = pgTable(
  'collections',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** CollectionSpec. Typed properly once packages/spec defines it (phase 1). */
    spec: jsonb('spec').$type<Record<string, unknown>>().notNull().default({}),
    version: version(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('collections_workspace_id_idx').on(t.workspaceId)],
);

/** Folders and requests in one tree, so they can be interleaved. */
export const nodes = pgTable(
  'nodes',
  {
    id: id(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    /** NULL means the collection root. */
    parentId: uuid('parent_id').references((): AnyPgColumn => nodes.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['folder', 'request'] }).notNull(),
    name: text('name').notNull(),
    /** Fractional index among siblings. */
    sortKey: sortKey('sort_key').notNull(),
    /** FolderSpec or RequestSpec. Typed properly once packages/spec defines them (phase 1). */
    spec: jsonb('spec').$type<Record<string, unknown>>().notNull(),
    version: version(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('nodes_kind_check', sql`${t.kind} in ('folder', 'request')`),
    unique('nodes_sibling_sort_key').on(t.collectionId, t.parentId, t.sortKey).nullsNotDistinct(),
  ],
);

export const environments = pgTable(
  'environments',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    variables: jsonb('variables').$type<EnvironmentVariable[]>().notNull().default([]),
    version: version(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('environments_workspace_id_idx').on(t.workspaceId)],
);
