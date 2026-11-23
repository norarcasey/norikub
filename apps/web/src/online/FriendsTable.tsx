import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { parse } from '@norikub/core/parse';
import { joinResponseSchema, SITE_REFUSED } from '@norikub/core/protocol';
import type { JoinResponse } from '@norikub/core/protocol';
import { displayNameSchema, tableRefusalSchema } from '@norikub/core/table';
import { z } from 'zod';

import type { Actions } from '../table/board.ts';
import { TableScreen } from '../table/GameScreen.tsx';
import { tableRefusalText } from '../table/messages.ts';
import {
  friendsBoard,
  isAway,
  newFriends,
  placeTile,
  probeMove,
  received,
  reconnected,
  sendDeal,
  sendTiles,
  sendTurn,
  takeBackTurn,
} from './friends.ts';
import type { Friends, Sent } from './friends.ts';
import { tableJoinUrl, tableSocketUrl } from './gameServer.ts';
import { TableLink } from './link.ts';
import type { Link } from './link.ts';
import { forgetSeat, keepSeat, keptSeat, tableCodeOf } from './seat.ts';
import type { KeptSeat } from './seat.ts';
import './friends.css';

/**
 * What `/t/…` shows: the table its code names, or why there is none. `server` is the game
 * host this build was told of (`gameServer.ts`); a build told of none cannot seat anybody.
 */
export function FriendsPage({ pathname, server }: { pathname: string; server: URL | null }) {
  const code = tableCodeOf(pathname);
  if (code === null || server === null) {
    return (
      <Panel>
        <h2>No table here</h2>
        <p>
          {code === null
            ? 'This table link is not complete. Ask whoever sent it to send it again.'
            : 'Playing with friends is not switched on in this build yet.'}
        </p>
        <a href="/">Play the bots</a>
      </Panel>
    );
  }
  return <FriendsTable code={code} server={server} />;
}

/**
 * A friends' table at its own link, `/t/<code>` (KUB-34). Sitting down asks for a name and
 * keeps the seat's token on this device under the code; the socket that token opens is the
 * whole game, every view of it the host's (docs/online.md).
 */
export function FriendsTable({ code, server }: { code: string; server: URL }) {
  const [kept, setKept] = useState<KeptSeat | null>(() => keptSeat(code));
  const [lostSeat, setLostSeat] = useState(false);
  const [friends, setFriends] = useState<Friends>(() => newFriends(rowsOf(keptSeat(code))));
  const [link, setLink] = useState<Link>('connecting');
  const socket = useRef<TableLink | null>(null);
  const token = kept?.token ?? null;

  useEffect(() => {
    if (token === null) return;
    const link = new TableLink(tableSocketUrl(server, code, token), {
      link: setLink,
      reconnected: () => setFriends(reconnected),
      message: (message) => setFriends((state) => received(state, message)),
      lostSeat: () => {
        forgetSeat(code);
        setLostSeat(true);
        setKept(null);
      },
    });
    socket.current = link;
    link.start();
    // A page iOS suspended wakes with a socket that may be dead and timers that stood still:
    // check at once rather than waiting for them. Offline, probe now, so the page says it is
    // reconnecting within a pong's wait (as Hanora's HAN-5).
    const wake = () => {
      if (document.visibilityState === 'visible') link.wake();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
      socket.current = null;
      link.stop();
    };
  }, [code, server, token]);

  // The rack's layout is this device's, kept beside the seat so a reload finds it as it was.
  useEffect(() => {
    if (kept === null || friends.rows === null) return;
    keepSeat(code, { ...kept, rows: friends.rows, startRows: friends.startRows });
  }, [code, kept, friends.rows, friends.startRows]);

  if (kept === null) {
    return (
      <SitDown
        code={code}
        server={server}
        lostSeat={lostSeat}
        onSeated={(seat) => {
          keepSeat(code, seat);
          setFriends(newFriends());
          setLink('connecting');
          setKept(seat);
        }}
      />
    );
  }

  // Sent on the open socket, or not made at all: a move made while the socket is down would
  // be shown and never judged.
  const dispatch = (sent: Sent) => {
    if (socket.current?.send(sent.send) === true) setFriends(sent.state);
  };

  const host = friends.host;
  const status = link === 'lost' ? <span className="link-lost">Reconnecting…</span> : null;
  if (host === null) {
    return (
      <Panel>
        <h2>Table {code}</h2>
        <p role="status">{link === 'lost' ? 'Reconnecting…' : 'Connecting…'}</p>
      </Panel>
    );
  }
  if (host.phase === 'seating') {
    return (
      <Seating
        code={code}
        names={host.names}
        you={host.you}
        away={host.names.map((_, seat) => isAway(friends, seat))}
        notes={friends.notes}
        status={status}
        onDeal={() => dispatch(sendDeal(friends))}
      />
    );
  }

  const board = friendsBoard(friends);
  if (board === null) return null;
  const actions: Actions = {
    probe: (m) => probeMove(friends, m),
    place: (m, spot) => dispatch(placeTile(friends, m, spot)),
    send: (tileIds, target) => dispatch(sendTiles(friends, tileIds, target)),
    takeBack: () => dispatch(takeBackTurn(friends)),
    endTurn: () => dispatch(sendTurn(friends, { type: 'end-turn' })),
    draw: (pick) => dispatch(sendTurn(friends, { type: 'draw', pick: pick ?? null })),
  };
  // The first seat deals the next game for the same seats, as it dealt this one.
  const next =
    host.you === 0 ? (
      <button type="button" className="primary" onClick={() => dispatch(sendDeal(friends))}>
        Deal again
      </button>
    ) : (
      <p>Waiting for {host.names[0] ?? 'the first player'} to deal again.</p>
    );
  return <TableScreen board={board} actions={actions} barEnd={status} afterScores={next} />;
}

