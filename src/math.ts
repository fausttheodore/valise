import katex from "katex";
import "katex/contrib/mhchem";

/**
 * Commands from LaTeX packages KaTeX lacks (physics, siunitx, upgreek, unicode-math)
 * that models routinely emit. They approximate the packages closely enough to read.
 */
const MACROS: Record<string, string> = {
  // physics
  "\\abs": "\\left\\lvert #1\\right\\rvert",
  "\\norm": "\\left\\lVert #1\\right\\rVert",
  "\\dd": "\\mathop{}\\!\\mathrm{d}",
  "\\dv": "\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}",
  "\\pdv": "\\frac{\\partial #1}{\\partial #2}",
  "\\vb": "\\mathbf{#1}",
  "\\vu": "\\hat{\\mathbf{#1}}",
  "\\va": "\\vec{#1}",
  "\\vdot": "\\cdot",
  "\\cross": "\\times",
  "\\grad": "\\nabla",
  "\\curl": "\\nabla\\times",
  "\\divergence": "\\nabla\\cdot",
  "\\laplacian": "\\nabla^{2}",
  "\\expval": "\\left\\langle #1\\right\\rangle",
  "\\ev": "\\left\\langle #1\\right\\rangle",
  "\\mel": "\\left\\langle #1\\middle\\vert #2\\middle\\vert #3\\right\\rangle",
  "\\comm": "\\left[#1,#2\\right]",
  "\\acomm": "\\left\\{#1,#2\\right\\}",
  "\\order": "\\mathcal{O}\\left(#1\\right)",
  "\\tr": "\\operatorname{tr}",
  "\\Tr": "\\operatorname{Tr}",
  "\\rank": "\\operatorname{rank}",
  "\\sgn": "\\operatorname{sgn}",
  "\\erf": "\\operatorname{erf}",
  "\\Res": "\\operatorname{Res}",
  // common operators
  "\\argmax": "\\operatorname*{arg\\,max}",
  "\\argmin": "\\operatorname*{arg\\,min}",
  "\\Var": "\\operatorname{Var}",
  "\\Cov": "\\operatorname{Cov}",
  "\\diag": "\\operatorname{diag}",
  "\\bold": "\\mathbf{#1}",
  "\\mathbbm": "\\mathbb{#1}",
  "\\mathds": "\\mathbb{#1}",
  // unicode-math
  "\\symbf": "\\boldsymbol{#1}",
  "\\symup": "\\mathrm{#1}",
  "\\symit": "\\mathit{#1}",
  "\\symcal": "\\mathcal{#1}",
  "\\mathbfit": "\\boldsymbol{#1}",
  "\\mathup": "\\mathrm{#1}",
  // siunitx
  "\\si": "\\mathrm{#1}",
  "\\unit": "\\mathrm{#1}",
  "\\SI": "#1\\,\\mathrm{#2}",
  "\\qty": "#1\\,\\mathrm{#2}",
  "\\SIrange": "#1\\text{–}#2\\,\\mathrm{#3}",
  "\\num": "#1",
  "\\ang": "#1^{\\circ}",
  "\\per": "/",
  "\\squared": "^{2}",
  "\\cubed": "^{3}",
  "\\celsius": "{}^{\\circ}\\mathrm{C}",
  "\\degreeCelsius": "{}^{\\circ}\\mathrm{C}",
  "\\ohm": "\\Omega",
  "\\micro": "\\mu",
  "\\textmu": "\\mu",
  "\\percent": "\\%",
  "\\angstrom": "\\mathring{\\mathrm{A}}",
};
const UNITS: Record<string, string> = {
  metre: "m",
  meter: "m",
  second: "s",
  kilogram: "kg",
  gram: "g",
  kelvin: "K",
  ampere: "A",
  mole: "mol",
  candela: "cd",
  newton: "N",
  joule: "J",
  watt: "W",
  pascal: "Pa",
  hertz: "Hz",
  coulomb: "C",
  volt: "V",
  farad: "F",
  tesla: "T",
  henry: "H",
  weber: "Wb",
  siemens: "S",
  electronvolt: "eV",
  litre: "L",
  liter: "L",
  minute: "min",
  hour: "h",
  day: "d",
  becquerel: "Bq",
  gray: "Gy",
  sievert: "Sv",
  lumen: "lm",
  lux: "lx",
  radian: "rad",
  steradian: "sr",
  dalton: "Da",
  decibel: "dB",
  kilo: "k",
  mega: "M",
  giga: "G",
  tera: "T",
  centi: "c",
  deci: "d",
  milli: "m",
  nano: "n",
  pico: "p",
  femto: "f",
};
for (const [name, symbol] of Object.entries(UNITS))
  MACROS["\\" + name] = `\\mathrm{${symbol}}`;
// upgreek: \upalpha, \Upgamma …
for (const g of "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega".split(
  " ",
))
  MACROS["\\up" + g] = "\\" + g;
for (const g of "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega".split(" "))
  MACROS["\\Up" + g.toLowerCase()] = "\\" + g;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Unsupported input falls back to its source, shown neutrally with the reason on hover. */
