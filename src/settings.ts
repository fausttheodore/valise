import "./style.css";
import "./settings.css";
import { faviconUrl } from "./browser";
import {
  ACCENTS,
  apiOrigin,
  applyLocale,
  capabilities,
  defaultProfile,
  exportSettings,
  FLOAT_WIDTH_MAX,
  loadSettings,
  normalizeSettings,
  providerPresets,
  saveSettings,
  searchMeta,
  searchServices,
  validateProfile,
  validateSettings,
} from "./config";
import { append, h, type Child } from "./dom";
import { formatNumber, getLocale, t, type MessageKey } from "./i18n";
import { icon, type IconName } from "./icons";
import { generate, listModels } from "./providers";
import { actionIcon, formatSize, renderMarkdown } from "./render";
import { RequestScope } from "./request";
import { search } from "./search";
import { clearConversations, clearSnapshots, countConversations } from "./storage";
import { applyAppearance, FONT_PRESETS } from "./theme";
import {
  uid,
  type ActionTemplate,
  type Capabilities,
  type Profile,
  type Settings,
} from "./types";
import {
  button,
  confirmAction,
  download,
  iconButton,
  openMenu,
  spinner,
  toast,
} from "./ui";

type SectionId =
  | "models"
  | "search"
  | "prompts"
  | "actions"
  | "appearance"
  | "sites"
  | "data"
  | "about";
const SECTIONS: { id: SectionId; icon: IconName; label: MessageKey; desc: MessageKey }[] = [
  { id: "models", icon: "cpu", label: "settings.models", desc: "settings.models.desc" },
  { id: "search", icon: "globe", label: "settings.search", desc: "settings.search.desc" },
  { id: "prompts", icon: "pen", label: "settings.prompts", desc: "settings.prompts.desc" },
  { id: "actions", icon: "cursor", label: "settings.actions", desc: "settings.actions.desc" },
  {
    id: "appearance",
    icon: "palette",
    label: "settings.appearance",
    desc: "settings.appearance.desc",
  },
  { id: "sites", icon: "link", label: "settings.sites", desc: "settings.sites.desc" },
  { id: "data", icon: "database", label: "settings.data", desc: "settings.data.desc" },
  { id: "about", icon: "info", label: "settings.about", desc: "settings.about.desc" },
];
const EFFORT_LABEL: Record<string, MessageKey> = {
  none: "effort.none",
  minimal: "effort.minimal",
  low: "effort.low",
  medium: "effort.medium",
  high: "effort.high",
  xhigh: "effort.xhigh",
  max: "effort.max",
};
const ACTION_ICONS: [IconName, MessageKey][] = [
  ["help", "icon.help"],
  ["languages", "icon.languages"],
  ["summary", "icon.summary"],
  ["sparkles", "icon.sparkles"],
  ["bulb", "icon.bulb"],
  ["quote", "icon.quote"],
  ["code", "icon.code"],
  ["search", "icon.search"],
  ["pen", "icon.pen"],
  ["list", "icon.list"],
  ["message", "icon.message"],
  ["zap", "icon.zap"],
  ["star", "icon.star"],
  ["globe", "icon.globe"],
];
/** Request parameters that switch on search built into an OpenAI-compatible service. */
const searchParamPresets = (): [string, Record<string, unknown>][] => [
  ["OpenRouter", { plugins: [{ id: "web" }] }],
  [t("settings.preset.openaiSearch"), { web_search_options: {} }],
  [t("settings.preset.qwen"), { enable_search: true, search_options: { enable_source: true } }],
  [
    t("settings.preset.glm"),
    { tools: [{ type: "web_search", web_search: { enable: true, search_result: true } }] },
  ],
];
const VARS: [string, MessageKey][] = [
  ["selection", "var.selection"],
  ["paragraph", "var.paragraph"],
  ["title", "var.title"],
  ["url", "var.url"],
];

document.body.classList.add("settings-page");
const root = document.querySelector<HTMLElement>("#settings")!;
// Loaded before any label is built, so the whole page uses the configured language.
let settings: Settings = await loadSettings();
let saved = JSON.stringify(settings);
let selected = "";
let current: SectionId = SECTIONS.some((s) => s.id === location.hash.slice(1))
  ? (location.hash.slice(1) as SectionId)
  : "models";
let timer: ReturnType<typeof setTimeout> | undefined;
let windowId: number | undefined;
let listHost: HTMLElement | undefined;
let lastTemplate: HTMLTextAreaElement | undefined;
const errors = new Map<string, string>();
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// ------------------------------------------------------------ shell
const nav = h("nav", { class: "nav-list" });
const heading = h("h1");
const description = h("p");
const saveState = h("div", { class: "save-state" });
const content = h("div", { class: "settings-content" });
const brandVersion = h("div", { class: "brand-version" });
const navFoot = h("div", { class: "nav-foot" });
root.append(
  h(
    "div",
    { class: "settings-shell" },
    h(
      "aside",
      { class: "settings-nav" },
      h(
        "div",
        { class: "settings-brand" },
        h("div", { class: "brand-mark" }, icon("sparkles", 17)),
        h("div", null, h("div", { class: "brand-name" }, "Valise"), brandVersion),
      ),
      nav,
      navFoot,
    ),
    h(
      "main",
      { class: "settings-main" },
      h("header", { class: "settings-head" }, h("div", null, heading, description), saveState),
      content,
    ),
  ),
);

/** Text outside the section content; set again when the interface language changes. */
function applyLanguage() {
  document.documentElement.lang = getLocale();
  document.title = t("settings.pageTitle");
  brandVersion.textContent = t("settings.brandVersion", {
    version: chrome.runtime.getManifest().version,
  });
  navFoot.replaceChildren(
    button(
      t("settings.openPanel"),
      () => {
        if (windowId !== undefined) void chrome.sidePanel.open({ windowId });
      },
      "btn-ghost",
      "sidebar",
    ),
  );
}
function go(id: SectionId) {
  current = id;
  history.replaceState(null, "", "#" + id);
  render();
  scrollTo({ top: 0 });
}
function render() {
  const section = SECTIONS.find((s) => s.id === current)!;
  nav.replaceChildren(
    ...SECTIONS.map((s) =>
      h(
        "button",
        {
          type: "button",
          class: "nav-item" + (s.id === current ? " active" : ""),
          onclick: () => go(s.id),
        },
        icon(s.icon, 17),
        t(s.label),
      ),
    ),
  );
  heading.textContent = t(section.label);
  description.textContent = t(section.desc);
  content.replaceChildren();
  const builders: Record<SectionId, () => Child[]> = {
    models: modelsSection,
    search: searchSection,
    prompts: promptsSection,
    actions: actionsSection,
    appearance: appearanceSection,
    sites: sitesSection,
    data: dataSection,
    about: aboutSection,
  };
  append(content, builders[current]());
}

