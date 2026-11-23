import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Who is at the table, and coming back to your seat (KUB-35), measured as Hanora's HAN-5 was:
 * two browsers at one table through `wrangler dev`. Bo closes his page and opens it again,
 * then loses the network and gets it back, while Ana watches his seat. Every wait is timed
 * and written to the test's annotations, so a run says how long each one took.
 *
 * The offline half is slow by design: nothing tells the host a device has lost signal, so the
 * others see it away only once the host's sweep finds its socket quiet (50 s, swept every 15 s).
 */

type Friend = { readonly context: BrowserContext; page: Page };

async function friend(browser: Browser): Promise<Friend> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

async function sitDown(page: Page, name: string): Promise<void> {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Sit down' }).click();
  await expect(page.getByRole('list', { name: 'Seated' })).toContainText(`${name} (you)`);
}

/** How long `wait` took, in ms, noted on the test under `what`. */
async function timed(what: string, wait: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await wait();
  const ms = Date.now() - start;
  test.info().annotations.push({ type: 'measured', description: `${what}: ${ms} ms` });
  return ms;
}

test('a seat shows as away when its device goes, and is back in it when it returns', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ana = await friend(browser);
  const bo = await friend(browser);

  await ana.page.goto('/');
  await ana.page.getByRole('link', { name: 'Play friends' }).click();
  const link = ana.page.url();
  await sitDown(ana.page, 'Ana');
  await bo.page.goto(link);
  await sitDown(bo.page, 'Bo');
  await ana.page.getByRole('button', { name: 'Deal' }).click();
  for (const f of [ana, bo]) await expect(f.page.locator('.rack .tile')).toHaveCount(14);

  const boSeat = ana.page.locator('.opponents li[data-seat="1"]');
  await expect(boSeat).not.toHaveAttribute('data-away');
  const rack = await bo.page.locator('.rack .tile').allTextContents();

  // A closed page's socket says goodbye, so the host knows at once.
  await bo.page.close();
  const closed = await timed('closed page shown away', () =>
    expect(boSeat).toHaveAttribute('data-away', 'true'),
  );
  expect(closed).toBeLessThan(2_000);
  await expect(boSeat).toContainText('away');

  // Bo opens the game from the home screen, as an installed app would, and is back in his seat.
  bo.page = await bo.context.newPage();
  await bo.page.goto('/');
  await bo.page.getByRole('link', { name: 'Back to your game' }).click();
  await timed('reopened page back in its seat', () =>
    expect(bo.page.locator('.rack .tile')).toHaveCount(14),
  );
  expect(await bo.page.locator('.rack .tile').allTextContents()).toEqual(rack);
  await expect(boSeat).not.toHaveAttribute('data-away');

  // Offline, Bo's socket goes quiet without closing. His own page notices within a pong's
  // wait; the others only once the host's sweep does.
  await bo.context.setOffline(true);
  await timed('offline page says Reconnecting', () =>
    expect(bo.page.getByText('Reconnecting…')).toBeVisible({ timeout: 40_000 }),
  );
  const offline = await timed('offline device shown away to the others', () =>
    expect(boSeat).toHaveAttribute('data-away', 'true', { timeout: 90_000 }),
  );
  expect(offline).toBeLessThan(80_000);

  await bo.context.setOffline(false);
  await timed('back online, back in its seat for the others', () =>
    expect(boSeat).not.toHaveAttribute('data-away', { timeout: 15_000 }),
  );
  await expect(bo.page.getByText('Reconnecting…')).toBeHidden();
  await expect(bo.page.locator('.rack .tile')).toHaveCount(14);
});
