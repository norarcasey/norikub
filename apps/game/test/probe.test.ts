import { describe, expect, it } from 'vitest';

import { probeOrigin, siteDomains } from '../src/probe.ts';

describe('siteDomains', () => {
  it('checks the domains that serve production, and names the rest', () => {
    const domains = siteDomains({
      domains: [
        { name: 'norikub.crucinora.com', verified: true, redirect: null, gitBranch: null },
        { name: 'norikub.vercel.app', verified: true },
        { name: 'www.norikub.example', verified: true, redirect: 'norikub.crucinora.com' },
        { name: 'staging.norikub.example', verified: true, gitBranch: 'staging' },
        { name: 'preview.norikub.example', verified: true, customEnvironmentId: 'env_1' },
        { name: 'new.norikub.example', verified: false },
      ],
    });
    expect(domains).toEqual({
      serving: ['norikub.crucinora.com', 'norikub.vercel.app'],
      skipped: [
        'www.norikub.example',
        'staging.norikub.example',
        'preview.norikub.example',
        'new.norikub.example',
      ],
    });
  });

  it("refuses an answer that is not Vercel's list", () => {
    expect(siteDomains({ error: { code: 'forbidden' } })).toBeNull();
  });
});

describe('probeOrigin', () => {
  const server = new URL('https://game.example');
  const origin = 'https://norikub.crucinora.com';
  const allowed = { 'Access-Control-Allow-Origin': origin };
  const answering =
    (preflight: Response, join: Response): typeof fetch =>
    (_input, init) =>
      Promise.resolve(init?.method === 'OPTIONS' ? preflight : join);

  it('names a preflight the host refused, as the Worker did before KUB-47', async () => {
    const problem = await probeOrigin(
      server,
      origin,
      'abcd',
      answering(new Response('origin not allowed', { status: 403 }), new Response(null)),
    );
    expect(problem).toBe(`${origin}: the preflight answered 403, allowing no origin`);
  });

  it('names a join that did not reach a table', async () => {
    const problem = await probeOrigin(
      server,
      origin,
      'abcd',
      answering(
        new Response(null, { status: 204, headers: allowed }),
        new Response('not found', { status: 404, headers: allowed }),
      ),
    );
    expect(problem).toBe(
      `${origin}: the join answered 404 not found, not the table's refusal of a missing name`,
    );
  });

  it("names a table's answer the page could not read", async () => {
    const problem = await probeOrigin(
      server,
      origin,
      'abcd',
      answering(
        new Response(null, { status: 204, headers: allowed }),
        Response.json({ refused: 'not a name' }, { status: 400 }),
      ),
    );
    expect(problem).toBe(`${origin}: the join's answer does not allow ${origin} to read it`);
  });
});
