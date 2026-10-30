# Blob store and native file format

Documents can now be saved and opened: pixels as content-addressed blobs, a deterministic `.kpixel` file format with a published schema and migrations, and an IndexedDB cache for the browser. Details are in [document model](../design/document-model.md#storage-and-files).

## Changes

- Content-addressed pixel blobs (SHA-256 via WebCrypto) and a `BlobStore` interface, with in-memory and IndexedDB implementations.
- A stored document form that refers to pixels by blob hash, with `saveToBlobStore` and `loadFromBlobStore`.
- The `.kpixel` file: a zip of `manifest.json` and `blobs/<sha256>`. Reading checks size limits and blob hashes, and migrates before validating.
- Document migrations by schema version, and the manifest's JSON Schema published at `docs/schemas/kpixel-file-v1.schema.json`, kept in sync by a test.
- A `patchCelPixels` operation that replaces a rectangle of pixels, so edits cost undo memory and sync traffic in proportion to what they touch.

## Decisions

- **Zip container.** Standard tools can open it, deflate compresses pixels well, and later versions can add entries (previews, history) that older readers ignore.
- **Deterministic saves.** Zip timestamps are fixed and built from local date parts, because zip stores local time; the same document gives identical bytes in every time zone.
- **Whole-image blobs for now.** Tiling large images into separately stored chunks waits until canvas sizes call for it.
- **Transaction log versioning moves to the server skeleton**, where logs are first persisted.

## Next

- PNG import and export, then the clean-room `.aseprite` codec and its conformance corpus.
