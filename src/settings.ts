import "./style.css";
import "./settings.css";
import { faviconUrl } from "./browser";
import {
  ACCENTS,
  apiOrigin,
  capabilities,
  defaultProfile,
  exportSettings,
  FLOAT_WIDTH_MAX,
  loadSettings,
  normalizeSettings,
  PROVIDER_PRESETS,
  saveSettings,
  SEARCH_SERVICES,
  searchMeta,
  validateProfile,
  validateSettings,
} from "./config";
import { append, h, type Child } from "./dom";
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
const SECTIONS: { id: SectionId; label: string; icon: IconName; desc: string }[] = [
  { id: "models", label: "模型", icon: "cpu", desc: "保存多套接口与模型，在侧栏中随时切换。" },
  { id: "search", label: "联网搜索", icon: "globe", desc: "优先使用模型自带的联网；也可接入搜索 API，让任何模型都能查资料。" },
  { id: "prompts", label: "提示词", icon: "pen", desc: "全局提示词对所有会话生效，单个会话可在侧栏「⋯ → 会话提示词」中覆盖。" },
  { id: "actions", label: "划词动作", icon: "cursor", desc: "选中网页文字后出现的快捷按钮，以及它们使用的提示词模板。" },
  { id: "appearance", label: "外观", icon: "palette", desc: "主题、强调色与阅读字体。" },
  { id: "sites", label: "网站", icon: "link", desc: "划词工具栏的开关、排除名单与网页访问权限。" },
  { id: "data", label: "数据", icon: "database", desc: "备份、导入与本地存储。" },
  { id: "about", label: "关于", icon: "info", desc: "版本、快捷键与隐私说明。" },
];
const EFFORT_LABEL: Record<string, string> = {
  none: "关闭",
  minimal: "极少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
};
const ACTION_ICONS: [IconName, string][] = [
  ["help", "解释"],
  ["languages", "翻译"],
  ["summary", "总结"],
  ["sparkles", "灵感"],
  ["bulb", "要点"],
  ["quote", "引用"],
  ["code", "代码"],
  ["search", "查找"],
  ["pen", "改写"],
  ["list", "列表"],
  ["message", "对话"],
  ["zap", "快速"],
  ["star", "收藏"],
  ["globe", "网络"],
];
/** Request parameters that switch on search built into an OpenAI-compatible service. */
const SEARCH_PARAM_PRESETS: [string, Record<string, unknown>][] = [
  ["OpenRouter", { plugins: [{ id: "web" }] }],
  ["OpenAI 搜索模型", { web_search_options: {} }],
  ["通义千问", { enable_search: true, search_options: { enable_source: true } }],
  ["智谱 GLM", { tools: [{ type: "web_search", web_search: { enable: true, search_result: true } }] }],
];
const VARS: [string, string][] = [
  ["selection", "选区原文"],
  ["paragraph", "所在段落"],
  ["title", "页面标题"],
  ["url", "页面地址"],
];

