// Derived from Page Assist src/parser/default.ts at c54bc6f41644e83b8130532814f7b62e01a47300 (MIT).
// The fallback covers sibling articles and preserves page math sources before conversion.
import Defuddle, { createMarkdownContent } from "defuddle/full";

export function extractHtml(
  html: string,
  url: string,
): { content: string; warnings: string[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const warnings = [
    "仅包含当前已加载且可访问的正文；未展开、懒加载或虚拟列表内容可能不完整。",
  ];
  for (const node of doc.querySelectorAll(".katex,mjx-container,.MathJax")) {
    const tex =
      node.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent ||
      node.getAttribute("data-tex") ||
      node.querySelector("math")?.getAttribute("alttext");
    if (tex) {
      const display = node.closest(".katex-display");
      const math = doc.createElement("math");
      math.setAttribute("data-latex", tex);
      math.textContent = tex;
      math.setAttribute(
        "display",
        display || node.getAttribute("display") === "true" ? "block" : "inline",
      );
      (display || node).replaceWith(math);
    }
  }
  for (const node of doc.querySelectorAll('script[type^="math/tex"]')) {
    const math = doc.createElement("math");
    math.setAttribute("data-latex", node.textContent || "");
    math.textContent = node.textContent;
    math.setAttribute(
      "display",
      node.getAttribute("type")?.includes("mode=display") ? "block" : "inline",
    );
    node.replaceWith(math);
  }
  if (doc.querySelector("iframe"))
    warnings.push(
      "嵌入 frame 正文未合并；请在该 frame 内选区提问，或单独打开来源页面。",
    );
  if (doc.querySelector("mjx-container,.MathJax"))
    warnings.push("部分公式未提供可恢复的 TeX 源，保留可读文本。");
  doc
    .querySelectorAll(
      'script,style,link,noscript,nav,footer,aside,[role="navigation"],[hidden],[data-valise-root],.advertisement,.ads',
    )
    .forEach((e) => e.remove());
  // A forum can contain multiple article siblings. Selecting just the first one loses replies.
  const articles = [...doc.querySelectorAll("article")].filter(
    (e) => !e.parentElement?.closest("article"),
  );
  const root =
    doc.querySelector('main,[role="main"]') ||
    (articles.length === 1 ? articles[0] : doc.body);
  const fallback = () => createMarkdownContent(root.innerHTML, url).trim();
  if (articles.length > 1) {
    warnings.push("已保留多个文章/讨论内容块。");
    return { content: fallback(), warnings };
  }
  let content = "";
  try {
    const result = new Defuddle(doc.cloneNode(true) as Document, {
      url,
    }).parse();
    if (result.content)
      content = createMarkdownContent(result.content, url).trim();
  } catch {
    warnings.push("正文识别未成功，已使用结构化回退。");
  }
  const plain = (root.textContent || "").trim();
  if (!content || content.length < plain.length * 0.3) {
    content = fallback();
    warnings.push("使用结构化回退以保留更多当前页面内容。");
  }
  return { content, warnings };
}
