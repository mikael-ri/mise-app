// Spike A03: RFC 6238 TOTP (SHA1) for the throwaway test client. Not used by Mise itself.
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: Buffer, epochSeconds: number, digits = 6, period = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(epochSeconds / period)));
  const h = createHmac('sha1', secret).update(counter).digest();
  const offset = (h[h.length - 1] ?? 0) & 0x0f;
  const bin =
    (((h[offset] ?? 0) & 0x7f) << 24) |
    ((h[offset + 1] ?? 0) << 16) |
    ((h[offset + 2] ?? 0) << 8) |
    (h[offset + 3] ?? 0);
  return String(bin % 10 ** digits).padStart(digits, '0');
}
