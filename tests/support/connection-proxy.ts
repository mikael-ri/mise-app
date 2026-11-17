// Test-only TCP forwarder in front of Vite (listens on the public test origin; Vite itself runs on its own port,
// see e2e-ports.ts), so E2E can really drop the live-list event streams (AC-08 reconnect). `context.setOffline(true)`
// does not close a stream that is already open in Chromium, and cutting the API side is hidden by Vite's
// own /api proxy, so the break has to happen on the browser's connection.
//
// Everything is forwarded untouched. A connection that sends `GET /api/v1/shopping-lists/<id>/events` is a
// stream. `POST /cut` on the control port destroys all open streams and refuses new ones; `POST /restore`
// lets them through again, and the browser's own EventSource retry then reconnects. Only streams are
// affected: pages and REST calls keep working while cut.
import { createServer as createHttpServer } from 'node:http';
import net from 'node:net';

const LISTEN = Number(process.env['PROXY_LISTEN_PORT'] ?? 5183);
const TARGET = Number(process.env['PROXY_TARGET_PORT'] ?? 5184);
const CONTROL = Number(process.env['PROXY_CONTROL_PORT'] ?? 3102);
const STREAM_REQUEST = /^GET \/api\/v1\/shopping-lists\/[^ ?]+\/events[ ?]/m;

let cut = false;
const streams = new Map<net.Socket, net.Socket>();

net
  .createServer((client) => {
    const upstream = net.connect(TARGET, '127.0.0.1');
    let isStream = false;
    client.on('data', (chunk) => {
      if (!isStream && STREAM_REQUEST.test(chunk.toString('latin1'))) {
        if (cut) {
          client.destroy();
          upstream.destroy();
          return;
        }
        isStream = true;
        streams.set(client, upstream);
      }
      upstream.write(chunk);
    });
    upstream.pipe(client);
    const close = () => {
      streams.delete(client);
      client.destroy();
      upstream.destroy();
    };
    client.on('close', close).on('error', close);
    upstream.on('close', close).on('error', close);
  })
  .listen(LISTEN, '127.0.0.1');

createHttpServer((req, res) => {
  if (req.method === 'POST' && req.url === '/cut') {
    cut = true;
    for (const [client, upstream] of streams) {
      client.destroy();
      upstream.destroy();
    }
    streams.clear();
  } else if (req.method === 'POST' && req.url === '/restore') {
    cut = false;
  } else {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(204).end();
}).listen(CONTROL, '127.0.0.1');
