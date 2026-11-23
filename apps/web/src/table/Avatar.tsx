import asabo from './avatars/asabo.svg';
import edward from './avatars/edward.svg';
import erik from './avatars/erik.svg';
import fuzzy from './avatars/fuzzy.svg';
import michael from './avatars/michael.svg';
import nora from './avatars/nora.svg';
import reilly from './avatars/reilly.svg';
import roscoe from './avatars/roscoe.svg';
import tatum from './avatars/tatum.svg';
import type { Who } from './cast.ts';

/*
 * The cast's portraits (KUB-43, 22 Nov 2026), drawn by hand in SVG from Nora's photos in the
 * tile animals' sticker style — the dark rounded outline, flat fills, a highlight in each eye,
 * pink cheeks — with more of the person in them than the animals have: the plaid, the hat, the
 * mug, the bookshelf behind. Each is a circle, so it sits in the game bar as it does in the
 * picker. Reilly alone is drawn out of focus, glowing eyes in a haze: a cryptid, as Nora asked.
 *
 * Files and <img>, unlike the tiles' inline art: a face is never dragged or flown, and the
 * service worker's precache already takes every svg in the build, so a face loads offline.
 */
const PORTRAITS: Readonly<Record<Who, string>> = {
  tatum,
  edward,
  erik,
  fuzzy,
  michael,
  asabo,
  nora,
  roscoe,
  reilly,
};

/** A bot's face. Decorative: its name is always written beside it. */
export function Avatar({ who, size }: { readonly who: Who; readonly size: number }) {
  return (
    <img
      className="avatar"
      src={PORTRAITS[who]}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}