// ------------------------------------------------------------ saving
function setState(kind: "saved" | "saving" | "error", text: string) {
  saveState.className = "save-state " + kind;
  saveState.textContent = text;
  saveState.title = text;
}
function changed() {
  setState("saving", t("settings.saving"));
  clearTimeout(timer);
  timer = setTimeout(() => void commit(), 350);
}
async function commit() {
  timer = undefined;
  const fieldError = [...errors.values()][0];
  if (fieldError) return setState("error", t("settings.notSaved", { error: fieldError }));
  try {
    validateSettings(settings);
    const json = JSON.stringify(settings);
    if (json !== saved) {
      await saveSettings(settings);
      saved = json;
    }
    setState("saved", t("settings.saved"));
  } catch (error) {
    setState("error", t("settings.notSaved", { error: errorText(error) }));
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && timer) {
    clearTimeout(timer);
    void commit();
  }
});

// ------------------------------------------------------------ form helpers
type Attrs = Record<string, unknown>;
function field(label: string, control: Child, hint: Child = "", full = false) {
  return h(
    "div",
    { class: "field" + (full ? " full" : "") },
    h("span", { class: "field-label" }, label),
    control,
    hint ? h("span", { class: "field-hint" }, hint) : null,
  );
}
function card(title: string, desc: Child, ...children: Child[]) {
  return h(
    "section",
    { class: "card" },
    title
      ? h(
          "div",
          { class: "card-head" },
          h("div", null, h("h3", null, title), desc ? h("p", null, desc) : null),
        )
      : null,
    ...children,
  );
}
function textInput(value: string, onInput: (v: string) => void, attrs: Attrs = {}) {
  const input = h("input", { class: "input", value, ...attrs });
  input.spellcheck = false;
  input.addEventListener("input", () => {
    onInput(input.value);
    changed();
  });
  return input;
}
function numberInput(
  value: number | undefined,
  onInput: (v: number | undefined) => void,
  attrs: Attrs = {},
) {
  const input = h("input", {
    class: "input",
    type: "number",
    ...attrs,
    value: value === undefined || Number.isNaN(value) ? "" : String(value),
  });
  input.addEventListener("input", () => {
    onInput(input.value.trim() === "" ? undefined : Number(input.value));
    changed();
  });
  return input;
}
function secretInput(value: string, onInput: (v: string) => void, placeholder = "") {
  const input = textInput(value, onInput, {
    type: "password",
    placeholder,
    autocomplete: "off",
  });
  const eye: HTMLButtonElement = iconButton(
    "eye",
    t("settings.show"),
    () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.replaceChildren(icon(show ? "eyeOff" : "eye", 17));
      eye.title = t(show ? "settings.hide" : "settings.show");
    },
    "icon-btn-sm",
  );
  return h("div", { class: "secret" }, input, eye);
}
function toggleRow(
  title: string,
  hint: string,
  checked: boolean,
  onChange: (v: boolean) => void,
) {
  const input = h("input", { type: "checkbox", checked, role: "switch" });
  input.addEventListener("change", () => {
    onChange(input.checked);
    changed();
  });
  return h(
    "label",
    { class: "switch-row" },
    h(
      "span",
      { class: "switch-text" },
      h("span", { class: "switch-title" }, title),
      hint ? h("span", { class: "field-hint" }, hint) : null,
    ),
    h("span", { class: "switch" }, input, h("span", { class: "track" })),
  );
}
function segmented<T extends string>(
  value: T,
  options: [T, string, IconName?][],
  onChange: (v: T) => void,
) {
  const wrap = h("div", { class: "segmented", role: "group" });
  const draw = (v: T) =>
    wrap.replaceChildren(
      ...options.map(([key, label, name]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String(key === v),
            onclick: () => {
              draw(key);
              onChange(key);
              changed();
            },
          },
          name ? icon(name, 15) : null,
          label,
        ),
      ),
    );
  draw(value);
  return wrap;
}
function selectInput(value: string, options: [string, string][], onChange: (v: string) => void) {
  const select = h(
    "select",
    { class: "input" },
    options.map(([v, label]) => h("option", { value: v }, label)),
  );
  select.value = value;
  select.addEventListener("change", () => {
    onChange(select.value);
    changed();
  });
  return select;
}
function rangeRow(
  value: number,
  [min, max, step]: [number, number, number],
  format: (v: number) => string,
  onInput: (v: number) => void,
) {
  const out = h("span", { class: "range-value" }, format(value));
  const input = h("input", {
    type: "range",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onInput(v);
    changed();
  });
  return h("div", { class: "range-row" }, input, out);
}

// ------------------------------------------------------------ models
function uniqueName(base: string) {
  let name = base,
    n = 2;
  while (settings.profiles.some((p) => p.name === name)) name = `${base} ${n++}`;
  return name;
}
function addProfile(presetId: string) {
  const presets = providerPresets();
  const preset = presets.find((x) => x.id === presetId) || presets[0];
  const p = defaultProfile();
  p.name = uniqueName(preset.id === "custom" ? t("settings.customName") : preset.name);
  p.provider = preset.provider;
  p.baseUrl = preset.baseUrl;
  if (preset.provider === "gemini") p.contextTokens = 128000;
  settings.profiles.push(p);
  if (!settings.activeProfileId) settings.activeProfileId = p.id;
  selected = p.id;
  render();
  changed();
}
function modelsSection(): Child[] {
  if (!settings.profiles.length)
    return [
      card(
        t("settings.pickProvider"),
        t("settings.pickProviderDesc"),
        h(
          "div",
          { class: "preset-grid" },
          providerPresets().map((preset) =>
            h(
              "button",
              { type: "button", class: "preset", onclick: () => addProfile(preset.id) },
              h(
                "span",
                { class: "preset-icon" },
                icon(preset.provider === "gemini" ? "sparkles" : preset.id === "custom" ? "plus" : "cpu", 18),
              ),
              h("span", { class: "preset-name" }, preset.name),
              h("span", { class: "preset-hint" }, preset.hint),
            ),
          ),
        ),
      ),
    ];
  if (!settings.profiles.some((p) => p.id === selected))
    selected = settings.activeProfileId || settings.profiles[0].id;
  const p = settings.profiles.find((x) => x.id === selected)!;
  listHost = h("div", { class: "profile-list-host" }, profileList());
  return [h("div", { class: "models-layout" }, listHost, profileEditor(p))];
}
function refreshList() {
  listHost?.replaceChildren(profileList());
}
function profileList() {
  const add = h(
    "button",
    { type: "button", class: "add-profile" },
    icon("plus", 16),
    t("settings.newProfile"),
  );
  add.onclick = () =>
    openMenu(add, [
      { heading: t("settings.chooseProvider") },
      ...providerPresets().map((preset) => ({
        label: preset.name,
        hint: preset.hint,
        action: () => addProfile(preset.id),
      })),
    ]);
  return h(
    "div",
    { class: "profile-list" },
    settings.profiles.map((p) =>
      h(
        "button",
        {
          type: "button",
          class: "profile-item" + (p.id === selected ? " selected" : ""),
          onclick: () => {
            selected = p.id;
            render();
          },
        },
        h("span", { class: "provider-avatar" }, icon(p.provider === "gemini" ? "sparkles" : "cpu", 16)),
        h(
          "span",
          { class: "profile-text" },
          h(
            "span",
            { class: "profile-name" },
            h("span", null, p.name || t("settings.unnamed")),
            p.id === settings.activeProfileId
              ? h("span", { class: "badge" }, t("settings.default"))
              : null,
          ),
          h("span", { class: "profile-sub" }, p.model || t("settings.noModel")),
        ),
      ),
    ),
    add,
  );
}

