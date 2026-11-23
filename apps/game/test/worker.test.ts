import { createTestHarness } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../../packages/core/src/parse.ts';
import {
  CLOSE_UNKNOWN_SEAT,
  joinResponseSchema,
  PING,
  PONG,
  SITE_REFUSED,
  tableMessageSchema,
  type TableClientMessage,
  type TableMessage,
} from '../../../packages/core/src/protocol.ts';
import type { TableView } from '../../../packages/core/src/table.ts';
import { probeOrigin } from '../src/probe.ts';

/**
 * The game host as deployed: the Worker and its Durable Object running in workerd, started by
 * the pinned wrangler from the committed wrangler.jsonc, driven over real HTTP and real
 * WebSockets the way a page drives it. This is the test of invariants 1–3 at the boundary,
 * where a unit test of the rules cannot reach: what actually crosses the wire.
 */

const SITE = 'http://localhost:5173';

const harness = createTestHarness();
let base: URL;

beforeAll(async () => {
  await harness.update({
    root: new URL('..', import.meta.url).pathname,
    workers: [{ configPath: 'wrangler.jsonc' }],
  });
  base = (await harness.listen()).url;
}, 60_000);
afterAll(async () => {
  await harness.close();
});

let tables = 0;
const freshCode = () => `table${Date.now().toString(36)}${tables++}`;

