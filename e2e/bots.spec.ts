import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

/**
 * Two friends and two bots at one table (KUB-36), each friend in a browser of their own: the
 * first seat adds the bots before the deal, and the game is played to its end through the
 * screen, the friends only drawing. The bots play on the host; each page sees their turns
 * played back as moves and draws, by name, then the turn come round to a friend again.
 */

type Friend = { readonly name: string; readonly page: Page };

async function friend(browser: Browser, name: string): Promise<Friend> {
  const context = await browser.newContext();
  return { name, page: await context.newPage() };
}

async function sitDown({ page, name }: Friend): Promise<void> {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Sit down' }).click();
  await expect(page.getByRole('list', { name: 'Seated' })).toContainText(`${name} (you)`);
}

/** The friend whose turn it is, once their screen offers it; a playback is skipped. */
async function mover(friends: readonly Friend[]): Promise<Friend | null> {
  for (let tries = 0; tries < 150; tries++) {
    for (const f of friends) {
      if (await f.page.getByRole('region', { name: 'Scores' }).isVisible()) return null;
      const skip = f.page.getByRole('button', { name: 'Skip' });
      if (await skip.isVisible()) await skip.click().catch(() => {});
      if (await f.page.getByRole('button', { name: 'End turn' }).isVisible()) return f;
    }
    await friends[0]?.page.waitForTimeout(100);
  }
  throw new Error('nobody was offered a turn');
}

async function drawOrPass({ page }: Friend): Promise<void> {
  const pass = page.getByRole('button', { name: 'Pass' });
  if (await pass.isVisible()) await pass.click();
  else await page.locator('.pool .face-down').last().click();
  await expect(page.getByRole('button', { name: 'End turn' })).toBeHidden();
}

test('two friends play a game with two bots', async ({ browser }) => {
  test.setTimeout(240_000);
  const ana = await friend(browser, 'Ana');
  const bo = await friend(browser, 'Bo');
  const all = [ana, bo];

  await ana.page.goto('/');
  await ana.page.getByRole('link', { name: 'Play friends' }).click();
  await expect(ana.page).toHaveURL(/\/t\/[a-z0-9]{12}$/);
  const link = ana.page.url();
  await sitDown(ana);
  await bo.page.goto(link);
  await sitDown(bo);

  // Only the first seat is offered the bots.
  await expect(bo.page.getByRole('group', { name: 'Add a bot' })).toHaveCount(0);
  const add = ana.page.getByRole('group', { name: 'Add a bot' });
  await add.getByRole('button', { name: 'Medium' }).click();
  await expect(ana.page.getByRole('list', { name: 'Seated' })).toContainText('Erik · medium bot');
  await add.getByRole('button', { name: 'Hard' }).click();
  const seated = bo.page.getByRole('list', { name: 'Seated' });
  await expect(seated).toContainText('Erik · medium bot');
  await expect(seated).toContainText('Michael · hard bot');
  // A full table offers no more bots, and a bot is never shown away.
  await expect(add).toHaveCount(0);
  await expect(seated).not.toContainText('away');

  await ana.page.getByRole('button', { name: 'Deal' }).click();
  for (const f of all) await expect(f.page.locator('.rack .tile')).toHaveCount(14);

  // The bots sit after Bo, so once Bo has drawn their turns are played back, by name, on Ana's
  // page before the turn comes round to her.
  let turns = 0;
  for (let f = await mover(all); f === ana; f = await mover(all)) {
    await drawOrPass(f);
    turns++;
  }
  await drawOrPass(bo);
  turns++;
  await expect(ana.page.getByRole('status')).toContainText(/Erik|Michael/, { timeout: 15_000 });

  // Then the friends draw until the game ends, the bots playing between them.
  for (let f = await mover(all); f !== null; f = await mover(all)) {
    await drawOrPass(f);
    turns++;
  }
  expect(turns).toBeGreaterThan(5);
  for (const f of all) {
    await expect(f.page.getByRole('region', { name: 'Scores' })).toBeVisible();
    await expect(f.page.getByRole('region', { name: 'Scores' })).toContainText('won.');
  }
});
