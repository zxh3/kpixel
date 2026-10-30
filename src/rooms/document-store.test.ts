import * as fc from "fast-check";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

import type { BlobStore, SpriteDocument, Transaction } from "@/document";

import { createDocument, createId, DocumentSession, MemoryBlobStore } from "@/document";
import { drawOperations } from "@/document/test-support/random-operations";

import { DocumentStore } from "./document-store";
import { KnownBlobStore } from "./known-blob-store";
import { nodeSqlDatabase } from "./test-support/node-sql-database";

const actor = { kind: "user", id: "test-user" } as const;

/** Storage that outlives any one DocumentStore, like a Durable Object's storage and R2. */
function newStorage() {
  return { database: new DatabaseSync(":memory:"), blobs: new MemoryBlobStore() };
}

function openStore(storage: ReturnType<typeof newStorage>, blobs: BlobStore = storage.blobs) {
  return new DocumentStore(nodeSqlDatabase(storage.database), blobs);
}

function addFrame(baseVersion: number, id = createId()): Transaction {
  return {
    id,
    label: "Add frame",
    actor,
    baseVersion,
    operations: [{ type: "addFrame", frame: { id: createId(), durationMs: 80 }, index: 1 }],
  };
}

/** A transaction that paints one cel, so pixels flow through the log and blob store. */
function addCel(
  document: SpriteDocument,
  baseVersion: number,
  fill: number,
  frameId = document.frames[0]!.id,
): Transaction {
  const celDataId = createId();
  return {
    id: createId(),
    label: "Paint",
    actor,
    baseVersion,
    operations: [
      {
        type: "addCel",
        cel: {
          id: createId(),
          layerId: document.rootLayerIds[0]!,
          frameId,
          celDataId,
          zIndex: 0,
        },
        celData: {
          id: celDataId,
          x: 0,
          y: 0,
          opacity: 255,
          image: { width: 2, height: 2, format: "rgba8", pixels: new Uint8Array(16).fill(fill) },
          provenance: { origin: "human" },
        },
      },
    ],
  };
}