export function renderTex(tex: string, display: boolean) {
  try {
    return katex.renderToString(tex.replace(/\\label\{[^{}]*\}/g, ""), {
      displayMode: display,
      throwOnError: true,
      errorColor: "inherit",
      strict: "ignore",
      trust: false,
      maxExpand: 1000,
      macros: { ...MACROS },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/^KaTeX parse error: /, "") : "";
    return `<code class="math-error" title="${escape("无法渲染的 LaTeX：" + reason)}">${escape(tex)}</code>`;
  }
}

export interface Formula {
  tex: string;
  display: boolean;
  /** Stands on its own line(s), so it renders as a block rather than inside a paragraph. */
  block: boolean;
}
export type Slot = { math: Formula } | { tag: string };
// Placeholders use private-use code points U+E000 / U+E001, which never occur in model output.
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);
export const SLOT = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");
export const BLOCK_SLOT = new RegExp(`<p>${OPEN}(\\d+)${CLOSE}</p>`, "g");
const BLOCK_ENVS = "equation|align|alignat|gather|multline|flalign|eqnarray";
// Order matters: code spans and escaped dollars are claimed before any math delimiter.
const SCAN = new RegExp(
  [
    String.raw`\\\$`,
    String.raw`(\`+)[^\`][\s\S]*?\1(?!\`)`,
    String.raw`<(\/?)(br|sup|sub|kbd|mark|u|ins|del)\s*\/?>`,
    String.raw`\$\$([\s\S]+?)\$\$`,
    String.raw`\\\[([\s\S]+?)\\\]`,
    String.raw`\\\(([\s\S]+?)\\\)`,
    String.raw`\\begin\{((?:${BLOCK_ENVS})\*?)\}[\s\S]+?\\end\{\7\}`,
    String.raw`\$((?:\\.|[^\s$\\])(?:(?:\\.|[^$\\\n])*?(?:\\.|[^\s$\\]))?)\$(?!\d)`,
  ].join("|"),
  "gi",
);

/**
 * Pulls math (and a few harmless inline tags) out of Markdown before parsing, so `_`, `*`,
 * `|` and `\\` inside formulas never reach the Markdown parser. Each piece becomes a
 * private-use placeholder that `renderMarkdown` swaps back after sanitising.
 */
export function extractMath(source: string) {
  const slots: Slot[] = [];
  const put = (slot: Slot) => OPEN + (slots.push(slot) - 1) + CLOSE;
  const scan = (chunk: string) =>
    chunk.replace(
      SCAN,
      (all, ticks, close, tag, dollars, brackets, parens, env, inline, offset: number) => {
        if (ticks !== undefined || all === "\\$") return all;
        if (tag) return put({ tag: `<${close}${tag.toLowerCase()}>` });
        if (inline !== undefined) {
          // "5$" or a "$" glued to a digit is currency, not math.
          if (/\d/.test(chunk[offset - 1] || "")) return all;
          return put({ math: { tex: inline, display: false, block: false } });
        }
        // "\[1\]" is an escaped citation marker, not a formula.
        if (brackets !== undefined && /^\s*\d+(?:\s*[,–-]\s*\d+)*\s*$/.test(brackets))
          return all;
        const lineStart = chunk.lastIndexOf("\n", offset - 1) + 1;
        const prefix = chunk.slice(lineStart, offset);
        const lineEnd = chunk.indexOf("\n", offset + all.length);
        const suffix = chunk.slice(offset + all.length, lineEnd < 0 ? undefined : lineEnd);
        let tex: string = env ? all : (dollars ?? brackets ?? parens);
        if (prefix.includes(">")) tex = tex.replace(/^[ \t]*(?:>[ \t]?)+/gm, "");
        tex = tex.trim();
        if (parens !== undefined)
          return put({ math: { tex, display: false, block: false } });
        const block = /^[\s>]*$/.test(prefix) && !suffix.trim();
        const slot = put({ math: { tex, display: true, block } });
        // Top-level blocks get their own paragraph; nested ones keep the line structure.
        return block && !prefix ? `\n\n${slot}\n\n` : slot;
      },
    );
  const out: string[] = [];
  let buffer: string[] = [];
  let fence: { marker: string; indent: string; math: string[] | undefined } | undefined;
  const flush = () => {
    if (buffer.length) out.push(scan(buffer.join("\n")));
    buffer = [];
  };
  for (const line of source.replaceAll(OPEN, "").replaceAll(CLOSE, "").split("\n")) {
    const open = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (fence) {
      const closing =
        open && open[1][0] === fence.marker[0] && open[1].length >= fence.marker.length && !open[2];
      if (fence.math && !closing) fence.math.push(line);
      else if (fence.math) {
        const tex = fence.math.join("\n").trim();
        out.push(`\n${fence.indent}${put({ math: { tex, display: true, block: true } })}\n`);
      } else out.push(line);
      if (closing) fence = undefined;
      continue;
    }
    if (open) {
      flush();
      const math = open[2].toLowerCase() === "math";
      fence = { marker: open[1], indent: line.match(/^ */)![0], math: math ? [] : undefined };
      if (!math) out.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();
  // An unclosed ```math fence (still streaming) stays visible as code.
  if (fence?.math) out.push("```", ...fence.math);
  return { text: out.join("\n"), slots };
}
