[English](README.md) | 简体中文

# Valise

Valise 是一个用大模型辅助阅读网页的浏览器扩展。可以针对当前网页、选中的段落或同时打开的多个标签页提问。它使用你自己的 API key，请求从浏览器直接发往你选择的服务商，没有后端服务器，也不需要注册账号。

<!-- TODO: 在这里放一张侧栏和划词浮窗的截图或短 GIF。 -->

## 兼容性

作者实测过的环境：

| 系统 | 浏览器 |
| --- | --- |
| macOS 15.7.3 | Vivaldi、Brave |
| Windows 11 25H2 | Vivaldi、Brave |

其他支持 Manifest V3 侧栏的 Chromium 系浏览器（Chrome 120+、Edge）理论上可用，但未经实测。欢迎在 Issues 中反馈。

## 功能

- **读取网页**：用 Defuddle 把当前标签页正文转成 Markdown。可以选择发送全文、仅选区、选区加全文或不发送，发送前能预览实际内容。
- **引用多个标签页**：在输入框输入 `@` 选择其他打开的标签页。每个网页都附带标题、URL 和读取时间，方便模型对比或交叉核对。
- **长网页**：正文超出上下文预算时，按问题检索相关段落，并在回答下方注明只用了部分内容。「总结全文」「翻译全文」会分段处理整页。
- **划词提问**：在网页上选中文字后出现工具栏（解释、翻译、总结，也可以自定义）。回答显示在选区旁的浮窗里，浮窗可以拖动、缩放、追问，也可以转到侧栏继续。
- **引用回答追问**：在回答中选中一段，点「引用」，针对这段继续提问。
- **公式渲染**：使用 KaTeX，支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`、裸 `\begin{align}` 和 ` ```math ` 代码块，并补充了 physics、siunitx、upgreek、mhchem 的常用命令。公式在 Markdown 解析之前提取，表格中的 `|` 和公式里的 `_`、`*` 不会被误解析。KaTeX 无法渲染的公式显示为源码，悬停可查看原因。
- **联网搜索**：模型自带联网时直接使用（Gemini、OpenRouter、Perplexity、通义、智谱等）；没有时，由模型调用你配置的搜索服务：Tavily、Exa、Brave、Jina、博查或 SearXNG。也可以先搜索再回答，这种方式对任何模型都适用。
- **思考模型**：按模型发送对应的思考参数（`reasoning_effort`、`thinkingLevel` 或 `thinkingBudget`），服务商返回思考摘要时折叠显示。
- **附件**：图片、PDF、文本和代码文件、当前可见区域截图，以及当前标签页打开的 PDF。
- **token 用量**：每条回答显示输入和输出 token；输入框旁的圆环显示当前会话占上下文预算的比例。
- **本地历史**：会话保存在浏览器本地，可以搜索、重命名、导出为 Markdown。
- **界面语言**：支持英文和简体中文。默认跟随浏览器语言，可在设置 → 外观 → 界面语言中切换。默认提示词和划词动作在你修改之前会跟随界面语言。

## 安装

### 从 Release 安装

1. 在 [Releases](../../releases) 下载 `valise-<版本>.zip`，解压到一个长期保留的文件夹。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`，Brave 为 `brave://extensions`，Vivaldi 为 `vivaldi://extensions`），开启开发者模式。
3. 点击「加载已解压的扩展程序」，选择解压后的文件夹。
4. 点击工具栏图标或按 `Ctrl+Shift+Y`（macOS 为 `⌘⇧Y`）打开侧栏，然后添加模型。

更新时把新版本解压到同一个文件夹，再在扩展管理页点击「重新加载」。设置和历史记录会保留。

### 从源码构建

需要 Node.js 22.12 或更高版本。

```sh
npm ci
npm run build    # 类型检查并构建到 dist/
```

然后按上面的步骤加载 `dist/` 文件夹。

## 快速上手

1. **添加模型**：打开设置 → 模型，选择预设（OpenAI、Gemini、DeepSeek、OpenRouter、硅基流动、Ollama 或其他 OpenAI 兼容服务），填写 Base URL、API key 和模型名。「获取列表」可查看接口提供的模型，「测试连接」用于检查配置。
2. **针对网页提问**：打开任意网页，在侧栏输入问题，或在空白会话中点击推荐操作。
3. **引用其他标签页**：输入 `@`，用方向键选择标签页后回车。被引用的标签页在发送时读取。
4. **划词提问**：在网页上选中文字，点击工具栏中的动作。也可以用右键菜单（Valise → 动作）或 `Alt+Shift+L`。

