import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './errors.js';
import {
  canonicalJson,
  parseIdempotencyKey,
  requestHash,
  startPeriodicSweep,
} from './idempotency.js';

describe('startPeriodicSweep (ADR-013 expiry sweep)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps on every interval, reports counts and errors, and stops cleanly', async () => {
    vi.useFakeTimers();
    const sweep = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(3)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(0);
    const onSwept = vi.fn();
    const onError = vi.fn();
    const stop = startPeriodicSweep({ sweep, intervalMs: 1000, onSwept, onError });

    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSwept).toHaveBeenCalledWith(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it('never runs two sweeps at once when one is slower than the interval', async () => {
    vi.useFakeTimers();
    let release: (n: number) => void = () => {};
    const sweep = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));
    const stop = startPeriodicSweep({
      sweep,
      intervalMs: 1000,
      onSwept: () => {},
      onError: () => {},
    });
    await vi.advanceTimersByTimeAsync(3500);
    expect(sweep).toHaveBeenCalledTimes(1);
    release(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('idempotency helpers (NFR-04)', () => {
  it('canonicalJson sorts keys, drops undefined and is whitespace free', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"z":1}]},"b":1}',
    );
  });

  it('hash ignores key order but depends on operation and values', () => {
    const h = requestHash('recipes.create', { a: 1, b: 2 });
    expect(h).toHaveLength(32);
    expect(requestHash('recipes.create', { b: 2, a: 1 }).equals(h)).toBe(true);
    expect(requestHash('recipes.create', { a: 1, b: 3 }).equals(h)).toBe(false);
    expect(requestHash('recipes.restore', { a: 1, b: 2 }).equals(h)).toBe(false);
  });

  it('parseIdempotencyKey: missing -> 400 idempotency_key_required, malformed -> validation_failed', () => {
    expect(() => parseIdempotencyKey(undefined)).toThrowError(
      expect.objectContaining({ code: 'idempotency_key_required' }),
    );
    expect(() => parseIdempotencyKey('short')).toThrowError(AppError);
    expect(parseIdempotencyKey('a'.repeat(16))).toBe('a'.repeat(16));
  });
});
