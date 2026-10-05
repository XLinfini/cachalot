import type { Disposable, Event } from "../../sdk";
export function disposable(fn: () => void): Disposable {
  let disposed = false;
  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        fn();
      }
    },
  };
}
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();
  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return disposable(() => this.listeners.delete(listener));
  };
  fire(value: T) {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch {
        /* A subscriber cannot break the publisher. */
      }
    }
  }
}
export function cancelled(): never {
  throw new DOMException("Operation cancelled", "AbortError");
}
/** Reject promptly and detach even if an adapter ignores cancellation. The
 * adapter also receives this signal to abort the underlying network request. */
export async function cancellable<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) cancelled();
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException("Operation cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work(), stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
