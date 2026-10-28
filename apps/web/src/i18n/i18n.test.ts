import { describe, expect, it } from 'vitest';
import { t } from './index.js';

describe('i18n', () => {
  it('resolves a key to its English string', () => {
    expect(t('app.title')).toBe('Mise');
  });
});
