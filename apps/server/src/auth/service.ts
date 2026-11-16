import { DeviceSessionId, HouseholdId, MemberId, UserId } from '@mise/contracts';
import type { DeviceSession, MeResponse, OidcCallbackQuery } from '@mise/contracts';
import type { HouseholdsService } from '../households/index.js';
import { AppError, issueCsrfToken, withTransaction } from '../platform/index.js';
import type { OidcConfig, Pool, RequestContext } from '../platform/index.js';
import { newSessionToken, sessionTokenDigest } from './cookies.js';
import type { LoginState } from './cookies.js';
import { deriveDeviceLabel, storableUserAgent } from './device-label.js';
import type { IdpClient } from './idp.js';
import {
  OidcError,
  buildAuthorizationUrl,
  randomUrlToken,
  safeEqual,
  validateIdToken,
} from './oidc.js';
import type { RevocationHub } from './revocation.js';
import * as repo from './repository.js';

const DAY_MS = 86_400_000;
/** ADR-003 addendum D2: 180 days absolute, 90 days idle (sliding). */
export const SESSION_ABSOLUTE_MS = 180 * DAY_MS;
export const SESSION_IDLE_MS = 90 * DAY_MS;
/** Sliding-expiry writes happen at most this often per session. */
export const TOUCH_INTERVAL_MS = 5 * 60_000;

export const CALLBACK_PATH = '/api/v1/auth/oidc/callback';

export interface AuthServiceDeps {
  pool: Pool;
  households: HouseholdsService;
  idp: IdpClient;
  revocations: RevocationHub;
  oidc: OidcConfig;
  publicOrigin: string;
  csrfSecret: string;
  now?: () => Date;
}

export interface StartedLogin {
  authorizationUrl: string;
  state: LoginState;
}

export interface CompletedLogin {
  /** Plaintext session token for the cookie. Never stored or logged. */
  token: string;
  sessionId: string;
  returnTo: string;
  maxAgeSeconds: number;
}

export interface LoginClient {
  userAgent: string | undefined;
  /**
   * The session this browser still held when the callback arrived (from the session hook). It is
   * revoked once the new session exists, because the new cookie overwrites the old token and would
   * leave it live but unusable for up to 90 days. A failed login leaves it untouched.
   */
  replacing: RequestContext | null;
}

export interface AuthService {
  startLogin(returnTo: string | undefined): Promise<StartedLogin>;
  /**
   * Verifies the callback against the login state and creates a new device session. The only path
   * that creates sessions (no bypass, ADR-003). Throws `OidcError` with a loggable reason.
   */
  completeLogin(
    query: OidcCallbackQuery,
    state: LoginState | null,
    client: LoginClient,
  ): Promise<CompletedLogin>;
  /** Resolves a session cookie to the actor, or null. Checks revocation and expiry every call. */
  authenticate(token: string): Promise<RequestContext | null>;
  /**
   * Whether the actor's device session is still valid (not revoked or expired, user active and in the
   * same household). Read-only; for long-lived streams that authenticated once (A14).
   */
  isSessionLive(actor: RequestContext): Promise<boolean>;
  me(actor: RequestContext): Promise<MeResponse>;
  listDevices(actor: RequestContext): Promise<DeviceSession[]>;
  /** Revokes a session of the actor's household. 404 for unknown or other-household sessions. */
  revokeDevice(actor: RequestContext, sessionId: string): Promise<void>;
  logout(actor: RequestContext): Promise<void>;
}

