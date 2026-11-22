import { createHash } from 'node:crypto';
import { schema, type Db } from '@povik/db';
import type { User, WorkspaceSummary } from '@povik/spec';
import { and, asc, eq, gt } from 'drizzle-orm';

export const SESSION_COOKIE = 'povik_session';

/** Sessions are stored by the SHA-256 of their token, never the token itself. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** The user behind a session token, or null if the token is unknown or expired. */
export async function findSessionUser(db: Db, token: string): Promise<User | null> {
  const { sessions, users } = schema;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Every workspace the user is a member of, with their role in it. */
export async function listWorkspaces(db: Db, userId: string): Promise<WorkspaceSummary[]> {
  const { workspaceMembers, workspaces } = schema;
  return db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      kind: workspaces.kind,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.kind), asc(workspaces.name));
}
