import tseslint from 'typescript-eslint';
import base from './base.js';

/**
 * Globals that only exist in browsers. Their types come with the DOM lib, which these packages
 * include for URL, fetch and TextEncoder, so using them type-checks but crashes in Node.
 */
const BROWSER_ONLY = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'history',
  'alert',
];

/**
 * For packages that run in both the browser and Node: spec, contract, core, scripting and
 * importers. They also run in the CLI and the agent, where browser globals don't exist.
 */
export default tseslint.config(...base, {
  rules: {
    'no-restricted-globals': [
      'error',
      ...BROWSER_ONLY.map((name) => ({
        name,
        message: `${name} only exists in browsers, and this package also runs in Node (CLI, agent).`,
      })),
    ],
  },
});
