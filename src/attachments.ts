import { uid, type Attachment } from "./types";

export const MAX_ATTACHMENTS = 8;
const MAX_SIDE = 2048;
const MB = 1024 * 1024;
const TEXT_EXT =
  /\.(?:md|markdown|txt|csv|tsv|json|jsonl|ya?ml|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|ipynb|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|swift|sh|zsh|bash|sql|tex|bib|toml|ini|cfg|conf|log|r|m|jl|lua|php|vue|svelte|srt|vtt)$/i;

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Re-encodes images as JPEG with a bounded long side to keep requests and history small. */
async function imageAttachment(blob: Blob, name: string): Promise<Attachment> {
  if (blob.size > 30 * MB) throw new Error(`图片「${name}」超过 30 MB。`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(`无法解码图片「${name}」。`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return {
    id: uid(),
    kind: "image",
    name: name.replace(/\.\w+$/, "") + ".jpg",
    mime: "image/jpeg",
    data: await base64(out),
    size: out.size,
  };
}

async function pdfAttachment(blob: Blob, name: string): Promise<Attachment> {
  if (blob.size > 20 * MB) throw new Error(`PDF「${name}」超过 20 MB。`);
  return {
    id: uid(),
    kind: "pdf",
    name,
    mime: "application/pdf",
    data: await base64(blob),
    size: blob.size,
  };
}

export async function attachmentFromFile(file: File): Promise<Attachment> {
  if (file.type.startsWith("image/")) return imageAttachment(file, file.name);
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name))
    return pdfAttachment(file, file.name);
  if (
    file.type.startsWith("text/") ||
    /json|xml|javascript|yaml|csv|x-tex|markdown|x-sh/.test(file.type) ||
    TEXT_EXT.test(file.name)
  ) {
    if (file.size > 2 * MB) throw new Error(`文本文件「${file.name}」超过 2 MB。`);
    return {
      id: uid(),
      kind: "text",
      name: file.name,
      mime: file.type || "text/plain",
      data: await file.text(),
      size: file.size,
    };
  }
  throw new Error(`暂不支持「${file.name}」这种文件；可上传图片、PDF 或文本/代码文件。`);
}

export async function captureTab(windowId?: number): Promise<Attachment> {
  const options = { format: "jpeg" as const, quality: 92 };
  const dataUrl =
    windowId === undefined
      ? await chrome.tabs.captureVisibleTab(options)
      : await chrome.tabs.captureVisibleTab(windowId, options);
  const blob = await (await fetch(dataUrl)).blob();
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  return imageAttachment(blob, `截图 ${time}`);
}

/** Fetches the PDF the user is viewing; the extension's host access covers the request. */
export async function attachmentFromUrl(url: string): Promise<Attachment> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`下载 PDF 失败：HTTP ${response.status}`);
  const blob = await response.blob();
  let name = "document.pdf";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() || name);
  } catch {
    // Keep the generic name for malformed escapes.
  }
  return pdfAttachment(blob, /\.pdf$/i.test(name) ? name : name + ".pdf");
}
