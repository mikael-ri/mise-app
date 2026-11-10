// Spike A03: RFC 6238 test vectors for the spike's TOTP helper (used to log in as the password+TOTP user).
import { describe, expect, it } from 'vitest';
import { base32Decode, totp } from './totp.ts';

const SECRET_ASCII = Buffer.from('12345678901234567890');

describe('totp (RFC 6238 appendix B, SHA1)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('T=%i -> %s (8 digits)', (t, expected) => {
    expect(totp(SECRET_ASCII, t, 8)).toBe(expected);
  });

  it('6 digits is the last 6 of the 8-digit value for the same counter', () => {
    expect(totp(SECRET_ASCII, 59, 6)).toBe('287082');
  });

  it('base32Decode round-trips RFC 4648 vectors', () => {
    expect(base32Decode('MZXW6YTBOI======').toString()).toBe('foobar');
    expect(base32Decode('mzxw6ytboi').toString()).toBe('foobar');
  });

  it('base32Decode rejects invalid characters', () => {
    expect(() => base32Decode('MZXW1')).toThrow(/base32/);
  });
});
