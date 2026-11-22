import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `print.js` against a fake page, run as a classic script with a supplied `globalThis`, as
 * WebKit runs it.
 *
 * The failure worth hunting is a rule read wrong, not a rule unread: a sheet read as portrait
 * prints a landscape page with its right side cut off, which is what the shell did before it read
 * the rule at all. So every case asserts the points, and a case it cannot read must come back
 * null rather than as a plausible sheet.
 */
const SOURCE = readFileSync(join(import.meta.dirname, '..', 'shell', 'print.js'), 'utf8');

type Style = Record<string, string>;
type Rule =
  | { type: 6; selectorText: string; style: { getPropertyValue: (name: string) => string } }
  | { type: 4; media: { mediaText: string }; cssRules: Rule[] }
  | { type: 12; cssRules: Rule[] }
  | { type: 1 };
type Sheet = { media: { mediaText: string }; disabled?: boolean; cssRules?: Rule[] };

const pageRule = (style: Style, selectorText = ''): Rule => ({
  type: 6,
  selectorText,
  style: { getPropertyValue: (name) => style[name] ?? '' },
});
const media = (mediaText: string, ...cssRules: Rule[]): Rule => ({
  type: 4,
  media: { mediaText },
  cssRules,
});
const sheet = (...cssRules: Rule[]): Sheet => ({ media: { mediaText: '' }, cssRules });

/** `@page { size: letter landscape; margin: 0 }` as WebKit serialises it, read by Bingora's probe (`BINGO-7`). */
const LANDSCAPE_EDGE_TO_EDGE = {
  size: 'letter landscape',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
};

function run(sheets: Sheet[], options: { bridge?: boolean } = {}) {
  const posted: unknown[] = [];
  const enginePrint = () => 'engine';
  const world: Record<string, unknown> = {
    print: enginePrint,
    document: { styleSheets: sheets },
  };
  if (options.bridge !== false) {
    world.webkit = {
      messageHandlers: { shellPrint: { postMessage: (m: unknown) => posted.push(m) } },
    };
  }
  // The shipped file, with a parameter NAMED globalThis shadowing node's own.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('globalThis', SOURCE)(world);
  const page = (): unknown => {
    const target: unknown = world.__shellPrint;
    if (typeof target !== 'object' || target === null) throw new Error('no __shellPrint');
    const fn: unknown = Reflect.get(target, 'page');
    if (typeof fn !== 'function') throw new Error('no page');
    return Reflect.apply(fn, target, []);
  };
  return { posted, world, enginePrint, page };
}

const zero = { top: 0, right: 0, bottom: 0, left: 0 };
const unsaid = { top: null, right: null, bottom: null, left: null };

describe('window.print', () => {
  it('is a message to the shell', () => {
    const { posted, world } = run([]);
    const print: unknown = world.print;
    if (typeof print !== 'function') throw new Error('no print');
    expect(print()).toBeUndefined();
    expect(posted).toEqual([{ kind: 'print' }]);
  });

  it('is left as the engine has it when the shell registered no channel', () => {
    const { world, enginePrint } = run([], { bridge: false });
    expect(world.print).toBe(enginePrint);
    expect(world.__shellPrint).toBeUndefined();
  });
});

describe("the page's @page rule", () => {
  it('reads landscape Letter, edge to edge', () => {
    const { page } = run([sheet(media('print', pageRule(LANDSCAPE_EDGE_TO_EDGE)))]);
    expect(page()).toEqual({ paper: { width: 612, height: 792 }, landscape: true, margins: zero });
  });

  it('reads nothing as nothing, so the printer keeps its own settings', () => {
    expect(run([sheet({ type: 1 })]).page()).toEqual({
      paper: null,
      landscape: null,
      margins: unsaid,
    });
  });

  it('skips screen-only rules, other media and a not query', () => {
    const { page } = run([
      sheet(
        media('screen', pageRule({ size: 'a4' })),
        media('not print', pageRule({ size: 'a5' })),
        media('screen, print', pageRule({ size: 'legal' })),
      ),
      { media: { mediaText: 'screen' }, cssRules: [pageRule({ size: 'a3' })] },
      { media: { mediaText: '' }, disabled: true, cssRules: [pageRule({ size: 'ledger' })] },
    ]);
    expect(page()).toMatchObject({ paper: { width: 612, height: 1008 }, landscape: null });
  });

  it('lets a later rule win, side by side', () => {
    const { page } = run([
      sheet(pageRule({ size: 'a4 portrait', 'margin-top': '1in', 'margin-left': '10mm' })),
      sheet(media('all', pageRule({ size: 'landscape', 'margin-top': '0' }))),
    ]);
    const read = page();
    expect(read).toMatchObject({
      paper: null,
      landscape: true,
      margins: { top: 0, right: null, bottom: null },
    });
    expect(Reflect.get(Reflect.get(Object(read), 'margins'), 'left')).toBeCloseTo(28.35, 2);
  });

  it('ignores a :first or :left rule, which is one sheet and not every sheet', () => {
    const { page } = run([sheet(pageRule({ size: 'a4' }, ':first'))]);
    expect(page()).toMatchObject({ paper: null });
  });

  it('looks inside @supports and @layer, which have rules and no media', () => {
    const { page } = run([sheet({ type: 12, cssRules: [pageRule({ size: 'a4' })] })]);
    expect(page()).toMatchObject({ paper: { width: 595.28, height: 841.89 }, landscape: null });
  });

  it('reads lengths as the sheet as read, orientation included', () => {
    const size = (text: string): unknown => run([sheet(pageRule({ size: text }))]).page();
    expect(size('11in 8.5in')).toMatchObject({
      paper: { width: 612, height: 792 },
      landscape: true,
    });
    expect(size('8.5in 11in')).toMatchObject({
      paper: { width: 612, height: 792 },
      landscape: false,
    });
    expect(size('816px 1056px')).toMatchObject({ paper: { width: 612, height: 792 } });
    expect(size('100mm')).toMatchObject({
      paper: { width: expect.closeTo(283.46, 2), height: expect.closeTo(283.46, 2) },
    });
  });

  it('refuses what it cannot read rather than guessing a sheet', () => {
    for (const text of [
      'auto',
      'letter a4',
      'landscape portrait',
      'letter 8.5in',
      '8.5in 11in landscape',
      '1in 2in 3in',
      '50%',
      '0 11in',
      'tabloid',
      '-8in 11in',
    ]) {
      expect(run([sheet(pageRule({ size: text }))]).page(), text).toMatchObject({
        paper: null,
        landscape: null,
      });
    }
  });

  it('leaves a margin it cannot read to the printer', () => {
    const { page } = run([
      sheet(pageRule({ 'margin-top': '5%', 'margin-left': 'auto', 'margin-right': '3' })),
    ]);
    expect(page()).toMatchObject({ margins: unsaid });
  });

  it("skips another origin's sheet, whose rules cannot be read", () => {
    const foreign = {
      media: { mediaText: '' },
      get cssRules(): Rule[] {
        throw new Error('SecurityError');
      },
    };
    const { page } = run([foreign, sheet(pageRule(LANDSCAPE_EDGE_TO_EDGE))]);
    expect(page()).toMatchObject({ paper: { width: 612, height: 792 }, landscape: true });
  });
});
