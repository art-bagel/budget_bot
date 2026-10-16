import { randomUUID } from 'node:crypto';
import { EMAIL, PASSWORD, expect, login, test } from './fixtures';

// A gift sold for rubles instead of coins is deleted from the operations
// history; the seed state is restored, so other tests see the same data.
test('a mistaken collection sale is deleted from the history', async ({ page }) => {
  const api = process.env.PLAYWRIGHT_API_URL ?? '';
  const session = await page.request.post(`${api}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await session.json()).token}` };
  const positions = await (await page.request.get(`${api}/api/v1/portfolio/positions?status=open`, { headers })).json();
  const gift = positions.find((p: { title: string }) => p.title === 'Тестовый подарок');
  const sold = await page.request.post(`${api}/api/v1/portfolio/positions/${gift.id}/close`, {
    headers,
    data: { request_id: randomUUID(), close_amount_in_currency: 26, close_currency_code: 'RUB' },
  });
  expect(sold.ok()).toBe(true);

  await login(page);
  await page.getByRole('button', { name: 'Портфель', exact: true }).click();
  await page.getByRole('tab', { name: 'Коллекции', exact: true }).click();
  await page.getByRole('tab', { name: 'Операции' }).last().click();
  await page.getByRole('button', { name: 'История операций' }).click();

  const sheet = page.getByRole('dialog', { name: 'История операций' });
  await sheet.getByRole('button', { name: /Продажа предмета.*26 ₽/ }).click();
  const operation = page.getByRole('dialog', { name: 'Продажа предмета' });
  await operation.getByRole('button', { name: 'Удалить операцию' }).click();
  await operation.getByRole('button', { name: 'Удалить', exact: true }).click();

  await expect(sheet.getByRole('button', { name: /Получение предмета/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Продажа предмета/ })).toHaveCount(0);
  const after = await (await page.request.get(`${api}/api/v1/portfolio/positions?status=open`, { headers })).json();
  expect(after.some((p: { id: number }) => p.id === gift.id)).toBe(true);
});
