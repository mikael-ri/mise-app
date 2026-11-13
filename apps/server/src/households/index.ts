// Public surface of the households module. Other modules import only from here.
export { createHouseholdsService, ProvisionHouseholdInput } from './service.js';
export type { ActorMembership, HouseholdsService, HouseholdView, MemberView } from './service.js';
