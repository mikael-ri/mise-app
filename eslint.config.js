import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { noHardcodedUiStrings } from './apps/web/eslint/no-hardcoded-ui-strings.js';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['**/*.test.tsx', 'apps/web/src/test/**'],
    plugins: { mise: { rules: { 'no-hardcoded-ui-strings': noHardcodedUiStrings } } },
    rules: { 'mise/no-hardcoded-ui-strings': 'error' },
  },
);
