import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { contract } from '@povik/contract';
import { platform } from './platform';

const link = new OpenAPILink(contract, {
  // A function, so a changed server URL (desktop settings) applies to the next call.
  url: () => `${platform.apiBaseUrl}/api/v1`,
  fetch: (request, init) => platform.apiFetch(request, init),
});

/** Typed API client generated from the contract: `await api.me.get()`. */
export const api: ContractRouterClient<typeof contract> = createORPCClient(link);

/** TanStack Query helpers for the same API: `useQuery(orpc.me.get.queryOptions())`. */
export const orpc = createTanstackQueryUtils(api);
