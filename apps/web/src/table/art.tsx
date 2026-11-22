import type { JSX } from 'react';

import type { Colour } from '@norikub/core/tiles';

/*
 * Norikub's animals (KUB-7, 22 Nov 2026), drawn by hand in SVG in the soft sticker style of the
 * red panda Nora attached to the ticket: a dark rounded outline, flat fills, a highlight in each
 * eye, pink cheeks. Grown-up animals, as she asked, not babies: smaller eyes, longer faces.
 *
 * Each colour is an animal, and each animal has its own outline — pointed ears, round ears, a
 * beak in profile, wide wings — so a player who cannot tell the hues apart tells the tiles apart
 * by the face (the spec's colour-blind requirement). The engine's colour names are unchanged:
 * they are in every saved game's tile ids, and `orange` is drawn as the jaguar's gold.
 *
 * Inline rather than <img>: a tile is dragged, flown and ghosted, and an image would be fetched,
 * decoded and could flash blank on each of those.
 */

/** Red tiles. */
export function RedPanda() {
  return (
    <svg className="tile-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g stroke="#2d1e1b" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
        <path d="M14 12 C 10 24 10 36 14 46 L 40 30 C 32 20 22 14 14 12 Z" fill="#b8431f" />
        <path d="M86 12 C 90 24 90 36 86 46 L 60 30 C 68 20 78 14 86 12 Z" fill="#b8431f" />
        <path
          d="M18 22 C 17 30 17 36 19 41 L 32 32 C 28 27 23 24 18 22 Z"
          fill="#fbe9dc"
          stroke="none"
        />
        <path
          d="M82 22 C 83 30 83 36 81 41 L 68 32 C 72 27 77 24 82 22 Z"
          fill="#fbe9dc"
          stroke="none"
        />
        <path
          d="M50 24 C 76 24 92 40 92 58 C 92 78 74 90 50 90 C 26 90 8 78 8 58 C 8 40 24 24 50 24 Z"
          fill="#c9542a"
        />
        <path
          d="M10 60 C 18 52 28 54 32 62 C 36 70 42 74 50 74 C 58 74 64 70 68 62 C 72 54 82 52 90 60 C 90 78 72 89 50 89 C 28 89 10 78 10 60 Z"
          fill="#fff6ee"
          stroke="none"
        />
        <path
          d="M50 24 C 76 24 92 40 92 58 C 92 78 74 90 50 90 C 26 90 8 78 8 58 C 8 40 24 24 50 24 Z"
          fill="none"
        />
        <ellipse cx="33" cy="41" rx="7" ry="4" fill="#fff6ee" stroke="none" />
        <ellipse cx="67" cy="41" rx="7" ry="4" fill="#fff6ee" stroke="none" />
        <path d="M33 56 C 30 64 34 72 40 76" fill="none" stroke="#7a2b16" strokeWidth="6" />
        <path d="M67 56 C 70 64 66 72 60 76" fill="none" stroke="#7a2b16" strokeWidth="6" />
        <ellipse cx="35" cy="54" rx="5" ry="5.5" fill="#1d1412" stroke="none" />
        <ellipse cx="65" cy="54" rx="5" ry="5.5" fill="#1d1412" stroke="none" />
        <circle cx="36.5" cy="52" r="1.8" fill="#fff" stroke="none" />
        <circle cx="66.5" cy="52" r="1.8" fill="#fff" stroke="none" />
        <path
          d="M44 66 C 44 63 56 63 56 66 C 56 69 52 72 50 72 C 48 72 44 69 44 66 Z"
          fill="#1d1412"
          strokeWidth="2"
        />
        <path d="M44 78 C 47 81 50 80 50 77 C 50 80 53 81 56 78" fill="none" strokeWidth="2.5" />
        <ellipse cx="22" cy="70" rx="6" ry="3.5" fill="#f4a39a" stroke="none" opacity="0.8" />
        <ellipse cx="78" cy="70" rx="6" ry="3.5" fill="#f4a39a" stroke="none" opacity="0.8" />
      </g>
    </svg>
  );
}