async function sitDown(code: string, name: unknown, origin = SITE) {
  return fetch(new URL(`/tables/${code}/join`, base), {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

async function seatAt(code: string, name: string) {
  const res = await sitDown(code, name);
  const parsed = parse(joinResponseSchema, await res.json());
  if (!parsed.ok) throw new Error(`join answered ${res.status}`);
  return parsed.value;
}

/** A device at a table, keeping every frame the host sent it. */
class Seat {
  readonly frames: string[] = [];
  closed: number | null = null;
  readonly ws: WebSocket;
  private readonly opened: Promise<void>;

  constructor(code: string, token: string) {
    const url = new URL(`/tables/${code}/socket?token=${token}`, base);
    url.protocol = 'ws:';
    this.ws = new WebSocket(url, { headers: { Origin: SITE } });
    this.ws.addEventListener('message', (e) => this.frames.push(String(e.data)));
    this.ws.addEventListener('close', (e) => (this.closed = e.code));
    this.opened = new Promise((resolve) => this.ws.addEventListener('open', () => resolve()));
  }

  async send(message: TableClientMessage | string): Promise<void> {
    await this.opened;
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  messages(): TableMessage[] {
    return this.frames.flatMap((f) => {
      if (f === PONG) return [];
      const m = parse(tableMessageSchema, JSON.parse(f));
      if (!m.ok) throw new Error(`the host sent what the page cannot parse: ${f}`);
      return [m.value];
    });
  }

  views(): TableView[] {
    return this.messages().flatMap((m) => (m.type === 'view' ? [m.table] : []));
  }

  lastView(): TableView {
    const view = this.views().at(-1);
    if (view === undefined) throw new Error('no view yet');
    return view;
  }

  /** The last playing view, for a test that has dealt. */
  playing() {
    const view = this.lastView();
    if (view.phase !== 'playing') throw new Error(`expected a dealt table, got ${view.phase}`);
    return view.view;
  }

  /** Waits for `count` more frames than `since` (or for `done`), so a test reads what arrived. */
  async until(done: (seat: Seat) => boolean): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!done(this)) {
      if (Date.now() > deadline) throw new Error(`timed out; frames:\n${this.frames.join('\n')}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async next(since = this.frames.length): Promise<void> {
    await this.until((s) => s.frames.length > since);
  }

  close(): void {
    this.ws.close();
  }
}

/** Every tile anywhere in a frame, by id: whatever field it hid in. */
function tileIds(json: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== 'object' || value === null) return;
    const kind: unknown = Reflect.get(value, 'kind');
    const id: unknown = Reflect.get(value, 'id');
    if ((kind === 'number' || kind === 'joker') && typeof id === 'string') ids.add(id);
    Object.values(value).forEach(walk);
  };
  walk(json);
  return ids;
}

describe('the Worker', () => {
  it("refuses another site's page, and an unknown path", async () => {
    expect((await sitDown(freshCode(), 'Nora', 'https://evil.example')).status).toBe(403);
    const res = await fetch(new URL('/tables/NOT-A-CODE/join', base), {
      method: 'POST',
      headers: { Origin: SITE },
    });
    expect(res.status).toBe(404);
    const get = await fetch(new URL(`/tables/${freshCode()}/join`, base), {
      headers: { Origin: SITE },
    });
    expect(get.status).toBe(405);
  });

  // KUB-47: the refusal is one the refused page can read, and it still seats nobody.
  it("tells another site's page it is refused, in words it can read, and seats nobody", async () => {
    const code = freshCode();
    const evil = 'https://evil.example';
    const preflight = await fetch(new URL(`/tables/${code}/join`, base), {
      method: 'OPTIONS',
      headers: { Origin: evil },
    });
    expect(preflight.status).toBe(204);
    const res = await sitDown(code, 'Nora', evil);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(evil);
    expect(await res.json()).toEqual({ refused: SITE_REFUSED });

    const socket = new URL(`/tables/${code}/socket?token=${'x'.repeat(36)}`, base);
    socket.protocol = 'ws:';
    const ws = new WebSocket(socket, { headers: { Origin: evil } });
    const opened = await new Promise<boolean>((resolve) => {
      ws.addEventListener('open', () => resolve(true));
      ws.addEventListener('error', () => resolve(false));
    });
    expect(opened).toBe(false);

    // The table was never touched: the first page allowed to sit down takes the first seat.
    expect((await seatAt(code, 'Nora')).seat).toBe(0);
    const bare = await fetch(new URL(`/tables/${code}/join`, base), { method: 'POST' });
    expect(bare.status).toBe(403);
    expect(bare.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  // CI's check-origins, against the Worker as deployed: what it says of a listed origin, and of
  // one SITE_ORIGINS left out, as KUB-46's crucinora.com was.
  it('passes a listed origin in the deploy check, and fails an unlisted one by name', async () => {
    expect(await probeOrigin(base, 'https://norikub.crucinora.com', freshCode())).toBeNull();
    const problem = await probeOrigin(base, 'https://kub.elsewhere.example', freshCode());
    expect(problem).toMatch(
      /^https:\/\/kub\.elsewhere\.example is not in the game host's SITE_ORIGINS/,
    );
  });

  it('answers a preflight for the site, naming it', async () => {
    const res = await fetch(new URL(`/tables/${freshCode()}/join`, base), {
      method: 'OPTIONS',
      headers: { Origin: SITE },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  });

  // The origins production serves the page from, as the committed config lists them. A site
  // domain left out refused every seat there and looked like a dropped connection (KUB-46).
  it.each(['https://norikub.crucinora.com', 'https://norikub.vercel.app'])(
    'seats a page served from %s',
    async (origin) => {
      const code = freshCode();
      const preflight = await fetch(new URL(`/tables/${code}/join`, base), {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect((await sitDown(code, 'Nora', origin)).status).toBe(200);
    },
  );

  it('refuses a name that is not one, and a fifth seat', async () => {
    const code = freshCode();
    expect((await sitDown(code, '')).status).toBe(400);
    for (const name of ['A', 'B', 'C', 'D']) await seatAt(code, name);
    expect((await sitDown(code, 'E')).status).toBe(409);
  });

  it('closes a socket with a token the table never gave out, with its own code', async () => {
    const code = freshCode();
    await seatAt(code, 'Nora');
    const stranger = new Seat(code, 'not-a-token');
    await stranger.until((s) => s.closed !== null);
    expect(stranger.closed).toBe(CLOSE_UNKNOWN_SEAT);
  });

  it('answers a ping without a view', async () => {
    const code = freshCode();
    const nora = new Seat(code, (await seatAt(code, 'Nora')).token);
    await nora.next(0);
    const before = nora.frames.length;
    await nora.send(PING);
    await nora.until((s) => s.frames.length > before);
    expect(nora.frames.at(-1)).toBe(PONG);
  });
});

describe('who is at the table', () => {
  const here = (seat: Seat) =>
    seat
      .messages()
      .flatMap((m) => (m.type === 'presence' ? [m.here.join()] : []))
      .at(-1);

  it('tells everyone when a seat connects and when it drops, and keeps the seat', async () => {
    const code = freshCode();
    const nora = await seatAt(code, 'Nora');
    const s0 = new Seat(code, nora.token);
    await s0.until((s) => here(s) === 'true');
    const aiko = await seatAt(code, 'Aiko');
    // Sat down and not yet connected: away, and the others can see so.
    await s0.until((s) => here(s) === 'true,false');
    const s1 = new Seat(code, aiko.token);
    await s0.until((s) => here(s) === 'true,true');
    await s1.until((s) => here(s) === 'true,true');

    s1.close();
    await s0.until((s) => here(s) === 'true,false');
    expect(s0.lastView().names).toEqual(['Nora', 'Aiko']);

    const back = new Seat(code, aiko.token);
    await s0.until((s) => here(s) === 'true,true');
    await back.until((s) => s.views().at(-1)?.you === 1);
    s0.close();
    back.close();
  });

  it('counts a seat here while any of its devices is', async () => {
    const code = freshCode();
    const nora = await seatAt(code, 'Nora');
    const phone = new Seat(code, nora.token);
    await phone.until((s) => here(s) === 'true');
    const laptop = new Seat(code, nora.token);
    await laptop.until((s) => here(s) === 'true');
    const told = () => laptop.messages().filter((m) => m.type === 'presence').length;
    const before = told();
    phone.close();
    // The phone's close is told to the laptop, and Nora is still here on it.
    await laptop.until(() => told() > before);
    expect(here(laptop)).toBe('true');
    laptop.close();
  });
});

describe('a seat away on its turn (KUB-37)', () => {
  it('starts its clock, asks nobody before the minute, and refuses a vote until then', async () => {
    const code = freshCode();
    const seats = [await seatAt(code, 'Nora'), await seatAt(code, 'Kit')];
    const [nora, kit] = seats.map((s) => new Seat(code, s.token));
    if (nora === undefined || kit === undefined) throw new Error('two seats');
    await nora.until((s) => s.views().length > 0);
    await nora.send({ type: 'deal' });
    await nora.until((s) => s.lastView().phase === 'playing');
    await kit.until((s) => s.lastView().phase === 'playing');
    const [mover, other] = nora.playing().current === 0 ? [nora, kit] : [kit, nora];
    const offers = () => other.messages().filter((m) => m.type === 'away-turn');

    const before = offers().length;
    mover.close();
    // Told with the presence that the mover is away: no question yet, a minute has not passed.
    await other.until(() => offers().length > before);
    expect(offers().at(-1)).toEqual({ type: 'away-turn', offer: null });

    await other.send({ type: 'draw-for-away', yes: true });
    await other.until((s) => s.messages().some((m) => m.type === 'refused'));
    expect(other.messages().find((m) => m.type === 'refused')).toEqual({
      type: 'refused',
      refusal: { kind: 'table', refusal: { kind: 'no-away-turn' } },
    });
    other.close();
  });
});

describe('a table played over two sockets', () => {
  it('deals, shares a reworked turn, draws, and never shows a seat another rack or the pool', async () => {
    const code = freshCode();
    const seats = [await seatAt(code, 'Nora'), await seatAt(code, 'Kit')];
    expect(seats.map((s) => s.seat)).toEqual([0, 1]);
    const [nora, kit] = seats.map((s) => new Seat(code, s.token));
    if (nora === undefined || kit === undefined) throw new Error('two seats');
    await nora.until((s) => s.views().length > 0);
    await kit.until((s) => s.views().length > 0);
    expect(nora.lastView()).toEqual({ phase: 'seating', you: 0, names: ['Nora', 'Kit'], bots: [] });

    // Only the first seat deals; Kit's try is refused to Kit alone.
    const noraBefore = nora.frames.length;
    await kit.send({ type: 'deal' });
    await kit.until((s) => s.messages().some((m) => m.type === 'refused'));
    expect(nora.frames.length).toBe(noraBefore);

    await nora.send({ type: 'deal' });
    await nora.until((s) => s.lastView().phase === 'playing');
    await kit.until((s) => s.lastView().phase === 'playing');
    const dealt = [nora.playing(), kit.playing()];
    expect(dealt.map((v) => v.rack.length)).toEqual([14, 14]);
    const current = dealt[0]?.current;
    expect(dealt[1]?.current).toBe(current);
    const [mover, other] = current === 0 ? [nora, kit] : [kit, nora];

    // The one seat whose turn it is not is refused, to itself alone, and nothing changes.
    const moverBefore = mover.frames.length;
    const t1 = mover.playing().rack[0];
    const t2 = mover.playing().rack[1];
    if (t1 === undefined || t2 === undefined) throw new Error('a dealt rack');
    await other.send({ type: 'move', move: { kind: 'to-new-set', tileId: t1.id } });
    await other.until((s) => s.messages().filter((m) => m.type === 'refused').length > 0);
    expect(mover.frames.length).toBe(moverBefore);

    // The turn reworked: every seat sees the working table, the mover alone the working rack.
    await mover.send({ type: 'move', move: { kind: 'to-new-set', tileId: t1.id } });
    await other.until((s) => s.playing().table.some((set) => set.some((t) => t.id === t1.id)));
    await mover.until((s) => s.playing().rack.length === 13);
    expect(other.playing().opponents[0]?.tileCount).toBe(13);
    expect(other.playing().rack.some((t) => t.id === t1.id)).toBe(false);
    await mover.send({ type: 'move', move: { kind: 'to-set', tileId: t2.id, set: 0 } });
    await other.until((s) => s.playing().table[0]?.length === 2);

    // The turn in progress is stored: a second device in the mover's seat finds it as it was.
    const moverToken = seats[current ?? 0]?.token ?? '';
    const again = new Seat(code, moverToken);
    await again.until((s) => s.views().length > 0);
    expect(again.playing().table).toEqual(mover.playing().table);
    expect(again.playing().rack).toEqual(mover.playing().rack);
    again.close();

    // Taken back: the table the turn found, for everyone.
    await mover.send({ type: 'take-back' });
    await other.until((s) => s.playing().table.length === 0 && s.playing().turn === null);
    await mover.until((s) => s.playing().rack.length === 14);

    // A move that leaves a broken set, then a draw instead: every seat hears where in the pool,
    // the drawer alone what it was, and the turn passes on with the table as it began.
    await mover.send({ type: 'move', move: { kind: 'to-new-set', tileId: t1.id } });
    await mover.until((s) => s.playing().rack.length === 13);
    const rackBefore = new Set([...mover.playing().rack, t1].map((t) => t.id));
    await mover.send({ type: 'draw', pick: 0 });
    for (const seat of [mover, other]) {
      await seat.until((s) => s.messages().some((m) => m.type === 'drew'));
    }
    const drew = other.messages().find((m) => m.type === 'drew');
    expect(drew).toEqual({ type: 'drew', seat: current, drewAt: 0 });
    await mover.until((s) => s.playing().rack.length === 15);
    await other.until((s) => s.playing().current !== current);
    const drawn = mover.playing().rack.find((t) => !rackBefore.has(t.id));
    if (drawn === undefined) throw new Error('the drawer holds the drawn tile');
    expect(other.playing().table).toEqual([]);
    expect(other.playing().poolSize).toBe(106 - 28 - 1);

    // Invariant 2, across every frame either socket was sent: each tile a frame names is in
    // that seat's own rack or on the table that frame shows, never anywhere else; and no seat
    // ever held a tile the other's rack had.
    for (const [me, them] of [
      [nora, kit],
      [kit, nora],
    ] as const) {
      const theirRacks = new Set(
        them.views().flatMap((v) => (v.phase === 'playing' ? v.view.rack.map((t) => t.id) : [])),
      );
      for (const frame of me.frames) {
        if (frame === PONG) continue;
        const json: unknown = JSON.parse(frame);
        const seen = tileIds(json);
        const m = parse(tableMessageSchema, json);
        if (!m.ok) throw new Error(`unparseable frame: ${frame}`);
        if (m.value.type !== 'view' || m.value.table.phase !== 'playing') {
          expect(seen.size).toBe(0);
          continue;
        }
        const view = m.value.table.view;
        const shown = new Set([
          ...view.rack.map((t) => t.id),
          ...view.table.flat().map((t) => t.id),
          ...(view.turn?.began.flat().map((t) => t.id) ?? []),
        ]);
        expect([...seen].filter((id) => !shown.has(id))).toEqual([]);
        expect(view.rack.filter((t) => theirRacks.has(t.id))).toEqual([]);
      }
    }
    const otherSaw = new Set(
      other.frames.flatMap((f) => (f === PONG ? [] : [...tileIds(JSON.parse(f))])),
    );
    expect(otherSaw.has(drawn.id)).toBe(false);

    nora.close();
    kit.close();
  }, 20_000);
});

describe('bots at a friends’ table', () => {
  /**
   * The ticket's done-when, through the host as deployed: two friends and two bots play to the
   * end. The friends only ever draw, so every tile laid on the table is a bot's, played by the
   * host in the same event as the turn before it and told to each seat as moves, then a view.
   */
  it('seats two bots for the first seat and plays them to the end of a game', async () => {
    const code = freshCode();
    const seats = [await seatAt(code, 'Nora'), await seatAt(code, 'Kit')];
    const [nora, kit] = seats.map((s) => new Seat(code, s.token));
    if (nora === undefined || kit === undefined) throw new Error('two seats');
    await nora.until((s) => s.views().length > 0);

    // Only the first seat adds a bot, and it takes the next seat.
    await kit.send({ type: 'add-bot', level: 'easy', name: 'Tatum' });
    await kit.until((s) => s.messages().some((m) => m.type === 'refused'));
    await nora.send({ type: 'add-bot', level: 'medium', name: 'Erik' });
    await nora.send({ type: 'add-bot', level: 'hard', name: 'Michael' });
    await kit.until((s) => s.lastView().names.length === 4);
    expect(kit.lastView()).toEqual({
      phase: 'seating',
      you: 1,
      names: ['Nora', 'Kit', 'Erik', 'Michael'],
      bots: [
        { seat: 2, level: 'medium' },
        { seat: 3, level: 'hard' },
      ],
    });

    await nora.send({ type: 'deal' });
    await nora.until((s) => s.lastView().phase === 'playing');
    const bySeat = [nora, kit];
    // The turn rests only with a friend or on a finished game: a bot's turn is never left open.
    const settled = (s: Seat) => {
      const v = s.playing();
      return v.status.kind === 'over' || v.current < 2;
    };
    for (let turn = 0; turn < 400; turn++) {
      await nora.until(settled);
      const view = nora.playing();
      if (view.status.kind === 'over') break;
      const mover = bySeat[view.current];
      if (mover === undefined) throw new Error(`seat ${view.current} is a bot's`);
      const before = nora.frames.length;
      await mover.send({ type: 'draw', pick: null });
      await nora.until((s) => s.frames.length > before && settled(s));
    }
    await kit.until((s) => s.playing().status.kind === 'over');
    expect(nora.playing().status.kind).toBe('over');

    const botTurns = nora.messages().flatMap((m) => (m.type === 'bot-turn' ? [m] : []));
    expect(new Set(botTurns.map((m) => m.seat))).toEqual(new Set([2, 3]));
    // Each bot turn is followed by its own view; one that played named the tiles it laid down.
    const played = botTurns.filter((m) => m.moves.length > 0);
    expect(played.length).toBeGreaterThan(0);
    const laid = new Set(
      nora
        .views()
        .flatMap((v) => (v.phase === 'playing' ? v.view.table.flat() : []))
        .map((t) => t.id),
    );
    for (const m of played) for (const move of m.moves) expect(laid.has(move.tileId)).toBe(true);
    // Nobody was ever asked to draw for a bot: it has no device, and is never away.
    const asked = nora
      .messages()
      .flatMap((m) => (m.type === 'away-turn' && m.offer !== null ? [m.offer.seat] : []));
    expect(asked.filter((seat) => seat >= 2)).toEqual([]);

    nora.close();
    kit.close();
  }, 30_000);
});

describe('a cancelled table', () => {
  it('is cancelled by any seat for everyone, stays so, and seats nobody after', async () => {
    const code = freshCode();
    const seats = [await seatAt(code, 'Nora'), await seatAt(code, 'Kit')];
    const [nora, kit] = seats.map((s) => new Seat(code, s.token));
    if (nora === undefined || kit === undefined) throw new Error('two seats');
    await nora.send({ type: 'deal' });
    await kit.until((s) => s.views().at(-1)?.phase === 'playing');

    // Kit, who does not deal, calls it off mid-game; both seats are told who did.
    await kit.send({ type: 'cancel' });
    const told = { phase: 'cancelled', names: ['Nora', 'Kit'], bots: [], by: 1 };
    await nora.until((s) => s.views().at(-1)?.phase === 'cancelled');
    await kit.until((s) => s.views().at(-1)?.phase === 'cancelled');
    expect(nora.lastView()).toEqual({ ...told, you: 0 });
    expect(kit.lastView()).toEqual({ ...told, you: 1 });

    // Stored: nothing more is taken, and a device coming back to its seat is told the same.
    await nora.send({ type: 'deal' });
    await nora.until((s) => s.messages().at(-1)?.type === 'refused');
    expect(nora.messages().at(-1)).toEqual({
      type: 'refused',
      refusal: { kind: 'table', refusal: { kind: 'cancelled' } },
    });
    const back = new Seat(code, seats[0]?.token ?? '');
    await back.until((s) => s.views().length > 0);
    expect(back.lastView()).toEqual({ ...told, you: 0 });
    const late = await sitDown(code, 'Bo');
    expect(late.status).toBe(409);
    // The page's join reads this shape (FriendsTable.tsx); until KUB-52 it read another.
    expect(await late.json()).toEqual({
      refused: { kind: 'table', refusal: { kind: 'cancelled' } },
    });
    for (const seat of [nora, kit, back]) seat.close();
  });
});
