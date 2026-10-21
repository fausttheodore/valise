import { en } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = "en" | "zh-CN";
export type MessageKey = keyof typeof zhCN;
export type Messages = Record<MessageKey, string>;

const dictionaries: Record<Locale, Messages> = { en, "zh-CN": zhCN };
let locale: Locale = "en";

/** "auto" follows the browser UI language: any Chinese variant maps to zh-CN, everything else to English. */
export function resolveLocale(setting: unknown, browserLanguage: string): Locale {
  if (setting === "en" || setting === "zh-CN") return setting;
  return browserLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
export const getLocale = () => locale;
export function setLocale(next: Locale) {
  locale = next;
}
/** Looks up a message in the current locale and fills `{name}` placeholders. */
export function t(key: MessageKey, params?: Record<string, string | number>) {
  const text = dictionaries[locale][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in params ? String(params[name]) : all,
  );
}
/** The same message in every locale, to recognize text saved under another language. */
export const translations = (key: MessageKey) =>
  Object.values(dictionaries).map((d) => d[key]);
export const formatNumber = (n: number) => n.toLocaleString(locale);
