import {
  resolveLocale,
  setLocale,
  t,
  translations,
  type MessageKey,
} from "./i18n";
import {
  uid,
  type Capabilities,
  type Profile,
  type Provider,
  type SearchProviderId,
  type Settings,
} from "./types";

export const defaultProfile = (): Profile => ({
  id: uid(),
  name: t("defaults.profileName"),
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  contextTokens: 16000,
  maxOutputTokens: 4096,
  includeThoughts: false,
  timeouts: { first: 120, idle: 60, total: 600 },
  extra: {},
});

/** Endpoint presets only fill protocol and address; model names stay user-chosen. */
export const providerPresets = (): {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  hint: string;
}[] => [
  {
    id: "openai",
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    hint: t("preset.openai"),
  },
  {
    id: "gemini",
    name: "Google Gemini",
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    hint: t("preset.gemini"),
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    hint: t("preset.compatible"),
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    hint: t("preset.openrouter"),
  },
  {
    id: "siliconflow",
    name: t("preset.siliconflowName"),
    provider: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    hint: t("preset.compatible"),
  },
  {
    id: "ollama",
    name: t("preset.ollamaName"),
    provider: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    hint: t("preset.ollama"),
  },
  {
    id: "custom",
    name: t("preset.customName"),
    provider: "openai",
    baseUrl: "https://",
    hint: t("preset.custom"),
  },
];

/** Search APIs used by "Search first" and by the web_search tool; request shapes live in search.ts. */
export const searchServices = (): {
  id: SearchProviderId;
  name: string;
  baseUrl: string;
  keyRequired: boolean;
  site: string;
  hint: string;
  keyPlaceholder: string;
}[] => [
  {
    id: "tavily",
    name: "Tavily",
    baseUrl: "https://api.tavily.com",
    keyRequired: true,
    site: "https://app.tavily.com/",
    hint: t("searchService.tavily"),
    keyPlaceholder: "tvly-…",
  },
  {
    id: "exa",
    name: "Exa",
    baseUrl: "https://api.exa.ai",
    keyRequired: true,
    site: "https://dashboard.exa.ai/api-keys",
    hint: t("searchService.exa"),
    keyPlaceholder: "Exa API key",
  },
  {
    id: "brave",
    name: "Brave Search",
    baseUrl: "https://api.search.brave.com/res/v1",
    keyRequired: true,
    site: "https://api-dashboard.search.brave.com/",
    hint: t("searchService.brave"),
    keyPlaceholder: "BSA…",
  },
  {
    id: "jina",
    name: "Jina",
    baseUrl: "https://s.jina.ai",
    keyRequired: false,
    site: "https://jina.ai/api-dashboard",
    hint: t("searchService.jina"),
    keyPlaceholder: t("searchService.jinaKey"),
  },
  {
    id: "bocha",
    name: t("searchService.bochaName"),
    baseUrl: "https://api.bochaai.com/v1",
    keyRequired: true,
    site: "https://open.bochaai.com/",
    hint: t("searchService.bocha"),
    keyPlaceholder: "sk-…",
  },
  {
    id: "searxng",
    name: "SearXNG",
    baseUrl: "",
    keyRequired: false,
    site: "https://docs.searxng.org/",
    hint: t("searchService.searxng"),
    keyPlaceholder: t("searchService.noKey"),
  },
];
export const searchMeta = (id: SearchProviderId) =>
  searchServices().find((x) => x.id === id)!;
/** Whether the selected search service has what it needs to run. */
export function searchReady(s: Settings["search"]) {
  const service = s.services[s.provider];
  return !!service.baseUrl && (!searchMeta(s.provider).keyRequired || !!service.apiKey);
}
export const searchKeys = (s: Settings["search"]) =>
  Object.values(s.services).map((x) => x.apiKey);

/** The float can be dragged wider than this, but only this much is remembered. */
export const FLOAT_WIDTH_MAX = 960;

export const ACCENTS: { name: MessageKey; value: string }[] = [
  { name: "accent.indigo", value: "#5b5bd6" },
  { name: "accent.blue", value: "#2f6fdb" },
  { name: "accent.teal", value: "#13846f" },
  { name: "accent.ochre", value: "#c15f3c" },
  { name: "accent.berry", value: "#c2416b" },
  { name: "accent.graphite", value: "#5c5c66" },
];

/** Built-in selection actions; their text follows the interface language until the user edits it. */
const DEFAULT_ACTIONS: { id: string; icon: string; name: MessageKey; prompt: MessageKey }[] = [
  { id: "explain", icon: "help", name: "defaults.explain", prompt: "defaults.explainPrompt" },
  {
    id: "translate",
    icon: "languages",
    name: "defaults.translate",
    prompt: "defaults.translatePrompt",
  },
  { id: "summary", icon: "summary", name: "defaults.summary", prompt: "defaults.summaryPrompt" },
];

