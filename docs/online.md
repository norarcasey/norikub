# Playing friends online

Decided in `KUB-12`, 22 Nov 2026: **one Cloudflare Durable Object per table, as Hanora
does it.** Nora reviews it with the ticket. Nothing here is built yet; the tickets that build
it are listed at the end.

## Why not compare the hosts again

Hanora asked the same question a week earlier (`HAN/HAN-1`, 15 Nov 2026) against the same
three constraints Norikub has: hidden racks (here invariant 2), one judge of every move
(invariant 1), and a game that survives a reload (invariant 3). It compared a Durable Object
per game, Vercel functions over Upstash Redis, a new Supabase project, a schema in a shared
Supabase project and PartyKit, with each provider's limits read on the day; Hanora's
`docs/game-host.md` has the comparison and the reasons the others lost. The Durable Object won
at $0 a month on the Workers Free plan.

It has since been played for real. Hanora's host has deployed through CI since 16 Nov 2026
(`hanora-game.noratsu.workers.dev`), and Nora's note on this ticket is _"We did this with
Hanora and it worked really well."_ Nothing about Norikub changes the comparison: its data
already lives in CruciNora's project (invariant 8), so a game kept there would have the same
problems Hanora found (rules in Deno or Postgres, a row per seat's view behind row-level
security), and Norikub's sockets would be cut at 300 s on Vercel exactly as Hanora's would.

What Norikub needs that Hanora did not is in **What is Norikub's own**, below.

## The shape

- **`apps/game`**, a Cloudflare Worker named `norikub-game`, on the same Cloudflare account
  as Hanora's. Each table is one object, `idFromName('table:<code>')`, which Cloudflare runs
  as one instance handed one event at a time, so two messages at once are judged one after the
  other with no lock written here. The object stores the table, the game and each seat's
  token as one row in its SQLite storage, **written before anything is sent** (invariant 3).
- **It runs `packages/core` by relative path**, the copy the page runs. Core imports only
  zod, so it runs in a Worker unchanged, as Hanora's does. The messages both sides send are a
  zod schema in `packages/core/src/protocol.ts`, so each parses the other with one schema.
- **Each socket is sent its own seat's view** (`seatView`), never the game. The other racks
  and the pool never leave the object, so invariant 2 holds for people as it already holds for
  the bots. The seat rides on the socket as its server-side attachment, from the token it
  connected with; a seat named in a message is ignored.
- **The Worker checks every socket's `Origin`** against the site's (`SITE_ORIGINS`, plus any
  `http://localhost` port), since `*.workers.dev` is a second origin.
- **CI deploys it** in a `deploy-game` job behind `gate`, as Hanora's does, and never a
  `wrangler deploy` from the laptop: invariant 5 then covers both hosts.
- **`pnpm dev`** runs Vite and `wrangler dev` together, with no account.

## What is Norikub's own

### A turn is shared while it is played

Hanora's moves are one message each, judged as they arrive. A Norikub turn is long, and the
table is reworked freely on the way (invariant 4), so the object holds the **turn in
progress**, the core's `Turn`, beside the game:

| The page sends        | The object runs           | Then                                     |
| --------------------- | ------------------------- | ---------------------------------------- |
| `{type:'move', move}` | `move(turn, move)`        | stores the turn, sends every seat a view |
| `{type:'take-back'}`  | `takeBack(turn)`          | the same                                 |
| `{type:'end-turn'}`   | `endTurn(turn)`           | faults to the sender alone; else stores  |
| `{type:'draw', pick}` | `drawInstead(turn, pick)` | the new game, stored, then views         |

Only the seat whose turn it is may send any of them; anything else is refused to its sender
alone. The page applies its own moves at once with the same `move`, so a drag feels as it does
against the bots, and takes the object's view when it comes; since both ran one copy of the
rules, they only disagree when the page was stale, and then the object's wins.

**Every seat sees the table being reworked, live**, as at a real table: the working table
and the mover's working tile count. The mover's working rack is in the mover's view alone.
This means a tile put down and taken back is seen by the others for a moment, which is also
true at a real table. If Nora would rather the others see only the judged end of each turn,
the object sends them the turn's `start` instead and nothing else changes.

Because the turn is stored, a reload, a lost signal or a second device puts the mover back
with the table exactly as they had reworked it: invariant 3 holds mid-turn, which the bot game
on one device already does through `resumeTurn`.

How the mover's own rack is laid out (the three rows and their slots, `KUB-20`, `KUB-22`) is
not a game move, so it stays on the device and never reaches the object.

### Drawing by pick

