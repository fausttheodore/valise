import type { Profile } from "./types";

export class RequestTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
export class RequestScope {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private totalTimer: ReturnType<typeof setTimeout>;
  private phaseTimer?: ReturnType<typeof setTimeout>;
  private totalDue: number;
  private phaseDue?: number;
  private phaseMessage = "";
  constructor(readonly timeouts: Profile["timeouts"]) {
    this.totalDue = Date.now() + timeouts.total * 1000;
    this.totalTimer = setTimeout(
      () => this.abort(new RequestTimeout("已达到总时长上限。")),
      timeouts.total * 1000,
    );
  }
  check() {
    if (!this.signal.aborted) {
      if (Date.now() >= this.totalDue)
        this.abort(new RequestTimeout("已达到总时长上限。"));
      else if (this.phaseDue && Date.now() >= this.phaseDue)
        this.abort(new RequestTimeout(this.phaseMessage));
    }
    this.signal.throwIfAborted();
  }
  abort(reason: unknown = new DOMException("已停止生成", "AbortError")) {
    if (!this.signal.aborted) this.controller.abort(reason);
    this.dispose();
  }
  connecting() {
    this.check();
    this.arm(this.timeouts.first, "首响应等待超时。");
  }
  touch() {
    this.check();
    this.arm(this.timeouts.idle, "流式响应长时间没有新数据。");
  }
  pausePhase() {
    clearTimeout(this.phaseTimer);
    this.phaseTimer = undefined;
    this.phaseDue = undefined;
  }
  private arm(seconds: number, message: string) {
    clearTimeout(this.phaseTimer);
    this.phaseDue = Date.now() + seconds * 1000;
    this.phaseMessage = message;
    this.phaseTimer = setTimeout(
      () => this.abort(new RequestTimeout(message)),
      seconds * 1000,
    );
  }
  async wait<T>(promise: Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const aborted = () => reject(this.signal.reason);
      this.signal.addEventListener("abort", aborted, { once: true });
      promise
        .then((v) => {
          if (this.signal.aborted) reject(this.signal.reason);
          else resolve(v);
        }, reject)
        .finally(() => this.signal.removeEventListener("abort", aborted));
    });
  }
  dispose() {
    clearTimeout(this.totalTimer);
    this.pausePhase();
  }
}
