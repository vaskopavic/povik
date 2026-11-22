import { z } from 'zod';

export const WorkspaceKindSchema = z.enum(['personal', 'team', 'sandbox']);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const WorkspaceRoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

/**
 * A user as the API returns them. Email and avatar are plain strings on purpose: they come from
 * the OAuth provider, and zod's stricter formats reject some real addresses (`user@bücher.de`),
 * which would turn every response for that user into a 500. Validate strictly on input instead.
 */
export const UserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

/** A workspace as it appears in the workspace switcher, with the current user's role in it. */
export const WorkspaceSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: WorkspaceKindSchema,
  role: WorkspaceRoleSchema,
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

/** The signed-in user and their workspaces. `user` is null when nobody is signed in. */
export const MeSchema = z.object({
  user: UserSchema.nullable(),
  workspaces: z.array(WorkspaceSummarySchema),
});
export type Me = z.infer<typeof MeSchema>;
