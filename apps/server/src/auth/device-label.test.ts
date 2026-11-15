import { describe, expect, it } from 'vitest';
import { USER_AGENT_MAX, deriveDeviceLabel, storableUserAgent } from './device-label.js';

describe('deriveDeviceLabel (AC-11 device list)', () => {
  it.each([
    ['Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0', 'Firefox on Android'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
      'Chrome on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Safari on macOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    ['curl/8.5.0', null],
    [null, null],
  ])('%s -> %s', (ua, label) => {
    expect(deriveDeviceLabel(ua)).toBe(label);
  });
});

describe('storableUserAgent', () => {
  it.each<[string | undefined, string | null]>([
    [undefined, null],
    ['   ', null],
    [' Firefox/1 ', 'Firefox/1'],
    ['a\u0000b\nc', 'abc'],
  ])('%j -> %j', (header, stored) => {
    expect(storableUserAgent(header)).toBe(stored);
  });

  it(`truncates to ${USER_AGENT_MAX} characters`, () => {
    expect(storableUserAgent('x'.repeat(500))).toHaveLength(USER_AGENT_MAX);
  });
});
