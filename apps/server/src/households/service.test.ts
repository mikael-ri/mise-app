import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createHouseholdsService, ProvisionHouseholdInput } from './service.js';

const member = (subject: string) => ({
  oidcIssuer: 'https://auth.test',
  oidcSubject: subject,
  displayName: 'Name',
});
const valid = { name: 'Home', members: [member('a'), member('b')] };

describe('ProvisionHouseholdInput (FR-30)', () => {
  it('defaults the timezone to Europe/Helsinki', () => {
    expect(ProvisionHouseholdInput.parse(valid).timezone).toBe('Europe/Helsinki');
  });
  it.each([
    ['bad timezone', { ...valid, timezone: 'Mars/Olympus' }],
    ['one member', { ...valid, members: [member('a')] }],
    ['three members', { ...valid, members: [member('a'), member('b'), member('c')] }],
    ['empty name', { ...valid, name: ' ' }],
    ['non-URL issuer', { ...valid, members: [{ ...member('a'), oidcIssuer: 'x' }, member('b')] }],
    ['extra role field', { ...valid, members: [{ ...member('a'), role: 'owner' }, member('b')] }],
  ])('rejects %s', (_n, input) => {
    expect(ProvisionHouseholdInput.safeParse(input).success).toBe(false);
  });
});

describe('households service (FR-30, FR-31)', () => {
  it('rejects the same identity provisioned twice before touching the database', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const svc = createHouseholdsService(pool as never);
    await expect(
      svc.provisionHousehold({ name: 'Home', members: [member('a'), member('a')] }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('resolveActor returns the membership of the session user', async () => {
    const [u, h, m] = [randomUUID(), randomUUID(), randomUUID()];
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ user_id: u, household_id: h, member_id: m }] }),
    };
    const actor = await createHouseholdsService(pool as never).resolveActor(u);
    expect(actor).toEqual({ userId: u, householdId: h, memberId: m });
  });

  it('resolveActor denies a user with no active membership', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(
      createHouseholdsService(pool as never).resolveActor(randomUUID()),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('listHouseholdMembers (FR-34, FR-37)', () => {
  it('scopes by the actor household and returns only id and displayName', async () => {
    const memberId = randomUUID();
    const householdId = randomUUID();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: memberId,
          user_id: randomUUID(),
          display_name: 'Anna',
          role: 'owner',
          joined_at: new Date(),
        },
      ],
    });
    const svc = createHouseholdsService({ query, connect: vi.fn() } as never);
    const out = await svc.listHouseholdMembers({
      householdId,
      userId: randomUUID(),
      memberId,
    } as never);
    expect(out).toEqual([{ id: memberId, displayName: 'Anna' }]);
    expect(query.mock.calls[0]![1][0]).toBe(householdId);
  });
});
