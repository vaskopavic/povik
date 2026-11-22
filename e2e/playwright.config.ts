import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.POVIK_E2E_PORT ?? 4317);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Runs against the production build: the bundled server serving the built web app, on a
 * local Postgres (`docker compose up -d postgres`, or the CI service container).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../apps/server/dist/index.mjs serve',
    url: `${baseURL}/readyz`,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    env: {
      NODE_ENV: 'production',
      POVIK_HOST: '127.0.0.1',
      POVIK_PORT: String(port),
      POVIK_PUBLIC_URL: baseURL,
      POVIK_WEB_DIR: '../apps/web/dist',
      POVIK_DATABASE_URL:
        process.env.POVIK_DATABASE_URL ?? 'postgres://povik:povik@localhost:54329/povik',
    },
  },
});
