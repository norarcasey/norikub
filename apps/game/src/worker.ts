import { parse } from '../../../packages/core/src/parse.ts';
import { tableCodeSchema } from '../../../packages/core/src/protocol.ts';
import type { Table } from './host.ts';
import { corsHeaders, originAllowed } from './origin.ts';

export { Table } from './host.ts';

interface Env {
  readonly TABLE: DurableObjectNamespace<Table>;
  readonly SITE_ORIGINS: string;
}

const route = /^\/tables\/([^/]+)\/(join|socket)$/;

/**
 * The Worker only routes: it checks who is asking and which table, then hands the request to
 * that table's object. Everything that decides anything happens in the object, by the core.
 *
 * - `POST /tables/<code>/join`, with `{ name }`, sits this device down and answers
 *   `{ seat, token }`; `GET /tables/<code>/socket?token=…` is that seat's WebSocket.
 */
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const origin = request.headers.get('Origin');
    if (origin === null || !originAllowed(origin, env.SITE_ORIGINS)) {
      return new Response('origin not allowed', { status: 403 });
    }
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const match = route.exec(new URL(request.url).pathname);
    const code = parse(tableCodeSchema, match?.[1]);
    const action = match?.[2];
    if (!code.ok || action === undefined)
      return new Response('not found', { status: 404, headers: cors });

    if (action === 'join' && request.method !== 'POST') {
      return new Response('join is a POST', { status: 405, headers: cors });
    }
    if (action === 'socket' && request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket', { status: 426, headers: cors });
    }

    const table = env.TABLE.get(env.TABLE.idFromName(`table:${code.value}`));
    if (action === 'socket') return table.fetch(request);
    return withHeaders(table.fetch(request), cors);
  },
} satisfies ExportedHandler<Env>;

async function withHeaders(
  pending: Promise<Response>,
  headers: Record<string, string>,
): Promise<Response> {
  const response = await pending;
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
