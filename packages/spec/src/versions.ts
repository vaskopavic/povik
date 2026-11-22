/**
 * Version of the messages the web app and the local agent exchange (docs/PLAN.md §7.4). Both
 * sides send it in `hello`, so an outdated agent can be told to update instead of misbehaving.
 */
export const AGENT_PROTOCOL_VERSION = 1;

/**
 * Version of the request, folder and collection spec shapes (docs/PLAN.md §5). Stored with
 * every spec, so a later shape change can migrate old data.
 */
export const CURRENT_SPEC_VERSION = 1;
