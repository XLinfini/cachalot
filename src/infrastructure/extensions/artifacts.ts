import type { Artifact, ArtifactInput } from "../../domain/document-workbench";

/** User artifacts have a separate database from regenerable analysis caches.
 * Metadata and binary data commit together; listing never copies PDF blobs. */
export class ArtifactRepository {
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("cachalot-extension-artifacts", 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore("metadata", { keyPath: ["owner", "id"] })
          .createIndex("owner", "owner");
        request.result.createObjectStore("data", { keyPath: ["owner", "id"] });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Artifact storage is blocked"));
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (value: T) => void) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const db = await this.open();
    try {
      signal?.throwIfAborted();
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(["metadata", "data"], mode);
        let value: T;
        const abort = () => {
          try {
            tx.abort();
          } catch {
            /* Already completed. */
          }
        };
        const cleanup = () => signal?.removeEventListener("abort", abort);
        signal?.addEventListener("abort", abort, { once: true });
        tx.oncomplete = () => {
          cleanup();
          resolve(value);
        };
        tx.onabort = () => {
          cleanup();
          reject(
            signal?.aborted
              ? new DOMException("Cancelled", "AbortError")
              : (tx.error ?? new Error("Artifact transaction aborted")),
          );
        };
        try {
          run(tx, (next) => {
            value = next;
          });
        } catch (error) {
          abort();
          cleanup();
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  }
  async write(owner: string, input: ArtifactInput, signal?: AbortSignal): Promise<Artifact> {
    validateArtifact(input);
    signal?.throwIfAborted();
    // Capture the input before yielding to IndexedDB; callers may reuse their
    // buffer while the transaction waits for its previous checkpoint.
    input = {
      id: input.id,
      name: input.name,
      mediaType: input.mediaType,
      sourceDocumentId: input.sourceDocumentId,
      bytes: input.bytes.slice(),
    };
    return this.transaction(
      "readwrite",
      (tx, done) => {
        const store = tx.objectStore("metadata");
        const request = store.get([owner, input.id]);
        request.onsuccess = () => {
          const now = Date.now();
          const artifact: Artifact = {
            id: input.id,
            name: input.name,
            mediaType: input.mediaType,
            sourceDocumentId: input.sourceDocumentId,
            byteLength: input.bytes.byteLength,
            createdAt: request.result?.createdAt ?? now,
            updatedAt: now,
          };
          store.put({ ...artifact, owner });
          tx.objectStore("data").put({ owner, id: input.id, bytes: input.bytes });
          done(artifact);
        };
      },
      signal,
    );
  }
  async read(owner: string, id: string, signal?: AbortSignal): Promise<Uint8Array> {
    validateArtifactId(id);
    const bytes = await this.transaction<Uint8Array | undefined>(
      "readonly",
      (tx, done) => {
        const request = tx.objectStore("data").get([owner, id]);
        request.onsuccess = () => done(request.result?.bytes);
      },
      signal,
    );
    if (!bytes) throw new Error("Artifact not found");
    return bytes.slice();
  }
  list(owner: string, sourceDocumentId?: string): Promise<Artifact[]> {
    return this.transaction("readonly", (tx, done) => {
      const request = tx.objectStore("metadata").index("owner").getAll(owner);
      request.onsuccess = () =>
        done(
          request.result
            .filter(
              (item) =>
                sourceDocumentId === undefined || item.sourceDocumentId === sourceDocumentId,
            )
            .map(({ owner: _owner, ...item }) => item),
        );
    });
  }
  delete(owner: string, id: string): Promise<void> {
    validateArtifactId(id);
    return this.transaction("readwrite", (tx, done) => {
      for (const store of ["metadata", "data"]) tx.objectStore(store).delete([owner, id]);
      done(undefined);
    });
  }
}
export function validateArtifactId(id: string): void {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id))
    throw new Error("Invalid artifact ID");
}
function validateArtifact(input: ArtifactInput): void {
  validateArtifactId(input?.id);
  if (
    typeof input.name !== "string" ||
    !input.name ||
    input.name.length > 240 ||
    /[\\/\x00-\x1f]/.test(input.name)
  )
    throw new Error("Invalid artifact name");
  if (typeof input.mediaType !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(input.mediaType))
    throw new Error("Invalid artifact media type");
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 256 * 1024 * 1024)
    throw new Error("Artifact exceeds 256 MiB or has invalid bytes");
  if (
    input.sourceDocumentId !== undefined &&
    (typeof input.sourceDocumentId !== "string" || input.sourceDocumentId.length > 256)
  )
    throw new Error("Invalid source document ID");
}
