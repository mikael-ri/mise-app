import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import { noHardcodedUiStrings } from './no-hardcoded-ui-strings.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-hardcoded-ui-strings (NFR-05)', noHardcodedUiStrings, {
  valid: [
    { code: 'const a = <p>{t("x.y")}</p>;' },
    { code: 'const a = <p aria-label={t("x.y")} placeholder={t("x.z")} />;' },
    { code: 'const a = <p data-testid="device-row" className="flex gap-2" />;' },
    { code: 'const a = <span aria-hidden="true">&rsaquo;</span>;' },
    { code: 'const a = <p>{count} / 3</p>;' },
    { code: 'const a = <input type="text" title={label} />;' },
  ],
  invalid: [
    { code: 'const a = <p>Hello</p>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <p>{"Hello"}</p>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <p>{`Hello`}</p>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <button aria-label="Close" />;', errors: [{ messageId: 'attribute' }] },
    { code: 'const a = <input placeholder={"Search"} />;', errors: [{ messageId: 'attribute' }] },
    { code: 'const a = <img alt="Logo" />;', errors: [{ messageId: 'attribute' }] },
    { code: 'const a = <a title="Go">{t("x")}</a>;', errors: [{ messageId: 'attribute' }] },
    { code: 'const a = <p>Päivää</p>;', errors: [{ messageId: 'text' }] },
  ],
});