export function createAuthService(d: AuthServiceDeps): AuthService {
  const now = d.now ?? (() => new Date());
  const redirectUri = `${d.publicOrigin}${CALLBACK_PATH}`;

  async function revoke(householdId: string, sessionId: string): Promise<boolean> {
    const r = await repo.revokeHouseholdSession(d.pool, householdId, sessionId, now());
    if (r.newlyRevoked) d.revocations.publish(sessionId);
    return r.found;
  }

  return {
    async startLogin(returnTo) {
      const { authorizationEndpoint } = await d.idp.endpoints();
      const state: LoginState = {
        state: randomUrlToken(),
        nonce: randomUrlToken(),
        codeVerifier: randomUrlToken(48),
        startedAt: now().getTime(),
        returnTo: returnTo ?? '/',
      };
      const authorizationUrl = buildAuthorizationUrl({
        authorizationEndpoint,
        clientId: d.oidc.clientId,
        redirectUri,
        state: state.state,
        nonce: state.nonce,
        codeVerifier: state.codeVerifier,
      });
      return { authorizationUrl, state };
    },

    async completeLogin(query, state, client) {
      if (state === null) throw new OidcError('login_state_invalid');
      if (!safeEqual(query.state, state.state)) throw new OidcError('state_mismatch');
      if (query.error !== undefined || query.code === undefined) throw new OidcError('idp_error');
      const endpoints = await d.idp.endpoints();
      // RFC 9207 mix-up defence.
      if (query.iss !== undefined ? query.iss !== d.oidc.issuer : endpoints.issParameterRequired) {
        throw new OidcError('issuer_param_mismatch');
      }

      // External calls first; no transaction is open (hard rule 8).
      const idToken = await d.idp.exchangeCode(query.code, state.codeVerifier, redirectUri);
      const check = async (forceRefresh: boolean) =>
        validateIdToken({
          token: idToken,
          jwks: await d.idp.jwks(forceRefresh),
          issuer: d.oidc.issuer,
          clientId: d.oidc.clientId,
          nonce: state.nonce,
          now: Math.floor(now().getTime() / 1000),
          loginStartedAt: Math.floor(state.startedAt / 1000),
        });
      let identity;
      try {
        identity = await check(false);
      } catch (err) {
        // Key rotation: retry once with refetched keys (rate-limited in the IdP client).
        if (!(err instanceof OidcError && err.reason === 'kid_unknown')) throw err;
        identity = await check(true);
      }

      const userId = await repo.findActiveUserIdByIdentity(d.pool, d.oidc.issuer, identity.subject);
      if (userId === null) throw new OidcError('subject_not_provisioned');
      try {
        await d.households.resolveActor(userId);
      } catch (err) {
        // Only "no membership" means not provisioned; anything else (DB outage) stays a 5xx.
        if (err instanceof AppError && err.code === 'forbidden') {
          throw new OidcError('subject_not_provisioned');
        }
        throw err;
      }

      const t = now();
      const token = newSessionToken();
      const absoluteExpiresAt = new Date(t.getTime() + SESSION_ABSOLUTE_MS);
      const old = client.replacing;
      // Insert and revoke commit together; every external call has already happened (hard rule 8).
      const { sessionId, oldRevoked } = await withTransaction(d.pool, async (tx) => {
        const id = await repo.insertSession(tx, {
          userId,
          tokenHash: sessionTokenDigest(token)!,
          userAgent: storableUserAgent(client.userAgent),
          now: t,
          authenticatedAt: new Date(identity.authTime * 1000),
          idleExpiresAt: new Date(t.getTime() + SESSION_IDLE_MS),
          absoluteExpiresAt,
        });
        // Scoped to the old session's own household: on a shared browser it may be the partner's.
        const r =
          old === null
            ? null
            : await repo.revokeHouseholdSession(tx, old.householdId, old.deviceSessionId, t);
        return { sessionId: id, oldRevoked: r?.newlyRevoked === true };
      });
      // Signal only after commit, so a rolled-back login never closes the old device's streams.
      if (old !== null && oldRevoked) d.revocations.publish(old.deviceSessionId);
      return {
        token,
        sessionId,
        returnTo: state.returnTo,
        maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / 1000),
      };
    },

    async authenticate(token) {
      const digest = sessionTokenDigest(token);
      if (digest === null) return null;
      const t = now();
      const row = await repo.findValidSession(d.pool, digest, t);
      if (row === null) return null;
      if (t.getTime() - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
        await repo.touchSession(d.pool, row.sessionId, t, new Date(t.getTime() + SESSION_IDLE_MS));
      }
      return {
        userId: UserId.parse(row.userId),
        householdId: HouseholdId.parse(row.householdId),
        memberId: MemberId.parse(row.memberId),
        deviceSessionId: DeviceSessionId.parse(row.sessionId),
      };
    },

    async isSessionLive(actor) {
      return repo.isSessionLive(d.pool, actor.householdId, actor.deviceSessionId, now());
    },

    async me(actor) {
      const [household, members, authenticatedAt] = await Promise.all([
        d.households.getHousehold(actor),
        d.households.listMembers(actor),
        repo.findSessionAuthenticatedAt(d.pool, actor.householdId, actor.deviceSessionId, now()),
      ]);
      const member = members.find((m) => m.id === actor.memberId);
      // Revoked between the hook and here: treat as signed out.
      if (member === undefined || authenticatedAt === null) {
        throw new AppError('unauthenticated', 'authentication required');
      }
      return {
        user: { id: actor.userId, displayName: member.displayName },
        household,
        member: { id: actor.memberId, role: member.role },
        session: {
          id: actor.deviceSessionId,
          authenticatedAt: authenticatedAt.toISOString(),
        },
        csrfToken: issueCsrfToken(d.csrfSecret, actor.deviceSessionId),
      };
    },

    async listDevices(actor) {
      const rows = await repo.listHouseholdSessions(d.pool, actor.householdId, now());
      return rows.map((r) => ({
        id: DeviceSessionId.parse(r.id),
        member: { id: MemberId.parse(r.memberId), displayName: r.displayName },
        // A user-set name wins; otherwise "<browser> on <OS>" from the stored User-Agent.
        deviceLabel: r.deviceLabel ?? deriveDeviceLabel(r.userAgent),
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        authenticatedAt: r.authenticatedAt.toISOString(),
        idleExpiresAt: r.idleExpiresAt.toISOString(),
        absoluteExpiresAt: r.absoluteExpiresAt.toISOString(),
        current: r.id === actor.deviceSessionId,
      }));
    },

    async revokeDevice(actor, sessionId) {
      if (!(await revoke(actor.householdId, sessionId))) {
        throw new AppError('not_found', 'device session not found');
      }
    },

    async logout(actor) {
      await revoke(actor.householdId, actor.deviceSessionId);
    },
  };
}