`draw(game, pick)` takes a place in the pool. The pool is shuffled once at the deal and only
ever loses tiles, so a place says nothing about the tile there, and the object can tell every
seat where a tile was taken from (`drewAt`) so each page's scattered pile (`KUB-25`) loses the
same tile. The tile itself goes to the drawer's view alone, and the face-down flight (`KUB-21`)
goes to everyone else.

### The deal

Seats are taken in the order friends sit down, two to four. The first seat deals once two
or more are seated, as in Hanora; the object deals with a seed from
`crypto.getRandomValues` that it neither stores nor sends (the dealt pool is in the game).
Who plays first is a random seat at the deal, so sitting down first is not an advantage.

### Bots at a friends' table

An empty seat can be a bot. The object runs `takeBotTurn` with that seat's `seatView`, the same
call the bot game makes on the device, so the bot is still handed only what a person in its
seat would see. Each seat is sent the bot's moves as well as the result, for `KUB-17`'s
playback; the result is stored before they are sent.

## Invites

A table is a link, `/t/<code>`, made by whoever starts it and sent to friends by whatever they
already use to talk. There is no list of tables, no endpoint that finds one and no way to
reach a table except its code, so non-goal 2 (no strangers, no matchmaking) holds by
construction. The code is random and long enough not to be guessed; a friend who has it sits
down by name.

## Who you are, and why sign-in is not needed to play

Sitting down answers a **seat token**, kept in the device's own storage under the table's
code. Reconnecting with it puts the device back in its seat; a token the table never gave out
is answered with a socket closed at once with its own close code, so the page can tell "sit
down again" from "try again". A device that loses its token (cleared site data) loses the seat.

The ticket said online play needs sign-in first. It does not, as Hanora found: a seat is a
token, not an account. **Sign-in (`KUB-29`) is needed only to keep results between games**,
which is what a friends' leaderboard (`KUB-13`) is built from. Hanora's route for that is
`HAN-23`: a seat says whose it is with its access token, the object asks CruciNora's project
whose that is, and the move that ends the game writes one row per signed-in seat to the app's
schema, with the service key as a Worker secret uploaded by `deploy-game`.

## Who is here, and a player who is away

As Hanora (`HAN-5`): each socket accepted or closed sends every seat who is connected; a seat
with no device connected shows as away, never gone. Pages ping every 25 s, answered by the
runtime without waking the object, and while any socket is open an alarm closes sockets
silent for 50 s, because a phone that loses signal rarely closes its socket. Hanora measured
a lost device shown as away in 59 s and back in its seat 30 ms after the network returned.

What Hanora never needed, and Norikub does: in a turn-based game, **an away player stalls
everyone**. Nothing is decided here. The rules give a turn a time limit (a minute, at a real
table), and friends playing over an evening may want none. The likely shape is no limit, and
a seat away for a while can be skipped (its turn becomes a draw) or handed to a bot by the
others; that is Nora's choice, filed as `KUB-37`.

## What it costs

**$0 a month**, on the same free plan Hanora uses, if Hanora's estimates hold here: they are
estimates against Cloudflare's published limits read on 15 Nov 2026, not a measured bill. The
two apps share one account's free daily limits.

The one thing Norikub sends more of is moves. A four-player game of about 40 turns each with
about ten moves a turn (a guess, not measured) is about 1,600 moves: 1,600 rows written of the
free 100,000 a day, and 80 billed requests (incoming socket messages count one per 20). That is
under two percent of a day's rows per game. If it ever mattered, a turn's moves could be stored
every few moves instead of every one, at the price of a reload losing the last few.

## Not decided here

- **Moves made with no signal** (`KUB-11`). A move made with no signal meets a game that may have
  moved on; turns are ordered, so it is refused, never merged. The first cut needs a signal.
- **The Mac app** loads the page, so it plays online with no change of its own (invariant 7).
- **Lifting this into a layer** (`SKILL/SKILL-20`). Norikub would be the second app on the
  shape, which is the evidence that ticket waits for; it is copied from Hanora's `apps/game`
  here rather than waiting for the layer.

## The tickets that build it

Filed from `KUB-12`, in order:

1. `KUB-32` The turn shared between seats, in core: each seat's view of a turn in progress
   and the protocol, with no host yet.
2. `KUB-33` The game host in `apps/game`, deployed by CI. Needs Nora: the Cloudflare secrets
   in this repository's `production` environment and a **Shipit**.
3. `KUB-34` The page's table at `/t/<code>`: start a table, send the link, sit down by name,
   deal and play. The bot game on the device stays as it is.
4. `KUB-35` Who is here, and coming back to your seat.
5. `KUB-36` Bots in the empty seats of a friends' table.
6. `KUB-37` A player who is away does not stall the table (Nora's choice).
7. `KUB-38` Finished online games kept for signed-in seats, after `KUB-29`, for `KUB-13`.
