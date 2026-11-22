import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `open.js` against a fake page, run as a classic script with a supplied `globalThis`, as
 * WebKit runs it (`LIN/LIN-89`). What matters is that the bytes come back whole and the name is the
 * one the page shows: a wrong name opens the file in the wrong app, or in none.
 */
const SOURCE = readFileSync(join(import.meta.dirname, '..', 'shell', 'open.js'), 'utf8');

type Link = {
  href: string;
  getAttribute: (name: string) => string | null;
  querySelector: (selector: string) => { getAttribute: (name: string) => string | null } | null;
  textContent: string;
};

function link(
  href: string,
  options: { download?: string; alt?: string; text?: string } = {},
): Link {
  return {
    href,
    getAttribute: (name) => (name === 'download' ? (options.download ?? null) : null),
    querySelector: () =>
      options.alt === undefined
        ? null
        : { getAttribute: (name) => (name === 'alt' ? (options.alt ?? null) : null) },
    textContent: options.text ?? '',
  };
}

function page(links: Link[], files: Record<string, Blob>) {
  const fetched: string[] = [];
  let next = 0;
  // The engine's own URL statics, which open.js wraps. The engine keeps no bytes here: what
  // read() returns can only have come from open.js keeping the Blob, or from fetch.
  const engine = {
    createObjectURL: (): string => `blob:http://localhost:5173/made-${String(++next)}`,
    revokeObjectURL: (): void => undefined,
  };
  const world: Record<string, unknown> = {
    btoa,
    Blob,
    URL: engine,
    document: { querySelectorAll: () => links },
    fetch: (url: string) => {
      fetched.push(url);
      const blob = files[url];
      if (blob === undefined) return Promise.reject(new Error('revoked'));
      return Promise.resolve({ blob: () => Promise.resolve(blob) });
    },
  };
  // The shipped file, with a parameter NAMED globalThis shadowing node's own.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('globalThis', SOURCE)(world);
  const read = (url: string): Promise<unknown> => {
    const target: unknown = world.__shellOpen;
    if (typeof target !== 'object' || target === null) throw new Error('no __shellOpen');
    const fn: unknown = Reflect.get(target, 'read');
    if (typeof fn !== 'function') throw new Error('no read');
    const answer: unknown = Reflect.apply(fn, target, [url]);
    if (!(answer instanceof Promise)) throw new Error('read did not answer with a promise');
    return answer;
  };
  /** What the page's own code does: `URL.createObjectURL` and `revokeObjectURL`, as wrapped. */
  const make = (object: unknown): string =>
    String(Reflect.apply(engine.createObjectURL, engine, [object]));
  const revoke = (url: string): void => void Reflect.apply(engine.revokeObjectURL, engine, [url]);
  return { read, fetched, make, revoke };
}

const MD = 'blob:http://localhost:5173/10e51e47';
const PNG = 'blob:http://localhost:5173/7d4d85d2';

describe('reading a blob link for the shell', () => {
  it('returns the bytes whole, in base64, with the type and the name the link shows', async () => {
    const text = '# Notes\n\nA file the page made for itself.\n';
    const { read } = page([link(MD, { text: ' notes.md ' })], {
      [MD]: new Blob([text], { type: 'text/markdown' }),
    });
    const answer = await read(MD);
    expect(answer).toEqual({
      name: 'notes.md',
      type: 'text/markdown',
      data: Buffer.from(text, 'utf8').toString('base64'),
    });
  });

  it('carries every byte value through a file larger than one slice', async () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 256);
    const { read } = page([link(PNG, { alt: 'shot.png' })], {
      [PNG]: new Blob([bytes], { type: 'image/png' }),
    });
    const answer = await read(PNG);
    if (typeof answer !== 'object' || answer === null) throw new Error('no answer');
    const data: unknown = Reflect.get(answer, 'data');
    expect(Buffer.from(String(data), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });

  it('takes the name from download, then the image alt, then the text', async () => {
    const files = { [MD]: new Blob(['x']) };
    const named = async (l: Link): Promise<unknown> => {
      const answer = await page([l], files).read(MD);
      return typeof answer === 'object' && answer !== null ? Reflect.get(answer, 'name') : null;
    };
    expect(await named(link(MD, { download: 'a.md', alt: 'b.png', text: 'c' }))).toBe('a.md');
    expect(await named(link(MD, { alt: 'b.png', text: 'c' }))).toBe('b.png');
    expect(await named(link(MD, { text: 'c' }))).toBe('c');
    // No link on the page with that address: no name, and the shell names it from the type.
    expect(await named(link('blob:elsewhere', { text: 'c' }))).toBe('');
  });

  it('reads a blob the page made from the Blob itself, never by fetch, which a CSP refuses', async () => {
    // Measured (16 Nov 2026): under Linora's policy, fetch of a blob: URL in the window fails
    // with "TypeError: Load failed". Here fetch fails for every URL, as it does there.
    const { read, fetched, make } = page([], {});
    const url = make(new Blob(['# notes'], { type: 'text/markdown' }));
    expect(await read(url)).toEqual({
      name: '',
      type: 'text/markdown',
      data: Buffer.from('# notes').toString('base64'),
    });
    expect(fetched).toEqual([]);
  });

  it('forgets a blob once the page revokes its URL, and keeps nothing that is not a Blob', async () => {
    const { read, fetched, make, revoke } = page([], {});
    const url = make(new Blob(['x']));
    revoke(url);
    await expect(read(url)).rejects.toThrow('revoked');
    // A MediaSource has a URL and no bytes: it goes the old way, and fails there.
    const media = make({ kind: 'MediaSource' });
    await expect(read(media)).rejects.toThrow('revoked');
    expect(fetched).toEqual([url, media]);
  });

  it('reads nothing that is not a blob URL', async () => {
    const { read, fetched } = page([], {});
    expect(await read('https://example.com/file.md')).toBeNull();
    expect(fetched).toEqual([]);
  });

  it('fails, rather than answering, for a blob the page has revoked', async () => {
    const { read } = page([], {});
    await expect(read(MD)).rejects.toThrow('revoked');
  });
});
