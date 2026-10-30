import { Type } from "typebox";

// Pixel data is stored as content-addressed blobs: a blob's key is the SHA-256 of its bytes.
// Identical images are stored once, blobs never change once written, and any copy can be
// checked against its key. Hashing uses WebCrypto, available in browsers, Workers and Node.

/** The lowercase hex SHA-256 of a blob's bytes. */
export type BlobHash = string;

export const BlobHashSchema = Type.String({
  pattern: "^[0-9a-f]{64}$",
  description: "SHA-256 of the blob's bytes, as lowercase hex",
});

export async function hashBlob(bytes: Uint8Array): Promise<BlobHash> {
  // Copy into a fresh ArrayBuffer: digest() rejects views over SharedArrayBuffer.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Somewhere blobs can be read from and written to: memory, IndexedDB, R2. */
export interface BlobStore {
  get(hash: BlobHash): Promise<Uint8Array | undefined>;
  has(hash: BlobHash): Promise<boolean>;
  /** Stores the bytes if they aren't stored yet, and returns their hash. */
  put(bytes: Uint8Array): Promise<BlobHash>;
}

export class MemoryBlobStore implements BlobStore {
  #blobs = new Map<BlobHash, Uint8Array>();

  async get(hash: BlobHash): Promise<Uint8Array | undefined> {
    return this.#blobs.get(hash);
  }

  async has(hash: BlobHash): Promise<boolean> {
    return this.#blobs.has(hash);
  }

  async put(bytes: Uint8Array): Promise<BlobHash> {
    const hash = await hashBlob(bytes);
    if (!this.#blobs.has(hash)) {
      this.#blobs.set(hash, bytes);
    }
    return hash;
  }

  get size(): number {
    return this.#blobs.size;
  }
}