// --- Operator commands (CLI). They never create sessions (ADR-003, lost-device runbook). ---

export interface OperatorService {
  /** Links a member to a new OIDC identity and revokes that user's existing sessions. */
  linkIdentity(memberId: string, issuer: string, subject: string): Promise<{ revoked: number }>;
  /** Revokes all live sessions of the given members, or of every member when null. */
  revokeSessions(memberIds: readonly string[] | null): Promise<{ revoked: number }>;
}

export function createOperatorService(
  pool: Pool,
  now: () => Date = () => new Date(),
): OperatorService {
  return {
    async linkIdentity(memberId, issuer, subject) {
      try {
        return await withTransaction(pool, async (tx) => {
          const userId = await repo.relinkMemberIdentity(tx, memberId, issuer, subject);
          if (userId === null) throw new AppError('not_found', 'member not found');
          const revoked = await repo.revokeUserSessions(tx, [userId], now());
          return { revoked: revoked.length };
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError('conflict', 'that OIDC identity is already linked to another user');
        }
        throw err;
      }
    },

    async revokeSessions(memberIds) {
      return withTransaction(pool, async (tx) => {
        const members = await repo.findMemberUserIds(tx, memberIds);
        if (memberIds !== null && members.length !== new Set(memberIds).size) {
          throw new AppError('not_found', 'member not found');
        }
        const revoked = await repo.revokeUserSessions(
          tx,
          members.map((m) => m.userId),
          now(),
        );
        return { revoked: revoked.length };
      });
    },
  };
}
