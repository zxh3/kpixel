# Document model

**Status:** implemented in [`src/document/`](../../src/document/) (Phase 0). Tilesets, grayscale and per-frame palettes are still to come; see [Not yet modelled](#not-yet-modelled).

The document model is the foundation every other feature builds on: the editor, `.aseprite` I/O, sync, AI jobs and agents. It is pure TypeScript with no React or browser dependencies, so the same code runs in the editor, in Workers and Durable Objects, and in tests. The design follows [product research](../product-research.md#foundation-get-the-document-commands-and-pipeline-right-before-any-model-call).

## Shape

The structure mirrors Aseprite's, so `.aseprite` files can round-trip and engines' expectations hold:

- A **sprite document** has a size, a colour mode (`rgba` or `indexed`), a palette, frames in playback order, a layer tree, cels, tags and slices.
- **Layers** are image layers or groups. Groups list their children bottom to top; top-level layers are in `rootLayerIds`.
- A **cel** is a layer's content at one frame. Cels point at **cel data** (pixels, position, opacity, provenance), and linked cels share one cel data. Images are tight-bounded and positioned with `x`/`y`, so they can extend past the canvas.
- **Tags** name frame ranges with a loop direction and repeat count. **Slices** are named regions with per-frame keys, for 9-slices and pivots.

Every entity has a stable UUIDv7 id. Nothing is addressed by array index, so ids survive reordering, concurrent edits and undo.

Documents are **immutable**. Every change produces a new document that shares unchanged parts with the old one, which makes undo cheap and lets React subscribe by reference equality.

## Schemas and wire format

[TypeBox](https://github.com/sinclairzx81/typebox) schemas in `schema.ts` and `operations.ts` are the single source of truth. Their decoded static types are the in-memory types, and the schemas themselves describe the JSON wire form used for storage, sync and agent tool calls. TypeBox is also what Pi uses for tool parameters, so operations can become agent tools without a second schema.

Pixel data is the one difference between the two forms: a `Uint8Array` in memory and base64 on the wire, converted by a TypeBox codec. `wire-format.ts` encodes and decodes documents, operations and transactions; decoding validates first and reports problems by field path, such as `/operations/0/durationMs must be >= 1`.

## Operations and transactions

**Operations** (`operations.ts`) are the only way to change a document: 20 small steps such as `addFrame`, `moveLayer`, `addCel` and `setCelData`. `applyOperation` returns the new document plus the **inverse** operations that undo it exactly.

Operations have strict preconditions instead of cascading side effects. For example, `removeFrame` fails while cels, tags or slice keys still use the frame, and `removeLayer` fails while the layer has cels. Higher-level editor commands emit the cleanup operations first. This keeps every step easy to invert, validate and explain to an agent.

Operations are normalized on entry: undefined-valued properties are dropped, so documents and logs never hold keys that JSON would silently lose. In "set…" operations an omitted property is left alone and `null` removes an optional one.

`patchCelPixels` replaces a rectangle inside a cel's image, so a brush stroke costs undo memory and sync traffic in proportion to the pixels it touched; `setCelData` replaces or resizes a whole image.

A **transaction** (`transaction.ts`) is one logical edit: a labelled batch of operations with an actor (`user`, `agent`, `job` or `system`) and the document version it was built against. It applies all or nothing, and the result is checked against every document rule before it is accepted.

A **`DocumentSession`** (`session.ts`) holds one open document with its version, an append-only transaction log, and undo and redo stacks. Undo and redo are themselves transactions, so the log can be replayed or synced. The session implements `subscribe` and `getSnapshot` for React's `useSyncExternalStore`.

## Storage and files

Pixels are stored as **content-addressed blobs**: a blob's key is the SHA-256 of its bytes (`blobs.ts`). Identical images are stored once, blobs never change once written, and any copy can be verified against its key.

The **stored form** of a document (`stored-document.ts`) is the wire JSON with each image's pixels replaced by a `blob` hash. `saveToBlobStore` and `loadFromBlobStore` move documents in and out of any `BlobStore`: `MemoryBlobStore` for tests, `IndexedDbBlobStore` (`src/storage/`) as the browser's local cache, and an R2-backed store to come with the server.

The native **`.kpixel` file** (`native-file.ts`) is a zip holding `manifest.json` (format metadata and the stored document) and `blobs/<sha256>`. Saving is deterministic: the same document always produces the same bytes. Opening caps the unzipped size, verifies every blob against its hash, and migrates the document before validating it. The manifest's JSON Schema is published at [`docs/schemas/kpixel-file-v1.schema.json`](../schemas/kpixel-file-v1.schema.json); a test fails if it drifts from the code, and `pnpm test -u` regenerates it.

**Migrations** (`migrations.ts`) keep old files opening. Each change to the stored shape bumps `DOCUMENT_SCHEMA_VERSION` and adds a migration from the previous version that works on plain JSON, before validation. Shipped migrations never change.

## Rendering and PNG

**`renderFrame`** (`render-frame.ts`) flattens one frame into canvas-sized RGBA. Visible layers draw bottom to top with their blend mode and opacity times the cel's opacity; reference layers are left out unless asked for. Groups are flattened on their own and then blended in as one image. A cel's z-index moves it up or down its group's stack, with ties going to the higher z-index, as in Aseprite. Indexed documents render through the palette, with the transparent index clear. Fully transparent output pixels are always transparent black.

Blend modes (`blend-modes.ts`) follow the [W3C Compositing and Blending spec](https://www.w3.org/TR/compositing-1/#blending), plus Aseprite's addition, subtract and divide. Results aren't guaranteed to match Aseprite byte for byte, since Aseprite uses its own integer arithmetic.

**PNG** (`formats/png.ts`) uses [fast-png](https://github.com/image-js/fast-png) for decoding and plain encoding:

- `decodePng` accepts every PNG flavour (1–16-bit, grey, RGB, palette, alpha, `tRNS`, interlaced) and normalises it to 8-bit RGBA or palette indexes. Images over 4096×4096 are refused before decoding.
- `importPng` opens a PNG as a new document trimmed to its content, with provenance `imported`. Indexed PNGs become indexed documents with the same palette and indexes, adding a transparent entry if needed; a full 256-colour palette with no transparent entry opens as RGBA.
- `exportFramePng` writes one frame, optionally upscaled. Indexed documents export as indexed PNGs whenever every flattened colour is in the palette, and as RGBA otherwise. fast-png doesn't write palette transparency, so the `tRNS` chunk is added separately.

## Invariants

`invariants.ts` lists the structural rules the types can't express. They hold after every committed transaction:

- at least one frame, with unique ids and valid durations;
- every layer reachable from the top level exactly once (no cycles, shared children or orphans);
- cels only on image layers, at most one per layer and frame, pointing at existing frames and cel data;
- linked cels on the same layer, and no unused cel data;
- images in the document's pixel format with the right byte length;
- tags that start no later than they end, slice keys on existing frames, and the transparent index inside the palette in indexed mode.

## Provenance

Each cel data records where its pixels came from: `human`, `algorithmic`, `generated`, `generated-edited` or `imported`, with the generation job id for generated pixels. Each transaction records its actor. These are the inputs for disclosure exports and "No generative AI" mode later.

## Testing

- **Property-based tests** (`document.property.test.ts`) generate long random sequences of transactions, many of them deliberately invalid, and check that every accepted transaction leaves a valid document, that rejected ones change nothing, that undo restores each previous document exactly and redo replays it, and that the JSON transaction log replays to the same document.
- **File properties** (`native-file.test.ts`) check that randomly edited documents round-trip exactly through `.kpixel` files and blob stores, and unit tests cover damaged, foreign and newer files.
- **Unit tests** cover each operation's preconditions and inverses, the session, the wire format and migrations.
- **Rendering and PNG tests** check each blend mode's range, z-index and group behaviour, every PNG colour type and bit depth (with PNGs written by hand from the spec), and that exported PNGs decode to exactly the rendered pixels.

`pnpm test` runs 100 random cases per property. To soak them, run `FAST_CHECK_NUM_RUNS=2000 pnpm test --testTimeout=0`.

## Not yet modelled

These are needed for lossless `.aseprite` round-trips and are tracked in the [roadmap](../roadmap.md):

- tilesets and tilemap layers;
- grayscale colour mode;
- per-frame palettes (the model has one palette per document);
- a schema version stored with persisted transaction logs, so logs can be migrated alongside documents (with the server's op log).

Blobs are whole images. Splitting large images into tiles, so an edit rewrites only the tiles it touches, can come later if canvases grow large enough to need it.