function profileEditor(p: Profile) {
  const caps = () => capabilities(p);
  const nameHeading = h("h2", null, p.name || t("settings.unnamedProfile"));
  const result = h("div", { class: "test-result" });
  result.hidden = true;
  const testButton = button(t("settings.test"), () => void test(), "btn-small", "zap");
  const more: HTMLButtonElement = iconButton("more", t("settings.moreActions"), () =>
    openMenu(
      more,
      [
        {
          label: t("settings.makeDefault"),
          icon: "star",
          disabled: settings.activeProfileId === p.id,
          action: () => {
            settings.activeProfileId = p.id;
            render();
            changed();
          },
        },
        {
          label: t("settings.duplicate"),
          icon: "copy",
          action: () => {
            const copy = structuredClone(p);
            copy.id = uid();
            copy.name = uniqueName(t("settings.copyName", { name: p.name }));
            settings.profiles.splice(settings.profiles.indexOf(p) + 1, 0, copy);
            selected = copy.id;
            render();
            changed();
          },
        },
        "separator",
        {
          label: t("settings.deleteProfile"),
          icon: "trash",
          danger: true,
          action: () => void remove(),
        },
      ],
      { align: "end" },
    ),
  );

  // connection
  const modelList = h("datalist", { id: "models-" + p.id });
  const modelInput = textInput(
    p.model,
    (v) => {
      p.model = v.trim();
      refreshList();
      refreshDerived();
    },
    {
      list: modelList.id,
      placeholder: t("settings.modelExample", {
        model: p.provider === "gemini" ? "gemini-2.5-flash" : "gpt-4.1-mini",
      }),
    },
  );
  const fetchButton = button(t("settings.fetchModels"), () => void fetchModels(), "btn-small", "list");
  const connection = card(
    t("settings.connection"),
    "",
    h(
      "div",
      { class: "grid-2" },
      field(
        t("settings.profileName"),
        textInput(p.name, (v) => {
          p.name = v;
          nameHeading.textContent = v || t("settings.unnamedProfile");
          refreshList();
        }),
      ),
      field(
        t("settings.protocol"),
        segmented(
          p.provider,
          [
            ["openai", t("protocol.openai")],
            ["gemini", t("protocol.gemini")],
          ],
          (v) => {
            p.provider = v;
            drawSearchCard();
            refreshDerived();
          },
        ),
      ),
      field(
        t("settings.baseUrl"),
        textInput(p.baseUrl, (v) => {
          p.baseUrl = v.trim();
          refreshDerived();
        }, { placeholder: "https://…/v1" }),
        t("settings.baseUrlHint"),
        true,
      ),
      field(
        "API key",
        secretInput(p.apiKey, (v) => (p.apiKey = v.trim()), t("settings.keyOptionalLocal")),
        t("settings.keyHint"),
        true,
      ),
      field(
        t("settings.model"),
        h("div", { class: "field-row" }, modelInput, fetchButton, modelList),
        t("settings.modelHint"),
        true,
      ),
    ),
  );

  // generation
  const temperature = numberInput(p.temperature, (v) => (p.temperature = v), {
    step: "0.1",
    min: "0",
    max: "2",
    placeholder: t("common.default"),
  });
  const topP = numberInput(p.topP, (v) => (p.topP = v), {
    step: "0.05",
    min: "0",
    max: "1",
    placeholder: t("common.default"),
  });
  const temperatureHint = h("span", { class: "field-hint" });
  const topPHint = h("span", { class: "field-hint" });
  const generation = card(
    t("settings.generation"),
    t("settings.generationDesc"),
    h(
      "div",
      { class: "grid-2" },
      field(
        t("settings.contextTokens"),
        numberInput(p.contextTokens, (v) => (p.contextTokens = v ?? NaN), { min: "1024", step: "1024" }),
        t("settings.contextTokensHint"),
      ),
      field(
        t("settings.maxOutput"),
        numberInput(p.maxOutputTokens, (v) => (p.maxOutputTokens = v ?? NaN), { min: "1", step: "256" }),
        t("settings.maxOutputHint"),
      ),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Temperature"), temperature, temperatureHint),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Top P"), topP, topPHint),
    ),
  );
  const thinkingHost = h("div", { class: "card-host" });

  // built-in web search
  const searchHost = h("div", { class: "card-host" });
  const searchStatus = h("div", { class: "search-status" });
  function setSearchParams(text: string, area: HTMLTextAreaElement) {
    const key = "search:" + p.id;
    try {
      const value = text.trim() ? JSON.parse(text) : {};
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      p.searchParams = Object.keys(value).length ? value : undefined;
      errors.delete(key);
      area.classList.remove("invalid");
    } catch {
      errors.set(key, t("settings.searchParamsInvalid"));
      area.classList.add("invalid");
    }
    refreshDerived();
    changed();
  }
  function drawSearchCard() {
    if (p.provider === "gemini") {
      errors.delete("search:" + p.id);
      searchHost.replaceChildren(
        card(t("settings.nativeSearch"), t("settings.nativeSearchGemini"), searchStatus),
      );
      return;
    }
    const area = h("textarea", {
      class: "input textarea code-input",
      rows: 3,
      value: p.searchParams ? JSON.stringify(p.searchParams, null, 2) : "",
      placeholder: t("settings.searchParamsExample"),
      "aria-label": t("settings.searchParamsLabel"),
    });
    area.spellcheck = false;
    area.addEventListener("input", () => setSearchParams(area.value, area));
    searchHost.replaceChildren(
      card(
        t("settings.nativeSearch"),
        t("settings.nativeSearchOpenai"),
        searchStatus,
        field(t("settings.searchParams"), area, t("settings.searchParamsHint"), true),
        h(
          "div",
          { class: "quick-chips" },
          searchParamPresets().map(([label, value]) =>
            h(
              "button",
              {
                type: "button",
                class: "quick-chip",
                onclick: () => {
                  area.value = JSON.stringify(value, null, 2);
                  setSearchParams(area.value, area);
                },
              },
              label,
            ),
          ),
        ),
      ),
    );
  }

  const timeouts = card(
    t("settings.timeouts"),
    t("settings.timeoutsDesc"),
    h(
      "div",
      { class: "grid-3" },
      field(t("settings.timeoutFirst"), numberInput(p.timeouts.first, (v) => (p.timeouts.first = v ?? NaN), { min: "1" })),
      field(t("settings.timeoutIdle"), numberInput(p.timeouts.idle, (v) => (p.timeouts.idle = v ?? NaN), { min: "1" })),
      field(t("settings.timeoutTotal"), numberInput(p.timeouts.total, (v) => (p.timeouts.total = v ?? NaN), { min: "1" })),
    ),
  );

  // capabilities
  const chips = h("div", { class: "cap-chips" });
  const overrideHost = h("div", { class: "override" });
  const capabilityCard = card(
    t("settings.capabilities"),
    t("settings.capabilitiesDesc"),
    chips,
    toggleRow(
      t("settings.override"),
      t("settings.overrideHint"),
      !!p.capabilities,
      (on) => {
        p.capabilities = on ? capabilities({ ...p, capabilities: undefined }) : undefined;
        drawOverride();
        refreshDerived();
      },
    ),
    overrideHost,
  );

  // advanced
  const extra = h("textarea", {
    class: "input textarea code-input",
    rows: 5,
    value: JSON.stringify(p.extra, null, 2),
    "aria-label": t("settings.extraLabel"),
  });
  extra.spellcheck = false;
  extra.addEventListener("input", () => {
    const key = "extra:" + p.id;
    try {
      const value = JSON.parse(extra.value.trim() || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      p.extra = value;
      errors.delete(key);
      extra.classList.remove("invalid");
    } catch {
      errors.set(key, t("settings.extraInvalid"));
      extra.classList.add("invalid");
    }
    changed();
  });
  const advanced = h(
    "details",
    { class: "card advanced" },
    h("summary", null, icon("chevronRight", 16), t("settings.extra")),
    field(
      "JSON",
      extra,
      t("settings.extraHint", {
        target: t(p.provider === "gemini" ? "settings.extraGemini" : "settings.extraOpenai"),
      }),
    ),
  );

  function setCapability(key: keyof Capabilities, value: unknown) {
    (p.capabilities as unknown as Record<string, unknown>)[key] = value;
    refreshDerived();
  }
  function drawOverride() {
    overrideHost.replaceChildren();
    if (!p.capabilities) return;
    const c = caps();
    const flag = (label: string, key: keyof Capabilities, hint = "") =>
      toggleRow(label, hint, !!c[key], (v) => setCapability(key, v));
    overrideHost.append(
      h(
        "div",
        { class: "grid-2 override-grid" },
        flag(t("settings.capVision"), "vision"),
        flag(t("settings.capPdf"), "documents"),
        flag(t("settings.capTools"), "tools", t("settings.capToolsHint")),
        flag(t("settings.nativeSearch"), "nativeSearch", t("settings.capNativeHint")),
        flag("temperature", "temperature"),
        flag("top_p", "topP"),
        field(
          t("settings.reasoningParam"),
          selectInput(
            c.reasoning,
            [
              ["none", t("settings.reasoningNone")],
              ["effort", "reasoning_effort (OpenAI)"],
              ["level", "thinkingLevel (Gemini 3)"],
              ["budget", "thinkingBudget (Gemini 2.5)"],
            ],
            (v) => {
              setCapability("reasoning", v);
              drawOverride();
            },
          ),
        ),
        c.reasoning === "effort" || c.reasoning === "level"
          ? field(
              t("settings.efforts"),
              textInput(c.efforts.join(", "), (v) =>
                setCapability("efforts", v.split(/[,，\s]+/).filter(Boolean)),
              ),
              t("settings.effortsHint"),
            )
          : null,
        c.reasoning === "budget"
          ? field(
              t("settings.budgetRange"),
              h(
                "div",
                { class: "field-row" },
                numberInput(c.budgetMin, (v) => setCapability("budgetMin", v ?? NaN), {
                  "aria-label": t("settings.budgetMin"),
                }),
                numberInput(c.budgetMax, (v) => setCapability("budgetMax", v ?? NaN), {
                  "aria-label": t("settings.budgetMax"),
                }),
              ),
            )
          : null,
        c.reasoning !== "none" ? flag(t("settings.canDisable"), "canDisable") : null,
        p.provider === "openai"
          ? field(
              t("settings.maxOutputField"),
              selectInput(
                c.maxOutputField,
                [
                  ["max_tokens", "max_tokens"],
                  ["max_completion_tokens", "max_completion_tokens"],
                ],
                (v) => setCapability("maxOutputField", v),
              ),
            )
          : null,
      ),
    );
  }
  function thinkingCard(c: Capabilities) {
    if (c.reasoning === "none") {
      const stale = p.reasoning !== undefined && p.reasoning !== "";
      return card(
        t("settings.thinking"),
        t("settings.thinkingNone"),
        stale
          ? h(
              "div",
              { class: "inline-warning" },
              icon("alert", 15),
              h("span", null, t("settings.thinkingStale", { value: String(p.reasoning) })),
              button(t("settings.clear"), () => {
                p.reasoning = undefined;
                refreshDerived();
                changed();
              }, "btn-small"),
            )
          : null,
      );
    }
    let control: HTMLElement;
    let hint: string;
    if (c.reasoning === "budget") {
      const value =
        p.reasoning === undefined || p.reasoning === "" ? undefined : Number(p.reasoning);
      const input = numberInput(value, (v) => (p.reasoning = v), {
        placeholder: t("settings.providerDefault"),
        step: "128",
      });
      const quick = (label: string, v: number | undefined) =>
        h(
          "button",
          {
            type: "button",
            class: "quick-chip",
            onclick: () => {
              p.reasoning = v;
              input.value = v === undefined ? "" : String(v);
              changed();
            },
          },
          label,
        );
      control = h(
        "div",
        { class: "stack-sm" },
        input,
        h(
          "div",
          { class: "quick-chips" },
          quick(t("common.default"), undefined),
          quick(t("settings.dynamic"), -1),
          c.canDisable ? quick(t("settings.off0"), 0) : null,
          quick("4096", Math.max(c.budgetMin, Math.min(4096, c.budgetMax))),
          quick("16384", Math.max(c.budgetMin, Math.min(16384, c.budgetMax))),
        ),
      );
      hint = t(c.canDisable ? "settings.budgetHintOff" : "settings.budgetHintOn", {
        min: c.budgetMin,
        max: c.budgetMax,
      });
    } else {
      control = selectInput(
        p.reasoning === undefined ? "" : String(p.reasoning),
        [
          ["", t("settings.providerDefault")],
          ...c.efforts.map((e): [string, string] => [
            e,
            EFFORT_LABEL[e] ? t("settings.effortOption", { value: e, label: t(EFFORT_LABEL[e]) }) : e,
          ]),
        ],
        (v) => {
          p.reasoning = v || undefined;
          refreshDerived();
        },
      );
      hint = t(c.reasoning === "level" ? "settings.levelHint" : "settings.effortHint");
    }
    return card(
      t("settings.thinking"),
      t(
        c.reasoning === "budget"
          ? "settings.budgetDesc"
          : c.reasoning === "level"
            ? "settings.levelDesc"
            : "settings.effortDesc",
      ),
      h(
        "div",
        { class: "grid-2" },
        field(
          t(c.reasoning === "budget" ? "settings.thinkingBudget" : "settings.thinkingEffort"),
          control,
          hint,
        ),
        p.provider === "gemini"
          ? toggleRow(
              t("settings.includeThoughts"),
              t("settings.includeThoughtsHint"),
              p.includeThoughts,
              (v) => (p.includeThoughts = v),
            )
          : null,
      ),
    );
  }
  function refreshDerived() {
    const c = caps();
    temperature.disabled = !c.temperature;
    topP.disabled = !c.topP;
    if (!c.temperature && p.temperature !== undefined) {
      p.temperature = undefined;
      temperature.value = "";
    }
    if (!c.topP && p.topP !== undefined) {
      p.topP = undefined;
      topP.value = "";
    }
    temperatureHint.textContent = c.temperature
      ? t("settings.temperatureHint")
      : t("settings.unsupported");
    topPHint.textContent = c.topP ? "0–1" : t("settings.unsupported");
    const items: [string, boolean][] = [
      [t("cap.vision"), c.vision],
      ["PDF", c.documents],
      [t("cap.tools"), c.tools],
      [t("cap.nativeSearch"), c.nativeSearch],
      [
        c.reasoning === "none"
          ? t("cap.reasoning")
          : t("settings.thinkingChip", {
              range:
                c.reasoning === "budget" ? `${c.budgetMin}–${c.budgetMax}` : c.efforts.join("/"),
            }),
        c.reasoning !== "none",
      ],
    ];
    chips.replaceChildren(
      ...items.map(([label, on]) =>
        h("span", { class: "cap" + (on ? " on" : "") }, icon(on ? "check" : "x", 13), label),
      ),
    );
    thinkingHost.replaceChildren(thinkingCard(c));
    searchStatus.className = "search-status" + (c.nativeSearch ? " on" : "");
    searchStatus.replaceChildren(
      icon(c.nativeSearch ? "check" : "info", 14),
      h(
        "span",
        null,
        t(
          c.nativeSearch
            ? "settings.nativeOn"
            : c.tools
              ? "settings.nativeOffTools"
              : "settings.nativeOffNone",
        ),
      ),
    );
  }
  async function fetchModels() {
    fetchButton.disabled = true;
    try {
      apiOrigin(p.baseUrl);
      const models = (await listModels(p, AbortSignal.timeout(20000))).sort();
      modelList.replaceChildren(...models.map((id) => h("option", { value: id })));
      if (!models.length) return toast(t("settings.noModels"), "error");
      openMenu(fetchButton, [
        { heading: t("settings.modelsFound", { count: models.length }) },
        ...models.map((id) => ({
          label: id,
          checked: id === p.model,
          action: () => {
            p.model = id;
            modelInput.value = id;
            refreshList();
            refreshDerived();
            changed();
          },
        })),
      ], { align: "end" });
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      fetchButton.disabled = false;
    }
  }
  async function test() {
    result.hidden = false;
    result.className = "test-result pending";
    result.replaceChildren(spinner(), h("span", null, t("settings.testing")));
    testButton.disabled = true;
    let scope: RequestScope | undefined;
    try {
      validateProfile(p);
      scope = new RequestScope(p.timeouts);
      const started = performance.now();
      const r = await generate({
        profile: structuredClone(p),
        system: "Reply briefly.",
        messages: [
          {
            id: uid(),
            role: "user",
            parts: [{ type: "text", text: "Reply with OK." }],
            createdAt: Date.now(),
          },
        ],
        scope,
        onDelta: () => {},
      });
      const reply = (r.text || r.thought || t("common.empty")).trim().slice(0, 80);
      result.className = "test-result ok";
      result.replaceChildren(
        icon("check", 15),
        h(
          "span",
          null,
          t("settings.testOk", {
            seconds: ((performance.now() - started) / 1000).toFixed(1),
            reply,
          }),
        ),
      );
    } catch (error) {
      result.className = "test-result fail";
      result.replaceChildren(icon("alert", 15), h("span", null, errorText(error)));
    } finally {
      scope?.dispose();
      testButton.disabled = false;
    }
  }
  async function remove() {
    if (
      !(await confirmAction(
        t("settings.deleteProfile"),
        t("settings.deleteProfileConfirm", { name: p.name }),
      ))
    )
      return;
    settings.profiles = settings.profiles.filter((x) => x.id !== p.id);
    errors.delete("extra:" + p.id);
    errors.delete("search:" + p.id);
    if (settings.activeProfileId === p.id)
      settings.activeProfileId = settings.profiles[0]?.id || "";
    selected = settings.profiles[0]?.id || "";
    render();
    changed();
  }

  drawOverride();
  drawSearchCard();
  refreshDerived();
  return h(
    "div",
    { class: "editor" },
    h(
      "div",
      { class: "editor-head" },
      nameHeading,
      settings.activeProfileId === p.id ? h("span", { class: "badge" }, t("settings.default")) : null,
      h("div", { class: "actions" }, testButton, more),
    ),
    result,
    connection,
    generation,
    thinkingHost,
    searchHost,
    timeouts,
    capabilityCard,
    advanced,
  );
}

