import * as fc from "fast-check";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";

import type { SpriteDocument } from "./schema";

import { MemoryBlobStore } from "./blobs";
import { createDocument } from "./create-document";
import { FileFormatError } from "./errors";
import { createId } from "./ids";
import { NativeFileManifestSchema, readNativeFile, writeNativeFile } from "./native-file";
import { loadFromBlobStore, saveToBlobStore } from "./stored-document";
import { firstFrameId, firstLayerId, newCelData } from "./test-support/builders";
import { editedDocumentArbitrary } from "./test-support/random-documents";
import { applyOperations } from "./transaction";

/** A document with the same pixels in two cels on different frames. */
function documentWithDuplicatePixels(): SpriteDocument {
  const document = createDocument({ width: 8, height: 8 });
  const secondFrame = { id: createId(), durationMs: 100 };
  const layerId = firstLayerId(document);
  const first = newCelData(document);
  const second = newCelData(document);
  return applyOperations(document, [
    { type: "addFrame", frame: secondFrame, index: 1 },
    {
      type: "addCel",
      cel: {
        id: createId(),
        layerId,
        frameId: firstFrameId(document),
        celDataId: first.id,
        zIndex: 0,
      },
      celData: first,
    },
    {
      type: "addCel",
      cel: { id: createId(), layerId, frameId: secondFrame.id, celDataId: second.id, zIndex: 0 },
      celData: second,
    },
  ]).document;
}

function readEntries(file: Uint8Array) {
  return unzipSync(file);
}

function rezip(entries: Record<string, Uint8Array>) {
  return zipSync(entries);
}

describe("native .kpixel files", () => {
  test("any document round-trips exactly", async () => {
    await fc.assert(
      fc.asyncProperty(editedDocumentArbitrary, async (document) => {
        expect(await readNativeFile(await writeNativeFile(document))).toStrictEqual(document);
      }),
    );
  });

  test("the same document always produces the same bytes", async () => {
    const document = documentWithDuplicatePixels();
    expect(await writeNativeFile(document)).toEqual(await writeNativeFile(document));
  });

  test("identical pixels are stored once", async () => {
    const entries = readEntries(await writeNativeFile(documentWithDuplicatePixels()));
    const blobPaths = Object.keys(entries).filter((path) => path.startsWith("blobs/"));
    expect(blobPaths).toHaveLength(1);
  });

  test("the manifest is readable JSON that matches the published schema", async () => {
    const entries = readEntries(await writeNativeFile(createDocument({ width: 4, height: 4 })));
    const manifest: unknown = JSON.parse(strFromU8(entries["manifest.json"]!));
    expect(manifest).toMatchObject({ format: "kpixel", formatVersion: 1 });
  });

  test("the published JSON Schema is up to date", async () => {
    // Regenerate with `pnpm test -u` after changing the stored document shape.
    await expect(`${JSON.stringify(NativeFileManifestSchema, null, 2)}\n`).toMatchFileSnapshot(
      "../../docs/schemas/kpixel-file-v1.schema.json",
    );
  });
});

describe("reading damaged or foreign files", () => {
  test("bytes that aren't a zip archive", async () => {
    await expect(readNativeFile(strToU8("not a zip"))).rejects.toThrow(/valid zip archive/);
  });

  test("a zip without a manifest", async () => {
    await expect(readNativeFile(rezip({ "readme.txt": strToU8("hi") }))).rejects.toThrow(
      /manifest.json is missing/,
    );
  });

  test("a blob whose content doesn't match its name", async () => {
    const entries = readEntries(await writeNativeFile(documentWithDuplicatePixels()));
    const blobPath = Object.keys(entries).find((path) => path.startsWith("blobs/"))!;
    entries[blobPath] = new Uint8Array(entries[blobPath]!.length).fill(42);
    await expect(readNativeFile(rezip(entries))).rejects.toThrow(/is corrupt/);
  });

  test("a missing blob", async () => {
    const entries = readEntries(await writeNativeFile(documentWithDuplicatePixels()));
    const blobPath = Object.keys(entries).find((path) => path.startsWith("blobs/"))!;
    delete entries[blobPath];
    await expect(readNativeFile(rezip(entries))).rejects.toThrow(/is missing/);
  });

  test("a file from a newer kpixel", async () => {
    const entries = readEntries(await writeNativeFile(createDocument({ width: 4, height: 4 })));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!));

    const newerFormat = { ...manifest, formatVersion: 2 };
    await expect(
      readNativeFile(rezip({ ...entries, "manifest.json": strToU8(JSON.stringify(newerFormat)) })),
    ).rejects.toThrow(/update kpixel/);

    const newerSchema = { ...manifest, document: { ...manifest.document, schemaVersion: 99 } };
    await expect(
      readNativeFile(rezip({ ...entries, "manifest.json": strToU8(JSON.stringify(newerSchema)) })),
    ).rejects.toThrow(/update kpixel/);
  });

  test("contents larger than the limit", async () => {
    const file = await writeNativeFile(documentWithDuplicatePixels());
    await expect(readNativeFile(file, { maxContentBytes: 100 })).rejects.toThrow(FileFormatError);
  });
});

describe("blob store persistence", () => {
  test("documents saved to a blob store load back exactly, sharing unchanged blobs", async () => {
    await fc.assert(
      fc.asyncProperty(editedDocumentArbitrary, async (document) => {
        const store = new MemoryBlobStore();
        const stored = await saveToBlobStore(document, store);
        const blobCount = store.size;
        await saveToBlobStore(document, store);
        expect(store.size).toBe(blobCount);
        expect(await loadFromBlobStore(JSON.parse(JSON.stringify(stored)), store)).toStrictEqual(
          document,
        );
      }),
      { numRuns: 50 },
    );
  });
});
