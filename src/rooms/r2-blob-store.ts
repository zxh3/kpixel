import type { BlobHash, BlobStore } from "@/document";

import { hashBlob } from "@/document";

/**
 * Pixel blobs in an R2 bucket, keyed by hash under `blobs/`. Blobs never change once written,
 * so they can be cached forever and copied between buckets safely.
 */
export class R2BlobStore implements BlobStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async get(hash: BlobHash): Promise<Uint8Array | undefined> {
    const object = await this.#bucket.get(blobKey(hash));
    return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
  }

  async has(hash: BlobHash): Promise<boolean> {
    return (await this.#bucket.head(blobKey(hash))) !== null;
  }

  async put(bytes: Uint8Array): Promise<BlobHash> {
    const hash = await hashBlob(bytes);
    await this.#bucket.put(blobKey(hash), bytes, {
      httpMetadata: {
        contentType: "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return hash;
  }
}

function blobKey(hash: BlobHash): string {
  return `blobs/${hash}`;
}
