import { LEVELS } from '@norikub/core/bot';
import type { Level } from '@norikub/core/bot';
import type { MatchFormat } from '@norikub/core/match';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { Avatar } from './Avatar.tsx';
import { CAST_NAMES, ROSTER, levelOf } from './cast.ts';
import type { Who } from './cast.ts';
import type { Lineup, Setup } from './session.ts';

const LABELS: Readonly<Record<Level, string>> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const HINTS: Readonly<Record<Level, string>> = {
  easy: 'Easy lays its own sets, never builds on yours.',
  medium: 'Medium adds to the table, borrows the odd spare tile.',
  hard: 'Hard reworks the whole table, as you can.',
};

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

/** Most bots a table seats: four seats, one of them the person's. */
const MOST = 3;

/**
 * Setting up a sitting against the bots (KUB-41, KUB-42, KUB-49): who to play, chosen from every
 * face at once, then one game, a number of games, or games until a running total reaches a
 * score. It starts on the setup just played, so the same again is one tap.
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
  const [chosen, setChosen] = useState<readonly Who[]>(initial.lineup.map((seat) => seat.who));
  const [length, setLength] = useState<Length>(initial.format.kind);
  const [games, setGames] = useState(initial.format.kind === 'games' ? initial.format.games : 3);
  const [target, setTarget] = useState(
    initial.format.kind === 'points' ? initial.format.target : 200,
  );
  const id = useId();
  // Seats in the order chosen; un-choosing one moves the later ones up a seat.
  const toggle = (who: Who) =>
    setChosen(
      chosen.includes(who)
        ? chosen.filter((other) => other !== who)
        : chosen.length < MOST
          ? [...chosen, who]
          : chosen,
    );
  const lineup: Lineup = chosen.map((who) => ({ level: levelOf(who), who }));
  const format: MatchFormat =
    length === 'games'
      ? { kind: 'games', games }
      : length === 'points'
        ? { kind: 'points', target }
        : { kind: 'single' };
  return (
    <div className="lineup">
      <fieldset className="roster">
        <legend>Who are you playing?</legend>
        {LEVELS.map((level) => (
          <div key={level} className="roster-row" data-level={level}>
            <span className="roster-level">{LABELS[level]}</span>
            {ROSTER[level].map((who) => {
              const seat = chosen.indexOf(who);
              const full = seat < 0 && chosen.length >= MOST;
              return (
                <label key={who} className="roster-pick" data-chosen={seat >= 0 || undefined}>
                  <input
                    type="checkbox"
                    aria-label={`${CAST_NAMES[who]}, ${LABELS[level].toLowerCase()}`}
                    checked={seat >= 0}
                    disabled={full}
                    onChange={() => toggle(who)}
                  />
                  <Avatar who={who} size={72} />
                  <span className="roster-name">{CAST_NAMES[who]}</span>
                  {seat >= 0 ? (
                    <span className="roster-seat" aria-hidden="true">
                      {seat + 1}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        ))}
      </fieldset>
      <p className="lineup-hint" aria-live="polite">
        {chosen.length === 0
          ? 'Pick one to three to play against.'
          : `Against ${chosen.map((who) => CAST_NAMES[who]).join(', ')}. ${[
              ...new Set(lineup.map((bot) => bot.level)),
            ]
              .map((level) => HINTS[level])
              .join(' ')}`}
      </p>
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
      <button
        type="button"
        className="primary"
        disabled={lineup.length === 0}
        onClick={() => onDeal({ lineup, format })}
      >
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
