import { afterEach, beforeEach, expect, it } from "vitest";
import { askText, confirmAction } from "../src/ui";

beforeEach(() => {
  // jsdom does not implement native dialog methods; preserve browser close semantics.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
});
afterEach(() => document.body.replaceChildren());

it("renames through a real form and resolves dismissal without suppressed window.prompt", async () => {
  const rename = askText("重命名会话", "会话名称", "原名");
  document.querySelector("input")!.value = "  新名  ";
  document
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  expect(await rename).toBe("新名");
  expect(document.querySelector("dialog")).toBeNull();
  const dismissed = askText("重命名会话", "会话名称", "保留");
  document.querySelector("dialog")!.close();
  expect(await dismissed).toBeUndefined();
});
it("keeps delete cancellation separate from explicit confirmation", async () => {
  const cancelled = confirmAction("删除", "不可撤销");
  document.querySelector("dialog")!.close();
  expect(await cancelled).toBe(false);
  const confirmed = confirmAction("删除", "不可撤销");
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent === "删除")!
    .click();
  expect(await confirmed).toBe(true);
  expect(document.querySelector("dialog")).toBeNull();
});
