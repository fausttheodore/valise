import type { MessageKey } from "./i18n";
import type { Settings } from "./types";

export const FONT_PRESETS: { id: string; name: MessageKey; stack: string }[] = [
  {
    id: "system",
    name: "font.system",
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  },
  {
    id: "serif",
    name: "font.serif",
    stack:
      '"Iowan Old Style", "Charter", Georgia, "Songti SC", "STSong", "Noto Serif CJK SC", serif',
  },
  {
    id: "rounded",
    name: "font.rounded",
    stack:
      'ui-rounded, "SF Pro Rounded", "PingFang SC", "Yuanti SC", "Microsoft YaHei", sans-serif',
  },
];
export const fontStack = (value: string) =>
  FONT_PRESETS.find((f) => f.id === value)?.stack || value;

export function applyAppearance(
  s: Pick<Settings, "theme" | "accent" | "fontSize" | "fontFamily">,
) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--font-size", s.fontSize + "px");
  root.style.setProperty("--font-reading", fontStack(s.fontFamily));
}
