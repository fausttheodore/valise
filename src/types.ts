export type Provider = "openai" | "gemini";
export type ContextMode = "none" | "page" | "selection" | "selection-page";
export type SearchMode = "off" | "auto" | "required";
export type TaskMode = "question" | "summarize" | "translate";
export type Stage =
  | "preparing"
  | "searching"
  | "connecting"
  | "streaming"
  | "complete"
  | "cancelled"
  | "timeout"
  | "failed"
  | "interrupted";
export interface Capabilities {
  temperature: boolean;
  topP: boolean;
  tools: boolean;
  nativeSearch: boolean;
  vision: boolean;
  documents: boolean;
  maxOutputField: "max_tokens" | "max_completion_tokens";
  reasoning: "none" | "effort" | "level" | "budget";
  efforts: string[];
  budgetMin: number;
  budgetMax: number;
  canDisable: boolean;
}
export interface Profile {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextTokens: number;
  maxOutputTokens: number;
  temperature?: number;
  topP?: number;
  reasoning?: string | number;
  includeThoughts: boolean;
  timeouts: { first: number; idle: number; total: number };
  capabilities?: Partial<Capabilities>;
  extra: Record<string, unknown>;
  /** OpenAI-compatible only: merged into the body when the model's own web search is used. */
  searchParams?: Record<string, unknown>;
}
export type SearchProviderId =
  | "tavily"
  | "exa"
  | "brave"
  | "jina"
  | "bocha"
  | "searxng";
export interface ActionTemplate {
  id: string;
  name: string;
  prompt: string;
  icon?: string;
}
export interface Settings {
  version: 1;
  profiles: Profile[];
  activeProfileId: string;
  systemPrompt: string;
  actions: ActionTemplate[];
  search: {
    provider: SearchProviderId;
    /** Per-service address and key, so switching services keeps each key. */
    services: Record<SearchProviderId, { baseUrl: string; apiKey: string }>;
    rounds: number;
    results: number;
    timeout: number;
    maxChars: number;
  };
  theme: "system" | "light" | "dark";
  accent: string;
  fontSize: number;
  fontFamily: string;
  floatWidth: number;
  selectionEnabled: boolean;
  blockedSites: string[];
  maxCalls: number;
}
export interface PageIdentity {
  tabId: number;
  frameId: number;
  documentId: string;
  url: string;
  title: string;
  version: number;
  capturedAt: number;
}
export interface SelectionSnapshot {
  text: string;
  paragraph: string;
  url: string;
  documentToken: string;
  capturedAt: number;
}
export interface PageSnapshot extends PageIdentity {
  id: string;
  content: string;
  selection?: SelectionSnapshot;
  status: "loaded" | "restricted" | "empty";
  warnings: string[];
}
/** A selection-action session created by the content script and claimed once by floating.html. */
export interface FloatSession {
  id: string;
  windowId: number;
  tabId: number;
  frameId: number;
  documentId: string;
  url: string;
  title: string;
  selection: SelectionSnapshot;
  action: ActionTemplate;
  createdAt: number;
  claimed?: boolean;
}
export interface Source {
  title: string;
  url: string;
  snippet: string;
  /** snippet: search API; grounding: Gemini Google Search; citation: an OpenAI-compatible model's own search. */
  kind: "snippet" | "grounding" | "citation";
}
/** Token counts reported by the provider for one model call. */
export interface Usage {
  input: number;
  output: number;
  cached?: number;
  reasoning?: number;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  providerId?: string;
}
/** Images and PDFs carry base64 data; text files carry their decoded text. */
export interface Attachment {
  id: string;
  kind: "image" | "pdf" | "text";
  name: string;
  mime: string;
  data: string;
  size: number;
}
export type MessagePart =
  | { type: "text" | "thought"; text: string }
  | { type: "tool-call"; call: ToolCall }
  | {
      type: "tool-result";
      id: string;
      name: string;
      text: string;
      providerId?: string;
    }
  | { type: "attachment"; attachment: Attachment };
/** How a templated user turn is presented; the full prompt stays in parts. */
export interface MessageDisplay {
  action: string;
  icon?: string;
  quote?: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  parts: MessagePart[];
  createdAt: number;
  profileId?: string;
  provider?: Provider;
  model?: string;
  source?: PageIdentity;
  snapshotId?: string;
  raw?: unknown;
  status?: Stage;
  error?: string;
  sources?: Source[];
  groundingHtml?: string;
  groundingMetadata?: unknown;
  coverage?: string;
  display?: MessageDisplay;
  usage?: Usage;
  /** Other tabs referenced with @, besides the current page in `source`. */
  refs?: { source: PageIdentity; snapshotId: string }[];
}
/** A browser tab picked with @; its content is read when the question is sent. */
export interface TabRef {
  tabId: number;
  title: string;
  url: string;
}
export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  systemPrompt?: string;
  profileId?: string;
  contextMode: ContextMode;
  searchMode: SearchMode;
}
export interface RequestEvent {
  requestId: string;
  conversationId: string;
  stage: Stage;
  detail?: string;
  text?: string;
  thought?: string;
}
export interface ModelResult {
  text: string;
  thought: string;
  calls: ToolCall[];
  raw: unknown;
  sources: Source[];
  groundingHtml?: string;
  groundingMetadata?: unknown;
  finishReason?: string;
  usage?: Usage;
}
export const messageText = (m: Message) =>
  m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");
export const messageAttachments = (m: Message) =>
  m.parts.flatMap((p) => (p.type === "attachment" ? [p.attachment] : []));
export const uid = () => crypto.randomUUID();