document.body.classList.add("settings-page");
const root = document.querySelector<HTMLElement>("#settings")!;
let settings: Settings;
let saved = "";
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
const saveState = h("div", { class: "save-state" }, "正在载入…");
const content = h("div", { class: "settings-content" });
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
        h(
          "div",
          null,
          h("div", { class: "brand-name" }, "Valise"),
          h("div", { class: "brand-version" }, "设置 · v" + chrome.runtime.getManifest().version),
        ),
      ),
      nav,
      h(
        "div",
        { class: "nav-foot" },
        button(
          "打开侧栏",
          () => {
            if (windowId !== undefined) void chrome.sidePanel.open({ windowId });
          },
          "btn-ghost",
          "sidebar",
        ),
      ),
    ),
    h(
      "main",
      { class: "settings-main" },
      h("header", { class: "settings-head" }, h("div", null, heading, description), saveState),
      content,
    ),
  ),
);

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
        s.label,
      ),
    ),
  );
  heading.textContent = section.label;
  description.textContent = section.desc;
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
  setState("saving", "正在保存…");
  clearTimeout(timer);
  timer = setTimeout(() => void commit(), 350);
}
async function commit() {
  timer = undefined;
  const fieldError = [...errors.values()][0];
  if (fieldError) return setState("error", "未保存 · " + fieldError);
  try {
    validateSettings(settings);
    const json = JSON.stringify(settings);
    if (json !== saved) {
      await saveSettings(settings);
      saved = json;
    }
    setState("saved", "已自动保存");
  } catch (error) {
    setState("error", "未保存 · " + errorText(error));
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
    "显示",
    () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.replaceChildren(icon(show ? "eyeOff" : "eye", 17));
      eye.title = show ? "隐藏" : "显示";
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
  const preset = PROVIDER_PRESETS.find((x) => x.id === presetId) || PROVIDER_PRESETS[0];
  const p = defaultProfile();
  p.name = uniqueName(preset.id === "custom" ? "自定义服务" : preset.name);
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
        "选择一个模型服务开始",
        "之后可以随时添加更多配置，例如同一服务的不同 key 或不同模型。",
        h(
          "div",
          { class: "preset-grid" },
          PROVIDER_PRESETS.map((preset) =>
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
  const add = h("button", { type: "button", class: "add-profile" }, icon("plus", 16), "新建配置");
  add.onclick = () =>
    openMenu(add, [
      { heading: "选择服务商" },
      ...PROVIDER_PRESETS.map((preset) => ({
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
            h("span", null, p.name || "未命名"),
            p.id === settings.activeProfileId ? h("span", { class: "badge" }, "默认") : null,
          ),
          h("span", { class: "profile-sub" }, p.model || "未填写模型"),
        ),
      ),
    ),
    add,
  );
}

function profileEditor(p: Profile) {
  const caps = () => capabilities(p);
  const nameHeading = h("h2", null, p.name || "未命名配置");
  const result = h("div", { class: "test-result" });
  result.hidden = true;
  const testButton = button("测试连接", () => void test(), "btn-small", "zap");
  const more: HTMLButtonElement = iconButton("more", "更多操作", () =>
    openMenu(
      more,
      [
        {
          label: "设为默认",
          icon: "star",
          disabled: settings.activeProfileId === p.id,
          action: () => {
            settings.activeProfileId = p.id;
            render();
            changed();
          },
        },
        {
          label: "复制配置",
          icon: "copy",
          action: () => {
            const copy = structuredClone(p);
            copy.id = uid();
            copy.name = uniqueName(p.name + " 副本");
            settings.profiles.splice(settings.profiles.indexOf(p) + 1, 0, copy);
            selected = copy.id;
            render();
            changed();
          },
        },
        "separator",
        { label: "删除配置", icon: "trash", danger: true, action: () => void remove() },
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
      placeholder: p.provider === "gemini" ? "例如 gemini-2.5-flash" : "例如 gpt-4.1-mini",
    },
  );
  const fetchButton = button("获取列表", () => void fetchModels(), "btn-small", "list");
  const connection = card(
    "连接",
    "",
    h(
      "div",
      { class: "grid-2" },
      field(
        "配置名称",
        textInput(p.name, (v) => {
          p.name = v;
          nameHeading.textContent = v || "未命名配置";
          refreshList();
        }),
      ),
      field(
        "协议",
        segmented(
          p.provider,
          [
            ["openai", "OpenAI 兼容"],
            ["gemini", "Gemini 原生"],
          ],
          (v) => {
            p.provider = v;
            drawSearchCard();
            refreshDerived();
          },
        ),
      ),
      field(
        "接口地址",
        textInput(p.baseUrl, (v) => {
          p.baseUrl = v.trim();
          refreshDerived();
        }, { placeholder: "https://…/v1" }),
        "填写版本根路径；OpenAI 兼容服务会自动拼接 /chat/completions。",
        true,
      ),
      field(
        "API key",
        secretInput(p.apiKey, (v) => (p.apiKey = v.trim()), "本地服务可以留空"),
        "只保存在本机；网页脚本无法读取，默认也不会被导出。",
        true,
      ),
      field(
        "模型",
        h("div", { class: "field-row" }, modelInput, fetchButton, modelList),
        "可以手动填写，也可以从服务商的模型列表中选择。",
        true,
      ),
    ),
  );

  // generation
  const temperature = numberInput(p.temperature, (v) => (p.temperature = v), {
    step: "0.1",
    min: "0",
    max: "2",
    placeholder: "默认",
  });
  const topP = numberInput(p.topP, (v) => (p.topP = v), {
    step: "0.05",
    min: "0",
    max: "1",
    placeholder: "默认",
  });
  const temperatureHint = h("span", { class: "field-hint" });
  const topPHint = h("span", { class: "field-hint" });
  const generation = card(
    "生成参数",
    "采样参数留空即使用服务商默认值。",
    h(
      "div",
      { class: "grid-2" },
      field(
        "上下文预算（token）",
        numberInput(p.contextTokens, (v) => (p.contextTokens = v ?? NaN), { min: "1024", step: "1024" }),
        "决定能放入多少网页正文与历史；按服务商文档填写。",
      ),
      field(
        "输出上限（token）",
        numberInput(p.maxOutputTokens, (v) => (p.maxOutputTokens = v ?? NaN), { min: "1", step: "256" }),
        "思考模型的思考也会占用输出额度。",
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
      errors.set(key, "联网参数不是有效的 JSON 对象");
      area.classList.add("invalid");
    }
    refreshDerived();
    changed();
  }
  function drawSearchCard() {
    if (p.provider === "gemini") {
      errors.delete("search:" + p.id);
      searchHost.replaceChildren(
        card(
          "自带联网",
          "Gemini 原生协议直接使用 Google 搜索，无需其他 key。在侧栏选择「按需搜索」后，由模型决定何时搜索，并附上来源与搜索建议。",
          searchStatus,
        ),
      );
      return;
    }
    const area = h("textarea", {
      class: "input textarea code-input",
      rows: 3,
      value: p.searchParams ? JSON.stringify(p.searchParams, null, 2) : "",
      placeholder: '例如 {"plugins": [{"id": "web"}]}',
      "aria-label": "联网参数 JSON",
    });
    area.spellcheck = false;
    area.addEventListener("input", () => setSearchParams(area.value, area));
    searchHost.replaceChildren(
      card(
        "自带联网",
        "许多服务商在接口里提供联网搜索，只需在请求中加一个开关参数。填写后，侧栏选择「按需搜索」时会把它合并进请求体，由服务商完成搜索，不再调用搜索 API。",
        searchStatus,
        field(
          "联网参数（JSON）",
          area,
          "OpenAI 的 *-search-api 模型、Perplexity Sonar 与 OpenRouter 的 :online 模型会自动识别，无需填写。DeepSeek 等官方接口不提供联网。",
          true,
        ),
        h(
          "div",
          { class: "quick-chips" },
          SEARCH_PARAM_PRESETS.map(([label, value]) =>
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
    "超时",
    "思考模型的首个响应可能较慢；超时后已收到的内容会保留。",
    h(
      "div",
      { class: "grid-3" },
      field("首响应（秒）", numberInput(p.timeouts.first, (v) => (p.timeouts.first = v ?? NaN), { min: "1" })),
      field("流式空闲（秒）", numberInput(p.timeouts.idle, (v) => (p.timeouts.idle = v ?? NaN), { min: "1" })),
      field("总时长（秒）", numberInput(p.timeouts.total, (v) => (p.timeouts.total = v ?? NaN), { min: "1" })),
    ),
  );

  // capabilities
  const chips = h("div", { class: "cap-chips" });
  const overrideHost = h("div", { class: "override" });
  const capabilityCard = card(
    "能力",
    "根据协议、地址和模型名自动识别。自定义端点可以手动声明真实支持的能力。",
    chips,
    toggleRow(
      "手动声明能力",
      "只在确认端点支持时开启，否则请求可能被拒绝。",
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
    "aria-label": "额外请求参数 JSON",
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
      errors.set(key, "额外请求参数不是有效的 JSON 对象");
      extra.classList.add("invalid");
    }
    changed();
  });
  const advanced = h(
    "details",
    { class: "card advanced" },
    h("summary", null, icon("chevronRight", 16), "高级：额外请求参数"),
    field(
      "JSON",
      extra,
      (p.provider === "gemini" ? "会合并进 generationConfig。" : "会合并进请求体顶层。") +
        "不能覆盖认证、消息、流式以及上面已有的参数。",
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
        flag("图片输入", "vision"),
        flag("PDF 输入", "documents"),
        flag("函数工具调用", "tools", "让模型按需调用搜索服务"),
        flag("自带联网", "nativeSearch", "模型或服务商自己完成搜索"),
        flag("temperature", "temperature"),
        flag("top_p", "topP"),
        field(
          "思考参数",
          selectInput(
            c.reasoning,
            [
              ["none", "不发送思考参数"],
              ["effort", "reasoning_effort（OpenAI）"],
              ["level", "thinkingLevel（Gemini 3）"],
              ["budget", "thinkingBudget（Gemini 2.5）"],
            ],
            (v) => {
              setCapability("reasoning", v);
              drawOverride();
            },
          ),
        ),
        c.reasoning === "effort" || c.reasoning === "level"
          ? field(
              "可选级别",
              textInput(c.efforts.join(", "), (v) =>
                setCapability("efforts", v.split(/[,，\s]+/).filter(Boolean)),
              ),
              "用逗号分隔，例如 low, medium, high",
            )
          : null,
        c.reasoning === "budget"
          ? field(
              "预算范围",
              h(
                "div",
                { class: "field-row" },
                numberInput(c.budgetMin, (v) => setCapability("budgetMin", v ?? NaN), { "aria-label": "最小预算" }),
                numberInput(c.budgetMax, (v) => setCapability("budgetMax", v ?? NaN), { "aria-label": "最大预算" }),
              ),
            )
          : null,
        c.reasoning !== "none" ? flag("允许完全关闭思考", "canDisable") : null,
        p.provider === "openai"
          ? field(
              "输出上限字段",
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
        "思考",
        "没有识别到此模型的思考参数，因此不会发送任何思考设置。若端点支持，可在下方「能力」中声明。",
        stale
          ? h(
              "div",
              { class: "inline-warning" },
              icon("alert", 15),
              h("span", null, `已保存的思考设置「${p.reasoning}」无法用于此模型。`),
              button("清除", () => {
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
        placeholder: "服务商默认",
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
          quick("默认", undefined),
          quick("动态 -1", -1),
          c.canDisable ? quick("关闭 0", 0) : null,
          quick("4096", Math.max(c.budgetMin, Math.min(4096, c.budgetMax))),
          quick("16384", Math.max(c.budgetMin, Math.min(16384, c.budgetMax))),
        ),
      );
      hint = `范围 ${c.budgetMin}–${c.budgetMax}；-1 让模型自行决定${c.canDisable ? "，0 关闭思考" : "；此模型不能完全关闭思考"}。`;
    } else {
      control = selectInput(
        p.reasoning === undefined ? "" : String(p.reasoning),
        [
          ["", "服务商默认"],
          ...c.efforts.map(
            (e): [string, string] => [e, EFFORT_LABEL[e] ? `${e} · ${EFFORT_LABEL[e]}` : e],
          ),
        ],
        (v) => {
          p.reasoning = v || undefined;
          refreshDerived();
        },
      );
      hint =
        c.reasoning === "level"
          ? "Gemini 3 使用 thinkingLevel；minimal 并不等于完全关闭。"
          : "推理强度越高，回答越慢、消耗越多。";
    }
    return card(
      "思考",
      c.reasoning === "budget"
        ? "Gemini 2.5 使用 thinkingBudget 控制思考长度。"
        : c.reasoning === "level"
          ? "控制模型思考的深度。"
          : "通过 reasoning_effort 控制推理强度。",
      h(
        "div",
        { class: "grid-2" },
        field(c.reasoning === "budget" ? "思考预算" : "思考强度", control, hint),
        p.provider === "gemini"
          ? toggleRow(
              "显示思考摘要",
              "让 Gemini 返回公开的思考摘要，在回答上方折叠显示。",
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
    temperatureHint.textContent = c.temperature ? "0–2，越高越发散" : "当前模型不支持，已停用";
    topPHint.textContent = c.topP ? "0–1" : "当前模型不支持，已停用";
    const items: [string, boolean][] = [
      ["图片", c.vision],
      ["PDF", c.documents],
      ["工具调用", c.tools],
      ["自带联网", c.nativeSearch],
      [
        c.reasoning === "none"
          ? "思考控制"
          : "思考 · " +
            (c.reasoning === "budget" ? `${c.budgetMin}–${c.budgetMax}` : c.efforts.join("/")),
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
        c.nativeSearch
          ? "已启用：「按需搜索」使用模型自带联网。"
          : c.tools
            ? "未启用：「按需搜索」会让模型调用设置中的搜索服务。"
            : "未启用：此模型也未声明工具调用，只能使用「先搜索再回答」。",
      ),
    );
  }
  async function fetchModels() {
    fetchButton.disabled = true;
    try {
      apiOrigin(p.baseUrl);
      const models = (await listModels(p, AbortSignal.timeout(20000))).sort();
      modelList.replaceChildren(...models.map((id) => h("option", { value: id })));
      if (!models.length) return toast("服务商没有返回模型，可以手动填写", "error");
      openMenu(fetchButton, [
        { heading: `${models.length} 个可用模型` },
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
    result.replaceChildren(spinner(), h("span", null, "正在发送一条测试消息…"));
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
      const reply = (r.text || r.thought || "（空）").trim().slice(0, 80);
      result.className = "test-result ok";
      result.replaceChildren(
        icon("check", 15),
        h("span", null, `连接正常 · ${((performance.now() - started) / 1000).toFixed(1)} 秒 · 回复「${reply}」`),
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
    if (!(await confirmAction("删除配置", `删除「${p.name}」？使用它的历史会话仍会保留。`)))
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
      settings.activeProfileId === p.id ? h("span", { class: "badge" }, "默认") : null,
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
  const grid = h("div", { class: "service-grid", role: "radiogroup", "aria-label": "搜索服务" });
  const detail = h("div", { class: "stack" });
  const result = h("div", { class: "test-result" });
  const testButton = button("测试搜索", () => void test(), "btn-small", "search");
  const drawGrid = () =>
    grid.replaceChildren(
      ...SEARCH_SERVICES.map((x) =>
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
    result.hidden = true;
    detail.replaceChildren(
      h(
        "div",
        { class: "grid-2" },
        field(
          "API key",
          secretInput(service.apiKey, (v) => (service.apiKey = v.trim()), meta.keyPlaceholder),
          h("span", null, meta.keyRequired ? "必填，" : "可选，", "在 ", external(meta.site), " 获取。"),
          true,
        ),
        field(
          "接口地址",
          textInput(service.baseUrl, (v) => (service.baseUrl = v.trim()), {
            placeholder: meta.baseUrl || "https://searx.example.com",
          }),
          meta.baseUrl ? "一般无需修改。" : "填写你的实例地址。",
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
    result.replaceChildren(spinner(), h("span", null, "正在搜索…"));
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
          `可用 · ${((performance.now() - started) / 1000).toFixed(1)} 秒 · ${found.length} 条结果` +
            (found[0] ? `，第一条「${found[0].title}」` : ""),
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
      "模型自带联网",
      "能由模型自己搜索时，不需要额外的搜索 API。",
      h(
        "div",
        { class: "mode-list" },
        modeItem(
          "sparkles",
          "Gemini 原生协议",
          "Gemini 2.0 及之后的模型（含 -latest 别名）都可使用 Google 搜索，自动识别。",
        ),
        modeItem(
          "cpu",
          "OpenAI 兼容服务",
          "取决于服务商：在「模型 → 自带联网」中填写开启参数（OpenRouter、通义千问、智谱等有预设）；OpenAI 搜索模型、Perplexity Sonar 与 OpenRouter :online 模型会自动识别。",
        ),
        modeItem(
          "globe",
          "其他模型",
          "例如 DeepSeek 官方接口不提供联网，需要使用下面的搜索服务。",
        ),
      ),
    ),
    card("搜索服务", "供「先搜索再回答」以及没有自带联网的模型调用。可以各自保存 key，随时切换。", grid, detail),
    card(
      "搜索参数",
      "",
      h(
        "div",
        { class: "grid-2" },
        field("最多搜索轮数", numberInput(s.rounds, (v) => (s.rounds = v ?? NaN), { min: "1", max: "8" }), "1–8，按需搜索时模型可多次补搜"),
        field("每轮结果数", numberInput(s.results, (v) => (s.results = v ?? NaN), { min: "1", max: "20" }), "1–20；Jina 固定返回约 5 条"),
        field("超时（秒）", numberInput(s.timeout, (v) => (s.timeout = v ?? NaN), { min: "1" })),
        field("摘要字数预算", numberInput(s.maxChars, (v) => (s.maxChars = v ?? NaN), { min: "100", step: "1000" }), "每次搜索交给模型的总字数上限"),
      ),
    ),
    card(
      "三种模式",
      "在侧栏输入框下方的「搜索」按钮中切换。",
      h(
        "div",
        { class: "mode-list" },
        modeItem("x", "关闭", "不发出任何搜索请求，也不向模型声明搜索工具。"),
        modeItem(
          "sparkles",
          "按需搜索",
          "模型有自带联网时由它自己决定是否搜索；否则支持工具调用的模型会在需要时调用上面的搜索服务。",
        ),
        modeItem(
          "search",
          "先搜索再回答",
          "每次提问都先用上面的搜索服务检索（可单独填写搜索词），再把结果交给模型。适用于任何模型。",
        ),
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
    "aria-label": "全局提示词",
  });
  area.addEventListener("input", () => {
    settings.systemPrompt = area.value;
    changed();
  });
  return [
    card(
      "全局提示词",
      "作为系统指令发送。网页正文和搜索结果会作为参考资料附在提问里，不会混进这里。",
      area,
    ),
    card(
      "长文处理",
      "",
      h(
        "div",
        { class: "grid-2" },
        field(
          "单次提问最多调用模型",
          numberInput(settings.maxCalls, (v) => (settings.maxCalls = v ?? NaN), { min: "1", max: "64" }),
          "全文总结 / 翻译会逐段调用模型，工具搜索也计入；1–64。",
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
              h("span", null, icon(actionIcon(a.icon), 15), a.name || "未命名"),
            ),
          )
        : h("span", { class: "muted" }, "还没有动作"),
    );
  drawPreview();
  const insert = (key: string) => {
    const t =
      lastTemplate?.isConnected
        ? lastTemplate
        : document.querySelector<HTMLTextAreaElement>(".action-card textarea");
    if (!t) return;
    t.setRangeText(`{{${key}}}`, t.selectionStart, t.selectionEnd, "end");
    t.dispatchEvent(new Event("input"));
    t.focus();
  };
  const actionCard = (a: ActionTemplate, index: number) => {
    const pick: HTMLButtonElement = h(
      "button",
      { type: "button", class: "icon-pick", title: "选择图标" },
      icon(actionIcon(a.icon), 18),
    );
    pick.onclick = () =>
      openMenu(
        pick,
        ACTION_ICONS.map(([name, label]) => ({
          label,
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
    }, { placeholder: "动作名称", "aria-label": "动作名称" });
    const template = h("textarea", {
      class: "input textarea",
      rows: 3,
      value: a.prompt,
      "aria-label": "提示词模板",
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
    const up = iconButton("arrowUp", "上移", () => move(-1), "icon-btn-sm");
    up.disabled = index === 0;
    const down = iconButton("arrowDown", "下移", () => move(1), "icon-btn-sm");
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
        iconButton("trash", "删除动作", () => {
          settings.actions.splice(index, 1);
          render();
          changed();
        }, "icon-btn-sm danger"),
      ),
      template,
    );
  };
  return [
    card("工具栏预览", "选中网页文字后出现；只有点击按钮才会调用模型。", stage),
    card(
      "模板变量",
      "点击插入到正在编辑的模板。",
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
            h("span", null, label),
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
            name: "新动作",
            icon: "sparkles",
            prompt: "请解释以下内容：\n{{selection}}",
          });
          render();
          changed();
        },
      },
      icon("plus", 16),
      "添加动作",
    ),
  ];
}

// ------------------------------------------------------------ appearance
const SAMPLE =
  "它描述量子态随时间的演化：\n\n" +
  String.raw`$$i\hbar\frac{\partial}{\partial t}\lvert\psi(t)\rangle=\hat H\lvert\psi(t)\rangle$$` +
  "\n\n其中 $\\hat H$ 是**哈密顿算符**，决定体系的能量；波函数 `ψ` 本身不可直接观测。";
function appearanceSection(): Child[] {
  const sample = h("div", { class: "appearance-preview" });
  const drawSample = () =>
    sample.replaceChildren(
      h("div", { class: "msg msg-user" }, h("div", { class: "bubble" }, "薛定谔方程讲的是什么？")),
      h(
        "div",
        { class: "msg msg-assistant" },
        h("div", { class: "markdown", innerHTML: renderMarkdown(SAMPLE).html }),
      ),
    );
  const live = () => {
    applyAppearance(settings);
    drawSample();
  };

  const themes: [Settings["theme"], string, IconName][] = [
    ["system", "跟随系统", "monitor"],
    ["light", "浅色", "sun"],
    ["dark", "深色", "moon"],
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
          h("span", { class: "theme-label" }, icon(name, 15), label),
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
      "aria-label": "自定义强调色",
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
            title: a.name,
            "aria-label": a.name,
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
          title: "自定义颜色",
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
    { placeholder: '自定义 font-family，例如 "LXGW WenKai", serif' },
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
          h("span", { class: "font-sample", style: `font-family:${f.stack}` }, "阅读 Aa 永"),
          h("span", { class: "font-name" }, f.name),
        ),
      ),
    );
  drawFonts();
  drawSample();

  return [
    card("主题", "", themeGrid),
    card("强调色", "用于按钮、高亮与链接。", swatches),
    card("阅读字体", "用于回答正文；界面文字保持系统字体。", h("div", { class: "stack" }, fonts, customFont)),
    card(
      "尺寸",
      "",
      h(
        "div",
        { class: "stack" },
        field(
          "正文字号",
          rangeRow(settings.fontSize, [12, 20, 0.5], (v) => v + " px", (v) => {
            settings.fontSize = v;
            live();
          }),
        ),
        field(
          "划词浮窗宽度",
          rangeRow(settings.floatWidth, [320, FLOAT_WIDTH_MAX, 20], (v) => v + " px", (v) => (settings.floatWidth = v)),
          "拖动浮窗边缘调整大小后，这里会记住新的宽度。侧栏宽度由浏览器控制。",
        ),
      ),
    ),
    card("预览", "", sample),
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
    h(
      "span",
      { class: "grow" },
      ok
        ? "已授权访问所有网站。"
        : "部分网站未授权：浏览器的「网站访问权限」可能被设为点击时或仅限特定网站。",
    ),
    ok
      ? null
      : button(
          "授权所有网站",
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
                  title: "移除",
                  "aria-label": "移除 " + host,
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
        : [h("span", { class: "muted" }, "暂无，所有网站都会显示工具栏。")]),
    );
  drawChips();
  const add = h("input", { class: "input", placeholder: "输入域名后按回车，例如 mail.google.com" });
  add.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const host = normalizeHost(add.value);
    if (!host) return toast("请输入有效的域名", "error");
    if (!settings.blockedSites.includes(host)) settings.blockedSites.push(host);
    add.value = "";
    drawChips();
    changed();
  });
  const permission = h("div", { class: "perm-state" }, spinner(), "正在检查…");
  void checkPermission(permission);
  return [
    card(
      "",
      "",
      toggleRow(
        "选中文字时显示划词工具栏",
        "只有点击工具栏按钮才会调用模型，选择文字本身不会产生费用。更改对新打开的页面生效。",
        settings.selectionEnabled,
        (v) => (settings.selectionEnabled = v),
      ),
    ),
    card("排除的网站", "这些网站（含子域名）不显示划词工具栏；侧栏依旧可以读取它们。", h("div", { class: "stack" }, chips, add)),
    card(
      "网页访问权限",
      "Valise 需要网站访问权限，才能在你提问时读取正文、截图以及显示划词工具栏；它不会在后台主动读取页面。",
      permission,
    ),
  ];
}

// ------------------------------------------------------------ data
const statCard = (value: string, label: string) =>
  h("div", { class: "stat-card" }, h("div", { class: "stat-value" }, value), h("div", { class: "stat-label" }, label));
function dataSection(): Child[] {
  let withKeys = false;
  const upload = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  upload.onchange = () => void importFile(upload);
  const stats = h("div", { class: "stats" }, statCard("…", "会话"), statCard("…", "本地占用"));
  void Promise.all([countConversations(), navigator.storage.estimate()]).then(([count, estimate]) =>
    stats.replaceChildren(
      statCard(count.toLocaleString(), "会话"),
      statCard(formatSize(estimate.usage || 0), "本地占用"),
    ),
  );
  return [
    card(
      "备份与迁移",
      "导出模型配置、提示词、划词动作与外观设置；会话不包含在内。",
      h(
        "div",
        { class: "stack" },
        toggleRow("导出时包含 API key", "文件会包含明文密钥，请妥善保管，切勿分享。", false, (v) => (withKeys = v)),
        h(
          "div",
          { class: "button-row" },
          button("导出设置", () => {
            try {
              validateSettings(settings);
            } catch (error) {
              return toast("当前设置有误，无法导出：" + errorText(error), "error");
            }
            download(
              withKeys ? "valise-settings-WITH-SECRETS.json" : "valise-settings.json",
              JSON.stringify(exportSettings(settings, withKeys), null, 2),
            );
          }, "", "download"),
          button("导入设置", () => upload.click(), "", "upload"),
          upload,
        ),
      ),
    ),
    card(
      "本地数据",
      "会话与网页快照只保存在这台电脑的浏览器里。",
      h(
        "div",
        { class: "stack" },
        stats,
        h(
          "div",
          { class: "button-row" },
          button("清理网页快照", () => void clearSnapshots().then(() => toast("网页快照已清理", "success")), "", "refresh"),
          button("删除全部会话", () => void wipe(), "btn-danger-soft", "trash"),
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
    if (!(await confirmAction("导入设置", "导入会替换当前全部设置（会话不受影响）。继续吗？", "导入")))
      return;
    clearTimeout(timer);
    settings = next;
    selected = "";
    errors.clear();
    await saveSettings(settings);
    saved = JSON.stringify(settings);
    applyAppearance(settings);
    render();
    setState("saved", "已导入并保存");
    if (settings.profiles.some((p) => !p.apiKey && !/127\.0\.0\.1|localhost/.test(p.baseUrl)))
      toast("部分配置没有 API key，请记得补填");
  } catch (error) {
    toast("导入失败：" + errorText(error), "error");
  }
}
async function wipe() {
  if (!(await confirmAction("删除全部会话", "所有历史会话都会被永久删除，无法恢复。", "全部删除")))
    return;
  await clearConversations();
  toast("已删除全部会话", "success");
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
              : h("span", { class: "muted" }, "未设置"),
          ),
        ),
      h(
        "div",
        { class: "shortcut" },
        h("span", null, "发送 / 换行"),
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
          h("div", { class: "muted" }, `版本 ${chrome.runtime.getManifest().version} · 网页阅读、划词与对话`),
        ),
      ),
    ),
    card(
      "快捷键",
      "",
      shortcuts,
      h(
        "div",
        { class: "button-row mt" },
        button("修改快捷键", () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }), "", "external"),
      ),
    ),
    card(
      "隐私与边界",
      "",
      h(
        "ul",
        { class: "bullet-list" },
        h("li", null, "模型与搜索请求从浏览器直接发往你配置的服务，不经过任何中间服务器。"),
        h("li", null, "API key 只保存在本机扩展存储中，网页脚本无法读取；默认不导出、不同步。"),
        h("li", null, "只有在你提问、预览或使用划词动作时才读取网页，且只能读到当前已加载的内容。"),
        h("li", null, "停止生成会立即中止浏览器端请求，但服务商是否计费由其决定。"),
        h("li", null, "不需要 embedding 或本地服务；长文使用分块与关键词检索处理。"),
      ),
    ),
  ];
}

void (async () => {
  windowId = (await chrome.windows.getCurrent()).id;
  settings = await loadSettings();
  saved = JSON.stringify(settings);
  try {
    validateSettings(settings);
    setState("saved", "更改会自动保存");
  } catch (error) {
    setState("error", "当前设置有误 · " + errorText(error));
  }
  applyAppearance(settings);
  render();
})();
// Dragging the float's edge saves a new width from the background; adopt it so the next save keeps it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings || !settings) return;
  const width = normalizeSettings(changes.settings.newValue).floatWidth;
  if (width === settings.floatWidth) return;
  settings.floatWidth = width;
  if (current === "appearance") render();
});