// ------------------------------------------------------------ search
const modeItem = (name: IconName, title: string, text: string) =>
  h(
    "div",
    { class: "mode-item" },
    h("span", { class: "mode-icon" }, icon(name, 16)),
    h("div", null, h("div", { class: "mode-title" }, title), h("div", { class: "field-hint" }, text)),
  );
const external = (href: string, text = new URL(href).hostname) =>
  h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
function searchSection(): Child[] {
  const s = settings.search;
  const grid = h("div", {
    class: "service-grid",
    role: "radiogroup",
    "aria-label": t("settings.searchService"),
  });
  const detail = h("div", { class: "stack" });
  const result = h("div", { class: "test-result" });
  const testButton = button(t("settings.testSearch"), () => void test(), "btn-small", "search");
  const drawGrid = () =>
    grid.replaceChildren(
      ...searchServices().map((x) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            "aria-checked": String(x.id === s.provider),
            class: "service" + (x.id === s.provider ? " selected" : ""),
            onclick: () => {
              s.provider = x.id;
              drawGrid();
              drawDetail();
              changed();
            },
          },
          h(
            "span",
            { class: "service-name" },
            x.name,
            s.services[x.id].apiKey ? icon("check", 13) : null,
          ),
          h("span", { class: "preset-hint" }, x.hint),
        ),
      ),
    );
  function drawDetail() {
    const meta = searchMeta(s.provider);
    const service = s.services[s.provider];
    // The key hint links to the provider's site in the middle of the sentence.
    const [before, after] = t(
      meta.keyRequired ? "settings.keyRequired" : "settings.keyOptional",
    ).split("{site}");
    result.hidden = true;
    detail.replaceChildren(
      h(
        "div",
        { class: "grid-2" },
        field(
          "API key",
          secretInput(service.apiKey, (v) => (service.apiKey = v.trim()), meta.keyPlaceholder),
          h("span", null, before, external(meta.site), after),
          true,
        ),
        field(
          t("settings.baseUrl"),
          textInput(service.baseUrl, (v) => (service.baseUrl = v.trim()), {
            placeholder: meta.baseUrl || "https://searx.example.com",
          }),
          t(meta.baseUrl ? "settings.baseUrlDefault" : "settings.baseUrlInstance"),
          true,
        ),
      ),
      h("div", { class: "row-end" }, testButton),
      result,
    );
  }
  async function test() {
    result.hidden = false;
    result.className = "test-result pending";
    result.replaceChildren(spinner(), h("span", null, t("settings.searching")));
    testButton.disabled = true;
    const scope = new RequestScope({ first: s.timeout, idle: s.timeout, total: s.timeout + 5 });
    try {
      const started = performance.now();
      const found = await search("Chrome side panel API", structuredClone(s), scope);
      result.className = "test-result ok";
      result.replaceChildren(
        icon("check", 15),
        h(
          "span",
          null,
          t("settings.searchOk", {
            seconds: ((performance.now() - started) / 1000).toFixed(1),
            count: found.length,
          }) + (found[0] ? t("settings.searchFirst", { title: found[0].title }) : ""),
        ),
      );
    } catch (error) {
      result.className = "test-result fail";
      result.replaceChildren(icon("alert", 15), h("span", null, errorText(error)));
    } finally {
      scope.dispose();
      testButton.disabled = false;
    }
  }
  drawGrid();
  drawDetail();
  return [
    card(
      t("settings.modelSearch"),
      t("settings.modelSearchDesc"),
      h(
        "div",
        { class: "mode-list" },
        modeItem("sparkles", t("settings.geminiNative"), t("settings.geminiSearchText")),
        modeItem("cpu", t("settings.openaiCompatible"), t("settings.openaiSearchText")),
        modeItem("globe", t("settings.otherModels"), t("settings.otherModelsText")),
      ),
    ),
    card(t("settings.searchService"), t("settings.searchServiceDesc"), grid, detail),
    card(
      t("settings.searchOptions"),
      "",
      h(
        "div",
        { class: "grid-2" },
        field(
          t("settings.rounds"),
          numberInput(s.rounds, (v) => (s.rounds = v ?? NaN), { min: "1", max: "8" }),
          t("settings.roundsHint"),
        ),
        field(
          t("settings.results"),
          numberInput(s.results, (v) => (s.results = v ?? NaN), { min: "1", max: "20" }),
          t("settings.resultsHint"),
        ),
        field(
          t("settings.timeoutSeconds"),
          numberInput(s.timeout, (v) => (s.timeout = v ?? NaN), { min: "1" }),
        ),
        field(
          t("settings.maxChars"),
          numberInput(s.maxChars, (v) => (s.maxChars = v ?? NaN), { min: "100", step: "1000" }),
          t("settings.maxCharsHint"),
        ),
      ),
    ),
    card(
      t("settings.modes"),
      t("settings.modesDesc"),
      h(
        "div",
        { class: "mode-list" },
        modeItem("x", t("searchMode.off"), t("settings.modeOff")),
        modeItem("sparkles", t("searchMode.auto"), t("settings.modeAuto")),
        modeItem("search", t("searchMode.required"), t("settings.modeRequired")),
      ),
    ),
  ];
}

