import { LEVELS } from '@norikub/core/bot';
import type { Level } from '@norikub/core/bot';
import type { MatchFormat } from '@norikub/core/match';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import type { Lineup, Setup } from './session.ts';

const LABELS: Readonly<Record<Level, string>> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const HINTS: Readonly<Record<Level, string>> = {
  easy: 'Lays its own sets, never builds on yours.',
  medium: 'Adds to the table, borrows the odd spare tile.',
  hard: 'Reworks the whole table, as you can.',
};

const SEATS = ['First bot', 'Second bot', 'Third bot'] as const;

/**
 * The lengths offered (KUB-42). A won game against two bots scores about 30 to 80 here (the
 * losers' racks; a guess from a handful of games, not measured), so 100 is two or three wins
 * and 500 an evening.
 */
const GAMES = [3, 5, 7, 10] as const;
const TARGETS = [100, 200, 300, 500] as const;

type Length = MatchFormat['kind'];

const LENGTHS: readonly { readonly kind: Length; readonly label: string }[] = [
  { kind: 'single', label: 'One game' },
  { kind: 'games', label: 'A few games' },
  { kind: 'points', label: 'To a score' },
];

/**
 * Setting up a sitting against the bots (KUB-41, KUB-42): one to three bots and the level of
 * each, then one game, a number of games, or games until a running total reaches a score. It
 * starts on the setup just played, so the same again is one tap.
 *
 * The number of games and the score are kept while another length is picked, so trying "One
 * game" and coming back does not lose a 7.
 */
export function GameSetup({
  initial,
  action,
  onDeal,
}: {
  readonly initial: Setup;
  /** The button's words: "New game" after a game, "Deal a new game" mid-game. */
  readonly action: string;
  readonly onDeal: (setup: Setup) => void;
}) {
  const [lineup, setLineup] = useState<Lineup>(initial.lineup);
  const [length, setLength] = useState<Length>(initial.format.kind);
  const [games, setGames] = useState(initial.format.kind === 'games' ? initial.format.games : 3);
  const [target, setTarget] = useState(
    initial.format.kind === 'points' ? initial.format.target : 200,
  );
  const id = useId();
  const pick = (seat: number, level: Level) =>
    setLineup(lineup.map((current, i) => (i === seat ? level : current)));
  // A bot added plays at the level of the one before it: most tables are all one level.
  const count = (bots: number) =>
    setLineup(Array.from({ length: bots }, (_, i) => lineup[i] ?? lineup.at(-1) ?? 'medium'));
  const format: MatchFormat =
    length === 'games'
      ? { kind: 'games', games }
      : length === 'points'
        ? { kind: 'points', target }
        : { kind: 'single' };
  return (
    <div className="lineup">
      <Choices
        legend="Bots"
        name={`${id}-count`}
        options={SEATS.map((_, i) => ({ value: i + 1, label: String(i + 1) }))}
        value={lineup.length}
        onPick={count}
      />
      {lineup.map((level, seat) => (
        <Choices
          key={seat}
          legend={SEATS[seat] ?? `Bot ${seat + 1}`}
          name={`${id}-${seat}`}
          options={LEVELS.map((option) => ({ value: option, label: LABELS[option] }))}
          value={level}
          onPick={(option) => pick(seat, option)}
        />
      ))}
      <p className="lineup-hint">{[...new Set(lineup)].map((level) => HINTS[level]).join(' ')}</p>
      <Choices
        legend="Play"
        name={`${id}-length`}
        options={LENGTHS.map(({ kind, label }) => ({ value: kind, label }))}
        value={length}
        onPick={setLength}
      />
      {length === 'games' && (
        <Choices
          legend="Games"
          name={`${id}-games`}
          options={GAMES.map((n) => ({ value: n, label: String(n) }))}
          value={games}
          onPick={setGames}
        />
      )}
      {length === 'points' && (
        <Choices
          legend="First to"
          name={`${id}-target`}
          options={TARGETS.map((n) => ({ value: n, label: String(n) }))}
          value={target}
          onPick={setTarget}
        />
      )}
      <button type="button" className="primary" onClick={() => onDeal({ lineup, format })}>
        {action}
      </button>
    </div>
  );
}

/** One row of pills: a fieldset of radios, its legend the question. */
function Choices<T extends string | number>({
  legend,
  name,
  options,
  value,
  onPick,
}: {
  readonly legend: ReactNode;
  readonly name: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onPick: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onPick(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
