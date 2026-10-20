// A small, hand-drawn 24px stroke icon set. Paths prefixed with "F" are filled.
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
const rect = (x: number, y: number, w: number, hh: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${2 * r - w}a${r} ${r} 0 0 1 ${-r} ${-r}v${2 * r - hh}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const sheet =
  "M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z";

export const ICONS = {
  plus: "M12 5v14M5 12h14",
  x: "M17.5 6.5l-11 11M6.5 6.5l11 11",
  check: "M5 12.5l4.5 4.5L19 7",
  chevronDown: "m6.5 9.5 5.5 5.5 5.5-5.5",
  chevronRight: "m9.5 6.5 5.5 5.5-5.5 5.5",
  chevronLeft: "m14.5 6.5-5.5 5.5 5.5 5.5",
  arrowUp: "M12 19V5.5M6 11.5l6-6 6 6",
  arrowDown: "M12 5v13.5M6 12.5l6 6 6-6",
  stop: "F" + rect(7, 7, 10, 10, 2),
  more: [
    "F" + circle(5.5, 12, 1.6),
    "F" + circle(12, 12, 1.6),
    "F" + circle(18.5, 12, 1.6),
  ],
  history: [
    "M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5",
    "M3.5 4v4.5H8",
    "M12 7.5V12l3 2",
  ],
  newChat: [
    "M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12",
    "M18.4 3.6a2 2 0 0 1 2.9 2.9L13 14.8l-3.8 1 1-3.8z",
  ],
  settings: [
    "M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20",
    circle(15, 7, 2.5),
    circle(9, 17, 2.5),
  ],
  sidebar: [rect(3.5, 4.5, 17, 15, 2.5), "M14.5 4.5v15"],
  page: [sheet, "M14 3.5v5h5", "M9 13h6M9 16.5h4"],
  file: [sheet, "M14 3.5v5h5"],
  globe: [
    circle(12, 12, 8.5),
    "M3.5 12h17",
    "M12 3.5c2.2 2.4 3.4 5.2 3.4 8.5s-1.2 6.1-3.4 8.5c-2.2-2.4-3.4-5.2-3.4-8.5s1.2-6.1 3.4-8.5z",
  ],
  paperclip:
    "M19.5 11.5l-7.6 7.6a4.9 4.9 0 0 1-6.9-6.9l8-8a3.3 3.3 0 0 1 4.6 4.6l-8 8a1.6 1.6 0 0 1-2.3-2.3l7.3-7.3",
  scan: [
    "M4 8.5v-2A2.5 2.5 0 0 1 6.5 4h2",
    "M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2",
    "M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2",
    "M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2",
    circle(12, 12, 3),
  ],
  image: [
    rect(3.5, 4.5, 17, 15, 2.5),
    circle(9, 10, 1.7),
    "m20.5 15.5-4.5-4.5-9.5 8.5",
  ],
  copy: [
    rect(8.5, 8.5, 12, 12, 2.5),
    "M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5",
  ],
  refresh: ["M20 12a8 8 0 1 1-2.6-5.9L20 8.5", "M20 4v4.5h-4.5"],
  trash: [
    "M4 7h16",
    "M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2",
    "M6 7l.9 12.1A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.9L18 7",
    "M10 11v6M14 11v6",
  ],
  edit: ["M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z", "M13 7l4 4"],
  download: ["M12 4v11", "M7 10.5l5 5 5-5", "M5 20h14"],
  upload: ["M12 15.5V4.5", "M7 9.5l5-5 5 5", "M5 20h14"],
  list: ["M9 6h11M9 12h11M9 18h11", "M4.5 6h.01M4.5 12h.01M4.5 18h.01"],
  search: [circle(11, 11, 6.5), "m20 20-4.2-4.2"],
  sparkles: [
    "M11 3.5l1.9 4.6 4.6 1.9-4.6 1.9L11 16.5l-1.9-4.6L4.5 10l4.6-1.9z",
    "M18.5 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z",
  ],
  languages: [
    "M4 5.5h9",
    "M8.5 3.5v2",
    "M6 5.5c.8 3.3 3 5.8 6 7.3",
    "M11 5.5c-.9 3.6-3.2 6.5-6.5 8.3",
    "M13 20.5l3.8-9 3.7 9",
    "M14.3 17.5h5",
  ],
  summary: "M4 6h16M4 10.5h16M4 15h11M4 19.5h7",
  help: [
    circle(12, 12, 8.5),
    "M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.2-2.5 3.9",
    "M12 17h.01",
  ],
  quote: [
    "M9.5 7h-3a2 2 0 0 0-2 2v3h5v3a3 3 0 0 1-3 3",
    "M19.5 7h-3a2 2 0 0 0-2 2v3h5v3a3 3 0 0 1-3 3",
  ],
  code: ["m8.5 8-4 4 4 4", "m15.5 8 4 4-4 4", "M13.5 5l-3 14"],
  bulb: [
    "M9.5 18h5M10.5 21h3",
    "M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z",
  ],
  eye: [
    "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z",
    circle(12, 12, 3),
  ],
  eyeOff: [
    "M3 3l18 18",
    "M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.7",
    "M6.6 6.7C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5",
    "M9.9 9.9a3 3 0 0 0 4.2 4.2",
  ],
  star: "M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z",
  zap: "M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z",
  cpu: [
    rect(5, 5, 14, 14, 3),
    rect(9.5, 9.5, 5, 5, 1),
    "M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5",
  ],
  palette: [
    "M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6h1.8a4.5 4.5 0 0 0 4.5-4.5c0-3.8-3.8-6.9-8.5-6.9z",
    "F" + circle(7.8, 11.5, 1.1),
    "F" + circle(10.5, 7.8, 1.1),
    "F" + circle(15, 8.2, 1.1),
  ],
  cursor: [
    "M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7",
    "M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7",
    "M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17",
    "M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17",
    "M8.5 9.5h7M8.5 12h7M8.5 14.5h4.5",
  ],
  database: [
    "M4.5 6c0-1.4 3.4-2.5 7.5-2.5s7.5 1.1 7.5 2.5-3.4 2.5-7.5 2.5S4.5 7.4 4.5 6z",
    "M4.5 6v12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6",
    "M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5",
  ],
  info: [circle(12, 12, 8.5), "M12 11v5", "M12 8h.01"],
  alert: [
    "M10.3 4.3 2.9 17.3A2 2 0 0 0 4.6 20.3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z",
    "M12 9.5v4",
    "M12 17h.01",
  ],
  lock: [rect(5, 11, 14, 9.5, 2.5), "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  external: [
    "M14 4h6v6",
    "M20 4l-8.5 8.5",
    "M18 14v3.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 4 17.5v-9A2.5 2.5 0 0 1 6.5 6H10",
  ],
  sun: [
    circle(12, 12, 3.8),
    "M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4",
  ],
  moon: "M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z",
  monitor: [rect(3, 4, 18, 12.5, 2.5), "M8.5 20.5h7M12 16.5v4"],
  type: ["M5 7V5h14v2", "M12 5v14", "M9.5 19h5"],
  layers: [
    "m12 3.5 8.5 4.5-8.5 4.5L3.5 8z",
    "m3.5 12 8.5 4.5 8.5-4.5",
    "m3.5 16 8.5 4.5 8.5-4.5",
  ],
  message:
    "M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z",
  key: [circle(8, 15.5, 4), "M10.9 12.6 19 4.5", "M16 7.5l2.5 2.5", "M13.8 9.7l2 2"],
  link: [
    "M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1",
    "M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1",
  ],
  grip: [
    "F" + circle(9, 6.5, 1.3),
    "F" + circle(15, 6.5, 1.3),
    "F" + circle(9, 12, 1.3),
    "F" + circle(15, 12, 1.3),
    "F" + circle(9, 17.5, 1.3),
    "F" + circle(15, 17.5, 1.3),
  ],
  pen: ["M12 20h8", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
  at: [circle(12, 12, 3.6), "M15.6 12v1.6a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7"],
} satisfies Record<string, string | string[]>;

export type IconName = keyof typeof ICONS;
export const isIcon = (name: unknown): name is IconName =>
  typeof name === "string" && Object.hasOwn(ICONS, name);

const NS = "http://www.w3.org/2000/svg";
export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of [
    ["viewBox", "0 0 24 24"],
    ["width", String(size)],
    ["height", String(size)],
    ["fill", "none"],
    ["stroke", "currentColor"],
    ["stroke-width", "1.8"],
    ["stroke-linecap", "round"],
    ["stroke-linejoin", "round"],
    ["aria-hidden", "true"],
    ["class", "icon"],
  ])
    svg.setAttribute(k, v);
  const paths: string[] = [ICONS[name]].flat();
  for (const d of paths) {
    const path = document.createElementNS(NS, "path");
    if (d.startsWith("F")) {
      path.setAttribute("d", d.slice(1));
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
    } else path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