// ------------------------------------------------------------ prompts
function promptsSection(): Child[] {
  const area = h("textarea", {
    class: "input textarea prompt-area",
    rows: 9,
    value: settings.systemPrompt,
    "aria-label": t("settings.globalPrompt"),
  });
  area.addEventListener("input", () => {
    settings.systemPrompt = area.value;
    changed();
  });
  return [
    card(t("settings.globalPrompt"), t("settings.globalPromptDesc"), area),
    card(
      t("settings.longText"),
      "",
      h(
        "div",
        { class: "grid-2" },
        field(
          t("settings.maxCalls"),
          numberInput(settings.maxCalls, (v) => (settings.maxCalls = v ?? NaN), { min: "1", max: "64" }),
          t("settings.maxCallsHint"),
        ),
      ),
    ),
  ];
}

// ------------------------------------------------------------ actions
function actionsSection(): Child[] {
  const stage = h("div", { class: "preview-stage" });
  const drawPreview = () =>
    stage.replaceChildren(
      settings.actions.length
        ? h(
            "div",
            { class: "toolbar-preview" },
            settings.actions.map((a) =>
              h("span", null, icon(actionIcon(a.icon), 15), a.name || t("settings.unnamed")),
            ),
          )
        : h("span", { class: "muted" }, t("settings.noActions")),
    );
  drawPreview();
  const insert = (key: string) => {
    const area =
      lastTemplate?.isConnected
        ? lastTemplate
        : document.querySelector<HTMLTextAreaElement>(".action-card textarea");
    if (!area) return;
    area.setRangeText(`{{${key}}}`, area.selectionStart, area.selectionEnd, "end");
    area.dispatchEvent(new Event("input"));
    area.focus();
  };
  const actionCard = (a: ActionTemplate, index: number) => {
    const pick: HTMLButtonElement = h(
      "button",
      { type: "button", class: "icon-pick", title: t("settings.pickIcon") },
      icon(actionIcon(a.icon), 18),
    );
    pick.onclick = () =>
      openMenu(
        pick,
        ACTION_ICONS.map(([name, label]) => ({
          label: t(label),
          icon: name,
          checked: a.icon === name,
          action: () => {
            a.icon = name;
            pick.replaceChildren(icon(name, 18));
            drawPreview();
            changed();
          },
        })),
      );
    const name = textInput(a.name, (v) => {
      a.name = v;
      drawPreview();
    }, { placeholder: t("settings.actionName"), "aria-label": t("settings.actionName") });
    const template = h("textarea", {
      class: "input textarea",
      rows: 3,
      value: a.prompt,
      "aria-label": t("settings.template"),
    });
    template.addEventListener("input", () => {
      a.prompt = template.value;
      changed();
    });
    template.addEventListener("focus", () => {
      lastTemplate = template;
    });
    const move = (delta: number) => {
      const j = index + delta;
      if (j < 0 || j >= settings.actions.length) return;
      [settings.actions[index], settings.actions[j]] = [settings.actions[j], settings.actions[index]];
      render();
      changed();
    };
    const up = iconButton("arrowUp", t("settings.moveUp"), () => move(-1), "icon-btn-sm");
    up.disabled = index === 0;
    const down = iconButton("arrowDown", t("settings.moveDown"), () => move(1), "icon-btn-sm");
    down.disabled = index === settings.actions.length - 1;
    return h(
      "section",
      { class: "card action-card" },
      h(
        "div",
        { class: "action-head" },
        pick,
        name,
        h("span", { class: "spacer" }),
        up,
        down,
        iconButton("trash", t("settings.deleteAction"), () => {
          settings.actions.splice(index, 1);
          render();
          changed();
        }, "icon-btn-sm danger"),
      ),
      template,
    );
  };
  return [
    card(t("settings.toolbarPreview"), t("settings.toolbarPreviewDesc"), stage),
    card(
      t("settings.variables"),
      t("settings.variablesDesc"),
      h(
        "div",
        { class: "var-chips" },
        VARS.map(([key, label]) =>
          h(
            "button",
            {
              type: "button",
              class: "var-chip",
              onpointerdown: (e: PointerEvent) => e.preventDefault(),
              onclick: () => insert(key),
            },
            h("code", null, `{{${key}}}`),
            h("span", null, t(label)),
          ),
        ),
      ),
    ),
    h("div", { class: "action-list" }, settings.actions.map(actionCard)),
    h(
      "button",
      {
        type: "button",
        class: "add-row",
        onclick: () => {
          settings.actions.push({
            id: uid(),
            name: t("settings.newAction"),
            icon: "sparkles",
            prompt: t("settings.newActionPrompt"),
          });
          render();
          changed();
        },
      },
      icon("plus", 16),
      t("settings.addAction"),
    ),
  ];
}

