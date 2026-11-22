import { expect, test } from '@playwright/test';

test('the app loads and reaches the API through the contract', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'povik' })).toBeVisible();
  await expect(page.getByTestId('api-status')).toHaveText('Connected. Signed out.');
});

test('unknown client routes render the app, not a server 404', async ({ page }) => {
  const response = await page.goto('/no/such/page');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('unknown API paths stay JSON 404s', async ({ request }) => {
  const response = await request.get('/api/v1/no-such-endpoint');
  expect(response.status()).toBe(404);
  expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
});
