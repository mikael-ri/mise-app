import type { DeviceSession } from '@mise/contracts';

const JUST_NOW_MS = 60_000;

/** Current device first, then most recently active. Does not mutate the input. */
export function sortDevices(devices: readonly DeviceSession[]): DeviceSession[] {
  return [...devices].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });
}

export function isJustNow(lastSeenAt: string, now: number): boolean {
  return now - Date.parse(lastSeenAt) < JUST_NOW_MS;
}
