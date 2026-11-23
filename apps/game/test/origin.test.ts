import { describe, expect, it } from 'vitest';

import { corsHeaders, originAllowed } from '../src/origin.ts';

describe('originAllowed', () => {
  const sites = 'https://norikub.vercel.app, https://kub.example.com ,';

  it('allows each listed site, spaces and a trailing comma aside', () => {
    expect(originAllowed('https://norikub.vercel.app', sites)).toBe(true);
    expect(originAllowed('https://kub.example.com', sites)).toBe(true);
  });

  it('allows a page served from this machine on any port', () => {
    expect(originAllowed('http://localhost:5173', '')).toBe(true);
    expect(originAllowed('http://127.0.0.1:4173', '')).toBe(true);
    expect(originAllowed('http://localhost', '')).toBe(true);
  });

  it('refuses everything else, including near misses', () => {
    expect(originAllowed('https://evil.example', sites)).toBe(false);
    expect(originAllowed('https://norikub.vercel.app.evil.example', sites)).toBe(false);
    expect(originAllowed('http://norikub.vercel.app', sites)).toBe(false);
    expect(originAllowed('https://localhost:5173', '')).toBe(false);
    expect(originAllowed('http://localhost.evil.example', '')).toBe(false);
    expect(originAllowed('', sites)).toBe(false);
  });
});

describe('corsHeaders', () => {
  it('names the asking origin, never a wildcard', () => {
    const headers = corsHeaders('http://localhost:5173');
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(headers['Vary']).toBe('Origin');
  });
});
