import { expect, test, type APIRequestContext } from "@playwright/test";

import type { Operation, SpriteDocument } from "@/document";

import {
  createDocument,
  createId,
  decodeDocument,
  decodeTransaction,
  DocumentSession,
  encodeDocument,
  encodeTransaction,
} from "@/document";

// The document API end to end, in the Workers runtime: HTTP route → DocumentRoom Durable Object →
// SQLite and R2 (emulated locally by `vite preview`).

const actor = { kind: "user", id: "e2e" } as const;

async function createRemote(request: APIRequestContext, document: SpriteDocument) {
  const response = await request.post("/api/documents", {
    data: { document: encodeDocument(document) },
  });
  expect(response.status()).toBe(201);
  return document.id;
}

async function loadRemote(request: APIRequestContext, documentId: string) {
  const response = await request.get(`/api/documents/${documentId}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(typeof body.version).toBe("number");
  return { document: decodeDocument(body.document), version: Number(body.version) };
}

function paintOperation(document: SpriteDocument, fill: number): Operation {
  const celDataId = createId();
  return {
    type: "addCel",
    cel: {
      id: createId(),
      layerId: document.rootLayerIds[0]!,
      frameId: document.frames[0]!.id,
      celDataId,
      zIndex: 0,
    },
    celData: {
      id: celDataId,
      x: 1,
      y: 1,
      opacity: 255,
      image: { width: 3, height: 2, format: "rgba8", pixels: new Uint8Array(24).fill(fill) },
      provenance: { origin: "human" },
    },
  };
}

test("documents are created, edited and loaded back through their Durable Object", async ({
  request,
}) => {
  const session = new DocumentSession(createDocument({ width: 16, height: 16 }));
  const initial = session.document;
  const documentId = await createRemote(request, initial);
  expect(await loadRemote(request, documentId)).toEqual({ document: initial, version: 0 });

  const paint = session.commit({
    label: "Paint",
    actor,
    operations: [paintOperation(session.document, 200)],
  });
  const addFrame = session.commit({
    label: "Add frame",
    actor,
    operations: [{ type: "addFrame", frame: { id: createId(), durationMs: 120 }, index: 1 }],
  });
  for (const transaction of [paint, addFrame]) {
    // Transactions must arrive in order, so send them one at a time.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const response = await request.post(`/api/documents/${documentId}/transactions`, {
      data: encodeTransaction(transaction),
    });
    expect(response.status()).toBe(200);
  }

  // The stored document, pixels included, matches the client's.
  expect(await loadRemote(request, documentId)).toEqual({ document: session.document, version: 2 });

  // The log replays to the same document.
  const history = await request.get(`/api/documents/${documentId}/transactions?since=0`);
  const { transactions } = await history.json();
  const replica = new DocumentSession(initial);
  for (const encoded of transactions) {
    replica.applyTransaction(decodeTransaction(encoded));
  }
  expect(replica.document).toEqual(session.document);
});

test("retries are safe, stale and invalid transactions are refused", async ({ request }) => {
  const session = new DocumentSession(createDocument({ width: 8, height: 8 }));
  const documentId = await createRemote(request, session.document);
  const url = `/api/documents/${documentId}/transactions`;

  const transaction = session.commit({
    label: "Add frame",
    actor,
    operations: [{ type: "addFrame", frame: { id: createId(), durationMs: 80 }, index: 1 }],
  });
  const first = await request.post(url, { data: encodeTransaction(transaction) });
  const retry = await request.post(url, { data: encodeTransaction(transaction) });
  expect([first.status(), await first.json()]).toEqual([200, { version: 1 }]);
  expect([retry.status(), await retry.json()]).toEqual([200, { version: 1 }]);

  const stale = await request.post(url, {
    data: encodeTransaction({ ...transaction, id: createId(), baseVersion: 0 }),
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ version: 1 });

  const invalid = await request.post(url, {
    data: encodeTransaction({
      ...transaction,
      id: createId(),
      baseVersion: 1,
      operations: [{ type: "removeFrame", frameId: "no-such-frame" }],
    }),
  });
  expect(invalid.status()).toBe(400);

  const malformed = await request.post(url, { data: { type: "not a transaction" } });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).error).toMatch(/Invalid transaction/);

  expect((await loadRemote(request, documentId)).version).toBe(1);
});

test("unknown and invalid documents are refused", async ({ request }) => {
  expect((await request.get(`/api/documents/${createId()}`)).status()).toBe(404);
  expect((await request.get("/api/documents/not-a-uuid")).status()).toBe(404);

  const document = createDocument({ width: 4, height: 4 });
  await createRemote(request, document);
  const duplicate = await request.post("/api/documents", {
    data: { document: encodeDocument(document) },
  });
  expect(duplicate.status()).toBe(409);

  const broken = await request.post("/api/documents", {
    data: {
      document: { ...encodeDocument(createDocument({ width: 4, height: 4 })), rootLayerIds: [] },
    },
  });
  expect(broken.status()).toBe(400);
});

test("a blank document can be created from settings", async ({ request }) => {
  const response = await request.post("/api/documents", {
    data: { width: 24, height: 12, colorMode: "indexed" },
  });
  expect(response.status()).toBe(201);
  const { documentId } = await response.json();
  const { document } = await loadRemote(request, documentId);
  expect(document).toMatchObject({ width: 24, height: 12, colorMode: "indexed" });
});
