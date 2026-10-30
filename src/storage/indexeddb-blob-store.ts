import type { BlobHash, BlobStore } from "@/document";

import { hashBlob } from "@/document";

const databaseVersion = 1;
const blobsStoreName = "blobs";

/**
 * A blob store in the browser's IndexedDB: the local cache for pixel blobs, so documents open
 * offline and unchanged images aren't downloaded twice. Blobs are keyed by hash and immutable,
 * so entries never need updating.
 */
export class IndexedDbBlobStore implements BlobStore {
  #database: Promise<IDBDatabase> | undefined;
  readonly #databaseName: string;
  readonly #factory: IDBFactory | undefined;

  /** `factory` defaults to the browser's IndexedDB; tests pass an in-memory one. */
  constructor(options: { databaseName?: string; factory?: IDBFactory } = {}) {
    this.#databaseName = options.databaseName ?? "kpixel";
    this.#factory = options.factory;
  }

  async get(hash: BlobHash): Promise<Uint8Array | undefined> {
    const value = await this.#request("readonly", (store) => store.get(hash));
    return value instanceof Uint8Array ? value : undefined;
  }

  async has(hash: BlobHash): Promise<boolean> {
    const count = await this.#request("readonly", (store) => store.count(hash));
    return count > 0;
  }

  async put(bytes: Uint8Array): Promise<BlobHash> {
    const hash = await hashBlob(bytes);
    await this.#request("readwrite", (store) => store.put(bytes, hash));
    return hash;
  }

  /** Closes the connection; the next call reopens it. */
  async close(): Promise<void> {
    const database = await this.#database;
    database?.close();
    this.#database = undefined;
  }

  #open(): Promise<IDBDatabase> {
    this.#database ??= new Promise((resolve, reject) => {
      // Resolved here rather than in the constructor, so constructing a store during
      // server rendering, where there is no IndexedDB, doesn't throw.
      const factory = this.#factory ?? globalThis.indexedDB;
      if (!factory) {
        reject(new Error("IndexedDB isn't available in this environment"));
        return;
      }
      const request = factory.open(this.#databaseName, databaseVersion);
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore(blobsStoreName);
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    return this.#database;
  }

  async #request<T>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(blobsStoreName, mode);
      const request = makeRequest(transaction.objectStore(blobsStoreName));
      transaction.addEventListener("complete", () => resolve(request.result));
      transaction.addEventListener("error", () => reject(transaction.error));
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
  }
}
