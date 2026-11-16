import type { HouseholdMember } from '@mise/contracts';
import { t } from '../../i18n/index.js';

/**
 * Display name for a member id: "You" for the current member, the household display name when
 * known, else a generic label (unknown id, or members not loaded yet).
 */
export function memberName(
  members: readonly HouseholdMember[] | undefined,
  id: string,
  currentMemberId: string | undefined,
): string {
  if (id === currentMemberId) return t('shopping.sheet.memberYou');
  // A blank display name (the DB only enforces NOT NULL) must not render as "picked up by ".
  const name = members?.find((m) => m.id === id)?.displayName.trim();
  return name === undefined || name === '' ? t('shopping.sheet.memberOther') : name;
}
