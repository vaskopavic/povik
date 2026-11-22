#!/usr/bin/env node
import { AGENT_PROTOCOL_VERSION } from '@povik/spec';

console.error(
  `povik-agent (protocol v${AGENT_PROTOCOL_VERSION}) is not implemented yet. It arrives in phase 1 (docs/PLAN.md §7.4).`,
);
process.exitCode = 1;
