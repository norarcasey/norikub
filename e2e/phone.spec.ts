import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

/**
 * Nothing runs off a phone's screen (KUB-45): the game bar, the side menu and the panels over
 * the table, upright at 360 and 320 wide and on its side, against three bots and at a friends'
 * table of four with names as long as a name may be. Measured 22 Nov 2026 before the fix: the
 * bots' screens all fit since the menu (KUB-50), and a friends' table ran its bar to 661px on a
 * 360px screen, so the whole game scrolled sideways.
 */

/**
 * In the page, every element that reaches past either edge of the screen or hides content it
 * scrolls sideways, once the side menu or a panel has come to rest from its slide. A string,
 * not a function: the root tsconfig, which this file is checked under, has no DOM library, and
 * giving it one would let `api/` and `scripts/` use the DOM unnoticed.
 */
const OFF_SCREEN = `Promise.all(document.getAnimations().map((a) => a.finished)).then(() => {
  const width = window.innerWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect();
    // A visually hidden label is 1px and clipped on purpose.
    if (box.width <= 1 || box.height <= 1) continue;
    const what = el.tagName.toLowerCase() + '.' + el.className;
    if (box.left < -0.5 || box.right > width + 0.5)
      out.push(what + ' spans ' + Math.round(box.left) + '..' + Math.round(box.right));
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
      out.push(what + ' scrolls sideways, ' + el.scrollWidth + ' in ' + el.clientWidth);
  }
  return out;
})`;

async function offScreen(page: Page): Promise<readonly string[]> {
  const found = await page.evaluate<unknown>(OFF_SCREEN);
  if (!Array.isArray(found)) throw new Error('the page answered something that is not a list');
  return found.map(String);
}

async function phone(browser: Browser, width: number, height: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
  });
  return context.newPage();
}

for (const [width, height] of [
  [360, 740],
  [320, 568],
  [740, 360],
] as const) {
  test(`against three bots at ${width}x${height}, nothing runs off the screen`, async ({
    browser,
  }) => {
    const page = await phone(browser, width, height);
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up a game' }).click();
    const picks = page.getByRole('checkbox', { checked: false, disabled: false });
    while ((await page.getByRole('checkbox', { checked: true }).count()) < 3)
      await picks.first().check({ force: true });
    expect(await offScreen(page)).toEqual([]);
    await page.getByRole('button', { name: 'Deal', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Opponents' }).getByRole('listitem')).toHaveCount(
      3,
    );
    expect(await offScreen(page)).toEqual([]);

    await page.getByRole('button', { name: /menu/i }).click();
    expect(await offScreen(page)).toEqual([]);
    await page.getByRole('button', { name: 'New game' }).click();
    expect(await offScreen(page)).toEqual([]);
    // The panel is taller than the screen; its foot, with Play friends, is reached by scrolling.
    const friends = page.getByRole('dialog', { name: 'New game' }).getByRole('link', {
      name: 'Play friends',
    });
    await friends.scrollIntoViewIfNeeded();
    await expect(friends).toBeInViewport();
    expect(await offScreen(page)).toEqual([]);
  });
}

test('at a friends’ table of four long names on a phone, nothing runs off the screen', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  // 23 and 22 letters: a display name is at most 24.
  const names = [
    'Annabel Wilhelmina Grey',
    'Bartholomew Fitzgerald',
    'Cyrillia Montgomery',
    'Desdemona Featherstone',
  ];
  const pages = await Promise.all(names.map(() => phone(browser, 360, 740)));
  const [first] = pages;
  if (first === undefined) throw new Error('no first friend');
  await first.goto('/');
  await first.getByRole('link', { name: 'Play friends' }).click();
  await expect(first).toHaveURL(/\/t\/[a-z0-9]{12}$/);
  const link = first.url();
  for (const [i, page] of pages.entries()) {
    if (i > 0) await page.goto(link);
    await page.getByLabel('Your name').fill(names[i] ?? '');
    await page.getByRole('button', { name: 'Sit down' }).click();
    await expect(page.getByRole('list', { name: 'Seated' })).toContainText(`${names[i]} (you)`);
  }
  expect(await offScreen(first)).toEqual([]);
  await first.getByRole('button', { name: 'Deal' }).click();
  for (const page of pages) {
    await expect(page.getByRole('list', { name: 'Opponents' }).getByRole('listitem')).toHaveCount(
      3,
    );
    expect(await offScreen(page)).toEqual([]);
  }
});
