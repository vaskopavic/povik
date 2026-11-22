import { implement } from '@orpc/server';
import { contract } from '@povik/contract';
import type { Db } from '@povik/db';
import { findSessionUser, listWorkspaces } from './auth/session';

export interface ApiContext {
  db: Db;
  /** Raw value of the session cookie, if the request carried one. */
  sessionToken: string | undefined;
}

const api = implement(contract).$context<ApiContext>();

export const router = api.router({
  me: {
    get: api.me.get.handler(async ({ context }) => {
      const user = context.sessionToken
        ? await findSessionUser(context.db, context.sessionToken)
        : null;
      if (!user) {
        return { user: null, workspaces: [] };
      }
      return { user, workspaces: await listWorkspaces(context.db, user.id) };
    }),
  },
});