// ------------------------------------------------------------ appearance
const sampleAnswer = () =>
  t("settings.sampleIntro") +
  "\n\n" +
  String.raw`$$i\hbar\frac{\partial}{\partial t}\lvert\psi(t)\rangle=\hat H\lvert\psi(t)\rangle$$` +
  "\n\n" +
  t("settings.sampleOutro");
function appearanceSection(): Child[] {
  const sample = h("div", { class: "appearance-preview" });
  const drawSample = () =>
    sample.replaceChildren(
      h("div", { class: "msg msg-user" }, h("div", { class: "bubble" }, t("settings.sampleQuestion"))),
      h(
        "div",
        { class: "msg msg-assistant" },
        h("div", { class: "markdown", innerHTML: renderMarkdown(sampleAnswer()).html }),
      ),
    );
  const live = () => {
    applyAppearance(settings);
    drawSample();
  };

  const language = segmented<Settings["uiLanguage"]>(
    settings.uiLanguage,
    [
      ["auto", t("settings.languageAuto")],
      ["en", "English"],
      ["zh-CN", "简体中文"],
    ],
    (v) => {
      settings.uiLanguage = v;
      applyLocale(settings);
      // Unedited default prompts and actions switch along with the interface.
      settings = normalizeSettings(settings);
      applyLanguage();
      render();
    },
  );

  const themes: [Settings["theme"], MessageKey, IconName][] = [
    ["system", "settings.themeSystem", "monitor"],
    ["light", "settings.themeLight", "sun"],
    ["dark", "settings.themeDark", "moon"],
  ];
  const themeGrid = h("div", { class: "theme-options" });
  const drawThemes = () =>
    themeGrid.replaceChildren(
      ...themes.map(([value, label, name]) =>
        h(
          "button",
          {
            type: "button",
            class: "theme-option",
            "aria-pressed": String(settings.theme === value),
            onclick: () => {
              settings.theme = value;
              drawThemes();
              live();
              changed();
            },
          },
          h("span", { class: "theme-thumb thumb-" + value }, h("i"), h("i"), h("i")),
          h("span", { class: "theme-label" }, icon(name, 15), t(label)),
        ),
      ),
    );
  drawThemes();

  const swatches = h("div", { class: "swatches" });
  const drawSwatches = () => {
    const accent = settings.accent.toLowerCase();
    const custom = !ACCENTS.some((a) => a.value === accent);
    const picker = h("input", {
      type: "color",
      value: settings.accent,
      "aria-label": t("settings.customAccent"),
    });
    picker.addEventListener("input", () => {
      settings.accent = picker.value;
      live();
      changed();
    });
    picker.addEventListener("change", drawSwatches);
    swatches.replaceChildren(
      ...ACCENTS.map((a) =>
        h(
          "button",
          {
            type: "button",
            class: "swatch",
            title: t(a.name),
            "aria-label": t(a.name),
            "aria-pressed": String(a.value === accent),
            style: `--swatch:${a.value}`,
            onclick: () => {
              settings.accent = a.value;
              drawSwatches();
              live();
              changed();
            },
          },
          a.value === accent ? icon("check", 15) : null,
        ),
      ),
      h(
        "label",
        {
          class: "swatch swatch-custom",
          title: t("settings.customColor"),
          "aria-pressed": String(custom),
          style: custom ? `--swatch:${settings.accent}` : "",
        },
        custom ? icon("check", 15) : icon("plus", 15),
        picker,
      ),
    );
  };
  drawSwatches();

  const fonts = h("div", { class: "font-options" });
  const customFont = textInput(
    FONT_PRESETS.some((f) => f.id === settings.fontFamily) ? "" : settings.fontFamily,
    (v) => {
      settings.fontFamily = v.trim() || "system";
      drawFonts();
      live();
    },
    { placeholder: t("settings.customFont") },
  );
  const drawFonts = () =>
    fonts.replaceChildren(
      ...FONT_PRESETS.map((f) =>
        h(
          "button",
          {
            type: "button",
            class: "font-option",
            "aria-pressed": String(settings.fontFamily === f.id),
            onclick: () => {
              settings.fontFamily = f.id;
              customFont.value = "";
              drawFonts();
              live();
              changed();
            },
          },
          h("span", { class: "font-sample", style: `font-family:${f.stack}` }, t("settings.fontSample")),
          h("span", { class: "font-name" }, t(f.name)),
        ),
      ),
    );
  drawFonts();
  drawSample();

  return [
    card(t("settings.language"), t("settings.languageDesc"), language),
    card(t("settings.theme"), "", themeGrid),
    card(t("settings.accent"), t("settings.accentDesc"), swatches),
    card(t("settings.font"), t("settings.fontDesc"), h("div", { class: "stack" }, fonts, customFont)),
    card(
      t("settings.size"),
      "",
      h(
        "div",
        { class: "stack" },
        field(
          t("settings.fontSize"),
          rangeRow(settings.fontSize, [12, 20, 0.5], (v) => v + " px", (v) => {
            settings.fontSize = v;
            live();
          }),
        ),
        field(
          t("settings.floatWidth"),
          rangeRow(settings.floatWidth, [320, FLOAT_WIDTH_MAX, 20], (v) => v + " px", (v) => (settings.floatWidth = v)),
          t("settings.floatWidthHint"),
        ),
      ),
    ),
    card(t("settings.preview"), "", sample),
  ];
}