/** The engine's `orange`, drawn gold. */
export function Jaguar() {
  return (
    <svg className="tile-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g stroke="#2d1e1b" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
        <circle cx="22" cy="28" r="13" fill="#e3a33b" />
        <circle cx="78" cy="28" r="13" fill="#e3a33b" />
        <circle cx="23" cy="30" r="6" fill="#6b4422" stroke="none" />
        <circle cx="77" cy="30" r="6" fill="#6b4422" stroke="none" />
        <path
          d="M50 24 C 76 24 90 40 90 58 C 90 78 72 90 50 90 C 28 90 10 78 10 58 C 10 40 24 24 50 24 Z"
          fill="#e3a33b"
        />
        <path
          d="M30 76 C 28 66 38 62 50 66 C 62 62 72 66 70 76 C 68 84 60 88 50 88 C 40 88 32 84 30 76 Z"
          fill="#fbe8c6"
          stroke="none"
        />
        <g fill="none" stroke="#5a3417" strokeWidth="2.5">
          <circle cx="50" cy="35" r="3.5" />
          <circle cx="39" cy="38" r="2.8" />
          <circle cx="61" cy="38" r="2.8" />
          <circle cx="20" cy="56" r="3.5" />
          <circle cx="80" cy="56" r="3.5" />
          <circle cx="24" cy="68" r="2.6" />
          <circle cx="76" cy="68" r="2.6" />
        </g>
        <g fill="#5a3417" stroke="none">
          <circle cx="50" cy="45" r="2" />
          <circle cx="44" cy="30" r="1.6" />
          <circle cx="56" cy="30" r="1.6" />
          <circle cx="30" cy="46" r="1.8" />
          <circle cx="70" cy="46" r="1.8" />
        </g>
        <path d="M33 58 C 32 64 34 68 38 70" fill="none" stroke="#5a3417" strokeWidth="2.5" />
        <path d="M67 58 C 68 64 66 68 62 70" fill="none" stroke="#5a3417" strokeWidth="2.5" />
        <path
          d="M28 55 C 30 50 40 50 42 55 C 40 59 30 59 28 55 Z"
          fill="#f6d36b"
          strokeWidth="2.5"
        />
        <path
          d="M72 55 C 70 50 60 50 58 55 C 60 59 70 59 72 55 Z"
          fill="#f6d36b"
          strokeWidth="2.5"
        />
        <ellipse cx="35" cy="55" rx="2.6" ry="3.6" fill="#1d1412" stroke="none" />
        <ellipse cx="65" cy="55" rx="2.6" ry="3.6" fill="#1d1412" stroke="none" />
        <path
          d="M43 66 C 43 63 57 63 57 66 C 57 69 52 72 50 72 C 48 72 43 69 43 66 Z"
          fill="#8a4a35"
          strokeWidth="2"
        />
        <path
          d="M50 72 L 50 76 M 43 79 C 46 81 50 80 50 76 C 50 80 54 81 57 79"
          fill="none"
          strokeWidth="2.5"
        />
      </g>
    </svg>
  );
}

/** Black tiles: the black of a puffin's cap and back. */
export function Puffin() {
  return (
    <svg className="tile-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g stroke="#2d1e1b" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M44 10 C 68 10 80 28 80 50 C 80 74 64 92 42 92 C 20 92 6 74 6 50 C 6 28 22 10 44 10 Z"
          fill="#2b2b36"
        />
        <path
          d="M28 38 C 38 24 64 24 72 36 C 78 50 76 68 66 78 C 54 88 34 84 26 72 C 20 62 20 48 28 38 Z"
          fill="#f4f1ea"
          stroke="none"
        />
        <path
          d="M68 34 C 82 38 94 48 98 60 C 92 68 80 72 68 74 C 63 62 63 46 68 34 Z"
          fill="#e8613a"
        />
        <path
          d="M75.5 37.5 C 72.5 49 72.5 61 75.5 72.5"
          fill="none"
          stroke="#f2c14e"
          strokeWidth="5"
        />
        <path d="M68 34 C 63 46 63 62 68 74" fill="none" stroke="#8ea3b8" strokeWidth="5" />
        <path
          d="M68 34 C 82 38 94 48 98 60 C 92 68 80 72 68 74 C 63 62 63 46 68 34 Z"
          fill="none"
        />
        <path d="M80 51 C 85 53 89 56 92 60" fill="none" strokeWidth="2" />
        <circle cx="52" cy="46" r="5.5" fill="#1d1412" stroke="#e8613a" strokeWidth="2.5" />
        <circle cx="53.5" cy="44.5" r="1.6" fill="#fff" stroke="none" />
        <path d="M48 37 L 52 33 L 56 37 Z M 48 55 L 52 59 L 56 55 Z" fill="#9aa3ad" stroke="none" />
        <ellipse cx="50" cy="66" rx="6" ry="3.5" fill="#f4a39a" stroke="none" opacity="0.8" />
      </g>
    </svg>
  );
}

