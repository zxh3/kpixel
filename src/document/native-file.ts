import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Type } from "typebox";

import type { BlobHash } from "./blobs";
import type { SpriteDocument } from "./schema";

import { hashBlob } from "./blobs";
import { FileFormatError } from "./errors";
import {
  fromStoredDocument,
  StoredSpriteDocumentSchema,
  toStoredDocument,
} from "./stored-document";

// The native .kpixel file: a zip archive holding
//
//   manifest.json   the stored document plus format metadata (see NativeFileManifestSchema)
//   blobs/<hash>    raw pixel bytes, named by their SHA-256
//
// A zip keeps the manifest readable with standard tools, compresses pixels well, and lets
// later versions add entries (previews, history) that older readers ignore.

export const NATIVE_FILE_EXTENSION = ".kpixel";
export const NATIVE_FILE_MIME_TYPE = "application/vnd.kpixel+zip";

/** The container version. It changes only when the archive layout changes, not the document. */
export const NATIVE_FORMAT_VERSION = 1;

/** Reading stops past this many uncompressed bytes, to protect against zip bombs. */
export const maxNativeFileContentBytes = 512 * 1024 * 1024;

const manifestPath = "manifest.json";
const blobDirectory = "blobs/";

// Zip entries carry a modification time. A fixed one makes identical documents produce
// identical files, which keeps saves deterministic and diffable. Zip stores local time, so
// build the date from local components: it then encodes the same in every time zone.
const fixedModificationTime = new Date(2000, 0, 1);

export const NativeFileManifestSchema = Type.Object(
  {
    format: Type.Literal("kpixel"),
    formatVersion: Type.Literal(NATIVE_FORMAT_VERSION),
    document: StoredSpriteDocumentSchema,
  },
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "kpixel-file-v1.schema.json",
    title: "kpixel file manifest",
    description:
      "manifest.json inside a .kpixel zip archive. Image pixels are stored next to it as blobs/<sha256>.",
  },
);

export async function writeNativeFile(document: SpriteDocument): Promise<Uint8Array> {
  const { document: stored, blobs } = await toStoredDocument(document);
  const manifest = { format: "kpixel", formatVersion: NATIVE_FORMAT_VERSION, document: stored };
  const entries: Record<string, Uint8Array> = {
    [manifestPath]: strToU8(JSON.stringify(manifest, null, 2)),
  };
  for (const [hash, bytes] of blobs) {
    entries[blobDirectory + hash] = bytes;
  }
  return zipSync(entries, { level: 6, mtime: fixedModificationTime });
}

/**
 * Opens a .kpixel file. Checks the archive, migrates the document to the current schema,
 * verifies every pixel blob against its hash, and validates the result.
 */
export async function readNativeFile(
  bytes: Uint8Array,
  options: { maxContentBytes?: number } = {},
): Promise<SpriteDocument> {
  const entries = unzipWithinLimit(bytes, options.maxContentBytes ?? maxNativeFileContentBytes);

  const manifestBytes = entries[manifestPath];
  if (!manifestBytes) {
    throw new FileFormatError("manifest.json is missing; this isn't a kpixel file");
  }
  const manifest = parseJson(strFromU8(manifestBytes));
  if (manifest?.format !== "kpixel") {
    throw new FileFormatError("manifest.json doesn't describe a kpixel file");
  }
  const { formatVersion } = manifest;
  if (typeof formatVersion !== "number" || formatVersion > NATIVE_FORMAT_VERSION) {
    throw new FileFormatError(
      `the file uses format version ${String(formatVersion)}; update kpixel to open it`,
    );
  }

  const blobs = new Map<BlobHash, Uint8Array>();
  await Promise.all(
    Object.entries(entries)
      .filter(([path]) => path.startsWith(blobDirectory))
      .map(async ([path, content]) => {
        const hash = path.slice(blobDirectory.length);
        if ((await hashBlob(content)) !== hash) {
          throw new FileFormatError(`${path} is corrupt: its content doesn't match its hash`);
        }
        blobs.set(hash, content);
      }),
  );

  return fromStoredDocument(manifest.document, blobs);
}

function unzipWithinLimit(bytes: Uint8Array, maxContentBytes: number): Record<string, Uint8Array> {
  let declaredBytes = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        declaredBytes += file.originalSize;
        if (declaredBytes > maxContentBytes) {
          throw new FileFormatError("the file's contents are too large");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof FileFormatError) {
      throw error;
    }
    throw new FileFormatError("the file isn't a valid zip archive");
  }
  // Sizes in the zip headers can lie, so check what was actually extracted too.
  const actualBytes = Object.values(entries).reduce((sum, entry) => sum + entry.length, 0);
  if (actualBytes > maxContentBytes) {
    throw new FileFormatError("the file's contents are too large");
  }
  return entries;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : undefined;
  } catch {
    throw new FileFormatError("manifest.json isn't valid JSON");
  }
}
