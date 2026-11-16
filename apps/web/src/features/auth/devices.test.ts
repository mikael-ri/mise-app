import { describe, expect, it } from 'vitest';
import { device } from '../../test/fixtures.js';
import { isJustNow, sortDevices } from './devices.js';

describe('devices ordering (FR-30)', () => {
  it('puts the current device first, then newest lastSeenAt', () => {
    const rows = [
      device({ id: 'a', lastSeenAt: '2026-10-20T00:00:00Z' }),
      device({ id: 'b', lastSeenAt: '2026-10-26T00:00:00Z' }),
      device({ id: 'c', lastSeenAt: '2026-10-01T00:00:00Z', current: true }),
    ];
    expect(sortDevices(rows).map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0]?.id).toBe('a');
  });

  it('treats under a minute as just now', () => {
    const now = Date.parse('2026-10-24T10:00:00Z');
    expect(isJustNow('2026-10-24T09:59:30Z', now)).toBe(true);
    expect(isJustNow('2026-10-24T09:58:00Z', now)).toBe(false);
  });
});
