// Device label for the device list: a coarse "<browser> on <OS>" from the stored User-Agent.
// Display only; never used for any security decision.

export const USER_AGENT_MAX = 200;

/** What is stored: the header trimmed, control characters removed, at most 200 characters. */
export function storableUserAgent(header: string | undefined): string | null {
  if (header === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const clean = header.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean === '' ? null : clean.slice(0, USER_AGENT_MAX);
}

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\b(OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\bAndroid\b/, 'Android'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const first = (ua: string, table: [RegExp, string][]) => table.find(([re]) => re.test(ua))?.[1];

/** "Firefox on Android", "Safari on iOS", "Chrome", "Linux" or null when nothing is recognised. */
export function deriveDeviceLabel(userAgent: string | null): string | null {
  if (userAgent === null) return null;
  const browser = first(userAgent, BROWSERS);
  const os = first(userAgent, SYSTEMS);
  if (browser !== undefined && os !== undefined) return `${browser} on ${os}`;
  return browser ?? os ?? null;
}
