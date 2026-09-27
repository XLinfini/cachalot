import { message } from "../domain/messages";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { chatImages } from "./chat-images";
import { maskApiKey } from "../domain/api-key";
import { apiEndpoint } from "../domain/api-endpoint";
import { providerErrorDetails } from "./provider-error";
import { browserProviderKeys as keys } from "./browser-provider-keys";
import type {
  DocumentRecord,
  Provider,
  ProviderInput,
  ModelInfo,
  ChatThread,
  ChatMessage,
  CompletionInput,
} from "../domain/records";

// Transport/storage adapter only. Components call application/services.ts.

const native = isTauri();

function readList<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(`cachalot:${key}`) || "[]") as T[];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]): void {
  localStorage.setItem(`cachalot:${key}`, JSON.stringify(items));
}

function openPdfStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cachalot-pdfs", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pdfs");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function pdfStore(
  action: "get" | "put" | "delete",
  id: string,
  data?: ArrayBuffer,
): Promise<ArrayBuffer | undefined> {
  const db = await openPdfStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pdfs", action === "get" ? "readonly" : "readwrite");
    const request =
      action === "get"
        ? tx.objectStore("pdfs").get(id)
        : action === "put"
          ? tx.objectStore("pdfs").put(data, id)
          : tx.objectStore("pdfs").delete(id);
    request.onsuccess = () =>
      resolve(action === "get" ? (request.result as ArrayBuffer | undefined) : undefined);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

function toBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(result);
}

