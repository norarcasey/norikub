import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BAKED_IN, RESOURCES, SWIFT_SOURCES, infoPlist, sourceHash } from './bundle.ts';
import type { Digester } from './bundle.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

function digester(): Digester {
  const hash = createHash('sha256');
  return { update: (chunk) => void hash.update(chunk), hex: () => hash.digest('hex') };
}

const plan = { root: '/r', sourceHash: 'abc', commit: '1234567', builtAt: '24 Sep', icon: true };

describe('what the bundle is built from', () => {
  it('stamps every file in apps/mac/shell and compiles every Swift file it stamps', () => {
    // Closed both ways: a file that exists and is not listed would be compiled in by nobody
    // or, worse, hand-added to swiftc and never hashed.
    const onDisk = readdirSync(join(root, 'apps/mac/shell')).map(
      (name) => `apps/mac/shell/${name}`,
    );
    expect(BAKED_IN.filter((p) => p.startsWith('apps/mac/shell/'))).toEqual([...onDisk].sort());
    expect(SWIFT_SOURCES).toContain('apps/mac/shell/main.swift');
    expect(SWIFT_SOURCES.every((p) => p.endsWith('.swift'))).toBe(true);
    expect(RESOURCES).toEqual([
      'apps/mac/shell/notify.js',
      'apps/mac/shell/open.js',
      'apps/mac/shell/print.js',
    ]);
  });

  it('changes the hash when a byte moves from one file to the next', () => {
    const files = (a: string, b: string) =>
      BAKED_IN.map((path, i) => ({
        path,
        bytes: new TextEncoder().encode(i === 0 ? a : i === 1 ? b : 'x'),
      }));
    expect(sourceHash(files('ab', 'c'), digester())).not.toBe(
      sourceHash(files('a', 'bc'), digester()),
    );
  });

  it('refuses a set that is not exactly what is stamped', () => {
    const some = BAKED_IN.slice(1).map((path) => ({ path, bytes: new Uint8Array() }));
    expect(() => sourceHash(some, digester())).toThrow(/expected/);
  });
});

describe('Info.plist', () => {
  it('exempts loopback from App Transport Security and nothing else', () => {
    const plist = infoPlist(plan);
    const exempt = [
      ...plist.matchAll(/<key>([^<]+)<\/key><dict><key>NSExceptionAllowsInsecure/g),
    ].map((m) => m[1]);
    expect(exempt).toEqual(['127.0.0.1', 'localhost']);
    expect(plist).not.toContain('NSAllowsArbitraryLoads');
  });

  it('declares no app-bound domains, which are inert on macOS', () => {
    expect(infoPlist(plan)).not.toContain('WKAppBoundDomains');
  });

  it('carries the stamp Provenance.swift reads, under the keys it reads', () => {
    const plist = infoPlist(plan);
    const swift = read('apps/mac/shell/Provenance.swift');
    for (const key of [
      'ShellSourceRoot',
      'ShellSourceHash',
      'ShellSourceFiles',
      'ShellBuiltFromCommit',
      'ShellBuiltAt',
    ]) {
      expect(plist).toContain(`<key>${key}</key>`);
      expect(swift).toContain(`"${key}"`);
    }
    for (const path of BAKED_IN) expect(plist).toContain(`<string>${path}</string>`);
  });

  it('names an icon only when one was rendered', () => {
    expect(infoPlist(plan)).toContain('CFBundleIconFile');
    expect(infoPlist({ ...plan, icon: false })).not.toContain('CFBundleIconFile');
  });

  it('escapes what it is given', () => {
    expect(infoPlist({ ...plan, root: '/a&b<c' })).toContain('/a&amp;b&lt;c');
  });
});