export const defaultSettings = (): Settings => ({
  version: 1,
  profiles: [],
  activeProfileId: "",
  systemPrompt: t("defaults.systemPrompt"),
  actions: DEFAULT_ACTIONS.map((a) => ({
    id: a.id,
    name: t(a.name),
    icon: a.icon,
    prompt: t(a.prompt),
  })),
  search: {
    provider: "tavily",
    services: Object.fromEntries(
      searchServices().map((x) => [x.id, { baseUrl: x.baseUrl, apiKey: "" }]),
    ) as Settings["search"]["services"],
    rounds: 2,
    results: 5,
    timeout: 20,
    maxChars: 16000,
  },
  uiLanguage: "auto",
  theme: "system",
  accent: ACCENTS[0].value,
  fontSize: 15,
  fontFamily: "system",
  floatWidth: 460,
  selectionEnabled: true,
  blockedSites: [],
  maxCalls: 16,
});

/** Sets the interface language from stored settings; call it before normalizeSettings so defaults follow. */
export function applyLocale(raw: unknown) {
  setLocale(
    resolveLocale(
      (raw as Partial<Settings> | null | undefined)?.uiLanguage,
      chrome.i18n.getUILanguage(),
    ),
  );
}

/** Fills fields added after a settings file was written; never invents profiles. */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Partial<Settings> & { enabledSites?: unknown };
  // 0.2 stored a single Tavily address and key directly on `search`.
  const {
    baseUrl: legacyUrl,
    apiKey: legacyKey,
    ...search
  } = (s.search || {}) as Partial<Settings["search"]> & {
    baseUrl?: string;
    apiKey?: string;
  };
  const services = { ...base.search.services };
  for (const id of Object.keys(services) as SearchProviderId[])
    services[id] = { ...services[id], ...search.services?.[id] };
  if (!search.services && (legacyUrl || legacyKey))
    services.tavily = {
      baseUrl: legacyUrl || services.tavily.baseUrl,
      apiKey: legacyKey || "",
    };
  const merged: Settings = {
    ...base,
    ...s,
    search: {
      ...base.search,
      ...search,
      provider: searchServices().some((x) => x.id === search.provider)
        ? search.provider!
        : base.search.provider,
      services,
    },
  } as Settings;
  delete (merged as unknown as Record<string, unknown>).enabledSites;
  if (!/^#[0-9a-f]{6}$/i.test(merged.accent || "")) merged.accent = base.accent;
  if (!merged.fontFamily || merged.fontFamily === "system-ui")
    merged.fontFamily = "system";
  // Text identical to a built-in default in any language counts as unedited.
  if (translations("defaults.systemPrompt").includes(merged.systemPrompt))
    merged.systemPrompt = base.systemPrompt;
  merged.actions = (merged.actions || []).map((a) => {
    const d = DEFAULT_ACTIONS.find((x) => x.id === a.id);
    return {
      ...a,
      name: d && translations(d.name).includes(a.name) ? t(d.name) : a.name,
      prompt: d && translations(d.prompt).includes(a.prompt) ? t(d.prompt) : a.prompt,
      icon: a.icon || d?.icon || "sparkles",
    };
  });
  return merged;
}

