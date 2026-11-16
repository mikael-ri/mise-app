import { describe, expect, it } from 'vitest';
import { summaryLine } from './recipe-view.js';

describe('recipe card summary (FR-01, FR-06)', () => {
  it('formats time and yield with the domain formatter and Finnish decimals', () => {
    expect(summaryLine({ totalMinutes: 35, yield: { quantity: '4', unit: 'servings' } })).toBe(
      '35 min · 4 serv.',
    );
    expect(summaryLine({ totalMinutes: 1500, yield: { quantity: '2.5', unit: 'servings' } })).toBe(
      `${new Intl.NumberFormat('fi-FI').format(1500)} min · 2 ½ serv.`,
    );
    expect(summaryLine({ totalMinutes: null, yield: { quantity: '2.3', unit: 'servings' } })).toBe(
      '2,3 serv.',
    );
    expect(summaryLine({ totalMinutes: null, yield: { quantity: '1/2', unit: 'leipää' } })).toBe(
      '½ leipää',
    );
  });

  it('shows only the present parts and nothing (no placeholder) when absent', () => {
    expect(summaryLine({ totalMinutes: 20, yield: null })).toBe('20 min');
    expect(summaryLine({ totalMinutes: null, yield: { quantity: '4', unit: 'servings' } })).toBe(
      '4 serv.',
    );
    expect(summaryLine({ totalMinutes: null, yield: null })).toBeNull();
  });
});
