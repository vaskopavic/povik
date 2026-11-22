#!/usr/bin/env node
import { CURRENT_SPEC_VERSION } from '@povik/spec';

console.error(
  `povik run (spec v${CURRENT_SPEC_VERSION}) is not implemented yet. It arrives in phase 2 (docs/PLAN.md §8).`,
);
process.exitCode = 1;
