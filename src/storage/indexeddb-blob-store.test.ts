import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";

import { hashBlob } from "@/document";

import { IndexedDbBlobStore } from "./indexeddb-blob-store";

describe("IndexedDbBlobStore", () => {
  test("stores blobs by hash and reads them back after reconnecting", async () => {
    const factory = new IDBFactory();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const writer = new IndexedDbBlobStore({ factory });
    const hash = await writer.put(bytes);
    expect(hash).toBe(await hashBlob(bytes));
    expect(await writer.has(hash)).toBe(true);
    await writer.close();

    const reader = new IndexedDbBlobStore({ factory });
    expect(await reader.get(hash)).toEqual(bytes);
    await reader.close();
  });

  test("unknown hashes are absent", async () => {
    const store = new IndexedDbBlobStore({ factory: new IDBFactory() });
    const missing = "0".repeat(64);
    expect(await store.has(missing)).toBe(false);
    expect(await store.get(missing)).toBeUndefined();
    await store.close();
  });

  test("putting the same bytes twice returns the same hash", async () => {
    const store = new IndexedDbBlobStore({ factory: new IDBFactory() });
    const first = await store.put(new Uint8Array([7, 7]));
    expect(await store.put(new Uint8Array([7, 7]))).toBe(first);
    await store.close();
  });
});
