import { describe, expect, it } from 'vitest';

import { gameServer, tableJoinUrl, tableSocketUrl } from './gameServer.ts';

describe('gameServer', () => {
  it('uses the address the build was given', () => {
    expect(
      gameServer({ VITE_GAME_SERVER: 'https://norikub-game.example.workers.dev', DEV: false })
        ?.href,
    ).toBe('https://norikub-game.example.workers.dev/');
  });

  it("falls back to wrangler dev's port in dev, and to none in production", () => {
    expect(gameServer({ DEV: true })?.href).toBe('http://localhost:8787/');
    expect(gameServer({ VITE_GAME_SERVER: '', DEV: false })).toBeNull();
    expect(gameServer({ DEV: false })).toBeNull();
  });

  it('refuses an address that is not one, rather than guessing', () => {
    expect(gameServer({ VITE_GAME_SERVER: 'not a url', DEV: true })).toBeNull();
  });
});

describe('table URLs', () => {
  it('joins by POST to the table and opens its socket with the token', () => {
    const server = new URL('https://host.example');
    expect(tableJoinUrl(server, 'abc123').href).toBe('https://host.example/tables/abc123/join');
    expect(tableSocketUrl(server, 'abc123', 't-1').href).toBe(
      'wss://host.example/tables/abc123/socket?token=t-1',
    );
    expect(tableSocketUrl(new URL('http://localhost:8787'), 'abc123', 't-1').protocol).toBe('ws:');
  });
});
