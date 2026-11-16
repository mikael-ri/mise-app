// SSE stream lifecycle with a fake service and session guard over real HTTP: per-session cap,
// fail-closed recheck, cursor ordering. The database-backed paths are in events.int.test.ts.
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ShoppingListId, ShoppingListParams } from '@mise/contracts';
import type { ShoppingListEvent } from '@mise/contracts';
import { buildApp } from '../app.js';
import { AppError } from '../platform/index.js';
import type { RequestContext } from '../platform/index.js';
import { testConfig } from '../platform/test-support.js';
import { createListEventHub } from './events.js';
import { openSse } from './sse-test-client.js';
import type { SseConnection } from './sse-test-client.js';
import { createListStreams } from './stream.js';
import type { ListStreamOptions } from './stream.js';

const listId = ShoppingListId.parse(randomUUID());
const actor = {
  userId: randomUUID(),
  householdId: randomUUID(),
  memberId: randomUUID(),
  deviceSessionId: randomUUID(),
} as unknown as RequestContext;

let app: FastifyInstance | undefined;
const open: SseConnection[] = [];

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await app?.close();
  app = undefined;
});

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function eventually(fn: () => Promise<boolean>, timeoutMs = 3_000) {
  const until = Date.now() + timeoutMs;
  while (!(await fn())) {
    if (Date.now() > until) throw new Error('condition not met');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function start(o: {
  seq?: number;
  isLive?: () => Promise<boolean>;
  options?: Partial<ListStreamOptions>;
  /** Holds `currentEvent` open until resolved; `entered` resolves once a subscribe is waiting. */
  gate?: { entered: () => void; release: Promise<void> };
}) {
  const hub = createListEventHub();
  const revocationListeners = new Set<() => void>();
  let seq = o.seq ?? 0;
  const streams = createListStreams(
    {
      currentEvent: async (_a, id) => {
        if (o.gate) {
          o.gate.entered();
          await o.gate.release;
        }
        if (id !== listId) throw new AppError('not_found', 'shopping list not found');
        return { listId, seq };
      },
      subscribe: (a, id, fn) => hub.subscribe(a.householdId, id, fn),
    },
    {
      sessions: {
        onRevoked: (_id, fn) => {
          revocationListeners.add(fn);
          return () => revocationListeners.delete(fn);
        },
        isLive: o.isLive ?? (async () => true),
      },
      heartbeatMs: 60_000,
      ...o.options,
    },
  );
  app = buildApp({ checkReady: async () => {}, config: testConfig, auth: null });
  app.addHook('onRequest', async (request) => {
    request.actor = actor;
  });
  app.addHook('preClose', async () => streams.closeAll());
  app.get('/api/v1/s/:id', async (req, reply) =>
    streams.open(reply, actor, ShoppingListParams.parse(req.params).id),
  );
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    base,
    streams,
    revoke: () => {
      for (const fn of [...revocationListeners]) fn();
    },
    revocationListeners,
    connect: async (id: string = listId) => {
      const c = await openSse(base, `/api/v1/s/${id}`);
      open.push(c);
      return c;
    },
    publish: (e: ShoppingListEvent) => hub.publish(actor.householdId, e),
    setSeq: (n: number) => {
      seq = n;
    },
  };
}

describe('SSE stream lifecycle (FR-37, ADR-004)', () => {
  it('sends SSE headers with proxy buffering off, retry and the current cursor first', async () => {
    const s = await start({ seq: 7 });
    const c = await s.connect();
    expect(c.status).toBe(200);
    expect(c.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(c.headers['x-accel-buffering']).toBe('no');
    expect(c.headers['cache-control']).toBe('no-store');
    expect(c.headers['x-content-type-options']).toBe('nosniff'); // platform headers still apply
    await c.waitFor((x) => x.events.length === 1);
    expect(c.events[0]).toEqual({ listId, seq: 7 });
    expect(c.ids).toEqual(['7']);
  });

  it('never sends an older or repeated cursor (out-of-order publishes)', async () => {
    const s = await start({ seq: 1 });
    const c = await s.connect();
    await c.waitFor((x) => x.events.length === 1);
    s.publish({ listId, seq: 3 });
    s.publish({ listId, seq: 2 });
    s.publish({ listId, seq: 3 });
    s.publish({ listId, seq: 4 });
    await c.waitFor((x) => x.events.at(-1)?.seq === 4);
    expect(c.events.map((e) => e.seq)).toEqual([1, 3, 4]);
  });

  it('caps open streams per device session at the limit (429), and frees the slot on close', async () => {
    const s = await start({ options: { maxStreamsPerSession: 2 } });
    const a = await s.connect();
    await s.connect();
    const third = await s.connect();
    expect(third.status).toBe(429);
    a.close();
    await eventually(async () => {
      const again = await s.connect();
      return again.status === 200;
    });
  });

  it('frees the slot, listeners and timer when the client leaves while the stream is authorizing', async () => {
    const entered = deferred();
    const release = deferred();
    let liveChecks = 0;
    const s = await start({
      options: { maxStreamsPerSession: 1, heartbeatMs: 20 },
      gate: { entered: entered.resolve, release: release.promise },
      isLive: async () => {
        liveChecks += 1;
        return true;
      },
    });
    const req = request(`${s.base}/api/v1/s/${listId}`);
    req.on('error', () => {});
    req.end();
    await entered.promise;
    req.destroy(); // e.g. a phone dropping off the network mid-subscribe
    await new Promise((r) => setTimeout(r, 50));
    release.resolve();
    await eventually(async () => s.revocationListeners.size === 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(liveChecks).toBeLessThanOrEqual(1); // no heartbeat timer was left running
    // Gate stays open now; the single slot is free again.
    expect((await s.connect()).status).toBe(200);
  });

  it('refuses the stream (401) when the session is revoked while it is authorizing', async () => {
    const entered = deferred();
    const release = deferred();
    const s = await start({ gate: { entered: entered.resolve, release: release.promise } });
    const pendingConnect = s.connect();
    await entered.promise;
    s.revoke();
    release.resolve();
    expect((await pendingConnect).status).toBe(401);
    expect(s.revocationListeners.size).toBe(0);
  });

  it('ends open streams on shutdown and refuses new ones (503)', async () => {
    const s = await start({});
    const c = await s.connect();
    await c.waitFor((x) => x.events.length === 1);
    s.streams.closeAll();
    await c.waitFor((x) => x.isEnded());
    expect((await s.connect()).status).toBe(503);
  });

  it('releases the slot when subscribe fails (404 list, dead session)', async () => {
    let live = true;
    const s = await start({
      options: { maxStreamsPerSession: 1 },
      isLive: async () => live,
    });
    expect((await s.connect(randomUUID())).status).toBe(404);
    live = false;
    expect((await s.connect()).status).toBe(401);
    live = true;
    expect((await s.connect()).status).toBe(200);
  });

  it('closes the stream when the heartbeat recheck fails (fail closed)', async () => {
    let calls = 0;
    const s = await start({
      options: { heartbeatMs: 50 },
      isLive: async () => {
        calls += 1;
        if (calls > 1) throw new Error('database unavailable');
        return true;
      },
    });
    const c = await s.connect();
    await c.waitFor((x) => x.isEnded(), 2_000);
    expect(c.isEnded()).toBe(true);
  });

  it('sends heartbeats while the session stays live', async () => {
    const s = await start({ options: { heartbeatMs: 30 } });
    const c = await s.connect();
    await c.waitFor((x) => x.comments >= 2);
    expect(c.isEnded()).toBe(false);
  });
});
