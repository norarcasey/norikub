import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

import { parse } from '../packages/core/src/parse.ts';
import { PONG, tableMessageSchema } from '../packages/core/src/protocol.ts';

/**
 * Three friends at one table, each in a browser of their own (KUB-34's "done when"): one
 * starts a table from the bot game, the others open its link and sit down by name, the first
 * deals, and they play the game to its end through the screen. Every frame each page is sent
 * is kept and read afterwards for anything of another seat's rack or the pool (invariant 2),
 * and the mover reloads part-way through a reworked turn and finds it as it was (invariant 3).
 */

type Friend = { readonly name: string; readonly page: Page; readonly frames: string[] };

async function friend(browser: Browser, name: string): Promise<Friend> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    // The table's socket, not the dev server's own (Vite's hot reload has one too).
    if (!new URL(ws.url()).pathname.startsWith('/tables/')) return;
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') frames.push(frame.payload);
    });
  });
  return { name, page, frames };
}

async function sitDown({ page, name }: Friend): Promise<void> {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Sit down' }).click();
  await expect(page.getByRole('list', { name: 'Seated' })).toContainText(`${name} (you)`);
}

/** The friend whose turn it is, once their screen offers the turn; a playback is skipped. */
async function mover(friends: readonly Friend[]): Promise<Friend | null> {
  for (let tries = 0; tries < 100; tries++) {
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

/** The tile ids the rack on screen holds. */
async function rackIds(page: Page): Promise<string[]> {
  const tiles = await page.locator('.rack .tile').all();
  const ids = await Promise.all(tiles.map((tile) => tile.getAttribute('data-tile')));
  return ids.flatMap((id) => (id === null ? [] : [id]));
}

test('three friends play a game at one table', async ({ browser }) => {
  test.setTimeout(240_000);
  const ana = await friend(browser, 'Ana');
  const bo = await friend(browser, 'Bo');
  const cy = await friend(browser, 'Cy');
  const all = [ana, bo, cy];

  // Ana starts a table from the bot game; its address is the link she sends.
  await ana.page.goto('/');
  await ana.page.getByRole('link', { name: 'Play friends' }).click();
  await expect(ana.page).toHaveURL(/\/t\/[a-z0-9]{12}$/);
  const link = ana.page.url();
  await sitDown(ana);
  await expect(ana.page.getByRole('button', { name: 'Deal' })).toBeDisabled();
  for (const f of [bo, cy]) {
    await f.page.goto(link);
    await sitDown(f);
  }
  await expect(cy.page.getByRole('status')).toHaveText('Waiting for Ana to deal.');
  await expect(ana.page.getByRole('list', { name: 'Seated' })).toContainText('Cy');
  await ana.page.getByRole('button', { name: 'Deal' }).click();
  for (const f of all) await expect(f.page.locator('.rack .tile')).toHaveCount(14);

  // The first mover reworks the table; the others watch it happen, and a reload keeps it.
  const first = await mover(all);
  if (first === null) throw new Error('the game ended before it began');
  const watchers = all.filter((f) => f !== first);
  const [tile] = await rackIds(first.page);
  if (tile === undefined) throw new Error('an empty rack');
  await first.page.locator(`.rack [data-tile="${tile}"]`).click();
  await first.page.getByText('New set').click();
  for (const w of watchers) {
    await expect(w.page.locator(`.table [data-tile="${tile}"]`)).toBeVisible();
    await expect(w.page.getByRole('status')).toHaveText(`${first.name} is playing.`);
  }
  await first.page.reload();
  await expect(first.page.locator(`.table [data-tile="${tile}"]`)).toBeVisible();
  await expect(first.page.locator(`.rack [data-tile="${tile}"]`)).toHaveCount(0);
  await expect(first.page.locator('.rack .tile')).toHaveCount(13);

  // Ending a turn with a lone tile on the table is refused by the host, as by the bots.
  await first.page.getByRole('button', { name: 'End turn' }).click();
  await expect(first.page.getByRole('status')).toContainText('is not a run or a group yet');
  await first.page.getByRole('button', { name: 'Take back' }).click();
  await expect(first.page.locator(`.rack [data-tile="${tile}"]`)).toBeVisible();
  for (const w of watchers)
    await expect(w.page.locator(`.table [data-tile="${tile}"]`)).toHaveCount(0);

  // Then everyone draws until the pool is gone and passes until the game ends on the lowest
  // rack: a whole game, every turn through the screen.
  let turns = 0;
  for (let f = await mover(all); f !== null; f = await mover(all)) {
    const pass = f.page.getByRole('button', { name: 'Pass' });
    if (await pass.isVisible()) await pass.click();
    else await f.page.locator('.pool .face-down').last().click();
    await expect(f.page.getByRole('button', { name: 'End turn' })).toBeHidden();
    turns++;
  }
  expect(turns).toBeGreaterThanOrEqual(106 - 3 * 14 + 3);
  for (const f of all) {
    await expect(f.page.getByRole('region', { name: 'Scores' })).toBeVisible();
    await expect(f.page.getByRole('region', { name: 'Scores' })).toContainText('won.');
  }
  await expect(bo.page.getByRole('region', { name: 'Scores' })).toContainText(
    'Waiting for Ana to deal again.',
  );
  await expect(bo.page.getByRole('button', { name: 'Deal again' })).toHaveCount(0);

  // Invariant 2, at the wire: every tile a frame names is in that seat's own rack or on the
  // table, in that same frame, and nothing else of the game reaches a page. In this game no
  // tile ever went from one rack to another, so the racks each page was shown never overlap.
  const racks = new Map<Friend, Set<string>>();
  for (const f of all) {
    const held = new Set<string>();
    racks.set(f, held);
    let views = 0;
    for (const raw of f.frames) {
      if (raw === PONG) continue;
      const message = parse(tableMessageSchema, JSON.parse(raw));
      if (!message.ok) throw new Error(`${f.name} was sent a frame that is not a message: ${raw}`);
      if (message.value.type !== 'view' || message.value.table.phase !== 'playing') continue;
      views++;
      const { view } = message.value.table;
      for (const t of view.rack) held.add(t.id);
      const seen = new Set(
        [...view.rack, ...view.table.flat(), ...(view.turn?.began.flat() ?? [])].map((t) => t.id),
      );
      const named = [...raw.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
      expect(
        named.filter((id) => id === undefined || !seen.has(id)),
        `${f.name}: ${raw}`,
      ).toEqual([]);
      expect(raw).not.toMatch(/"(pool|players|token)"/);
    }
    expect(views).toBeGreaterThan(turns);
  }
  for (const a of all) {
    for (const b of all) {
      if (a === b) continue;
      const theirs = racks.get(b) ?? new Set();
      const shared = [...(racks.get(a) ?? [])].filter((id) => theirs.has(id));
      expect(shared, `${a.name} and ${b.name} were both shown`).toEqual([]);
    }
  }

  // The first seat deals the next game for the same three, and every rack is laid out afresh.
  await ana.page.getByRole('button', { name: 'Deal again' }).click();
  for (const f of all) {
    await expect(f.page.getByRole('region', { name: 'Scores' })).toBeHidden();
    await expect(f.page.locator('.rack .tile')).toHaveCount(14);
  }
});
