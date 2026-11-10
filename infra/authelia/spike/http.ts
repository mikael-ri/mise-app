// Spike A03: tiny HTTP client for the spike. Resolves *.mydomain.test to 127.0.0.1 and trusts the dev CA.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

export interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const CA = readFileSync(fileURLToPath(new URL('../tls/ca.pem', import.meta.url)));

export function request(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Res> {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        ca: CA,
        lookup: (host, o, cb) => {
          if (!host.endsWith('.mydomain.test'))
            return cb(new Error(`unexpected host ${host}`), '', 4);
          // Node >= 20 may ask for all addresses (array form).
          if (o.all)
            (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
              { address: '127.0.0.1', family: 4 },
            ]);
          else cb(null, '127.0.0.1', 4);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
