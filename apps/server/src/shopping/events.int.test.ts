// FR-37, NFR-09, AC-08 (server side): SSE live list updates against real PostgreSQL as the app role,
// through the real session hook (shared test config, freshly migrated database per file).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  DeviceSessionId,
  HouseholdId,
  MemberId,
  ShoppingListSnapshot,
  UserId,
} from '@mise/contracts';
import { buildApp } from '../app.js';
import {
  createAuthService,
  createIdpClient,
  createOperatorService,
  createRevocationHub,
  loginStateKey,
} from '../auth/index.js';
import type { AuthService } from '../auth/index.js';
import { createHouseholdsService } from '../households/index.js';
import { CSRF_HEADER, createPool, createRateLimiter, issueCsrfToken } from '../platform/index.js';
import type { Pool, RequestContext } from '../platform/index.js';
import { createTwoHouseholds } from '../platform/isolation-harness.js';
import type { HouseholdFixture, TwoHouseholds } from '../platform/isolation-harness.js';
import { loadTestDatabaseConfig, testConfig } from '../platform/test-support.js';
import { createListEventHub, createShoppingService } from './index.js';
import type { ListEventHub, ShoppingService } from './index.js';
import { lastSeq, openSse } from './sse-test-client.js';
import type { SseConnection } from './sse-test-client.js';

const pool = createPool(loadTestDatabaseConfig().appUrl, 10);
const ORIGIN = testConfig.publicOrigin;
const SESSION_COOKIE = '__Host-mise_session';
/** Short heartbeat so out-of-process revocations are observed quickly. */
const HEARTBEAT_MS = 150;

const oidc = {
  issuer: 'https://auth.mise.test',
  internalUrl: 'http://authelia.internal:9091',
  clientId: 'mise',
  clientSecret: 'test-client-secret',
  postLoginLogoutUrl: 'https://auth.mise.test/logout',
};

let h: TwoHouseholds;
let a2: HouseholdFixture; // second member of household A (AC-08: two members, one list)
let hub: ListEventHub;
let service: ShoppingService;
let auth: AuthService;
const revocations = createRevocationHub();
const apps: FastifyInstance[] = [];
let base: string; // heartbeat HEARTBEAT_MS
let baseSlowHeartbeat: string; // heartbeat 60 s: only the revocation hub can close in time
const streams: SseConnection[] = [];

interface Session {
  actor: RequestContext;
  cookie: string;
  csrf: string;
}

/**
 * A device session row as a completed OIDC login would write it (test fixture only; production
 * sessions are minted solely by the OIDC callback). Cookie and digest follow auth/cookies.ts.
 */
async function sessionFor(f: HouseholdFixture): Promise<Session> {
  const raw = randomBytes(32);
  const token = raw.toString('base64url');
  const now = Date.now();
  const id = (
    await pool.query<{ id: string }>(
      `INSERT INTO device_sessions
         (user_id, token_hash, user_agent, created_at, last_seen_at, authenticated_at,
          idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, NULL, $3, $3, $3, $4, $5) RETURNING id`,
      [
        f.userId,
        createHash('sha256').update(raw).digest(),
        new Date(now),
        new Date(now + 86_400_000),
        new Date(now + 2 * 86_400_000),
      ],
    )
  ).rows[0]!.id;
  const actor: RequestContext = {
    userId: UserId.parse(f.userId),
    householdId: HouseholdId.parse(f.householdId),
    memberId: MemberId.parse(f.memberId),
    deviceSessionId: DeviceSessionId.parse(id),
  };
  return {
    actor,
    cookie: `${SESSION_COOKIE}=${token}`,
    csrf: issueCsrfToken(testConfig.csrfSecret, id),
  };
}

function build(heartbeatMs: number, svc: ShoppingService): FastifyInstance {
  const app = buildApp({
    checkReady: async () => {},
    config: testConfig,
    auth: {
      service: auth,
      publicOrigin: ORIGIN,
      postLoginLogoutUrl: oidc.postLoginLogoutUrl,
      loginStateKey: loginStateKey('int-test-session-secret-0123456789'),
      limiter: createRateLimiter({ windowMs: 60_000, max: 10_000 }),
    },
    shopping: {
      service: svc,
      streams: {
        heartbeatMs,
        sessions: {
          onRevoked: (id, fn) => revocations.subscribe(id, fn),
          isLive: (actor) => auth.isSessionLive(actor),
        },
      },
    },
  });
  apps.push(app);
  return app;
}

