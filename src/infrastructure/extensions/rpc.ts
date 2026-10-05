/** Small, bounded RPC transport. Only explicit operation handlers reach host services. */
export class ExtensionRpc {
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  constructor(
    private port: MessagePort,
    private handle: (method: string, args: unknown[]) => unknown | Promise<unknown>,
    private fault: (error: Error) => void,
  ) {
    port.onmessage = (event) => {
      void this.receive(event.data);
    };
    port.onmessageerror = () => fault(new Error("Invalid extension message"));
    port.start();
  }
  call(method: string, args: unknown[] = []): Promise<unknown> {
    if (this.closed) return Promise.reject(new DOMException("Extension stopped", "AbortError"));
    if (this.pending.size >= 256)
      return Promise.reject(new Error("Too many pending extension calls"));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension call timed out: ${method}`));
      }, 120000);
      this.pending.set(id, { resolve, reject, timer });
      this.port.postMessage({ id, method, args });
    });
  }
  notify(method: string, args: unknown[] = []) {
    if (!this.closed) this.port.postMessage({ method, args });
  }
  private async receive(message: {
    id?: number;
    method?: string;
    args?: unknown[];
    value?: unknown;
    error?: string;
    response?: boolean;
  }) {
    if (this.closed || !message || typeof message !== "object") return;
    if (message.response) {
      const item = this.pending.get(message.id!);
      if (!item) return;
      this.pending.delete(message.id!);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error));
      else item.resolve(message.value);
      return;
    }
    if (typeof message.method !== "string" || !Array.isArray(message.args)) {
      this.fault(new Error("Invalid extension RPC envelope"));
      return;
    }
    try {
      const value = await this.handle(message.method, message.args);
      if (message.id && !this.closed)
        this.port.postMessage({ id: message.id, response: true, value });
    } catch (error) {
      if (message.id && !this.closed)
        this.port.postMessage({ id: message.id, response: true, error: String(error) });
      else this.fault(new Error(String(error)));
    }
  }
  close() {
    this.closed = true;
    this.port.close();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new DOMException("Extension stopped", "AbortError"));
    }
    this.pending.clear();
  }
}
