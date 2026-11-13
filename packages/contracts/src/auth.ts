import { z } from 'zod';
import { DeviceSessionId, HouseholdId, Instant, MemberId, UserId } from './common.js';
import { MEMBER_ROLES } from './enums.js';

/**
 * Optional post-login return path. Same-origin relative path only: must start with a single `/`
 * (no `//host` or `/\host`), so it cannot become an open redirect.
 */
export const ReturnToPath = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[^\s\\]*$/, 'expected a same-origin relative path');

export const OidcStartQuery = z.strictObject({ returnTo: ReturnToPath.optional() });
export type OidcStartQuery = z.infer<typeof OidcStartQuery>;

/** Authorization response from Authelia: either `code` or `error`, always with `state`. */
export const OidcCallbackQuery = z
  .object({
    state: z.string().min(1).max(512),
    code: z.string().min(1).max(2048).optional(),
    iss: z.string().max(512).optional(),
    error: z.string().max(128).optional(),
    error_description: z.string().max(1024).optional(),
  })
  .refine((q) => (q.code === undefined) !== (q.error === undefined), {
    message: 'exactly one of code or error is required',
  });
export type OidcCallbackQuery = z.infer<typeof OidcCallbackQuery>;

export const MeResponse = z
  .strictObject({
    user: z.strictObject({ id: UserId, displayName: z.string() }),
    household: z.strictObject({ id: HouseholdId, name: z.string(), timezone: z.string() }),
    member: z.strictObject({ id: MemberId, role: z.enum(MEMBER_ROLES) }),
    session: z.strictObject({ id: DeviceSessionId, authenticatedAt: Instant }),
  })
  .meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof MeResponse>;

/** A device session as shown to its owner. Never includes the token or its digest. */
export const DeviceSession = z
  .strictObject({
    id: DeviceSessionId,
    deviceLabel: z.string().nullable(),
    createdAt: Instant,
    lastSeenAt: Instant,
    authenticatedAt: Instant,
    idleExpiresAt: Instant,
    absoluteExpiresAt: Instant,
    current: z.boolean(),
  })
  .meta({ id: 'DeviceSession' });
export type DeviceSession = z.infer<typeof DeviceSession>;

export const DeviceSessionList = z
  .strictObject({ items: z.array(DeviceSession) })
  .meta({ id: 'DeviceSessionList' });
export type DeviceSessionList = z.infer<typeof DeviceSessionList>;

export const DeviceSessionParams = z.strictObject({ sessionId: DeviceSessionId });
