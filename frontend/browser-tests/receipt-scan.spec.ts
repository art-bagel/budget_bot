import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { EMAIL, PASSWORD, allowConsoleErrors, expect, openOverview, test } from './fixtures';

// Everything here is made up: the model is replaced by page.route, the photo
// is a gray canvas with a fake EXIF segment carrying a marker string.
const EXIF_MARKER = 'GPS-MARKER-55.7558-37.6173';

const MOSCOW_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' });
const yesterday = MOSCOW_DAY.format(Date.now() - 24 * 3600 * 1000);

const RECEIPT = {
  merchant: 'Лавка у дома',
  date: yesterday,
  currency: 'RUB',
  total: '264.80',
  items: [
    { name: 'ХЛЕБ БОРОДИНСК', name_ru: 'Хлеб бородинский', amount: '54.90' },
    { name: 'MILK 3.2%', name_ru: 'Молоко 3,2%', amount: '89.90' },
    { name: 'ЧАЙ ЗЕЛЁНЫЙ', name_ru: 'Чай зелёный', amount: '120.00' },
  ],
};

// A real JPEG from the page's own canvas, 3000 px wide so the app has to
// shrink it, with an APP1/Exif segment the app must not send on.
async function photoWithExif(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 40;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#888888';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.9));
    let binary = '';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
  const jpeg = Buffer.from(base64, 'base64');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(EXIF_MARKER, 'latin1')]);
  const length = payload.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

function jpegSize(jpeg: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  return null;
}

async function openReceiptSheet(page: Page) {
  await openOverview(page);
  await page.getByRole('button', { name: /^Продукты/ }).click();
  await page.getByRole('button', { name: 'Распознать чек' }).click();
  return page.getByRole('dialog', { name: 'Распознать чек' });
}

async function choosePhoto(page: Page, photo: Buffer, buttonName = 'Выбрать фото') {
  const sheet = page.getByRole('dialog', { name: 'Распознать чек' });
  const chooser = page.waitForEvent('filechooser');
  await sheet.getByRole('button', { name: buttonName }).click();
  await (await chooser).setFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: photo });
}

async function mockScan(page: Page, body: object, status = 200) {
  const sent: Buffer[] = [];
  await page.route('**/api/v1/receipts/scan', async (route) => {
    sent.push(route.request().postDataBuffer() as Buffer);
    await route.fulfill({ status, json: body });
  });
  return sent;
}

