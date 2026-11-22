import { defineConfig } from 'tsdown';

/**
 * Published to npm, so @povik/* workspace packages (devDependencies, never published) are
 * bundled in. Targets an older Node than the server because it runs on users' machines.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: false,
  // Everything is bundled; the output may import Node built-ins and nothing else. A package
  // added under "dependencies" instead of "devDependencies" would stay external and fail here.
  deps: { onlyBundle: false, onlyImport: [] },
});