// ------------------------------------------------------------ sites
function normalizeHost(value: string) {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : "https://" + raw).hostname;
  } catch {
    return "";
  }
  host = host.replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host === "localhost" ? host : "";
}
async function checkPermission(box: HTMLElement) {
  const ok = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  box.replaceChildren();
  append(box, [
    h("span", { class: "dot " + (ok ? "ok" : "warn") }),
    h("span", { class: "grow" }, t(ok ? "settings.permOk" : "settings.permPartial")),
    ok
      ? null
      : button(
          t("settings.permGrant"),
          () => void chrome.permissions.request({ origins: ["<all_urls>"] }).then(() => checkPermission(box)),
          "btn-small btn-primary",
        ),
  ]);
}
function sitesSection(): Child[] {
  const chips = h("div", { class: "chip-list" });
  const drawChips = () =>
    chips.replaceChildren(
      ...(settings.blockedSites.length
        ? settings.blockedSites.map((host) =>
            h(
              "span",
              { class: "site-chip" },
              h("img", { class: "favicon", src: faviconUrl("https://" + host), alt: "" }),
              host,
              h(
                "button",
                {
                  type: "button",
                  title: t("common.remove"),
                  "aria-label": t("settings.removeSite", { host }),
                  onclick: () => {
                    settings.blockedSites = settings.blockedSites.filter((x) => x !== host);
                    drawChips();
                    changed();
                  },
                },
                icon("x", 12),
              ),
            ),
          )
        : [h("span", { class: "muted" }, t("settings.noBlocked"))]),
    );
  drawChips();
  const add = h("input", { class: "input", placeholder: t("settings.addSite") });
  add.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const host = normalizeHost(add.value);
    if (!host) return toast(t("settings.badDomain"), "error");
    if (!settings.blockedSites.includes(host)) settings.blockedSites.push(host);
    add.value = "";
    drawChips();
    changed();
  });
  const permission = h("div", { class: "perm-state" }, spinner(), t("settings.checking"));
  void checkPermission(permission);
  return [
    card(
      "",
      "",
      toggleRow(
        t("settings.selectionToggle"),
        t("settings.selectionToggleHint"),
        settings.selectionEnabled,
        (v) => (settings.selectionEnabled = v),
      ),
    ),
    card(t("settings.blocked"), t("settings.blockedDesc"), h("div", { class: "stack" }, chips, add)),
    card(t("settings.siteAccess"), t("settings.siteAccessDesc"), permission),
  ];
}

