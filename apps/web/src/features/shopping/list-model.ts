import type { ShoppingCategory, ShoppingItem } from '@mise/contracts';

/** Pure view model for the list screen (FR-36, FR-37): grouping, picked split, progress, announcements. */

export interface CategoryGroup {
  category: ShoppingCategory;
  items: ShoppingItem[];
}

export interface ListView {
  /** Not-yet-picked items by category; empty categories omitted. */
  open: CategoryGroup[];
  /** Picked items by category (shown in the collapsed Picked up section). */
  picked: CategoryGroup[];
  pickedCount: number;
  total: number;
}

/** Household timezone default (hard rule 7) when `me` does not carry one. */
export const HOUSEHOLD_TIMEZONE = 'Europe/Helsinki';

/**
 * Grouping fallback only, never rendered as a real category by itself: used when the category list
 * is unavailable or lacks `other`, so items still land in an Other group.
 */
const FALLBACK_OTHER: ShoppingCategory = {
  id: '00000000-0000-4000-8000-000000000000' as ShoppingCategory['id'],
  systemCode: 'other',
  name: 'Other',
  sortOrder: 1000,
};

/** Category order: sortOrder, `other` always last, ties by name then id. */
export function sortCategories(categories: readonly ShoppingCategory[]): ShoppingCategory[] {
  const isOther = (c: ShoppingCategory) => c.systemCode === 'other';
  return [...categories].sort(
    (a, b) =>
      Number(isOther(a)) - Number(isOther(b)) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

const byCreated = (a: ShoppingItem, b: ShoppingItem) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

function group(
  items: readonly ShoppingItem[],
  ordered: readonly ShoppingCategory[],
  other: ShoppingCategory,
): CategoryGroup[] {
  const known = new Set(ordered.map((c) => c.id));
  const buckets = new Map<string, ShoppingItem[]>();
  for (const item of [...items].sort(byCreated)) {
    // No category, or one this household no longer has: Other.
    const key = item.categoryId !== null && known.has(item.categoryId) ? item.categoryId : other.id;
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  return ordered.flatMap((category) => {
    const found = buckets.get(category.id);
    return found === undefined ? [] : [{ category, items: found }];
  });
}

export function buildListView(
  items: readonly ShoppingItem[],
  categories: readonly ShoppingCategory[],
): ListView {
  const other = categories.find((c) => c.systemCode === 'other') ?? FALLBACK_OTHER;
  const ordered = sortCategories(
    categories.some((c) => c.id === other.id) ? categories : [...categories, other],
  );
  const picked = items.filter((i) => i.picked);
  return {
    open: group(
      items.filter((i) => !i.picked),
      ordered,
      other,
    ),
    picked: group(picked, ordered, other),
    pickedCount: picked.length,
    total: items.length,
  };
}

/** Category an item is shown under (same fallback as grouping). */
export function categoryOf(
  item: Pick<ShoppingItem, 'categoryId'>,
  categories: readonly ShoppingCategory[],
): ShoppingCategory {
  const other = categories.find((c) => c.systemCode === 'other') ?? FALLBACK_OTHER;
  return categories.find((c) => c.id === item.categoryId) ?? other;
}

/** Local checkoff state per item: shown optimistically while pending; a rejected one is reverted. */
export interface CheckoffEntry {
  desired: boolean;
  status: 'pending' | 'rejected';
}

/** Items as displayed: a pending checkoff shows its desired state at once (FR-37). */
export function applyCheckoff(
  items: readonly ShoppingItem[],
  entries: ReadonlyMap<string, CheckoffEntry>,
): ShoppingItem[] {
  return items.map((item) => {
    const entry = entries.get(item.id);
    return entry?.status === 'pending' && entry.desired !== item.picked
      ? { ...item, picked: entry.desired }
      : item;
  });
}

/** Whether the row shows its "not saved" warning: rejected and the server still disagrees. */
export function isRejected(item: ShoppingItem, entry: CheckoffEntry | undefined): boolean {
  return entry?.status === 'rejected' && entry.desired !== item.picked;
}

export type ChangeKind = 'picked' | 'unpicked' | 'added' | 'removed' | 'changed';
export interface ItemChange {
  kind: ChangeKind;
  itemId: string;
  name: string;
  /** Who picked it, for `picked` changes, when the snapshot says. */
  memberId?: string;
}

/** Differences between two snapshots, for the polite live-region announcement. */
export function diffItems(
  before: readonly ShoppingItem[],
  after: readonly ShoppingItem[],
): ItemChange[] {
  const prev = new Map(before.map((i) => [i.id as string, i]));
  const next = new Map(after.map((i) => [i.id as string, i]));
  const changes: ItemChange[] = [];
  for (const item of after) {
    const old = prev.get(item.id);
    if (old === undefined) changes.push({ kind: 'added', itemId: item.id, name: item.name });
    else if (old.picked !== item.picked)
      changes.push({
        kind: item.picked ? 'picked' : 'unpicked',
        itemId: item.id,
        name: item.name,
        ...(item.picked && item.pickedByMemberId !== null
          ? { memberId: item.pickedByMemberId }
          : {}),
      });
    else if (old.revision !== item.revision)
      changes.push({ kind: 'changed', itemId: item.id, name: item.name });
  }
  for (const item of before) {
    if (!next.has(item.id)) changes.push({ kind: 'removed', itemId: item.id, name: item.name });
  }
  return changes;
}

/** Units offered as tap-to-insert chips (owner decision, A15: one free-text quantity field). */
export const UNIT_CHIPS = ['kpl', 'l', 'dl', 'g', 'kg', 'prk'] as const;

const TRAILING_UNIT = new RegExp(`^(.*?\\d)\\s*(?:${UNIT_CHIPS.join('|')})$`, 'i');

/**
 * Puts `unit` into the free quantity text: after the number, replacing a unit chip already there,
 * else appended. The text is never parsed back into fields; it maps 1:1 to `quantityText`.
 */
export function insertUnit(text: string, unit: string): string {
  const trimmed = text.trimEnd();
  if (trimmed === '') return unit;
  const replaced = TRAILING_UNIT.exec(trimmed);
  if (replaced?.[1] !== undefined) return `${replaced[1]} ${unit}`;
  return `${trimmed} ${unit}`;
}

/** Time today, otherwise the date, in the household timezone (S1 "updated 10:42" / "updated Mon"). */
export function formatUpdated(
  instant: string,
  now: Date,
  options: { locale: string; timeZone: string },
): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: options.timeZone }).format(d);
  const date = new Date(instant);
  if (day(date) === day(now)) {
    return new Intl.DateTimeFormat(options.locale, {
      timeStyle: 'short',
      timeZone: options.timeZone,
    }).format(date);
  }
  return new Intl.DateTimeFormat(options.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    timeZone: options.timeZone,
  }).format(date);
}

/** Weekday and time for attribution lines ("Mon 08:15"), in the household timezone. */
export function formatWhen(instant: string, options: { locale: string; timeZone: string }): string {
  return new Intl.DateTimeFormat(options.locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: options.timeZone,
  }).format(new Date(instant));
}