export function capabilities(p: Profile): Capabilities {
  const c: Capabilities = {
    temperature: true,
    topP: true,
    tools: false,
    nativeSearch: false,
    vision: !/deepseek-(?:chat|reasoner|coder|r1|v[23])|gpt-3\.5|o1-mini|o3-mini/i.test(
      p.model,
    ),
    documents: false,
    maxOutputField: "max_tokens",
    reasoning: "none",
    efforts: [],
    budgetMin: 0,
    budgetMax: 32768,
    canDisable: false,
  };
  let host = "";
  try {
    host = new URL(p.baseUrl).hostname;
  } catch {
    host = "";
  }
  const official = host === "api.openai.com";
  if (p.provider === "gemini") {
    c.vision = true;
    c.documents = true;
    // Every Gemini generation since 2.0 (and the -latest aliases) grounds with Google Search.
    if (/^gemini-(?:[2-9]|flash|pro)/.test(p.model)) {
      c.tools = true;
      c.nativeSearch = true;
    }
    if (/^gemini-2\.5/.test(p.model)) {
      c.reasoning = "budget";
      c.budgetMin = p.model.includes("pro")
        ? 128
        : p.model.includes("lite")
          ? 512
          : 0;
      c.budgetMax = p.model.includes("pro") ? 32768 : 24576;
      c.canDisable = !p.model.includes("pro");
    }
    if (/^gemini-3/.test(p.model)) {
      c.reasoning = "level";
      c.efforts = /^gemini-3\.[78]-flash/.test(p.model)
        ? ["low", "medium", "high"]
        : p.model.includes("flash-lite-image")
          ? ["minimal", "high"]
          : p.model.includes("flash")
            ? ["minimal", "low", "medium", "high"]
            : p.model.includes("3-pro")
              ? ["low", "high"]
              : ["low", "medium", "high"];
    }
    if (/^gemini-[4-9]/.test(p.model)) {
      c.reasoning = "level";
      c.efforts = ["low", "medium", "high"];
    }
  } else {
    // Search built into the model or the gateway: declared parameters, search-only models.
    c.nativeSearch =
      Object.keys(p.searchParams || {}).length > 0 ||
      (official && /search/.test(p.model)) ||
      host === "api.perplexity.ai" ||
      (host === "openrouter.ai" && /:online$/.test(p.model));
  }
  if (official && p.provider === "openai") {
    c.tools = true;
    c.documents = /^(?:gpt-4o|gpt-4\.1|gpt-[56]|o[134])/.test(p.model);
    if (/^(o[134]|gpt-[56])/.test(p.model)) {
      c.maxOutputField = "max_completion_tokens";
      c.reasoning = "effort";
      c.efforts = ["low", "medium", "high"];
      if (/^gpt-5\.[15]/.test(p.model))
        c.efforts = [
          "none",
          "low",
          "medium",
          "high",
          ...(/5\.5/.test(p.model) ? ["xhigh"] : []),
        ];
      if (/^gpt-6/.test(p.model))
        c.efforts = [
          ...(/astra|6\.1-sol/.test(p.model) ? [] : ["none"]),
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ];
      c.canDisable = c.efforts.includes("none");
      if (p.reasoning !== "none") {
        c.temperature = false;
        c.topP = false;
      }
      if (/^gpt-(?:5\.[45]|6)/.test(p.model))
        c.tools = p.reasoning === "none" && !/astra|6\.1-sol/.test(p.model);
    }
  }
  return { ...c, ...p.capabilities };
}

export function apiOrigin(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(t("config.urlRequired"));
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    !u.hostname ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw new Error(t("config.urlInvalid"));
  return u.origin + "/*";
}
const reserved = new Set([
  "model",
  "messages",
  "contents",
  "systemInstruction",
  "system_instruction",
  "stream",
  "stream_options",
  "tools",
  "tool_choice",
  "toolConfig",
  "generationConfig",
  "maxOutputTokens",
  "thinkingConfig",
  "topP",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "reasoning_effort",
  "headers",
  "signal",
]);
const BOOLEAN_CAPS = [
  "temperature",
  "topP",
  "tools",
  "nativeSearch",
  "vision",
  "documents",
  "canDisable",
] as const;
export function validateProfile(p: Profile) {
  if (!p.name.trim()) throw new Error(t("config.nameRequired"));
  apiOrigin(p.baseUrl);
  if (!p.model.trim()) throw new Error(t("config.modelRequired", { name: p.name }));
  if (!["openai", "gemini"].includes(p.provider))
    throw new Error(t("config.badProtocol"));
  if (
    !Number.isInteger(p.contextTokens) ||
    p.contextTokens < 1024 ||
    !Number.isInteger(p.maxOutputTokens) ||
    p.maxOutputTokens < 1 ||
    p.maxOutputTokens >= p.contextTokens
  )
    throw new Error(t("config.badBudget"));
  for (const n of Object.values(p.timeouts))
    if (!Number.isFinite(n) || n < 1) throw new Error(t("config.badTimeout"));
  const c = capabilities(p);
  if (p.capabilities) {
    const known = Object.keys(capabilities({ ...p, capabilities: undefined }));
    if (
      Object.keys(p.capabilities).some((k) => !known.includes(k)) ||
      BOOLEAN_CAPS.some((k) => typeof c[k] !== "boolean") ||
      !["max_tokens", "max_completion_tokens"].includes(c.maxOutputField) ||
      !["none", "effort", "level", "budget"].includes(c.reasoning) ||
      !Array.isArray(c.efforts) ||
      c.efforts.some((x) => typeof x !== "string") ||
      !Number.isInteger(c.budgetMin) ||
      !Number.isInteger(c.budgetMax) ||
      c.budgetMin < 0 ||
      c.budgetMax < c.budgetMin
    )
      throw new Error(t("config.badCapabilities"));
  }
  if (
    p.temperature !== undefined &&
    (!c.temperature ||
      !Number.isFinite(p.temperature) ||
      p.temperature < 0 ||
      p.temperature > 2)
  )
    throw new Error(t("config.badTemperature"));
  if (
    p.topP !== undefined &&
    (!c.topP || !Number.isFinite(p.topP) || p.topP < 0 || p.topP > 1)
  )
    throw new Error(t("config.badTopP"));
  if (p.reasoning !== undefined && p.reasoning !== "") {
    if (c.reasoning === "none") throw new Error(t("config.noReasoning"));
    if (c.reasoning === "budget") {
      const n = Number(p.reasoning);
      if (
        !Number.isInteger(n) ||
        !(
          n === -1 ||
          (n === 0 && c.canDisable) ||
          (n >= c.budgetMin && n <= c.budgetMax)
        )
      )
        throw new Error(t("config.badBudgetRange"));
    } else if (!c.efforts.includes(String(p.reasoning)))
      throw new Error(t("config.badEffort"));
  }
  if (!p.extra || typeof p.extra !== "object" || Array.isArray(p.extra))
    throw new Error(t("config.extraObject"));
  for (const k of Object.keys(p.extra))
    if (reserved.has(k)) throw new Error(t("config.extraReserved", { key: k }));
  if (p.searchParams !== undefined) {
    if (
      !p.searchParams ||
      typeof p.searchParams !== "object" ||
      Array.isArray(p.searchParams)
    )
      throw new Error(t("config.searchParamsObject"));
    // Built-in search may be declared as a provider tool, so tools is allowed here.
    for (const k of Object.keys(p.searchParams))
      if (reserved.has(k) && k !== "tools" && k !== "tool_choice")
        throw new Error(t("config.searchParamsReserved", { key: k }));
  }
  const check = (o: unknown): void => {
    if (o && typeof o === "object")
      for (const [k, v] of Object.entries(o)) {
        if (
          /^(api[-_]?key|authorization|password|token|__proto__|constructor|prototype)$/i.test(
            k,
          )
        )
          throw new Error(t("config.extraForbidden"));
        check(v);
      }
  };
  check(p.extra);
  check(p.searchParams);
}

