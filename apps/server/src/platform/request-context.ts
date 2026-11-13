import type { FastifyRequest } from 'fastify';
import type { DeviceSessionId, HouseholdId, MemberId, UserId } from '@mise/contracts';
import { AppError } from './errors.js';

/**
 * The authenticated actor. Populated from the session only (A07), never from client input or an
 * LLM (hard rule 2). Every service takes household and member from here.
 */
export interface RequestContext {
  readonly userId: UserId;
  readonly householdId: HouseholdId;
  readonly memberId: MemberId;
  readonly deviceSessionId: DeviceSessionId;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** `null` until the auth hook sets it; unauthenticated routes leave it `null`. */
    actor: RequestContext | null;
  }
}

export function requireActor(request: FastifyRequest): RequestContext {
  if (request.actor === null) throw new AppError('unauthenticated', 'authentication required');
  return request.actor;
}
