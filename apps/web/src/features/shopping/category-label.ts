import type { ShoppingCategory } from '@mise/contracts';
import { t } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/index.js';

type Code = NonNullable<ShoppingCategory['systemCode']>;

const LABEL_KEYS: Record<Code, MessageKey> = {
  vegetables: 'shopping.category.vegetables',
  fruit: 'shopping.category.fruit',
  dairy: 'shopping.category.dairy',
  meat: 'shopping.category.meat',
  dry_goods: 'shopping.category.dryGoods',
  household_supplies: 'shopping.category.householdSupplies',
  other: 'shopping.category.other',
};

/** System categories show the i18n string for their code; household categories show their name. */
export function categoryLabel(category: Pick<ShoppingCategory, 'systemCode' | 'name'>): string {
  return category.systemCode === null ? category.name : t(LABEL_KEYS[category.systemCode]);
}
