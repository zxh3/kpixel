import type { BlobHash, BlobStore } from "@/document";

/**
 * Remembers which blobs are known to be stored, so saving a document doesn't ask the underlying
 * store about every image on every commit. Safe because blobs are immutable and content-addressed:
 * once stored, a blob stays the same.
 */
export class KnownBlobStore implements BlobStore {
  readonly #store: BlobStore;
  readonly #known = new Set<BlobHash>();

  constructor(store: BlobStore) {
    this.#store = store;
  }

  async get(hash: BlobHash): Promise<Uint8Array | undefined> {
    const bytes = await this.#store.get(hash);
    if (bytes) this.#known.add(hash);
    return bytes;
  }

  async has(hash: BlobHash): Promise<boolean> {
    if (this.#known.has(hash)) return true;
    const stored = await this.#store.has(hash);
    if (stored) this.#known.add(hash);
    return stored;
  }

  async put(bytes: Uint8Array): Promise<BlobHash> {
    const hash = await this.#store.put(bytes);
    this.#known.add(hash);
    return hash;
  }
}
