import { defineConfig } from 'tsdown';

/**
 * Bundles the server and everything it imports into dist/, so the production image needs no
 * node_modules. All dependencies are devDependencies for that reason: tsdown bundles them.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node26',
  outDir: 'dist',
  clean: true,
  dts: false,
  // Everything is bundled; the output may import Node built-ins and nothing else. A package
  // added under "dependencies" instead of "devDependencies" would stay external and fail here.
  deps: { onlyBundle: false, onlyImport: [] },
  copy: [{ from: '../../packages/db/src/migrations', to: 'dist' }],
});