// ------------------------------------------------------------ data
const statCard = (value: string, label: string) =>
  h("div", { class: "stat-card" }, h("div", { class: "stat-value" }, value), h("div", { class: "stat-label" }, label));
function dataSection(): Child[] {
  let withKeys = false;
  const upload = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  upload.onchange = () => void importFile(upload);
  const stats = h(
    "div",
    { class: "stats" },
    statCard("…", t("settings.conversations")),
    statCard("…", t("settings.storageUsed")),
  );
  void Promise.all([countConversations(), navigator.storage.estimate()]).then(([count, estimate]) =>
    stats.replaceChildren(
      statCard(formatNumber(count), t("settings.conversations")),
      statCard(formatSize(estimate.usage || 0), t("settings.storageUsed")),
    ),
  );
  return [
    card(
      t("settings.backup"),
      t("settings.backupDesc"),
      h(
        "div",
        { class: "stack" },
        toggleRow(t("settings.includeKeys"), t("settings.includeKeysHint"), false, (v) => (withKeys = v)),
        h(
          "div",
          { class: "button-row" },
          button(t("settings.export"), () => {
            try {
              validateSettings(settings);
            } catch (error) {
              return toast(t("settings.exportInvalid", { error: errorText(error) }), "error");
            }
            download(
              withKeys ? "valise-settings-WITH-SECRETS.json" : "valise-settings.json",
              JSON.stringify(exportSettings(settings, withKeys), null, 2),
            );
          }, "", "download"),
          button(t("settings.import"), () => upload.click(), "", "upload"),
          upload,
        ),
      ),
    ),
    card(
      t("settings.localData"),
      t("settings.localDataDesc"),
      h(
        "div",
        { class: "stack" },
        stats,
        h(
          "div",
          { class: "button-row" },
          button(
            t("settings.clearSnapshots"),
            () => void clearSnapshots().then(() => toast(t("settings.snapshotsCleared"), "success")),
            "",
            "refresh",
          ),
          button(t("settings.deleteAll"), () => void wipe(), "btn-danger-soft", "trash"),
        ),
      ),
    ),
  ];
}
async function importFile(input: HTMLInputElement) {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const next = normalizeSettings(JSON.parse(await file.text()));
    validateSettings(next);
    if (
      !(await confirmAction(
        t("settings.import"),
        t("settings.importConfirm"),
        t("settings.importButton"),
      ))
    )
      return;
    clearTimeout(timer);
    applyLocale(next);
    settings = normalizeSettings(next);
    selected = "";
    errors.clear();
    await saveSettings(settings);
    saved = JSON.stringify(settings);
    applyAppearance(settings);
    applyLanguage();
    render();
    setState("saved", t("settings.imported"));
    if (settings.profiles.some((p) => !p.apiKey && !/127\.0\.0\.1|localhost/.test(p.baseUrl)))
      toast(t("settings.missingKeys"));
  } catch (error) {
    toast(t("settings.importFailed", { error: errorText(error) }), "error");
  }
}
async function wipe() {
  if (
    !(await confirmAction(
      t("settings.deleteAll"),
      t("settings.deleteAllConfirm"),
      t("settings.deleteAllButton"),
    ))
  )
    return;
  await clearConversations();
  toast(t("settings.allDeleted"), "success");
  render();
}

// ------------------------------------------------------------ about
function aboutSection(): Child[] {
  const shortcuts = h("div", { class: "shortcut-list" });
  void chrome.commands.getAll().then((commands) =>
    shortcuts.replaceChildren(
      ...commands
        .filter((c) => c.description)
        .map((c) =>
          h(
            "div",
            { class: "shortcut" },
            h("span", null, c.description),
            c.shortcut
              ? h(
                  "span",
                  null,
                  (c.shortcut.includes("+") ? c.shortcut.split("+") : [...c.shortcut]).map((k) =>
                    h("kbd", null, k),
                  ),
                )
              : h("span", { class: "muted" }, t("settings.notSet")),
          ),
        ),
      h(
        "div",
        { class: "shortcut" },
        h("span", null, t("settings.sendNewline")),
        h("span", null, h("kbd", null, "Enter"), h("span", { class: "muted" }, " / "), h("kbd", null, "⇧"), h("kbd", null, "Enter")),
      ),
    ),
  );
  return [
    card(
      "",
      "",
      h(
        "div",
        { class: "about-hero" },
        h("div", { class: "brand-mark" }, icon("sparkles", 24)),
        h(
          "div",
          null,
          h("div", { class: "about-name" }, "Valise"),
          h(
            "div",
            { class: "muted" },
            t("settings.aboutVersion", { version: chrome.runtime.getManifest().version }),
          ),
        ),
      ),
    ),
    card(
      t("settings.shortcuts"),
      "",
      shortcuts,
      h(
        "div",
        { class: "button-row mt" },
        button(
          t("settings.editShortcuts"),
          () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
          "",
          "external",
        ),
      ),
    ),
    card(
      t("settings.privacy"),
      "",
      h(
        "ul",
        { class: "bullet-list" },
        h("li", null, t("settings.privacy1")),
        h("li", null, t("settings.privacy2")),
        h("li", null, t("settings.privacy3")),
        h("li", null, t("settings.privacy4")),
        h("li", null, t("settings.privacy5")),
      ),
    ),
  ];
}

applyLanguage();
try {
  validateSettings(settings);
  setState("saved", t("settings.autoSave"));
} catch (error) {
  setState("error", t("settings.invalid", { error: errorText(error) }));
}
applyAppearance(settings);
render();
windowId = (await chrome.windows.getCurrent()).id;
// Dragging the float's edge saves a new width from the background; adopt it so the next save keeps it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const width = normalizeSettings(changes.settings.newValue).floatWidth;
  if (width === settings.floatWidth) return;
  settings.floatWidth = width;
  if (current === "appearance") render();
});