describe("DocumentStore", () => {
  test("creates a document once and loads it back", async () => {
    const store = openStore(newStorage());
    const document = createDocument({ width: 8, height: 8 });
    expect(await store.load()).toBeUndefined();
    expect(await store.create(document)).toBe(true);
    expect(await store.create(createDocument({ width: 4, height: 4 }))).toBe(false);
    expect(await store.load()).toEqual({ document, version: 0 });
  });

  test("commits advance the version, and a cold start reloads the same document", async () => {
    const storage = newStorage();
    const store = openStore(storage);
    const document = createDocument({ width: 8, height: 8 });
    await store.create(document);
    expect(await store.commit(addCel(document, 0, 7))).toEqual({ status: "committed", version: 1 });
    expect(await store.commit(addFrame(1))).toEqual({ status: "committed", version: 2 });

    // A new store over the same storage, as after the Durable Object is evicted.
    const reopened = openStore(storage);
    expect(await reopened.load()).toStrictEqual(await store.load());
  });

  test("a transaction built on an old version is a conflict, and changes nothing", async () => {
    const store = openStore(newStorage());
    await store.create(createDocument({ width: 8, height: 8 }));
    await store.commit(addFrame(0));
    expect(await store.commit(addFrame(0))).toEqual({ status: "conflict", version: 1 });
    expect((await store.load())?.version).toBe(1);
    expect(await store.transactionsSince(0)).toHaveLength(1);
  });

  test("operations that don't apply are rejected, and change nothing", async () => {
    const store = openStore(newStorage());
    await store.create(createDocument({ width: 8, height: 8 }));
    const invalid: Transaction = {
      ...addFrame(0),
      operations: [{ type: "removeFrame", frameId: "no-such-frame" }],
    };
    expect(await store.commit(invalid)).toMatchObject({
      status: "rejected",
      reason: expect.stringMatching(/doesn't exist/),
    });
    expect((await store.load())?.version).toBe(0);
    expect(await store.transactionsSince(0)).toEqual([]);
  });

  test("retrying an applied transaction returns its result instead of applying it twice", async () => {
    const store = openStore(newStorage());
    await store.create(createDocument({ width: 8, height: 8 }));
    const transaction = addFrame(0, "retry-me");
    expect(await store.commit(transaction)).toEqual({ status: "committed", version: 1 });
    expect(await store.commit(transaction)).toEqual({ status: "committed", version: 1 });
    expect((await store.load())?.document.frames).toHaveLength(2);
  });

  test("if pixel storage fails mid-commit, nothing is persisted", async () => {
    const storage = newStorage();
    const document = createDocument({ width: 8, height: 8 });
    await openStore(storage).create(document);

    const failing: BlobStore = {
      get: (hash) => storage.blobs.get(hash),
      has: (hash) => storage.blobs.has(hash),
      put: () => Promise.reject(new Error("R2 is unavailable")),
    };
    await expect(openStore(storage, failing).commit(addCel(document, 0, 9))).rejects.toThrow(
      /unavailable/,
    );

    const reopened = openStore(storage);
    expect((await reopened.load())?.version).toBe(0);
    expect(await reopened.transactionsSince(0)).toEqual([]);
  });

  test("identical pixels are stored once", async () => {
    const storage = newStorage();
    const store = openStore(storage);
    const document = createDocument({ width: 8, height: 8 });
    await store.create(document);
    await store.commit(addCel(document, 0, 5));
    const blobCount = storage.blobs.size;

    // The same pixels again, in a new cel on a new frame.
    const secondFrame = { id: createId(), durationMs: 80 };
    await store.commit({
      ...addFrame(1),
      operations: [{ type: "addFrame", frame: secondFrame, index: 1 }],
    });
    const result = await store.commit(addCel(document, 2, 5, secondFrame.id));
    expect(result).toEqual({ status: "committed", version: 3 });
    expect(storage.blobs.size).toBe(blobCount);
  });

  test("random editing sessions are mirrored exactly, and the log replays to the same document", async () => {
    await fc.assert(
      fc.asyncProperty(fc.gen(), fc.integer({ min: 1, max: 25 }), async (generate, steps) => {
        const storage = newStorage();
        const store = openStore(storage);
        const client = new DocumentSession(createDocument({ width: 8, height: 8 }));
        const initial = client.document;
        await store.create(initial);

        for (let step = 0; step < steps; step++) {
          try {
            const transaction = client.commit({
              label: `step ${step}`,
              actor,
              operations: drawOperations(generate, client.document),
            });
            // Commits must apply in order, so await each before the next.
            // oxlint-disable-next-line eslint/no-await-in-loop
            expect(await store.commit(transaction)).toEqual({
              status: "committed",
              version: client.version,
            });
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !/^(OperationError|DocumentInvariantError)$/.test(error.name)
            )
              throw error;
          }
        }

        expect((await openStore(storage).load())?.document).toStrictEqual(client.document);
        const replica = new DocumentSession(initial);
        for (const transaction of await openStore(storage).transactionsSince(0)) {
          replica.applyTransaction(transaction);
        }
        expect(replica.document).toStrictEqual(client.document);
      }),
      { numRuns: 40 },
    );
  });
});

describe("KnownBlobStore", () => {
  test("asks the underlying store about each blob at most once", async () => {
    const inner = new MemoryBlobStore();
    let checks = 0;
    const counting: BlobStore = {
      get: (hash) => inner.get(hash),
      has: (hash) => {
        checks += 1;
        return inner.has(hash);
      },
      put: (bytes) => inner.put(bytes),
    };
    const store = new KnownBlobStore(counting);
    const hash = await inner.put(new Uint8Array([1, 2, 3]));
    expect(await store.has(hash)).toBe(true);
    expect(await store.has(hash)).toBe(true);
    expect(checks).toBe(1);
  });
});
