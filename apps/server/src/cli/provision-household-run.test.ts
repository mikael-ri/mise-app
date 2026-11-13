import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../platform/index.js';
import type { HouseholdsService } from '../households/index.js';
import { runProvisionHousehold } from './provision-household-run.js';
import type { CliDeps } from './provision-household-run.js';

const SUBJECT_A = 'secret-subject-a';
const DB_URL = 'postgres://u:topsecret@db:5432/mise';
const args = [
  '--name',
  'Home',
  '--issuer',
  'https://auth.test',
  '--owner-subject',
  SUBJECT_A,
  '--owner-name',
  'Ann',
  '--member-subject',
  'secret-subject-b',
  '--member-name',
  'Bob',
];
const env = { DATABASE_URL: DB_URL };

function setup(provision?: HouseholdsService['provisionHousehold']) {
  const out: string[] = [];
  const err: string[] = [];
  const end = vi.fn().mockResolvedValue(undefined);
  const provisionHousehold = vi.fn(
    provision ??
      (async (input) => ({
        id: randomUUID() as never,
        name: input.name,
        timezone: input.timezone ?? 'Europe/Helsinki',
      })),
  );
  const createPool = vi.fn().mockReturnValue({ end });
  const deps = {
    createPool,
    createService: () => ({ provisionHousehold }) as unknown as HouseholdsService,
  } as unknown as CliDeps;
  const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
  return { out, err, end, provisionHousehold, createPool, deps, io };
}

describe('provision-household CLI (FR-30)', () => {
  it('maps arguments: shared issuer, owner first, default timezone, only DATABASE_URL needed', async () => {
    const s = setup();
    expect(await runProvisionHousehold(args, env, s.io, s.deps)).toBe(0);
    expect(s.createPool).toHaveBeenCalledWith(DB_URL, 2);
    const input = s.provisionHousehold.mock.calls[0]![0];
    expect(input.name).toBe('Home');
    expect(input).not.toHaveProperty('timezone');
    expect(input.members[0]).toEqual({
      oidcIssuer: 'https://auth.test',
      oidcSubject: SUBJECT_A,
      displayName: 'Ann',
    });
    expect(input.members[1]).toMatchObject({ oidcIssuer: 'https://auth.test', displayName: 'Bob' });
    expect(s.out[0]).toMatch(/^created household [0-9a-f-]{36} \(Europe\/Helsinki\)$/);
    expect(s.end).toHaveBeenCalledOnce();
  });

  it('passes --timezone through', async () => {
    const s = setup();
    await runProvisionHousehold([...args, '--timezone', 'Europe/Stockholm'], env, s.io, s.deps);
    expect(s.provisionHousehold.mock.calls[0]![0].timezone).toBe('Europe/Stockholm');
  });

  it('missing arguments: exit 1, field names only, no secrets echoed', async () => {
    const s = setup(async (input) => {
      const { ProvisionHouseholdInput } = await import('../households/index.js');
      ProvisionHouseholdInput.parse(input);
      throw new Error('unreachable');
    });
    expect(
      await runProvisionHousehold(
        ['--name', 'Home', '--issuer', 'https://auth.test'],
        env,
        s.io,
        s.deps,
      ),
    ).toBe(1);
    expect(s.err[0]).toMatch(/^invalid input: .*members\.0\.oidcSubject/);
    expect(s.err.join('\n')).not.toContain(DB_URL);
    expect(s.end).toHaveBeenCalledOnce();
  });

  it('missing DATABASE_URL: exit 1 naming the variable, no other settings required, no pool', async () => {
    const s = setup();
    expect(await runProvisionHousehold(args, {}, s.io, s.deps)).toBe(1);
    expect(s.err[0]).toContain('DATABASE_URL');
    expect(s.createPool).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown option', ['--bogus', 'x']],
    ['positional argument', ['stray']],
    ['option without value', ['--name']],
  ])('rejects %s before touching the database', async (_n, extra) => {
    const s = setup();
    expect(await runProvisionHousehold([...args, ...extra], env, s.io, s.deps)).toBe(1);
    expect(s.err).toEqual(['invalid arguments']);
    expect(s.createPool).not.toHaveBeenCalled();
  });

  it('duplicate identity: exit 1 with the service message, nothing sensitive echoed', async () => {
    const s = setup(async () => {
      throw new AppError('conflict', 'an OIDC identity is already provisioned');
    });
    expect(await runProvisionHousehold(args, env, s.io, s.deps)).toBe(1);
    expect(s.err).toEqual(['an OIDC identity is already provisioned']);
    expect(s.err.join('')).not.toContain(SUBJECT_A);
    expect(s.end).toHaveBeenCalledOnce();
  });

  it('unexpected failure: generic message only', async () => {
    const s = setup(async () => {
      throw new Error(`connect failed for ${DB_URL}`);
    });
    expect(await runProvisionHousehold(args, env, s.io, s.deps)).toBe(1);
    expect(s.err).toEqual(['provisioning failed']);
  });
});
