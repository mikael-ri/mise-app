// Test-only SSE reader over real HTTP (inject cannot observe an open stream). Never imported by
// production code.
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { ShoppingListEvent } from '@mise/contracts';

export interface SseConnection {
  status: number;
  headers: IncomingHttpHeaders;
  /** Parsed `data:` payloads, strictly validated against the contract. */
  events: ShoppingListEvent[];
  /** Raw `id:` values, in order. */
  ids: string[];
  /** Comment lines seen (heartbeats). */
  comments: number;
  /** Non-stream body (error responses). */
  body: string;
  /** Resolves when the server ends the response or the socket closes. */
  ended: Promise<void>;
  isEnded(): boolean;
  waitFor(pred: (c: SseConnection) => boolean, timeoutMs?: number): Promise<void>;
  close(): void;
}

export function openSse(baseUrl: string, path: string, cookie?: string): Promise<SseConnection> {
  return new Promise((resolve, reject) => {
    const req = request(
      `${baseUrl}${path}`,
      { headers: { accept: 'text/event-stream', ...(cookie ? { cookie } : {}) } },
      (res) => {
        let buffer = '';
        let ended = false;
        let onEnd: () => void = () => {};
        const waiters = new Set<() => void>();
        const conn: SseConnection = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          events: [],
          ids: [],
          comments: 0,
          body: '',
          ended: new Promise<void>((r) => (onEnd = r)),
          isEnded: () => ended,
          waitFor(pred, timeoutMs = 3_000) {
            if (pred(conn)) return Promise.resolve();
            return new Promise((ok, fail) => {
              const check = () => {
                if (!pred(conn)) return;
                clearTimeout(t);
                waiters.delete(check);
                ok();
              };
              const t = setTimeout(() => {
                waiters.delete(check);
                fail(new Error(`SSE condition not met in ${timeoutMs} ms`));
              }, timeoutMs);
              waiters.add(check);
            });
          },
          close: () => req.destroy(),
        };
        const notify = () => {
          for (const w of [...waiters]) w();
        };
        const finish = () => {
          if (ended) return;
          ended = true;
          onEnd();
          notify();
        };
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (!String(res.headers['content-type']).startsWith('text/event-stream')) {
            conn.body += chunk;
            return;
          }
          buffer += chunk;
          let at: number;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) conn.comments += 1;
              else if (line.startsWith('id: ')) conn.ids.push(line.slice(4));
              else if (line.startsWith('data: ')) {
                conn.events.push(ShoppingListEvent.parse(JSON.parse(line.slice(6))));
              }
            }
          }
          notify();
        });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
        resolve(conn);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Last seq a connection has received, or -1. */
export const lastSeq = (c: SseConnection): number => c.events.at(-1)?.seq ?? -1;
