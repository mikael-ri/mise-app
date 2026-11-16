// Flags hard-coded user-visible strings in JSX: JSXText with letters, and string literals in
// aria-label / placeholder / title / alt attributes. All UI text must go through t() (web rules).
// Limit: only JSX text and those attributes. Literals in custom props (e.g. message=) or in .ts
// files (toast.show) are not caught; review those by hand.
const ATTRIBUTES = new Set(['aria-label', 'aria-description', 'placeholder', 'title', 'alt']);
const HAS_LETTER = /\p{L}/u;

function literalText(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? '').join('');
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noHardcodedUiStrings = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      text: 'Hard-coded UI text. Use an i18n key via t().',
      attribute: 'Hard-coded "{{name}}" text. Use an i18n key via t().',
    },
  },
  create(context) {
    return {
      JSXText(node) {
        if (HAS_LETTER.test(node.value)) context.report({ node, messageId: 'text' });
      },
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXAttribute') return;
        const text = literalText(node.expression);
        if (text !== null && HAS_LETTER.test(text)) context.report({ node, messageId: 'text' });
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !ATTRIBUTES.has(node.name.name)) return;
        const value = node.value;
        if (value === null) return;
        const expression = value.type === 'JSXExpressionContainer' ? value.expression : value;
        const text = literalText(expression);
        if (text !== null && HAS_LETTER.test(text)) {
          context.report({ node, messageId: 'attribute', data: { name: node.name.name } });
        }
      },
    };
  },
};
