import type { FastifyInstance } from 'fastify';
import { API_PREFIX } from '@mise/contracts';
import type { HouseholdMemberList } from '@mise/contracts';
import { requireActor } from '../platform/index.js';
import type { HouseholdsService } from './service.js';

/** Handlers only authenticate, call one service method and return the result (server rules). */
export function registerHouseholdRoutes(app: FastifyInstance, service: HouseholdsService): void {
  app.get(`${API_PREFIX}/household/members`, async (request): Promise<HouseholdMemberList> => ({
    items: await service.listHouseholdMembers(requireActor(request)),
  }));
}
