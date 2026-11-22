/**
 * accountOf against a real AuthClient, with fetch stubbed: what goes over the wire is the
 * decision (the code type, the sign-out scope), so that is what is pinned.
 */
import { AuthClient } from '@supabase/auth-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { accountOf } from './port.ts';

const URL_ = 'https://example.supabase.co/auth/v1';
const calls: { url: string; body: unknown }[] = [];
let reply: (url: string) => Response = () => json({});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const user = {
  id: '11111111-1111-1111-1111-111111111111',
  aud: 'authenticated',
  email: 'nora@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-11-22T00:00:00Z',
};
const session = {
  access_token: 'jwt',
  refresh_token: 'refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};

function client() {
  return new AuthClient({
    url: URL_,
    headers: { apikey: 'key', Authorization: 'Bearer key' },
    storageKey: `test.${Math.random()}`,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const raw = init?.body;
      calls.push({ url, body: typeof raw === 'string' ? JSON.parse(raw) : null });
      return Promise.resolve(reply(url));
    },
  });
}

beforeEach(() => {
  calls.length = 0;
  reply = () => json({});
  localStorage.clear();
});

describe('accountOf', () => {
  it('asks for a code for the address, with no redirect of its own', async () => {
    const result = await accountOf(client()).sendCode('nora@example.com');
    expect(result).toEqual({ ok: true });
    const call = calls.find((c) => c.url.startsWith(`${URL_}/otp`));
    expect(call?.body).toMatchObject({ email: 'nora@example.com', create_user: true });
    expect(call?.url).not.toContain('redirect_to');
  });

  it('says why a code was not sent', async () => {
    reply = () => json({ code: 429, msg: 'email rate limit exceeded' }, 429);
    const result = await accountOf(client()).sendCode('nora@example.com');
    expect(result).toEqual({ ok: false, message: 'email rate limit exceeded' });
  });

  it('verifies the code as type email, then knows who is signed in', async () => {
    reply = (url) => (url.startsWith(`${URL_}/verify`) ? json(session) : json(user));
    const account = accountOf(client());
    const seen = vi.fn();
    const stop = account.watch(seen);
    expect(await account.verifyCode('nora@example.com', '123456')).toEqual({ ok: true });
    const call = calls.find((c) => c.url.startsWith(`${URL_}/verify`));
    expect(call?.body).toMatchObject({
      email: 'nora@example.com',
      token: '123456',
      type: 'email',
    });
    expect(await account.current()).toBe('nora@example.com');
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('nora@example.com'));
    stop();
  });

  it('signs out of this site only, never every session the shared account has', async () => {
    reply = (url) => (url.startsWith(`${URL_}/verify`) ? json(session) : json({}));
    const account = accountOf(client());
    await account.verifyCode('nora@example.com', '123456');
    expect(await account.signOut()).toEqual({ ok: true });
    const call = calls.find((c) => c.url.startsWith(`${URL_}/logout`));
    expect(call?.url).toContain('scope=local');
    expect(await account.current()).toBeNull();
  });
});