beforeAll(async () => {
  h = await createTwoHouseholds(pool);
  const userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO users (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://auth.test', $1, 'User a2') RETURNING id`,
      [randomUUID()],
    )
  ).rows[0]!.id;
  const memberId = (
    await pool.query<{ id: string }>(
      `INSERT INTO household_members (household_id, user_id, role)
       VALUES ($1, $2, 'member') RETURNING id`,
      [h.a.householdId, userId],
    )
  ).rows[0]!.id;
  a2 = { householdId: h.a.householdId, userId, memberId };

  auth = createAuthService({
    pool,
    households: createHouseholdsService(pool),
    // Never called: these tests do not log in through OIDC.
    idp: createIdpClient(oidc, async () => {
      throw new Error('no IdP in SSE tests');
    }),
    revocations,
    oidc,
    publicOrigin: ORIGIN,
    csrfSecret: testConfig.csrfSecret,
  });
  hub = createListEventHub();
  service = createShoppingService(pool, hub);
  base = await build(HEARTBEAT_MS, service).listen({ port: 0, host: '127.0.0.1' });
  baseSlowHeartbeat = await build(60_000, service).listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  for (const s of streams.splice(0)) s.close();
});

afterAll(async () => {
  for (const app of apps) await app.close();
  await pool.end();
});

const subscribe = async (s: Session, listId: string, at = base) => {
  const c = await openSse(at, `/api/v1/shopping-lists/${listId}/events`, s.cookie);
  streams.push(c);
  return c;
};

const newList = async (s: Session) =>
  (await service.createList(s.actor, randomUUID(), { name: 'Viikko' })).value;
const addItem = async (s: Session, listId: string, name: string) =>
  (await service.addItem(s.actor, listId, randomUUID(), { name })).value;

const committedSeq = async (listId: string) =>
  Number(
    (
      await pool.query<{ s: string }>('SELECT change_seq AS s FROM shopping_lists WHERE id = $1', [
        listId,
      ])
    ).rows[0]!.s,
  );

const setPickedOverHttp = (s: Session, itemId: string, picked: boolean) =>
  apps[0]!.inject({
    method: 'PATCH',
    url: `/api/v1/shopping-items/${itemId}`,
    headers: { cookie: s.cookie, origin: ORIGIN, [CSRF_HEADER]: s.csrf },
    payload: { picked },
  });

const snapshotOverHttp = async (s: Session, listId: string) => {
  const res = await apps[0]!.inject({
    url: `/api/v1/shopping-lists/${listId}`,
    headers: { cookie: s.cookie },
  });
  expect(res.statusCode).toBe(200);
  return ShoppingListSnapshot.parse(res.json());
};

const quiet = (ms = HEARTBEAT_MS * 4) => new Promise((r) => setTimeout(r, ms));

/** Methods of a proxied pg object run against the real object, never the proxy. */
const bound = (target: object, prop: string | symbol): unknown => {
  const v = Reflect.get(target, prop, target) as unknown;
  return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
};

/**
 * A pool whose transactions fail at COMMIT: every statement ran, then the transaction rolls back.
 * Only the promise form of `connect()` is wrapped (what `withTransaction` uses); the real pool's
 * own `query()` keeps using the real `connect`.
 */
