import en from './en.json';

export type MessageKey = keyof typeof en;
export type MessageParams = Readonly<Record<string, string | number>>;

export const DEFAULT_LOCALE = 'fi-FI';

/** Index of the `}` matching the `{` at `open`, or -1. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Minimal ICU subset: `{name}` and `{name, plural, one {# item} other {# items}}`.
 * Plural categories come from `Intl.PluralRules`; `#` is the localised count.
 */
export function formatMessage(
  template: string,
  params: MessageParams = {},
  locale: string = DEFAULT_LOCALE,
): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '{') {
      out += ch;
      i += 1;
      continue;
    }
    const end = closingBrace(template, i);
    if (end === -1) return out + template.slice(i);
    const body = template.slice(i + 1, end);
    const comma = body.indexOf(',');
    if (comma === -1) {
      out += String(params[body.trim()] ?? '');
    } else {
      const name = body.slice(0, comma).trim();
      const rest = body.slice(comma + 1).trim();
      if (rest.startsWith('plural,')) {
        const count = Number(params[name] ?? 0);
        const forms = new Map<string, string>();
        const optionsText = rest.slice('plural,'.length);
        let j = 0;
        while (j < optionsText.length) {
          const open = optionsText.indexOf('{', j);
          if (open === -1) break;
          const category = optionsText.slice(j, open).trim();
          const close = closingBrace(optionsText, open);
          if (close === -1) break;
          forms.set(category, optionsText.slice(open + 1, close));
          j = close + 1;
        }
        const category = new Intl.PluralRules(locale).select(count);
        const form = forms.get(category) ?? forms.get('other') ?? '';
        out += formatMessage(form.replaceAll('#', formatNumber(count, locale)), params, locale);
      }
    }
    i = end + 1;
  }
  return out;
}

export function t(key: MessageKey, params?: MessageParams): string {
  return formatMessage(en[key], params);
}

export function formatNumber(value: number, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Local calendar date for an instant, in the household timezone when known. */
export function formatDate(
  instant: string | Date,
  options: { locale?: string; timeZone?: string } = {},
): string {
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    dateStyle: 'medium',
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}
