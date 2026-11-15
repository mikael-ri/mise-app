import { describe, expect, it, vi } from 'vitest';
import type { OperatorService } from '../auth/index.js';
import { AppError } from '../platform/index.js';
import { runProvisionUser, runRevokeSessions } from './operator-run.js';
import type { OperatorCliDeps } from './operator-run.js';

const M1 = '44444444-4444-4444-8444-444444444444';
const M2 = '55555555-5555-4555-8555-555555555555';
const SUBJECT = 'secret-subject';
const env = { DATABASE_URL: 'postgres://u:topsecret@db:5432/mise' };

function setup(service: Partial<OperatorService> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const end = vi.fn().mockResolvedValue(undefined);
  const s: OperatorService = {
    linkIdentity: vi.fn(async () => ({ revoked: 2 })),
    revokeSessions: vi.fn(async () => ({ revoked: 3 })),
    ...service,
  };
  const deps = {
    createPool: vi.fn().mockReturnValue({ end }),
    createService: () => s,
  } as unknown as OperatorCliDeps;
  const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
  return { out, err, end, s, deps, io };
}

describe('provision-user CLI (FR-30, AC-11)', () => {
  const args = ['--member', M1, '--issuer', 'https://auth.test', '--subject', SUBJECT];

  it('links the member and reports revoked sessions without echoing the subject', async () => {
    const t = setup();
    expect(await runProvisionUser(args, env, t.io, t.deps)).toBe(0);
    expect(t.s.linkIdentity).toHaveBeenCalledWith(M1, 'https://auth.test', SUBJECT);
    expect(t.out).toEqual([`linked member ${M1}; revoked 2 session(s)`]);
    expect(t.out.join()).not.toContain(SUBJECT);
    expect(t.end).toHaveBeenCalled();
  });

  it.each([
    ['missing subject', ['--member', M1, '--issuer', 'https://auth.test']],
    ['bad member id', ['--member', 'x', '--issuer', 'https://auth.test', '--subject', 's']],
    ['http issuer', ['--member', M1, '--issuer', 'http://auth.test', '--subject', 's']],
    ['unknown flag', [...args, '--mint-session']],
  ])('refuses %s without touching the database', async (_n, argv) => {
    const t = setup();
    expect(await runProvisionUser(argv, env, t.io, t.deps)).toBe(1);
    expect(t.s.linkIdentity).not.toHaveBeenCalled();
  });

  it('reports service errors by message only', async () => {
    const t = setup({
      linkIdentity: async () => {
        throw new AppError('conflict', 'that OIDC identity is already linked to another user');
      },
    });
    expect(await runProvisionUser(args, env, t.io, t.deps)).toBe(1);
    expect(t.err).toEqual(['that OIDC identity is already linked to another user']);
    expect(t.err.join()).not.toContain('topsecret');
  });
});

describe('revoke-sessions CLI (AC-11)', () => {
  it('revokes the given members', async () => {
    const t = setup();
    expect(await runRevokeSessions(['--member', M1, '--member', M2], env, t.io, t.deps)).toBe(0);
    expect(t.s.revokeSessions).toHaveBeenCalledWith([M1, M2]);
    expect(t.out).toEqual(['revoked 3 session(s)']);
  });

  it('revokes everyone with --all', async () => {
    const t = setup();
    expect(await runRevokeSessions(['--all'], env, t.io, t.deps)).toBe(0);
    expect(t.s.revokeSessions).toHaveBeenCalledWith(null);
  });

  it.each([[[]], [['--all', '--member', M1]], [['--member', 'nope']]])(
    'refuses %j',
    async (argv) => {
      const t = setup();
      expect(await runRevokeSessions(argv, env, t.io, t.deps)).toBe(1);
      expect(t.s.revokeSessions).not.toHaveBeenCalled();
    },
  );
});