function failingCommitPool(real: Pool): Pool {
  return new Proxy(real, {
    get(target, prop) {
      if (prop !== 'connect') return bound(target, prop);
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(c, p) {
            if (p !== 'query') return bound(c, p);
            return (sql: unknown, ...rest: unknown[]) =>
              sql === 'COMMIT'
                ? Promise.reject(new Error('injected commit failure'))
                : (c.query as (...a: unknown[]) => Promise<unknown>).call(c, sql, ...rest);
          },
        });
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------

describe('FR-37: subscribe is authorized from the session only', () => {
  it('rejects a request without a session (401)', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const c = await openSse(base, `/api/v1/shopping-lists/${list.id}/events`);
    expect(c.status).toBe(401);
  });

  it("does not reveal another household's list (404) and never signals across households", async () => {
    const a = await sessionFor(h.a);
    const b = await sessionFor(h.b);
    const listA = await newList(a);
    expect((await subscribe(b, listA.id)).status).toBe(404);

    const own = await subscribe(a, listA.id);
    await own.waitFor((x) => x.events.length === 1);
    const listB = await newList(b);
    await addItem(b, listB.id, 'maito');
    await quiet();
    expect(own.events).toHaveLength(1);
  });
});

describe('FR-37 / DB §8.2: signal strictly after commit', () => {
  it('sends only {listId, seq}; the seq is already committed when the frame arrives', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const item = await addItem(s, list.id, 'maito');
    const c = await subscribe(s, list.id);
    await c.waitFor((x) => x.events.length === 1);
    expect(c.events[0]).toEqual({ listId: list.id, seq: await committedSeq(list.id) });

    const res = await setPickedOverHttp(s, item.id, true);
    expect(res.statusCode).toBe(200);
    await c.waitFor((x) => x.events.length === 2);
    expect(c.events[1]).toEqual({ listId: list.id, seq: c.events[0]!.seq + 1 });
    expect(await committedSeq(list.id)).toBe(c.events[1]!.seq);
    // Strict schema: nothing but the two fields (ADR-004).
    expect(Object.keys(c.events[1]!).sort()).toEqual(['listId', 'seq']);
  });

  it('a publish runs only after COMMIT returns (listener reads the cursor in the publish call)', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const item = await addItem(s, list.id, 'leipä');
    const observed: Array<{ seq: number; committed: number }> = [];
    const done = new Promise<void>((resolve) => {
      const stop = hub.subscribe(s.actor.householdId, list.id, (e) => {
        // Separate pool connection: sees only committed data.
        void committedSeq(list.id).then((committed) => {
          observed.push({ seq: e.seq, committed });
          stop();
          resolve();
        });
      });
    });
    await service.setPicked(s.actor, item.id, true);
    await done;
    expect(observed[0]!.committed).toBe(observed[0]!.seq);
  });

  it('sends nothing when the transaction rolls back, and the cursor does not move', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const item = await addItem(s, list.id, 'kahvi');
    const before = await committedSeq(list.id);
    const failing = createShoppingService(failingCommitPool(pool), hub);
    const c = await subscribe(s, list.id);
    await c.waitFor((x) => x.events.length === 1);

    await expect(failing.setPicked(s.actor, item.id, true)).rejects.toThrow(
      'injected commit failure',
    );
    await expect(failing.addItem(s.actor, list.id, randomUUID(), { name: 'tee' })).rejects.toThrow(
      'injected commit failure',
    );
    await quiet();
    expect(await committedSeq(list.id)).toBe(before);
    expect(c.events).toEqual([{ listId: list.id, seq: before }]);
  });

  it('sends nothing for a no-op checkoff, a stale edit (409) or an idempotent replay', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const item = await addItem(s, list.id, 'voi');
    const idem = randomUUID();
    await service.addItem(s.actor, list.id, idem, { name: 'juusto' });
    const c = await subscribe(s, list.id);
    await c.waitFor((x) => x.events.length === 1);

    await service.setPicked(s.actor, item.id, false); // already unpicked
    await expect(
      service.editItem(s.actor, item.id, item.revision + 5, { note: 'x' }),
    ).rejects.toThrow();
    await service.addItem(s.actor, list.id, idem, { name: 'juusto' }); // replay
    await quiet();
    expect(c.events).toHaveLength(1);
  });
});

describe('FR-37 / AC-08: reconnect resyncs from the committed cursor', () => {
  it('a reconnect gets the current cursor first, equal to the fresh REST snapshot', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const milk = await addItem(s, list.id, 'maito');
    const first = await subscribe(s, list.id);
    await first.waitFor((x) => x.events.length === 1);
    const seen = lastSeq(first);
    first.close();

    // Changes while disconnected: the client misses these signals.
    await service.setPicked(s.actor, milk.id, true);
    await addItem(s, list.id, 'munat');

    const again = await subscribe(s, list.id);
    await again.waitFor((x) => x.events.length === 1);
    const snapshot = await snapshotOverHttp(s, list.id);
    expect(again.events[0]!.seq).toBe(snapshot.list.changeSeq);
    expect(again.events[0]!.seq).toBe(seen + 2); // gap detected -> client refetches
    expect(snapshot.items.find((i) => i.id === milk.id)?.picked).toBe(true);
  });
});