function fromBase64(encoded: string): Uint8Array {
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export const platform = {
  native,

  async listDocuments(): Promise<DocumentRecord[]> {
    return native
      ? invoke("list_documents")
      : readList<DocumentRecord>("documents").sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async importPdf(
    file: File,
    bytes: Uint8Array,
    pageCount: number,
    title?: string,
  ): Promise<DocumentRecord> {
    if (native)
      return invoke("import_pdf", {
        fileName: file.name,
        dataBase64: toBase64(bytes),
        pageCount,
        title,
      });
    const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
    const id = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const docs = readList<DocumentRecord>("documents");
    const existing = docs.find((doc) => doc.id === id);
    const now = Math.floor(Date.now() / 1000);
    const document: DocumentRecord = existing
      ? { ...existing, updatedAt: now }
      : {
          id,
          fileName: file.name,
          title: title || file.name.replace(/\.pdf$/i, ""),
          pageCount,
          currentPage: 1,
          starred: false,
          createdAt: now,
          updatedAt: now,
        };
    writeList("documents", [document, ...docs.filter((doc) => doc.id !== id)]);
    await pdfStore("put", id, bytes.slice().buffer);
    return document;
  },

  async loadPdf(id: string): Promise<Uint8Array> {
    if (native) return fromBase64(await invoke<string>("load_pdf", { id }));
    const bytes = await pdfStore("get", id);
    if (!bytes) throw new Error(message("pdfNotFound"));
    return new Uint8Array(bytes);
  },

  async setProgress(id: string, page: number): Promise<void> {
    if (native) return invoke("set_document_progress", { id, page });
    writeList(
      "documents",
      readList<DocumentRecord>("documents").map((doc) =>
        doc.id === id
          ? {
              ...doc,
              currentPage: page,
              updatedAt: Math.floor(Date.now() / 1000),
            }
          : doc,
      ),
    );
  },

  async setStarred(id: string, starred: boolean): Promise<void> {
    if (native) return invoke("set_document_starred", { id, starred });
    writeList(
      "documents",
      readList<DocumentRecord>("documents").map((doc) =>
        doc.id === id ? { ...doc, starred } : doc,
      ),
    );
  },

  async deleteDocument(id: string): Promise<void> {
    if (native) return invoke("delete_document", { id });
    await pdfStore("delete", id);
    writeList(
      "documents",
      readList<DocumentRecord>("documents").filter((doc) => doc.id !== id),
    );
    const removed = new Set(
      readList<ChatThread>("threads")
        .filter((thread) => thread.documentId === id)
        .map((thread) => thread.id),
    );
    await Promise.all(
      readList<ChatMessage>("messages")
        .filter((message) => removed.has(message.threadId))
        .map((message) => chatImages("delete", message.id)),
    );
    writeList(
      "threads",
      readList<ChatThread>("threads").filter((thread) => thread.documentId !== id),
    );
    writeList(
      "messages",
      readList<ChatMessage>("messages").filter((message) => !removed.has(message.threadId)),
    );
    // Missing pages are possible after an interrupted import.
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`cachalot:page:${id}:`)) localStorage.removeItem(key);
  },

  async listProviders(): Promise<Provider[]> {
    return native
      ? invoke("list_providers")
      : Promise.all(
          readList<Provider>("providers").map(async (provider) => ({
            ...provider,
            hasKey: await keys.has(provider.id),
          })),
        );
  },

  async saveProvider(provider: ProviderInput): Promise<Provider> {
    if (native) return invoke("save_provider", { provider });
    apiEndpoint(provider.baseUrl, "models");
    if (provider.apiKey) await keys.set(provider.id, provider.apiKey);
    const saved = {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      modelId: provider.modelId,
      enabled: provider.enabled,
      hasKey: await keys.has(provider.id),
    };
    writeList("providers", [
      saved,
      ...readList<Provider>("providers").filter((item) => item.id !== saved.id),
    ]);
    return saved;
  },

  async providerKeyPreview(providerId: string): Promise<string | null> {
    if (native) return invoke("get_provider_key", { providerId, reveal: false });
    const key = await keys.get(providerId);
    return key ? maskApiKey(key) : null;
  },

  async revealProviderKey(providerId: string): Promise<string | null> {
    return native ? invoke("get_provider_key", { providerId, reveal: true }) : keys.get(providerId);
  },

  async deleteProvider(id: string): Promise<void> {
    if (native) return invoke("delete_provider", { id });
    await keys.delete(id);
    writeList(
      "providers",
      readList<Provider>("providers").filter((item) => item.id !== id),
    );
  },

  async listModels(providerId: string): Promise<ModelInfo[]> {
    if (native) return invoke("list_models", { providerId });
    const provider = readList<Provider>("providers").find((item) => item.id === providerId);
    if (!provider) throw new Error(message("providerNotFound"));
    const key = await keys.get(providerId);
    const response = await fetch(apiEndpoint(provider.baseUrl, "models"), {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!response.ok) {
      const details = providerErrorDetails(
        await response.text(),
        response.headers,
        key || undefined,
      );
      throw new Error(
        details
          ? message("modelsHttpDetails", { status: response.status, details })
          : message("modelsHttp", { status: response.status }),
      );
    }
    const body = (await response.json()) as { data?: Array<{ id: string; owned_by?: string }> };
    return (body.data || []).map((model) => ({ id: model.id, ownedBy: model.owned_by }));
  },

  async testProvider(providerId: string): Promise<string> {
    if (native) return invoke("test_provider", { providerId });
    await this.listModels(providerId);
    return message("connectionSucceeded");
  },

  async getSetting(key: string): Promise<string | null> {
    return native
      ? invoke("get_setting", { key })
      : localStorage.getItem(`cachalot:setting:${key}`);
  },

  async setSetting(key: string, value: string): Promise<void> {
    if (native) return invoke("set_setting", { key, value });
    localStorage.setItem(`cachalot:setting:${key}`, value);
  },

  async savePageText(documentId: string, page: number, content: string): Promise<void> {
    if (native) return invoke("save_page_text", { documentId, page, content });
    localStorage.setItem(`cachalot:page:${documentId}:${page}`, content);
  },

  async listPageText(documentId: string, pageCount: number): Promise<Array<[number, string]>> {
    if (native) return invoke("list_page_text", { documentId });
    const result: Array<[number, string]> = [];
    for (let page = 1; page <= pageCount; page++) {
      const content = localStorage.getItem(`cachalot:page:${documentId}:${page}`);
      if (content !== null) result.push([page, content]);
    }
    return result;
  },

  async createThread(documentId: string): Promise<ChatThread> {
    if (native) return invoke("create_chat_thread", { documentId });
    const now = Math.floor(Date.now() / 1000);
    const thread = {
      id: crypto.randomUUID(),
      documentId,
      title: "",
      createdAt: now,
      updatedAt: now,
    };
    writeList("threads", [thread, ...readList<ChatThread>("threads")]);
    return thread;
  },

  async listThreads(documentId: string): Promise<ChatThread[]> {
    return native
      ? invoke("list_chat_threads", { documentId })
      : readList<ChatThread>("threads")
          .filter((thread) => thread.documentId === documentId)
          .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async renameThread(id: string, title: string): Promise<void> {
    if (native) return invoke("rename_chat_thread", { id, title });
    writeList(
      "threads",
      readList<ChatThread>("threads").map((thread) =>
        thread.id === id ? { ...thread, title } : thread,
      ),
    );
  },

  async deleteThread(id: string): Promise<void> {
    if (native) return invoke("delete_chat_thread", { id });
    await Promise.all(
      readList<ChatMessage>("messages")
        .filter((message) => message.threadId === id)
        .map((message) => chatImages("delete", message.id)),
    );
    writeList(
      "threads",
      readList<ChatThread>("threads").filter((thread) => thread.id !== id),
    );
    writeList(
      "messages",
      readList<ChatMessage>("messages").filter((message) => message.threadId !== id),
    );
  },

  async listMessages(threadId: string): Promise<ChatMessage[]> {
    if (native) return invoke("list_chat_messages", { threadId });
    const messages = readList<ChatMessage>("messages")
      .filter((message) => message.threadId === threadId)
      .sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(
      messages.map(async (message) => ({
        ...message,
        images: message.images?.length
          ? (await chatImages("get", message.id)) ||
            message.images.filter((image) => image.dataUrl.startsWith("data:image/"))
          : [],
      })),
    );
  },

  async saveMessage(message: ChatMessage): Promise<void> {
    if (native) return invoke("save_chat_message", { message });
    if (message.images?.length) await chatImages("put", message.id, message.images);
    else if (message.images) await chatImages("delete", message.id);
    const metadata = {
      ...message,
      images: message.images?.map((image) => ({ ...image, dataUrl: "" })),
    };
    writeList("messages", [
      metadata,
      ...readList<ChatMessage>("messages").filter((item) => item.id !== message.id),
    ]);
  },

  async deleteMessage(id: string): Promise<void> {
    if (native) return invoke("delete_chat_message", { id });
    await chatImages("delete", id);
    writeList(
      "messages",
      readList<ChatMessage>("messages").filter((item) => item.id !== id),
    );
  },

  async complete(input: CompletionInput, onDelta: (text: string) => void): Promise<void> {
    if (native) {
      const channel = new Channel<{ kind: string; text: string }>();
      channel.onmessage = (event) => {
        if (event.kind === "delta") onDelta(event.text);
      };
      await invoke("stream_completion", { input, onEvent: channel });
      return;
    }
    const provider = readList<Provider>("providers").find((item) => item.id === input.providerId);
    if (!provider) throw new Error(message("configureProvider"));
    const key = await keys.get(provider.id);
    const response = await fetch(apiEndpoint(provider.baseUrl, "chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: input.modelId || provider.modelId,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        stream: true,
      }),
    });
    if (!response.ok) {
      const details = providerErrorDetails(
        await response.text(),
        response.headers,
        key || undefined,
      );
      throw new Error(
        details
          ? message("completionHttpDetails", { status: response.status, details })
          : message("completionHttp", { status: response.status }),
      );
    }
    if (!response.body) throw new Error(message("emptyResponse"));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let part: { error?: unknown; choices?: Array<{ delta?: { content?: string } }> };
        try {
          part = JSON.parse(data);
        } catch {
          continue; /* A provider may emit non-JSON heartbeat lines. */
        }
        if (part.error)
          throw new Error(
            message("completionStreamError", {
              details: providerErrorDetails(data, response.headers, key || undefined),
            }),
          );
        onDelta(part.choices?.[0]?.delta?.content || "");
      }
    }
  },
};
