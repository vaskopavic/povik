import { oc } from '@orpc/contract';
import { MeSchema } from '@povik/spec';

/**
 * The povik API contract. The server implements it and serves it as REST under `/api/v1`;
 * the web app calls it through the same contract, so a change here is a type error on both sides.
 */
export const contract = {
  me: {
    get: oc
      .route({
        method: 'GET',
        path: '/me',
        summary: 'The signed-in user and their workspaces',
        tags: ['Account'],
      })
      .output(MeSchema),
  },
};

export type Contract = typeof contract;
