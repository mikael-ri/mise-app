// SSE transport for GET /shopping-lists/:id/events (tech §11, ADR-004, AC-08).
// - Frames carry only `{listId, seq}` (`id: seq`). The first frame is the current committed cursor,
//   so every (re)connect tells the client whether its snapshot is stale; it then refetches over REST.
//   `Last-Event-ID` is therefore not needed: the server always sends the current cursor.
// - Cursors only move forward per stream: an older or repeated seq (commits racing to publish) is
//   dropped, because the client refetches the full snapshot anyway.
// - The device session is rechecked in the database on every heartbeat, and in-process revocations
//   close the stream immediately. A failed recheck closes the stream (fail closed).
// - Sent as a Fastify stream reply, not a hijacked socket, so the platform's security headers apply.
import { PassThrough } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { ShoppingListEvent } from '@mise/contracts';
import { AppError } from '../platform/index.js';
import type { RequestContext } from '../platform/index.js';
import type { ShoppingService } from './service.js';

/** What a stream needs from the auth module; wired in app.ts from `auth/index.ts`. */
export interface StreamSessionGuard {
  /** Calls `listener` once when the session is revoked in this process. Returns unsubscribe. */
  onRevoked(sessionId: string, listener: () => void): () => void;
  /** Database recheck: revoked, expired, deactivated or moved out of the household -> false. */
  isLive(actor: RequestContext): Promise<boolean>;
}

export interface ListStreamOptions {
  sessions: StreamSessionGuard;
  /** Below typical proxy idle timeouts (nginx 60 s). Also bounds how late an out-of-process revocation closes a stream. */
  heartbeatMs?: number;
  /** Open streams per device session; more is a client bug or abuse (429). */
  maxStreamsPerSession?: number;
  /** EventSource reconnect delay sent as `retry:`. */
  retryMs?: number;
}

export const DEFAULT_HEARTBEAT_MS = 25_000;
export const DEFAULT_MAX_STREAMS_PER_SESSION = 8;
const DEFAULT_RETRY_MS = 3_000;
/** A client this far behind is not reading; drop it rather than buffer without bound. */
const MAX_BUFFERED_BYTES = 64 * 1024;

export interface ListStreams {
  open(reply: FastifyReply, actor: RequestContext, listId: string): Promise<FastifyReply>;
  /** Ends every open or opening stream and refuses new ones (server shutdown). */
  closeAll(): void;
}

const frame = (event: ShoppingListEvent): string =>
  `id: ${event.seq}\ndata: ${JSON.stringify(ShoppingListEvent.parse(event))}\n\n`;

export function createListStreams(
  service: Pick<ShoppingService, 'currentEvent' | 'subscribe'>,
  options: ListStreamOptions,
): ListStreams {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const maxPerSession = options.maxStreamsPerSession ?? DEFAULT_MAX_STREAMS_PER_SESSION;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const perSession = new Map<string, number>();
  const active = new Set<() => void>();
  let shuttingDown = false;

  const release = (sessionId: string) => {
    const n = (perSession.get(sessionId) ?? 1) - 1;
    if (n <= 0) perSession.delete(sessionId);
    else perSession.set(sessionId, n);
  };

  return {
    async open(reply, actor, listId) {
      if (shuttingDown) throw new AppError('service_unavailable', 'server is shutting down');
      const sessionId = actor.deviceSessionId;
      // Reserve the slot before any await so concurrent opens cannot overshoot the cap.
      if ((perSession.get(sessionId) ?? 0) >= maxPerSession) {
        throw new AppError('rate_limited', 'too many open event streams for this device');
      }
      perSession.set(sessionId, (perSession.get(sessionId) ?? 0) + 1);

      let closed = false;
      let revoked = false;
      let lastSent = -1;
      let pending = -1; // highest seq signalled before the first frame
      let started = false;
      let timer: NodeJS.Timeout | undefined;
      const body = new PassThrough();

      /**
       * The single exit path: frees the slot, listeners and timer exactly once. `hard` drops the
       * connection at once (a client that does not read must not keep holding the socket).
       */
      function close(hard = false) {
        if (!closed) {
          closed = true;
          if (timer !== undefined) clearTimeout(timer);
          stopRevocation();
          stopEvents();
          active.delete(close);
          release(sessionId);
        }
        if (hard) {
          body.destroy();
          reply.raw.destroy();
        } else {
          body.end();
        }
      }

      const write = (chunk: string) => {
        if (closed) return;
        if (body.writableLength > MAX_BUFFERED_BYTES) return close(true);
        body.write(chunk);
      };
      const send = (event: ShoppingListEvent) => {
        if (event.seq <= lastSent) return;
        lastSent = event.seq;
        write(frame(event));
      };

      // Subscribe before reading the cursor, so no commit can fall between the read and the subscribe.
      const stopRevocation = options.sessions.onRevoked(sessionId, () => {
        revoked = true;
        close();
      });
      const stopEvents = service.subscribe(actor, listId, (event) => {
        if (started) send(event);
        else pending = Math.max(pending, event.seq);
      });
      // Registered before any await: a client that leaves while we authorize still frees everything,
      // and shutdown also reaches streams that are still opening.
      active.add(close);
      reply.raw.once('close', () => close());
      body.once('close', () => close());

      try {
        // 404 for a list outside the actor's household (hard rule 2).
        const current = await service.currentEvent(actor, listId);
        // Closes the window between the request's session check and the revocation subscription.
        if (!(await options.sessions.isLive(actor)) || revoked) {
          throw new AppError('unauthenticated', 'authentication required');
        }
        if (shuttingDown) throw new AppError('service_unavailable', 'server is shutting down');
        if (closed || reply.raw.destroyed) {
          close(true); // client already gone: nothing to send
          return reply;
        }
        started = true;
        write(`retry: ${retryMs}\n\n`);
        send(pending > current.seq ? { listId: current.listId, seq: pending } : current);
      } catch (err) {
        close();
        throw err;
      }

      const heartbeat = async () => {
        timer = undefined;
        // Cannot verify the session: fail closed, the client reconnects.
        const live = await options.sessions.isLive(actor).catch(() => false);
        if (closed) return;
        if (!live) return close();
        write(': heartbeat\n\n');
        if (!closed) timer = setTimeout(() => void heartbeat(), heartbeatMs);
      };
      timer = setTimeout(() => void heartbeat(), heartbeatMs);

      return reply
        .code(200)
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-store')
        .header('x-accel-buffering', 'no')
        .send(body);
    },

    closeAll() {
      shuttingDown = true;
      for (const close of [...active]) close();
    },
  };
}