describe('what the shell says', () => {
  it('says it through log(), so it lands in the file a Dock launch keeps', () => {
    // A line written straight to stderr is thrown away by every launch but a terminal's, which
    // is how "are notifications working?" had no answer on disk (LIN-53). main.swift is the one
    // exception: a bad --url is typed in a terminal, and the process exits before the log's
    // queue would write it.
    const writers = /standardError|\bprint\(|NSLog\(/;
    const shell = read('apps/mac/shell/Shell.swift');
    for (const path of SWIFT_SOURCES.filter(
      (p) => !p.endsWith('/Shell.swift') && !p.endsWith('/main.swift'),
    )) {
      expect(read(path), path).not.toMatch(writers);
    }
    expect(shell).toContain('appendingPathComponent("Library/Logs/\\(App.name).log")');
    expect(shell).toMatch(/^func log\(_ line: String\) \{ Log\.write\(line\) \}$/m);
  });
});

describe('the seam between the page and the shell', () => {
  const swift = read('apps/mac/shell/Notify.swift');
  const script = read('apps/mac/shell/notify.js');

  it('uses one channel name and one namespace on both sides', () => {
    const channel = /static let channel = "([^"]+)"/.exec(swift)?.[1];
    const namespace = /static let namespace = "([^"]+)"/.exec(swift)?.[1];
    expect(channel).toBeDefined();
    expect(namespace).toBeDefined();
    expect(script).toContain(`var CHANNEL = '${String(channel)}';`);
    expect(script).toContain(`var NAMESPACE = '${String(namespace)}';`);
  });

  it('sends nothing back into the page but integers and the three permission words', () => {
    // Every call the shell makes into the page's JavaScript, and what is interpolated into
    // each. A title, a body or a tag in this list would be page text becoming code.
    const calls = [...swift.matchAll(/tell\("([^"]*)"\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    const interpolated = new Set(
      calls.flatMap((call) => [...(call ?? '').matchAll(/\\\(([^)]*)\)/g)].map((m) => m[1])),
    );
    expect([...interpolated].sort()).toEqual(['handle', 'state']);
    // `state` is only ever one of the words `word(_:)` returns, or a literal.
    expect(swift).toMatch(/private static func word\(_ status: UNAuthorizationStatus\) -> String/);
  });
});

describe('printing', () => {
  const swift = read('apps/mac/shell/Print.swift');
  const script = read('apps/mac/shell/print.js');
  const shell = read('apps/mac/shell/Shell.swift');

  it('uses one channel name and one namespace on both sides', () => {
    const channel = /static let channel = "([^"]+)"/.exec(swift)?.[1];
    const namespace = /static let namespace = "([^"]+)"/.exec(swift)?.[1];
    expect(channel).toBe('shellPrint');
    expect(namespace).toBe('__shellPrint');
    expect(script).toContain(`var CHANNEL = '${String(channel)}';`);
    expect(script).toContain(`var NAMESPACE = '${String(namespace)}';`);
  });

  it('injects print.js and hears the page on its channel before the web view exists', () => {
    // A handler added to a configuration already in use is not seen by the page.
    const registered = shell.indexOf('add(PrintRelay(self), name: Printing.channel)');
    expect(shell).toContain('Self.resource("print", "js")');
    expect(registered).toBeGreaterThan(0);
    expect(registered).toBeLessThan(
      shell.indexOf('WKWebView(frame: frame, configuration: config)'),
    );
  });

  it('calls into the page for the rule alone, with nothing interpolated but the namespace', () => {
    const calls = [...swift.matchAll(/evaluateJavaScript\("([^"]*)"\)/g)].map((m) => m[1]);
    expect(calls).toEqual(['\\(namespace)?.page()']);
  });

  it('prints as a sheet, never with run(), which hung the probe', () => {
    expect(swift).toContain('runModal(for: window');
    expect(swift).not.toMatch(/\.run\(\)/);
  });

  it('puts File > Print on ⌘P, onto the same path as the page', () => {
    expect(read('apps/mac/shell/Menus.swift')).toContain(
      'item(file, "Print…", #selector(Shell.printPage), "p", shell)',
    );
    expect(swift).toContain('shell?.printPage()');
  });
});

describe('opening a blob link as a file (LIN/LIN-89)', () => {
  const swift = read('apps/mac/shell/Open.swift');
  const script = read('apps/mac/shell/open.js');
  const shell = read('apps/mac/shell/Shell.swift');
  const boundary = read('apps/mac/shell/Boundary.swift');

  it('uses one namespace on both sides', () => {
    const namespace = /static let namespace = "([^"]+)"/.exec(swift)?.[1];
    expect(namespace).toBe('__shellOpen');
    expect(script).toContain(`var NAMESPACE = '${String(namespace)}';`);
  });

  it('injects open.js into the page', () => {
    expect(shell).toContain('Self.resource("open", "js")');
  });

  it('passes the URL to the page as an argument, never inside the source', () => {
    const calls = [...swift.matchAll(/callAsyncJavaScript\("([^"]*)"/g)].map((m) => m[1]);
    expect(calls).toEqual(['return await globalThis.\\(namespace)?.read(url) ?? null']);
    expect(swift).toContain('arguments: ["url": url.absoluteString]');
  });

  it('never hands a blob URL to NSWorkspace, from a new-window link or the window itself', () => {
    // A blob URL lives only in the web view: macOS has no app for the scheme.
    expect(boundary.match(/url\.scheme == "blob"/g)).toHaveLength(2);
    expect(boundary.match(/Opening\.run\(url, from: web\)/g)).toHaveLength(2);
  });
});
