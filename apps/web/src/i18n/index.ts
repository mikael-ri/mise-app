import en from './en.json';

export type MessageKey = keyof typeof en;

export function t(key: MessageKey): string {
  return en[key];
}