## 支持的接口

| 协议        | Base URL 示例                                      | 请求                                                             |
| ----------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| OpenAI 兼容 | `https://api.openai.com/v1`                        | `POST /chat/completions`，Bearer token，流式                     |
| Gemini      | `https://generativelanguage.googleapis.com/v1beta` | `/models/<模型>:streamGenerateContent?alt=sse`，`x-goog-api-key` |

OpenAI 兼容协议适用于 DeepSeek、OpenRouter、硅基流动、通义、智谱、Moonshot、Ollama、vLLM、LM Studio 等服务。自定义接口可以手动声明能力（图片、PDF、工具调用、自带联网、思考参数），并以 JSON 填写额外请求字段。额外字段不能覆盖认证、消息和流式相关字段。

### 联网搜索

搜索有两种模式：

- **按需搜索**：模型自带联网时由模型自己搜索；不带联网但支持工具调用时，模型可以调用你配置的搜索服务；两者都不支持时，会提示改用另一种模式。
- **先搜索再回答**：Valise 先调用搜索服务，再把结果交给模型。适用于任何模型。

以下情况会自动识别为自带联网：Gemini 2.0 及之后的模型、OpenAI `*search*` 模型、Perplexity、OpenRouter `:online` 模型。其他 OpenAI 兼容服务可在「模型 → 自带联网」中开启，已内置 OpenRouter、OpenAI 搜索模型、通义和智谱的预设。

## 隐私

- 模型和搜索请求从浏览器直接发往你配置的服务。
- API key 保存在扩展存储中，网页和内容脚本都无法读取。导出设置时默认不包含 key；选择包含时，文件名会带 `WITH-SECRETS`。
- 只有在你发送问题、打开预览或点击划词动作时才会读取网页；`@` 引用的标签页在发送时读取。
- 网页内容和搜索结果作为参考资料放在你的消息里，并注明不是指令，不会进入系统提示词。
- 会话、附件和网页快照保存在本地 IndexedDB。快照最多保留 20 份或约 10 MiB，超出时先删除最旧的。

Valise 申请访问所有网站的权限，用于读取标签页、截图和显示划词工具栏。如果把网站访问权限改为「点击时」，侧栏会在需要时显示授权按钮。

## 常见问题

- **读不到网页内容**：浏览器内部页面（`chrome://…`）和扩展商店受保护，侧栏会提供「改为普通聊天」。PDF 标签页可以作为附件发送。懒加载或折叠的内容请先在网页上展开，再点 ↻ 重新读取。
- **引用的标签页读取失败**：浏览器可能已休眠该标签页。切换过去让它加载一次，再重试。
- **公式显示为灰底源码**：KaTeX 不支持其中的某个命令，悬停可以看到是哪个。源码仍然可以复制。
- **401 / 429 / 5xx 错误**：检查 key、模型名、Base URL 和额度。出错前收到的内容会保留，失败的请求不会自动重试。
- **服务商拒绝某个参数**：把思考和采样参数改回「默认」，或在该模型的「能力」中关闭不支持的项。
- **扩展更新后，之前打开的网页报错**：刷新网页即可。

## 开发

```sh
npm ci
npm test           # vitest
npm run typecheck
npm run build      # 类型检查并构建到 dist/
npm run dev        # 监听改动并重新构建
npm run package    # 构建并把 dist/ 打包为 artifacts/valise-<版本>.zip
npm run mock       # 本地 mock 接口：http://127.0.0.1:18473/fixture
```

技术栈为 TypeScript、Vite 和原生 DOM（不使用 UI 框架），依赖 markdown-it、KaTeX、DOMPurify、highlight.js、Defuddle 和 idb。代码结构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，提交 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 致谢

Valise 从 [Lumio](https://github.com/Iceeeeeeey/lumio)（MIT）fork 而来，图标也来自 Lumio。网页正文提取流程改编自 [Page Assist](https://github.com/n4ze3m/page-assist)（MIT）。所用依赖的许可证见 [`public/licenses/`](public/licenses/)。

名字 Valise 是法语的「手提箱」。

## 许可证

[MIT](LICENSE)
