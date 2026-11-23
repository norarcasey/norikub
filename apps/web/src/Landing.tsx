import { useState } from 'react';

import { GameSetup } from './table/GameSetup.tsx';
import { setupText } from './table/messages.ts';
import type { Setup } from './table/session.ts';

/**
 * Where the app opens when there is no game to go back to (Nora, KUB-42): play at once
 * against the bots last picked, set a sitting up first, or start a table with friends. A game
 * in progress never comes here on a reload: it resumes on the table (invariant 3).
 *
 * The setup opens in the same panel rather than over it, since there is no game under it to
 * keep.
 */
export function Landing({
  last,
  onDeal,
  friendsLink,
}: {
  /** What Play now deals: the setup played last, or the first one there is. */
  readonly last: Setup;
  readonly onDeal: (setup: Setup) => void;
  /** A new friends' table's link, or null in a build with no game host. */
  readonly friendsLink: string | null;
}) {
  const [setting, setSetting] = useState(false);
  return (
    <div className="lobby-wrap">
      <section className="lobby landing" aria-label="Start">
        <h2>{setting ? 'Set up a game' : 'Norikub'}</h2>
        {setting ? (
          <>
            <GameSetup initial={last} action="Deal" onDeal={onDeal} />
            <button type="button" className="landing-back" onClick={() => setSetting(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            <p>{setupText(last)}</p>
            <button type="button" className="primary" onClick={() => onDeal(last)}>
              Play now
            </button>
            <button type="button" className="landing-choice" onClick={() => setSetting(true)}>
              Set up a game
            </button>
            {friendsLink !== null && (
              <a className="landing-choice" href={friendsLink}>
                Play friends
              </a>
            )}
          </>
        )}
      </section>
    </div>
  );
}
