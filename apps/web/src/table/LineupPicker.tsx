import { LEVELS } from '@norikub/core/bot';
import type { Level } from '@norikub/core/bot';
import { useId, useState } from 'react';

import type { Lineup } from './session.ts';

const LABELS: Readonly<Record<Level, string>> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const HINTS: Readonly<Record<Level, string>> = {
  easy: 'Lays its own sets, never builds on yours.',
  medium: 'Adds to the table, borrows the odd spare tile.',
  hard: 'Reworks the whole table, as you can.',
};

/**
 * Picking the bots for the next game (KUB-41), one level for each seat. It starts on the
 * lineup just played, so playing again against the same bots is one tap.
 */
export function LineupPicker({
  initial,
  action,
  onDeal,
}: {
  readonly initial: Lineup;
  /** The button's words: "New game" after a game, "Deal a new game" mid-game. */
  readonly action: string;
  readonly onDeal: (lineup: Lineup) => void;
}) {
  const [lineup, setLineup] = useState<Lineup>(initial);
  const id = useId();
  const pick = (seat: number, level: Level) =>
    setLineup(lineup.map((current, i) => (i === seat ? level : current)));
  return (
    <div className="lineup">
      {lineup.map((level, seat) => (
        <fieldset key={seat}>
          <legend>{seat === 0 ? 'First bot' : 'Second bot'}</legend>
          {LEVELS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={`${id}-${seat}`}
                value={option}
                checked={level === option}
                onChange={() => pick(seat, option)}
              />
              {LABELS[option]}
            </label>
          ))}
        </fieldset>
      ))}
      <p className="lineup-hint">{[...new Set(lineup)].map((level) => HINTS[level]).join(' ')}</p>
      <button type="button" className="primary" onClick={() => onDeal(lineup)}>
        {action}
      </button>
    </div>
  );
}
