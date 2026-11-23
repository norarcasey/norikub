import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FriendsPage } from './FriendsTable.tsx';

/**
 * Sitting down at a friends' table, with the game host's answer stubbed. Which words the page
 * shows is the point: until KUB-47 a refused site, a 404 and a dropped connection all said
 * *could not be reached*, and KUB-46's missing origin was taken for the network.
 */

const server = new URL('https://game.example');

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function sitDownAnswered(answer: () => Promise<Response>): Promise<string> {
  vi.stubGlobal('fetch', vi.fn(answer));
  render(<FriendsPage pathname="/t/abcd" server={server} />);
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Nora' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sit down' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(''));
  return screen.getByRole('status').textContent;
}

describe('sitting down', () => {
  it('says this site is not allowed when the host refuses the site', async () => {
    const said = await sitDownAnswered(() =>
      Promise.resolve(Response.json({ refused: 'site' }, { status: 403 })),
    );
    expect(said).toMatch(/This site is not allowed to open tables/);
  });

  it('says the table could not be reached only when the request never arrived', async () => {
    const said = await sitDownAnswered(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(said).toMatch(/could not be reached/);
  });

  it('does not call an answer it cannot read a dropped connection', async () => {
    const said = await sitDownAnswered(() =>
      Promise.resolve(new Response('not found', { status: 404 })),
    );
    expect(said).not.toMatch(/could not be reached/);
    expect(said).toMatch(/does not understand \(404\)/);
  });

  it("gives a table's own refusal in its words", async () => {
    const said = await sitDownAnswered(() =>
      Promise.resolve(Response.json({ refused: { kind: 'table-full' } }, { status: 409 })),
    );
    expect(said).toMatch(/This table is full/);
  });
});
