import type { BlobHash } from "@/document";

import { hashBlob } from "@/document";

// Transactions can carry pixel data (Uint8Array). In the stored log, each buffer is replaced by
// a reference to a content-addressed blob, so log rows stay small and pixels are stored once.

interface BlobReference {
  $blob: BlobHash;
}

/**
 * Replaces every Uint8Array in a JSON-like value with a { $blob: hash } reference, and returns
 * the blobs it moved out.
 */
export async function externalizeBinary(
  value: unknown,
): Promise<{ value: unknown; blobs: Map<BlobHash, Uint8Array> }> {
  const blobs = new Map<BlobHash, Uint8Array>();
  const pending: Promise<void>[] = [];
  const visit = (node: unknown): unknown => {
    if (node instanceof Uint8Array) {
      const reference: BlobReference = { $blob: "" };
      pending.push(
        hashBlob(node).then((hash) => {
          reference.$blob = hash;
          blobs.set(hash, node);
        }),
      );
      return reference;
    }
    if (Array.isArray(node)) {
      return node.map(visit);
    }
    if (isPlainObject(node)) {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    }
    return node;
  };
  const result = visit(value);
  await Promise.all(pending);
  return { value: result, blobs };
}

/** The blob hashes a value references. */
export function referencedBlobs(value: unknown): Set<BlobHash> {
  const hashes = new Set<BlobHash>();
  const visit = (node: unknown) => {
    if (isBlobReference(node)) {
      hashes.add(node.$blob);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isPlainObject(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return hashes;
}

/** Replaces every { $blob: hash } reference with its bytes. */
export function internalizeBinary(
  value: unknown,
  blobs: ReadonlyMap<BlobHash, Uint8Array>,
): unknown {
  if (isBlobReference(value)) {
    const bytes = blobs.get(value.$blob);
    if (!bytes) {
      throw new Error(`Blob ${value.$blob} is missing from storage`);
    }
    return bytes;
  }
  if (Array.isArray(value)) {
    return value.map((child) => internalizeBinary(child, blobs));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, internalizeBinary(child, blobs)]),
    );
  }
  return value;
}

function isBlobReference(value: unknown): value is BlobReference {
  return isPlainObject(value) && typeof value.$blob === "string" && Object.keys(value).length === 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}