test('a scanned receipt fills the expense form and lands in history', async ({ page }, testInfo) => {
  // Records and then cancels a real expense in the shared seed: once per run, in the
  // dark project, so it runs after both cancel.spec screenshots of the history list
  // (the extra rows would shift them by a few pixels).
  test.skip(testInfo.project.name !== 'dark', 'data flow runs in one theme');
  const sent = await mockScan(page, RECEIPT);
  await openReceiptSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Распознать чек' });
  await choosePhoto(page, await photoWithExif(page));

  await expect(sheet.getByText('264,80')).toBeVisible();
  await expect(sheet.getByText('MILK 3.2%')).toBeVisible();
  // The photo went out re-encoded: no EXIF, long side shrunk to 2000 px.
  expect(sent).toHaveLength(1);
  expect(sent[0].includes(Buffer.from(EXIF_MARKER))).toBe(false);
  expect(sent[0].includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
  expect(jpegSize(sent[0])).toEqual({ width: 2000, height: 27 });

  await sheet.getByLabel('Название позиции 2').fill('Молоко');
  await sheet.getByRole('button', { name: 'Удалить позицию «Чай зелёный»' }).click();
  await sheet.getByRole('button', { name: 'Подставить' }).click();
  await expect(sheet).toBeHidden();

  const form = page.getByRole('dialog', { name: 'Продукты' });
  await expect(form.getByPlaceholder('0')).toHaveValue('144.8');
  await expect(form.locator('input[type="date"]')).toHaveValue(yesterday);
  const comment = form.getByPlaceholder('Необязательно');
  await expect(comment).toHaveValue('Лавка у дома: Хлеб бородинский 54,90; Молоко 89,90');

  // A second receipt replaces the block instead of appending another one.
  await comment.fill(`на ужин · ${await comment.inputValue()}`);
  await form.getByRole('button', { name: 'Распознать чек' }).click();
  await choosePhoto(page, await photoWithExif(page));
  await page.getByRole('dialog', { name: 'Распознать чек' }).getByRole('button', { name: 'Подставить' }).click();
  await expect(comment).toHaveValue('на ужин · Лавка у дома: Хлеб бородинский 54,90; Молоко 3,2% 89,90; Чай зелёный 120,00');
  await expect(form.getByPlaceholder('0')).toHaveValue('264.80');

  await form.getByRole('button', { name: 'Списать' }).click();
  await expect(form).toBeHidden();

  const api = process.env.PLAYWRIGHT_API_URL ?? '';
  const session = await page.request.post(`${api}/api/v1/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const headers = { Authorization: `Bearer ${(await session.json()).token}` };
  const history = await (await page.request.get(`${api}/api/v1/operations/history?limit=50`, { headers })).json();
  const recorded = history.items.find((item: { comment: string | null }) => item.comment?.includes('Лавка у дома'));
  expect(recorded.comment).toBe('на ужин · Лавка у дома: Хлеб бородинский 54,90; Молоко 3,2% 89,90; Чай зелёный 120,00');

  await page.getByRole('tab', { name: 'Операции', exact: true }).click();
  const row = page.locator('.op-row', { hasText: '264,8' }).first();
  await row.locator('.op-row__name').click();
  await expect(row.locator('.op-detail__comment')).toHaveText(recorded.comment);

  // Give the seed back for the snapshot specs that run later.
  const reversed = await page.request.post(`${api}/api/v1/operations/reverse`, {
    headers,
    data: { operation_id: recorded.operation_id },
  });
  expect(reversed.ok()).toBe(true);
});

test('amount is filled only for a recognised currency the account has', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'light', 'form logic, one theme');
  let answer: object = { ...RECEIPT, currency: null };
  await page.route('**/api/v1/receipts/scan', (route) => route.fulfill({ json: answer }));
  await openReceiptSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Распознать чек' });
  const form = page.getByRole('dialog', { name: 'Продукты' });
  const photo = await photoWithExif(page);

  const cases: [object, string][] = [
    [{ ...RECEIPT, currency: null }, 'Валюта не распознана — введите сумму вручную.'],
    [{ ...RECEIPT, currency: 'VND' }, 'На выбранном счёте нет VND — введите сумму вручную.'],
    [{ ...RECEIPT, total: null }, 'Итог не найден — введите сумму вручную.'],
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const [body, hint] = cases[index];
    answer = body;
    await choosePhoto(page, photo, index === 0 ? 'Выбрать фото' : 'Другое фото');
    await expect(sheet.getByText(hint)).toBeVisible();
  }
  await sheet.getByRole('button', { name: 'Подставить' }).click();
  await expect(form.getByPlaceholder('0')).toHaveValue('');
  await expect(form.getByPlaceholder('Необязательно')).toHaveValue(/^Лавка у дома: Хлеб бородинский 54,90/);
});

test('a total that does not add up is pointed out', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'light', 'text check, one theme');
  await mockScan(page, { ...RECEIPT, total: '265.80' });
  await openReceiptSheet(page);
  await choosePhoto(page, await photoWithExif(page));
  const sheet = page.getByRole('dialog', { name: 'Распознать чек' });
  await expect(sheet.getByText('Сумма позиций на 1 меньше итога.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Подставить' })).toBeEnabled();
});

test('server errors, a broken photo and cancel while loading', async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== 'light', 'error states, one theme');
  let respond: (route: Route) => Promise<void> = (route) =>
    route.fulfill({ status: 502, json: { detail: 'Не удалось распознать чек' } });
  await page.route('**/api/v1/receipts/scan', (route) => respond(route));
  await openReceiptSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Распознать чек' });
  const photo = await photoWithExif(page);

  await choosePhoto(page, photo);
  await expect(sheet.getByRole('alert')).toHaveText('Не удалось распознать чек');

  respond = (route) => route.fulfill({ status: 429, json: { detail: 'Слишком много чеков подряд, попробуйте через час' } });
  await choosePhoto(page, photo, 'Другое фото');
  await expect(sheet.getByRole('alert')).toHaveText('Слишком много чеков подряд, попробуйте через час');
  allowConsoleErrors(consoleErrors, /status of (502|429)/);

  await choosePhoto(page, Buffer.from('definitely not a picture'), 'Другое фото');
  await expect(sheet.getByRole('alert')).toHaveText('Не удалось открыть фото — выберите другое.');

  // The model never answers: «Отмена» closes the sheet, the form stays.
  respond = () => new Promise<void>(() => {});
  await choosePhoto(page, photo, 'Другое фото');
  await expect(sheet.getByRole('status')).toHaveText('Распознаём чек…');
  await sheet.getByRole('button', { name: 'Отмена' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Продукты' })).toBeVisible();
});

test('without the flag there is no receipt button', async ({ page }) => {
  await page.route('**/api/v1/auth/context', async (route) => {
    const api = process.env.PLAYWRIGHT_API_URL;
    const url = new URL(route.request().url());
    const response = await route.fetch(api ? { url: api + url.pathname } : undefined);
    await route.fulfill({ response, json: { ...(await response.json()), receipt_scan_enabled: false } });
  });
  await openOverview(page);
  await page.getByRole('button', { name: /^Продукты/ }).click();
  await expect(page.getByRole('dialog', { name: 'Продукты' }).getByText('Сумма', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Распознать чек' })).toHaveCount(0);
});

test('receipt sheet matches the reference and passes axe', async ({ page }) => {
  // 35 rows, translated names with originals, a total off by 10: the long case.
  const items = Array.from({ length: 35 }, (_, n) => ({
    name: n % 3 === 0 ? `ITEM ${n + 1} TIENG VIET` : `Товар ${n + 1}`,
    name_ru: n % 7 === 0 ? `Очень длинное название товара номер ${n + 1} для проверки переноса` : `Товар ${n + 1}`,
    amount: `${100 + n}.50`,
  }));
  await mockScan(page, { merchant: 'Лавка у дома', date: null, currency: 'RUB', total: '4122.50', items });
  await openReceiptSheet(page);
  await choosePhoto(page, await photoWithExif(page));
  const sheet = page.getByRole('dialog', { name: 'Распознать чек' });
  await expect(sheet.getByText('Сумма позиций на 10 меньше итога.')).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await expect(sheet).toHaveScreenshot('receipt-sheet.png');

  const { violations } = await new AxeBuilder({ page }).include('.rcpt').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`))).toEqual([]);
});
