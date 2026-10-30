import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import type { BlobHash, BlobStore } from "./blobs";
import type { CelData, SpriteDocument } from "./schema";

import { BlobHashSchema, hashBlob } from "./blobs";
import { FileFormatError, WireFormatError } from "./errors";
import { assertValidDocument } from "./invariants";
import { migrateStoredDocument } from "./migrations";
import { CelDataSchema, PixelImageSchema, SpriteDocumentSchema } from "./schema";

// The stored form of a document, used for files and persistence: the same JSON as the wire
// form, except that each image refers to its pixels by blob hash instead of embedding them.
// Pixels live alongside as content-addressed blobs, so unchanged images are never rewritten.

const { pixels: _inlinePixels, ...imageProperties } = PixelImageSchema.properties;

export const StoredPixelImageSchema = Type.Object({ ...imageProperties, blob: BlobHashSchema });

export const StoredCelDataSchema = Type.Object({
  ...CelDataSchema.properties,
  image: StoredPixelImageSchema,
});

export const StoredSpriteDocumentSchema = Type.Object({
  ...SpriteDocumentSchema.properties,
  celData: Type.Record(Type.String(), StoredCelDataSchema),
});

export type StoredSpriteDocument = Static<typeof StoredSpriteDocumentSchema>;
type StoredCelData = Static<typeof StoredCelDataSchema>;

/** Splits a document into its stored form and the pixel blobs it references. */
export async function toStoredDocument(
  document: SpriteDocument,
): Promise<{ document: StoredSpriteDocument; blobs: Map<BlobHash, Uint8Array> }> {
  const blobs = new Map<BlobHash, Uint8Array>();
  const entries = await Promise.all(
    Object.entries(document.celData).map(async ([id, data]) => {
      const { pixels, ...image } = data.image;
      const blob = await hashBlob(pixels);
      blobs.set(blob, pixels);
      const stored: StoredCelData = { ...data, image: { ...image, blob } };
      return [id, stored] as const;
    }),
  );
  return { document: { ...document, celData: Object.fromEntries(entries) }, blobs };
}

/** Migrates untrusted stored JSON to the current schema version and validates its shape. */
export function parseStoredDocument(input: unknown): StoredSpriteDocument {
  const stored = migrateStoredDocument(input);
  if (!Value.Check(StoredSpriteDocumentSchema, stored)) {
    const problems = Value.Errors(StoredSpriteDocumentSchema, stored).map(
      (error) => `${error.instancePath || "/"} ${error.message}`,
    );
    throw new WireFormatError("stored document", problems);
  }
  return stored;
}

/** The blob hashes a stored document references, without duplicates. */
export function blobHashesOf(document: StoredSpriteDocument): BlobHash[] {
  return [...new Set(Object.values(document.celData).map((data) => data.image.blob))];
}

/**
 * Rebuilds a document from untrusted stored JSON and its blobs: migrates and validates it,
 * attaches the pixels, and checks every document rule.
 */
export function fromStoredDocument(
  input: unknown,
  blobs: ReadonlyMap<BlobHash, Uint8Array>,
): SpriteDocument {
  return attachPixels(parseStoredDocument(input), blobs);
}

/** Saves a document's pixel blobs to a blob store and returns its stored form. */
export async function saveToBlobStore(
  document: SpriteDocument,
  store: BlobStore,
): Promise<StoredSpriteDocument> {
  const { document: stored, blobs } = await toStoredDocument(document);
  await Promise.all(
    [...blobs].map(async ([hash, bytes]) => {
      if (!(await store.has(hash))) {
        await store.put(bytes);
      }
    }),
  );
  return stored;
}

/** Loads a stored document, fetching the pixel blobs it references from a blob store. */
export async function loadFromBlobStore(input: unknown, store: BlobStore): Promise<SpriteDocument> {
  const stored = parseStoredDocument(input);
  const blobs = new Map<BlobHash, Uint8Array>();
  await Promise.all(
    blobHashesOf(stored).map(async (hash) => {
      const bytes = await store.get(hash);
      if (bytes) {
        blobs.set(hash, bytes);
      }
    }),
  );
  return attachPixels(stored, blobs);
}

function attachPixels(
  stored: StoredSpriteDocument,
  blobs: ReadonlyMap<BlobHash, Uint8Array>,
): SpriteDocument {
  const celData: Record<string, CelData> = {};
  for (const [id, data] of Object.entries(stored.celData)) {
    const { blob, ...image } = data.image;
    const pixels = blobs.get(blob);
    if (!pixels) {
      throw new FileFormatError(`pixel data ${blob} for cel data ${id} is missing`);
    }
    celData[id] = { ...data, image: { ...image, pixels } };
  }
  const document: SpriteDocument = { ...stored, celData };
  assertValidDocument(document);
  return document;
}