describe('AC-08: two members shopping simultaneously converge', () => {
  it('both streams reach the final cursor and both snapshots are identical', async () => {
    const sa = await sessionFor(h.a);
    const sb = await sessionFor(a2);
    const list = await newList(sa);
    const milk = await addItem(sa, list.id, 'maito');
    const bread = await addItem(sa, list.id, 'leipä');
    const ca = await subscribe(sa, list.id);
    const cb = await subscribe(sb, list.id);
    await Promise.all([ca, cb].map((c) => c.waitFor((x) => x.events.length === 1)));

    // Conflicting desired states on milk plus an unrelated checkoff, all at once.
    const results = await Promise.all([
      setPickedOverHttp(sa, milk.id, true),
      setPickedOverHttp(sb, milk.id, false),
      setPickedOverHttp(sb, milk.id, true),
      setPickedOverHttp(sa, bread.id, true),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);

    const final = await committedSeq(list.id);
    await Promise.all([ca, cb].map((c) => c.waitFor((x) => lastSeq(x) === final)));
    // Each stream's cursors only increase.
    for (const c of [ca, cb]) {
      const seqs = c.events.map((e) => e.seq);
      expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
      expect(new Set(seqs).size).toBe(seqs.length);
    }
    const [snapA, snapB] = await Promise.all([
      snapshotOverHttp(sa, list.id),
      snapshotOverHttp(sb, list.id),
    ]);
    expect(snapA).toEqual(snapB);
    expect(snapA.list.changeSeq).toBe(final);
    expect(snapA.items.find((i) => i.id === bread.id)?.picked).toBe(true);
  });
});

describe('AC-11 / A07 residual: revoked or expired sessions lose their stream', () => {
  it('in-process revocation (device revoke) closes the stream immediately, not at a heartbeat', async () => {
    const s = await sessionFor(h.a);
    const other = await sessionFor(h.a);
    const list = await newList(s);
    const c = await subscribe(s, list.id, baseSlowHeartbeat);
    const survivor = await subscribe(other, list.id, baseSlowHeartbeat);
    await c.waitFor((x) => x.events.length === 1);

    await auth.revokeDevice(other.actor, s.actor.deviceSessionId);
    await c.waitFor((x) => x.isEnded(), 1_000); // heartbeat here is 60 s
    expect(survivor.isEnded()).toBe(false);
    // The reconnect is refused.
    expect((await subscribe(s, list.id)).status).toBe(401);
  });

  it('a direct database revocation closes the stream by the next heartbeat', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const c = await subscribe(s, list.id);
    await c.waitFor((x) => x.events.length === 1);
    await pool.query('UPDATE device_sessions SET revoked_at = now() WHERE id = $1', [
      s.actor.deviceSessionId,
    ]);
    await c.waitFor((x) => x.isEnded(), 3_000);
  });

  it('the revoke-sessions operator path (CLI) closes the stream by the next heartbeat', async () => {
    // Its own household and member: revoking every session of that member affects no other test.
    const own = (await createTwoHouseholds(pool)).a;
    const s = await sessionFor(own);
    const list = await newList(s);
    const c = await subscribe(s, list.id);
    await c.waitFor((x) => x.events.length === 1);
    // Same service the `revoke-sessions` CLI runs; it never touches this process's revocation hub.
    await createOperatorService(pool).revokeSessions([own.memberId]);
    await c.waitFor((x) => x.isEnded(), 3_000);
  });

  it('an expired session closes the stream by the next heartbeat', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const c = await subscribe(s, list.id);
    await c.waitFor((x) => x.events.length === 1);
    await pool.query(
      "UPDATE device_sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1",
      [s.actor.deviceSessionId],
    );
    await c.waitFor((x) => x.isEnded(), 3_000);
  });

  it('a live session keeps its stream across heartbeats', async () => {
    const s = await sessionFor(h.a);
    const list = await newList(s);
    const c = await subscribe(s, list.id);
    await c.waitFor((x) => x.comments >= 2, HEARTBEAT_MS * 5);
    expect(c.isEnded()).toBe(false);
  });
});