function rowsOf(seat: KeptSeat | null) {
  if (seat === null || seat.rows === null) return null;
  return { rows: seat.rows, startRows: seat.startRows ?? seat.rows };
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="lobby-wrap">
      <section className="lobby">{children}</section>
    </div>
  );
}

/** The host's answer to a refused join: `{ refused }`, a table refusal or the host's own words. */
const joinRefusedSchema = z.object({ refused: z.union([tableRefusalSchema, z.string()]) });

type SatDown = { kind: 'seated'; seat: JoinResponse } | { kind: 'not seated'; text: string };

/**
 * One join, and what to tell the player when it did not seat them. Only a `fetch` that threw
 * is *could not be reached*: until KUB-47 an answer that was not JSON (a 404's `not found`)
 * and a refused origin's bare 403 said that too, and KUB-46's missing site origin passed for
 * a dropped connection.
 */
async function sitDown(url: URL, name: string): Promise<SatDown> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    text = await response.text();
  } catch {
    return {
      kind: 'not seated',
      text: 'The table could not be reached. Check the connection and try again.',
    };
  }
  const body = jsonOrNull(text);
  const joined = parse(joinResponseSchema, body);
  if (response.ok && joined.ok) return { kind: 'seated', seat: joined.value };
  const refused = parse(joinRefusedSchema, body);
  if (!refused.ok) {
    return {
      kind: 'not seated',
      text: `The game host answered in a way this page does not understand (${response.status}).`,
    };
  }
  const reason = refused.value.refused;
  if (reason === SITE_REFUSED) {
    return {
      kind: 'not seated',
      text: 'This site is not allowed to open tables. Open the table link from the Norikub site.',
    };
  }
  return {
    kind: 'not seated',
    text:
      typeof reason !== 'string'
        ? tableRefusalText(reason)
        : 'The table would not seat you. Try again.',
  };
}

function jsonOrNull(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

function SitDown({
  code,
  server,
  lostSeat,
  onSeated,
}: {
  code: string;
  server: URL;
  lostSeat: boolean;
  onSeated: (seat: KeptSeat) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(
    lostSeat ? 'This device’s seat at the table was not found. Sit down again.' : null,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parse(displayNameSchema, name);
    if (!parsed.ok) {
      setSaid('Type a name of up to 24 letters.');
      return;
    }
    setBusy(true);
    setSaid(null);
    const said = await sitDown(tableJoinUrl(server, code), parsed.value);
    setBusy(false);
    if (said.kind === 'seated') onSeated({ ...said.seat, rows: null, startRows: null });
    else setSaid(said.text);
  };

  return (
    <Panel>
      <h2>Table {code}</h2>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="sit-name">Your name</label>
        <input
          id="sit-name"
          autoComplete="nickname"
          maxLength={24}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>
          Sit down
        </button>
      </form>
      <p role="status">{said}</p>
      <a href="/">Play the bots instead</a>
    </Panel>
  );
}

function Seating({
  code,
  names,
  you,
  away,
  notes,
  status,
  onDeal,
}: {
  code: string;
  names: readonly string[];
  you: number;
  away: readonly boolean[];
  notes: Friends['notes'];
  status: ReactNode;
  onDeal: () => void;
}) {
  const link = `${window.location.origin}/t/${code}`;
  const [copied, setCopied] = useState(false);
  const refused = notes.flatMap((note) =>
    note.kind === 'host' && note.refusal.kind === 'table'
      ? [tableRefusalText(note.refusal.refusal)]
      : [],
  );
  return (
    <Panel>
      <h2>Table {code}</h2>
      <p>Send this link to the friends you are playing with:</p>
      <p className="lobby-link">{link}</p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(link).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : 'Copy the link'}
      </button>
      <h3>At the table</h3>
      <ol aria-label="Seated">
        {names.map((name, seat) => (
          <li key={seat}>
            {name}
            {seat === you ? ' (you)' : ''}
            {away[seat] === true ? ' · away' : ''}
          </li>
        ))}
      </ol>
      {you === 0 ? (
        <button type="button" className="primary" disabled={names.length < 2} onClick={onDeal}>
          Deal
        </button>
      ) : null}
      <p role="status">
        {refused.length > 0
          ? refused.join(' ')
          : you === 0
            ? names.length < 2
              ? 'Deal once someone else has sat down.'
              : ''
            : `Waiting for ${names[0] ?? 'the first player'} to deal.`}
      </p>
      {status}
    </Panel>
  );
}
