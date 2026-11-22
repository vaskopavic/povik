import { describe, expect, it } from 'vitest';
import { MeSchema } from './user';

describe('MeSchema', () => {
  it('accepts a signed-out response', () => {
    expect(MeSchema.parse({ user: null, workspaces: [] })).toEqual({ user: null, workspaces: [] });
  });

  it('accepts provider emails that stricter email formats reject', () => {
    const user = {
      id: '019a8a2e-7c4b-7f3e-9a1d-2b3c4d5e6f70',
      email: 'user@bücher.de',
      name: 'Ana',
      avatarUrl: null,
    };
    expect(MeSchema.safeParse({ user, workspaces: [] }).success).toBe(true);
  });

  it('rejects a workspace with an unknown role', () => {
    const result = MeSchema.safeParse({
      user: null,
      workspaces: [
        {
          id: '019a8a2e-7c4b-7f3e-9a1d-2b3c4d5e6f70',
          slug: 'acme',
          name: 'Acme',
          kind: 'team',
          role: 'guest',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
