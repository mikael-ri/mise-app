import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import { formatDate, formatMessage, formatNumber, t } from './index.js';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('i18n (NFR-05)', () => {
  it('resolves a key to its English string and interpolates params', () => {
    expect(t('app.title')).toBe('Mise');
    expect(t('settings.home.signedInAs', { name: 'Anna' })).toBe('Signed in as Anna');
  });

  it.each([
    [0, '0 items'],
    [1, '1 item'],
    [3, '3 items'],
  ])('formats ICU plural one/other for count %i', (count, expected) => {
    expect(formatMessage('{count, plural, one {# item} other {# items}}', { count }, 'en')).toBe(
      expected,
    );
  });

  it('formats numbers and dates with the fi-FI default', () => {
    expect(formatNumber(1.5)).toBe('1,5');
    expect(formatDate('2026-10-24T21:30:00Z', { timeZone: 'Europe/Helsinki' })).toBe('25.10.2026');
  });

  it('every key used in source exists in en.json', () => {
    const root = join(import.meta.dirname, '..');
    const used = new Set<string>();
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1] ?? '');
      for (const m of text.matchAll(/(?:label|titleKey|message):\s*'([a-z]+(?:\.[A-Za-z]+)+)'/g))
        used.add(m[1] ?? '');
      for (const m of text.matchAll(/titleKey="([^"]+)"/g)) used.add(m[1] ?? '');
    }
    const missing = [...used].filter((key) => !(key in en));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });

  it('keys follow feature.screen.element naming', () => {
    for (const key of Object.keys(en)) expect(key).toMatch(/^[a-z]+(\.[A-Za-z]+){1,4}$/);
  });
});
