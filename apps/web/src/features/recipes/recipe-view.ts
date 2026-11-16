import type { Recipe, RecipeSummary } from '@mise/contracts';
import { formatNumber, t } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/index.js';
import { formatServings, parseYield } from './scaling-view.js';

/** "You" for the signed-in member, otherwise a neutral label (no member names in recipe data). */
export function authorKey(createdByMemberId: string, myMemberId: string | undefined): MessageKey {
  return createdByMemberId === myMemberId ? 'recipes.author.you' : 'recipes.author.other';
}

/**
 * Prep + cook minutes, or null when neither is set. Keep in step with the server rule
 * `TOTAL_MINUTES_SQL` (apps/server/src/recipes/repository.ts), which feeds the list summary.
 */
export function totalMinutes(content: Recipe['content']): number | null {
  const { prep_minutes: prep, cook_minutes: cook } = content;
  return prep === null && cook === null ? null : (prep ?? 0) + (cook ?? 0);
}

/** Source as link text, only for http(s) URLs (the stored value is never fetched). */
export function sourceLink(url: string | null): { href: string; label: string } | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return { href: parsed.href, label: `${parsed.host}${path}` };
  } catch {
    return null;
  }
}

/** Tags seen in loaded results plus the selected ones, de-duplicated, in first-seen order. */
export function tagOptions(selected: readonly string[], loaded: readonly (readonly string[])[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...selected, ...loaded.flat()]) {
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** "35 min · 4 serv." from whichever parts are present; null when there are none (no placeholder). */
export function summaryLine(summary: Pick<RecipeSummary, 'totalMinutes' | 'yield'>): string | null {
  const parts: string[] = [];
  if (summary.totalMinutes !== null) {
    parts.push(t('recipes.detail.minutes', { count: formatNumber(summary.totalMinutes) }));
  }
  const y = summary.yield;
  if (y !== null) {
    const quantity = parseYield(y.quantity);
    if (quantity !== null) {
      const unit = y.unit === 'servings' ? t('recipes.list.servingsShort') : y.unit;
      parts.push(`${formatServings(quantity)} ${unit}`);
    }
  }
  return parts.length === 0 ? null : parts.join(' · ');
}
