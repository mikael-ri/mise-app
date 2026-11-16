import type { DeviceSession, MeResponse } from '@mise/contracts';

export const ME: MeResponse = {
  user: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Anna' },
  household: {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Home',
    timezone: 'Europe/Helsinki',
  },
  member: { id: '44444444-4444-4444-8444-444444444444', role: 'owner' },
  session: { id: '11111111-1111-4111-8111-111111111111', authenticatedAt: '2026-10-24T08:00:00Z' },
  csrfToken: 'csrf-token',
} as MeResponse;

export function device(
  overrides: Partial<Omit<DeviceSession, 'id'>> & { id: string },
): DeviceSession {
  return {
    member: { id: ME.member.id, displayName: 'Anna' },
    deviceLabel: 'Pixel 8 - Chrome',
    createdAt: '2026-10-24T08:00:00Z',
    lastSeenAt: '2026-10-24T09:00:00Z',
    authenticatedAt: '2026-10-24T08:00:00Z',
    idleExpiresAt: '2026-11-24T08:00:00Z',
    absoluteExpiresAt: '2027-01-24T08:00:00Z',
    current: false,
    ...overrides,
    id: overrides.id as DeviceSession['id'],
  };
}
