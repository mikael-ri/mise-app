// Controls tests/support/connection-proxy.ts: drops or restores the live-list event streams.
import { E2E_PROXY_CONTROL_PORT } from './e2e-ports.js';

const CONTROL = `http://127.0.0.1:${E2E_PROXY_CONTROL_PORT}`;

export async function cutStreams(): Promise<void> {
  const res = await fetch(`${CONTROL}/cut`, { method: 'POST' });
  if (res.status !== 204) throw new Error(`stream proxy answered ${res.status}`);
}

export async function restoreStreams(): Promise<void> {
  const res = await fetch(`${CONTROL}/restore`, { method: 'POST' });
  if (res.status !== 204) throw new Error(`stream proxy answered ${res.status}`);
}