export function validateSettings(s: Settings) {
  if (
    s.version !== 1 ||
    !Array.isArray(s.profiles) ||
    !Array.isArray(s.actions)
  )
    throw new Error(t("config.badFile"));
  s.profiles.forEach(validateProfile);
  if (new Set(s.profiles.map((p) => p.id)).size !== s.profiles.length)
    throw new Error(t("config.duplicateProfile"));
  if (s.activeProfileId && !s.profiles.some((p) => p.id === s.activeProfileId))
    throw new Error(t("config.missingDefault"));
  if (!searchServices().some((x) => x.id === s.search.provider))
    throw new Error(t("config.badSearch"));
  for (const service of Object.values(s.search.services))
    if (service.baseUrl) apiOrigin(service.baseUrl);
  for (const [n, max] of [
    [s.search.rounds, 8],
    [s.search.results, 20],
    [s.maxCalls, 64],
  ] as const)
    if (!Number.isInteger(n) || n < 1 || n > max)
      throw new Error(t("config.badLimits"));
  if (
    !Number.isFinite(s.search.timeout) ||
    s.search.timeout < 1 ||
    !Number.isFinite(s.search.maxChars) ||
    s.search.maxChars < 100
  )
    throw new Error(t("config.badSearchBudget"));
  if (
    !Number.isFinite(s.fontSize) ||
    s.fontSize < 12 ||
    s.fontSize > 22 ||
    !Number.isFinite(s.floatWidth) ||
    s.floatWidth < 320 ||
    s.floatWidth > FLOAT_WIDTH_MAX
  )
    throw new Error(t("config.badSize"));
  if (!/^#[0-9a-f]{6}$/i.test(s.accent)) throw new Error(t("config.badAccent"));
  if (!["auto", "en", "zh-CN"].includes(s.uiLanguage))
    throw new Error(t("config.badLanguage"));
  for (const a of s.actions)
    if (!a.id || !a.name?.trim() || !a.prompt?.trim())
      throw new Error(t("config.actionIncomplete"));
  if (new Set(s.actions.map((a) => a.id)).size !== s.actions.length)
    throw new Error(t("config.duplicateAction"));
}
export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  applyLocale(settings);
  return normalizeSettings(settings);
}
export async function saveSettings(s: Settings) {
  validateSettings(s);
  await chrome.storage.local.set({ settings: s });
}
export function exportSettings(s: Settings, secrets = false) {
  const copy = structuredClone(s);
  if (!secrets) {
    copy.profiles.forEach((p) => (p.apiKey = ""));
    for (const service of Object.values(copy.search.services))
      service.apiKey = "";
  }
  return copy;
}
export function redact(text: string, keys: string[]) {
  for (const key of keys) if (key) text = text.split(key).join(t("config.hiddenKey"));
  return text
    .replace(/(Bearer\s+)[^\s"<>]+/gi, (_, prefix: string) => prefix + t("config.hidden"))
    .slice(0, 1200);
}
