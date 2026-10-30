import type { PixelImage, PixelOrigin, Provenance } from "../../schema";

// Provenance survives a trip through Aseprite as an extension property map on each cel, with a
// checksum of the pixels. Aseprite keeps extension properties it doesn't understand, so on
// reopening kpixel can tell whether the pixels were edited in the meantime.

/** The user-data namespace (an Aseprite extension id) holding kpixel provenance. */
export const provenanceNamespace = "kpixel/provenance";

/** A fast, non-cryptographic checksum (FNV-1a) of an image's size and pixels. */
export function pixelChecksum(image: PixelImage): string {
  let hash = 0x81_1c_9d_c5;
  const mix = (byte: number) => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01_00_01_93);
  };
  for (const value of [image.width, image.height]) {
    mix(value & 0xff);
    mix(value >>> 8);
  }
  for (const byte of image.pixels) {
    mix(byte);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function provenanceRecord(
  provenance: Provenance,
  image: PixelImage,
): Record<string, unknown> {
  return { ...provenance, checksum: pixelChecksum(image) };
}

const origins: PixelOrigin[] = [
  "human",
  "algorithmic",
  "generated",
  "generated-edited",
  "imported",
];

/**
 * Recovers provenance from a stored record. If the pixels changed outside kpixel, generated
 * content becomes "generated-edited", so AI involvement is never lost, and anything else becomes
 * "imported", since the edit's origin is unknown.
 */
export function provenanceFromRecord(record: unknown, image: PixelImage): Provenance | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const { origin, jobId, checksum } = Object.fromEntries(Object.entries(record));
  if (!isPixelOrigin(origin)) return undefined;
  const stored = origin;
  const provenance: Provenance = { origin: stored };
  if (typeof jobId === "string" && jobId.length > 0) provenance.jobId = jobId;
  if (checksum === pixelChecksum(image)) {
    return provenance;
  }
  const isGenerated = stored === "generated" || stored === "generated-edited";
  return isGenerated ? { ...provenance, origin: "generated-edited" } : { origin: "imported" };
}

function isPixelOrigin(value: unknown): value is PixelOrigin {
  return typeof value === "string" && (origins as string[]).includes(value);
}