/** Blue tiles. */
export function MantaRay() {
  return (
    <svg className="tile-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g stroke="#2d1e1b" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
        <path d="M50 92 C 50 96 52 98 54 99" fill="none" strokeWidth="3" />
        <path d="M38 34 C 32 30 30 22 34 16 C 38 18 42 24 43 32 Z" fill="#2f63a6" />
        <path d="M62 34 C 68 30 70 22 66 16 C 62 18 58 24 57 32 Z" fill="#2f63a6" />
        <path
          d="M50 30 C 64 30 72 38 80 46 C 86 52 94 56 98 62 C 86 68 72 70 62 78 C 57 82 54 88 50 92 C 46 88 43 82 38 78 C 28 70 14 68 2 62 C 6 56 14 52 20 46 C 28 38 36 30 50 30 Z"
          fill="#3f78bf"
        />
        <path d="M24 52 C 30 48 36 50 38 56 C 32 60 26 58 24 52 Z" fill="#cfe2f3" stroke="none" />
        <path d="M76 52 C 70 48 64 50 62 56 C 68 60 74 58 76 52 Z" fill="#cfe2f3" stroke="none" />
        <ellipse cx="41" cy="42" rx="4" ry="4.5" fill="#1d1412" stroke="none" />
        <ellipse cx="59" cy="42" rx="4" ry="4.5" fill="#1d1412" stroke="none" />
        <circle cx="42.3" cy="40.5" r="1.5" fill="#fff" stroke="none" />
        <circle cx="60.3" cy="40.5" r="1.5" fill="#fff" stroke="none" />
        <path d="M43 51 C 47 55 53 55 57 51" fill="none" strokeWidth="2.5" />
        <ellipse cx="34" cy="49" rx="4" ry="2.5" fill="#f4a39a" stroke="none" opacity="0.8" />
        <ellipse cx="66" cy="49" rx="4" ry="2.5" fill="#f4a39a" stroke="none" opacity="0.8" />
      </g>
    </svg>
  );
}

/**
 * The joker is Nora, drawn from the photo she attached in the animals' style: head and
 * shoulders, auburn hair and fringe, tongue out, black top, gold chain, a hint of the tattoo.
 */
export function NoraJoker() {
  return (
    <svg className="tile-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g stroke="#2d1e1b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        <path d="M27 36 C 20 52 18 72 22 88 L 78 88 C 82 72 80 52 73 36 Z" fill="#a9532a" />
        <path d="M6 100 C 8 88 22 82 38 81 L 62 81 C 78 82 92 88 94 100 Z" fill="#f2c3a5" />
        <path d="M43 68 L 43 82 C 46 86 54 86 57 82 L 57 68 Z" fill="#e8b292" />
        <path
          d="M20 100 C 22 94 26 90 30 89 C 38 96 62 96 70 89 C 74 90 78 94 80 100 Z"
          fill="#26262e"
        />
        <path d="M30 89 L 33 82 M 70 89 L 67 82" fill="none" stroke="#26262e" strokeWidth="4" />
        <path d="M40 83 C 44 91 56 91 60 83" fill="none" stroke="#e0b04a" strokeWidth="2" />
        <ellipse cx="50" cy="54" rx="19" ry="22" fill="#f6cdb0" />
        <path
          d="M28 50 C 24 30 36 18 50 18 C 64 18 76 30 72 50 C 70 46 69 44 68 42 Q 65 46 62 43 Q 58 47 55 43 Q 51 47 48 43 Q 44 47 41 43 Q 37 47 34 43 Q 31 46 28 50 Z"
          fill="#b8612f"
        />
        <path d="M30 44 C 26 58 25 74 29 88 L 36 86 C 33 72 32 58 33 46 Z" fill="#b8612f" />
        <path d="M70 44 C 74 58 75 74 71 88 L 64 86 C 67 72 68 58 67 46 Z" fill="#b8612f" />
        <path
          d="M38 27 C 44 24 54 24 60 26 M 34 34 C 36 31 38 30 40 30"
          fill="none"
          stroke="#da9055"
          strokeWidth="2.5"
        />
        <ellipse cx="42" cy="53" rx="3" ry="3.6" fill="#1d1412" stroke="none" />
        <ellipse cx="58" cy="53" rx="3" ry="3.6" fill="#1d1412" stroke="none" />
        <circle cx="43" cy="51.6" r="1.1" fill="#fff" stroke="none" />
        <circle cx="59" cy="51.6" r="1.1" fill="#fff" stroke="none" />
        <path d="M48 58 C 49 60 51 60 52 58" fill="none" strokeWidth="2" />
        <path
          d="M41 63 C 44 62 56 62 59 63 C 58 69 54 72 50 72 C 46 72 42 69 41 63 Z"
          fill="#7a2630"
          strokeWidth="2.5"
        />
        <path
          d="M42 63 C 46 64 54 64 58 63 L 57 65 C 53 66 47 66 43 65 Z"
          fill="#fff"
          stroke="none"
        />
        <path d="M45 67 C 45 74 47 79 50 79 C 53 79 55 74 55 67 Z" fill="#ef7f8e" strokeWidth="2" />
        <path d="M50 69 L 50 75" fill="none" stroke="#c9536a" strokeWidth="1.5" />
        <ellipse cx="36" cy="62" rx="4" ry="2.5" fill="#f4a39a" stroke="none" opacity="0.8" />
        <ellipse cx="64" cy="62" rx="4" ry="2.5" fill="#f4a39a" stroke="none" opacity="0.8" />
        <path d="M10 99 C 12 93 17 90 21 92 C 18 95 14 97 10 99 Z" fill="#6b6f7a" stroke="none" />
      </g>
    </svg>
  );
}

export const ANIMALS = {
  red: RedPanda,
  blue: MantaRay,
  orange: Jaguar,
  black: Puffin,
} as const satisfies Record<Colour, () => JSX.Element>;
