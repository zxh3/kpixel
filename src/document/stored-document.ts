import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import type { BlobHash, BlobStore } from "./blobs";
import type { CelData, PixelImage, SpriteDocument, Tileset } from "./schema";

import { BlobHashSchema, hashBlob } from "./blobs";
import { FileFormatError, WireFormatError } from "./errors";
import { assertValidDocument } from "./invariants";
import { migrateStoredDocument } from "./migrations";
import {
  CelDataSchema,
  PixelImageSchema,
  SpriteDocumentSchema,
  TileSchema,
  TilesetSchema,
} from "./schema";

// The stored form of a document, used for files and persistence: the same JSON as the wire
// form, except that each image (in cel data and in tilesets) refers to its pixels by blob hash
// instead of embedding them. Pixels live alongside as content-addressed blobs, so unchanged
// images are never rewritten.

const { pixels: _inlinePixels, ...imageProperties } = PixelImageSchema.properties;

export const StoredPixelImageSchema = Type.Object({ ...imageProperties, blob: BlobHashSchema });

export const StoredCelDataSchema = Type.Object({
  ...CelDataSchema.properties,
  image: StoredPixelImageSchema,
});

export const StoredTilesetSchema = Type.Object({
  ...TilesetSchema.properties,
  tiles: Type.Array(Type.Object({ ...TileSchema.properties, image: StoredPixelImageSchema }), {
    minItems: 1,
  }),
});

export const StoredSpriteDocumentSchema = Type.Object({
  ...SpriteDocumentSchema.properties,
  celData: Type.Record(Type.String(), StoredCelDataSchema),
  tilesets: Type.Array(StoredTilesetSchema),
});

export type StoredSpriteDocument = Static<typeof StoredSpriteDocumentSchema>;
type StoredPixelImage = Static<typeof StoredPixelImageSchema>;

/** Splits a document into its stored form and the pixel blobs it references. */
export async function toStoredDocument(
  document: SpriteDocument,
): Promise<{ document: StoredSpriteDocument; blobs: Map<BlobHash, Uint8Array> }> {
  const blobs = new Map<BlobHash, Uint8Array>();
  const store = async ({ pixels, ...image }: PixelImage): Promise<StoredPixelImage> => {
    const blob = await hashBlob(pixels);
    blobs.set(blob, pixels);
    return { ...image, blob };
  };
  const celData = await Promise.all(
    Object.entries(document.celData).map(
      async ([id, data]) => [id, { ...data, image: await store(data.image) }] as const,
    ),
  );
  const tilesets = await Promise.all(
    document.tilesets.map(async (tileset) => ({
      ...tileset,
      tiles: await Promise.all(
        tileset.tiles.map(async (tile) => ({ ...tile, image: await store(tile.image) })),
      ),
    })),
  );
  return { document: { ...document, celData: Object.fromEntries(celData), tilesets }, blobs };
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
  return [
    ...new Set([
      ...Object.values(document.celData).map((data) => data.image.blob),
      ...document.tilesets.flatMap((tileset) => tileset.tiles.map((tile) => tile.image.blob)),
    ]),
  ];
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
  const attach = ({ blob, ...image }: StoredPixelImage, owner: string): PixelImage => {
    const pixels = blobs.get(blob);
    if (!pixels) {
      throw new FileFormatError(`pixel data ${blob} for ${owner} is missing`);
    }
    return { ...image, pixels };
  };
  const celData: Record<string, CelData> = {};
  for (const [id, data] of Object.entries(stored.celData)) {
    celData[id] = { ...data, image: attach(data.image, `cel data ${id}`) };
  }
  const tilesets: Tileset[] = stored.tilesets.map((tileset) => ({
    ...tileset,
    tiles: tileset.tiles.map((tile, index) => ({
      ...tile,
      image: attach(tile.image, `tile ${index} of tileset ${tileset.id}`),
    })),
  }));
  const document: SpriteDocument = { ...stored, celData, tilesets };
  assertValidDocument(document);
  return document;
}
