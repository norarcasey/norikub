import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * A player who is away on their turn (KUB-37, Nora's choice): three friends through
 * `wrangler dev`; whoever is to play closes their page, and once they have been away a minute
 * the other two are asked "Draw a tile for <name>?". The draw is made only when both have said
 * yes, and the player who left comes back to one tile more and the turn gone on.
 *
 * Slow by design, like the presence test: the question opens at the host's first sweep after
 * the minute, so 60–75 s after the page closed.
 */

type Friend = { readonly name: string; readonly context: BrowserContext; page: Page };

async function friend(browser: Browser, name: string): Promise<Friend> {
  const context = await browser.newContext();
  return { name, context, page: await context.newPage() };
}

async function sitDown({ page, name }: Friend): Promise<void> {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Sit down' }).click();
  await expect(page.getByRole('list', { name: 'Seated' })).toContainText(`${name} (you)`);
}

/** The friend whose screen offers the turn. */
async function mover(friends: readonly Friend[]): Promise<Friend> {
  for (let tries = 0; tries < 100; tries++) {
    for (const f of friends) {
      if (await f.page.getByRole('button', { name: 'End turn' }).isVisible()) return f;
    }
    await friends[0]?.page.waitForTimeout(100);
  }
  throw new Error('nobody was offered a turn');
}

test('the others draw for a player who is away on their turn, once all of them agree', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const all = [
    await friend(browser, 'Ana'),
    await friend(browser, 'Bo'),
    await friend(browser, 'Cy'),
  ];
  const [ana] = all;
  if (ana === undefined) throw new Error('no Ana');

  await ana.page.goto('/');
  await ana.page.getByRole('link', { name: 'Play friends' }).click();
  const link = ana.page.url();
  await sitDown(ana);
  for (const f of all.slice(1)) {
    await f.page.goto(link);
    await sitDown(f);
  }
  await expect(ana.page.getByRole('list', { name: 'Seated' })).toContainText('Cy');
  await ana.page.getByRole('button', { name: 'Deal' }).click();
  for (const f of all) await expect(f.page.locator('.rack .tile')).toHaveCount(14);

  const away = await mover(all);
  const [first, second] = all.filter((f) => f !== away);
  if (first === undefined || second === undefined) throw new Error('no one left to ask');
  await away.page.close();

  const question = `Draw a tile for ${away.name}?`;
  const start = Date.now();
  await expect(first.page.getByRole('alertdialog', { name: question })).toBeVisible({
    timeout: 90_000,
  });
  const waited = Date.now() - start;
  test.info().annotations.push({ type: 'measured', description: `question opened: ${waited} ms` });
  expect(waited).toBeGreaterThanOrEqual(59_000);
  await expect(second.page.getByRole('alertdialog', { name: question })).toBeVisible();

  // One yes is not enough: the draw waits for the other.
  await first.page.getByRole('button', { name: `Draw for ${away.name}` }).click();
  await expect(first.page.getByRole('alertdialog')).toContainText(
    `Waiting for ${second.name} to agree.`,
  );
  await second.page.getByRole('button', { name: `Draw for ${away.name}` }).click();
  for (const f of [first, second]) {
    await expect(f.page.getByRole('alertdialog')).toBeHidden();
  }

  // The player who left comes back to one tile more, and it is not their turn now.
  away.page = await away.context.newPage();
  await away.page.goto('/');
  await away.page.getByRole('link', { name: 'Back to your game' }).click();
  await expect(away.page.locator('.rack .tile')).toHaveCount(15);
  await expect(away.page.getByRole('button', { name: 'End turn' })).toBeHidden();
});
