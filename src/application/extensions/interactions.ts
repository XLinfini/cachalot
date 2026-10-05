import type { InputBoxOptions, Label, Progress, ProgressOptions, QuickPickItem } from "../../sdk";
import { cancelled, cancellable } from "./events";
export interface HostInteraction {
  id: number;
  owner: string;
  kind: "input" | "pick" | "progress" | "information" | "warning";
  title: Label;
  prompt?: Label;
  value?: string;
  password?: boolean;
  items?: QuickPickItem[];
  message?: string;
  percent?: number;
  cancellable?: boolean;
}
function label(value: unknown): asserts value is Label {
  const text = (item: unknown) => typeof item === "string" && item.length <= 10000;
  if (
    !text(value) &&
    !(
      value &&
      typeof value === "object" &&
      "zh" in value &&
      "en" in value &&
      text(value.zh) &&
      text(value.en)
    )
  )
    throw new Error("Invalid interaction label");
}
/** UI services belong to the activation scope, never to the core reader lifetime. */
export class ExtensionInteractions {
  private sequence = 0;
  private entries = new Map<number, HostInteraction>();
  private responses = new Map<number, (value?: string) => void>();
  private cancellations = new Map<number, AbortController>();
  constructor(private changed: () => void) {}
  snapshot() {
    return [...this.entries.values()].map((value) => ({ ...value }));
  }
  respond(id: number, value?: string) {
    this.responses.get(id)?.(value);
  }
  dismiss(id: number) {
    this.responses.get(id)?.();
    this.cancellations.get(id)?.abort();
    this.entries.delete(id);
    this.changed();
  }
  notify(owner: string, kind: "information" | "warning", title: string, signal: AbortSignal) {
    label(title);
    const id = ++this.sequence;
    const abort = () => {
      this.responses.delete(id);
      this.entries.delete(id);
      this.changed();
    };
    signal.addEventListener("abort", abort, { once: true });
    this.entries.set(id, { id, owner, kind, title });
    // Notifications are bounded, including their abort listener registrations.
    this.responses.set(id, () => {
      signal.removeEventListener("abort", abort);
      this.responses.delete(id);
      abort();
    });
    const notices = [...this.entries.values()].filter(
      (item) => item.kind === "information" || item.kind === "warning",
    );
    if (notices.length > 20) this.dismiss(notices[0].id);
    this.changed();
  }
  private request(
    input: Omit<HostInteraction, "id">,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (signal.aborted) cancelled();
    if (
      [...this.entries.values()].filter((item) => item.kind === "input" || item.kind === "pick")
        .length >= 16
    )
      throw new Error("Too many extension dialogs");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const clear = () => {
        signal.removeEventListener("abort", abort);
        this.responses.delete(id);
        this.entries.delete(id);
        this.changed();
      };
      const abort = () => {
        clear();
        reject(new DOMException("Extension stopped", "AbortError"));
      };
      this.responses.set(id, (value) => {
        clear();
        resolve(value);
      });
      signal.addEventListener("abort", abort, { once: true });
      this.entries.set(id, { ...input, id });
      this.changed();
    });
  }
  async pick(owner: string, items: QuickPickItem[], title: Label, signal: AbortSignal) {
    label(title);
    if (!Array.isArray(items) || items.length > 500) throw new Error("Invalid quick pick items");
    const ids = new Set<string>();
    for (const item of items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 256 ||
        ids.has(item.id)
      )
        throw new Error("Invalid quick pick item ID");
      ids.add(item.id);
      label(item.label);
      if (item.description !== undefined) label(item.description);
    }
    const copied = structuredClone(items);
    const result = await this.request({ owner, kind: "pick", title, items: copied }, signal);
    return copied.find((item) => item.id === result);
  }
  input(owner: string, options: InputBoxOptions, signal: AbortSignal) {
    label(options.title);
    if (options.prompt !== undefined) label(options.prompt);
    if (
      options.value !== undefined &&
      (typeof options.value !== "string" || options.value.length > 10000)
    )
      throw new Error("Invalid input value");
    return this.request(
      {
        owner,
        kind: "input",
        title: options.title,
        prompt: options.prompt,
        value: options.value,
        password: options.password === true,
      },
      signal,
    );
  }
  async progress<T>(
    owner: string,
    options: ProgressOptions,
    task: (progress: Progress, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    label(options.title);
    if (signal.aborted) cancelled();
    if (this.cancellations.size >= 32) throw new Error("Too many extension progress tasks");
    const id = ++this.sequence,
      controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    this.cancellations.set(id, controller);
    this.entries.set(id, {
      id,
      owner,
      kind: "progress",
      title: options.title,
      percent: 0,
      cancellable: options.cancellable === true,
    });
    this.changed();
    try {
      return await cancellable(combined, () =>
        task(
          {
            report: (value) => {
              const item = this.entries.get(id);
              if (!item || combined.aborted) return;
              if (
                !value ||
                (value.message !== undefined &&
                  (typeof value.message !== "string" || value.message.length > 10000)) ||
                (value.increment !== undefined && !Number.isFinite(value.increment))
              )
                throw new Error("Invalid progress report");
              this.entries.set(id, {
                ...item,
                message: value.message ?? item.message,
                percent: Math.max(0, Math.min(100, (item.percent ?? 0) + (value.increment ?? 0))),
              });
              this.changed();
            },
          },
          combined,
        ),
      );
    } finally {
      this.cancellations.delete(id);
      this.entries.delete(id);
      this.changed();
    }
  }
}
