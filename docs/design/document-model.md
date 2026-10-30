# Document model

**Status:** implemented in [`src/document/`](../../src/document/) (Phase 0). Schema version 2.

The document model is the foundation every other feature builds on: the editor, `.aseprite` I/O, sync, AI jobs and agents. It is pure TypeScript with no React or browser dependencies, so the same code runs in the editor, in Workers and Durable Objects, and in tests. The design follows [product research](../product-research.md#foundation-get-the-document-commands-and-pipeline-right-before-any-model-call).

## Shape

The structure mirrors Aseprite's, so `.aseprite` files can round-trip and engines' expectations hold:

- A **sprite document** has a size, a colour mode (`rgba`, `indexed` or `grayscale`), a palette, frames in playback order, a layer tree, cels, tags, slices and tilesets.
- **Layers** are image layers, tilemap layers or groups. Groups list their children bottom to top; top-level layers are in `rootLayerIds`.
- A **cel** is a layer's content at one frame. Cels point at **cel data** (pixels, position, opacity, provenance), and linked cels share one cel data. Images are tight-bounded and positioned with `x`/`y`, so they can extend past the canvas.
- **Tags** name frame ranges with a loop direction and repeat count. **Slices** are named regions with per-frame keys, for 9-slices and pivots.
- **Palette changes** give a later frame its own palette, which lasts until the next change. The first frame always uses the document's palette.
- A **tileset** is a list of same-sized tiles. Each **tilemap layer** uses one tileset, and its cels hold a grid of tile references instead of pixels.

Images are stored per colour mode: `rgba8` (RGBA), `indexed8` (palette indexes) or `graya8` (grey and alpha). Tilemap cels use `tile32`: one little-endian 32-bit reference per grid cell, with the tile index in bits 0–28 and diagonal, vertical and horizontal flips in bits 29, 30 and 31. Flips apply diagonal first (swapping x and y), then horizontal, then vertical.

Tile 0 is always the empty tile, and tiles are only appended or removed at the end, so tile references stay valid without renumbering.

Every entity has a stable UUIDv7 id. Nothing is addressed by array index, so ids survive reordering, concurrent edits and undo.

Documents are **immutable**. Every change produces a new document that shares unchanged parts with the old one, which makes undo cheap and lets React subscribe by reference equality.

## Schemas and wire format

[TypeBox](https://github.com/sinclairzx81/typebox) schemas in `schema.ts` and `operations.ts` are the single source of truth. Their decoded static types are the in-memory types, and the schemas themselves describe the JSON wire form used for storage, sync and agent tool calls. TypeBox is also what Pi uses for tool parameters, so operations can become agent tools without a second schema.

Pixel data is the one difference between the two forms: a `Uint8Array` in memory and base64 on the wire, converted by a TypeBox codec. `wire-format.ts` encodes and decodes documents, operations and transactions; decoding validates first and reports problems by field path, such as `/operations/0/durationMs must be >= 1`.

## Operations and transactions

**Operations** (`operations.ts`) are the only way to change a document: 28 small steps such as `addFrame`, `moveLayer`, `addCel`, `setCelData`, `setFramePalette` and `appendTile`. `applyOperation` returns the new document plus the **inverse** operations that undo it exactly.

Operations have strict preconditions instead of cascading side effects. For example, `removeFrame` fails while cels, tags, slice keys or a palette change still use the frame, and `removeLayer` fails while the layer has cels. Higher-level editor commands emit the cleanup operations first. This keeps every step easy to invert, validate and explain to an agent.

A precondition may only refuse a state that no operation can reach mid-transaction, or a transaction's inverse could fail to apply. Tile references aren't checked as they're written, so a cel may refer to a tile that its transaction appends later; removing a tile that's still used is caught by the invariants at the end of the transaction instead of by `removeLastTile`.

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

**`renderFrame`** (`render-frame.ts`) flattens one frame into canvas-sized RGBA. Visible layers draw bottom to top with their blend mode and opacity times the cel's opacity; reference layers are left out unless asked for. Groups are flattened on their own and then blended in as one image. A cel's z-index moves it up or down its group's stack, with ties going to the higher z-index, as in Aseprite. Indexed documents render through the palette in force at that frame (`paletteAt`), with the transparent index clear; grayscale renders grey into all three channels. Tilemap cels are expanded tile by tile, with their flips, and then composited like any image; tile 0 draws nothing. Fully transparent output pixels are always transparent black.

Blend modes (`blend-modes.ts`) follow the [W3C Compositing and Blending spec](https://www.w3.org/TR/compositing-1/#blending), plus Aseprite's addition, subtract and divide. Results aren't guaranteed to match Aseprite byte for byte, since Aseprite uses its own integer arithmetic.

**PNG** (`formats/png.ts`) uses [fast-png](https://github.com/image-js/fast-png) for decoding and plain encoding:

- `decodePng` accepts every PNG flavour (1–16-bit, grey, RGB, palette, alpha, `tRNS`, interlaced) and normalises it to 8-bit RGBA or palette indexes. Images over 4096×4096 are refused before decoding.
- `importPng` opens a PNG as a new document trimmed to its content, with provenance `imported`. Indexed PNGs become indexed documents with the same palette and indexes, adding a transparent entry if needed; a full 256-colour palette with no transparent entry opens as RGBA.
- `exportFramePng` writes one frame, optionally upscaled. Indexed documents export as indexed PNGs, with the frame's palette, whenever every flattened colour is in it; grayscale documents export as grey-and-alpha PNGs whenever every flattened colour is grey; anything else exports as RGBA. fast-png doesn't write palette transparency, so the `tRNS` chunk is added separately.

## `.aseprite` files

`formats/aseprite/` reads and writes Aseprite's format. It is **clean-room**: written only from the [published file spec](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md), because Aseprite's source code is under a proprietary EULA. It has three layers:

1. `binary.ts`: little-endian primitives. Every count read from a file is checked against the bytes left before anything is allocated.
2. `file-structure.ts` and `properties.ts`: bytes to and from a typed structure of header, frames and chunks, including typed user-data properties. Compressed cels inflate through a stream that stops at their declared size, and a file's decoded pixels are capped at 512 MB.
3. `read-aseprite.ts` and `write-aseprite.ts`: that structure to and from documents.

`readAseprite` returns `{ document, warnings }`; nothing is dropped silently:

- **Carried over exactly:** RGBA, indexed and grayscale sprites, frames and durations, image, tilemap and group layers with their settings, cels (raw, compressed, linked and tilemap, with flipped tiles) with z-index, tags with colours, the palette and its changes on later frames with alpha and names, tilesets, slices with 9-slice centres and pivots, and user data with typed properties on the sprite, layers, cels, tags, slices, tilesets and tiles.
- **Kept for export but not modelled yet:** the grid, colour profile, external files, a layer's lock-movement, background and prefer-linked flags, precise cel bounds, whether groups are composited separately, and a tileset's flip-matching flags and external file reference. They live under the `kpixel/aseprite` user-data namespace.
- **Converted with a warning:** palettes over 256 colours keep their first 256; deprecated and unknown chunks are ignored.
- **Rejected:** tilesets stored only in an external file.

Typed properties stay natural JSON where that round-trips exactly (booleans, strings, 32-bit integers, non-integer doubles, arrays, objects). Other types are wrapped, e.g. `{ "$type": "int16", "value": 5 }`. Aseprite's user properties use the `user` namespace; extension properties use the extension's id.

**Provenance survives Aseprite.** Each cel carries a `kpixel/provenance` extension property with a pixel checksum, which Aseprite keeps when it saves. If the pixels changed in the meantime, AI-generated content comes back as `generated-edited`, so AI involvement is never lost, and anything else becomes `imported`.

**Known differences from Aseprite:**

- Translucent compositing can differ by 1–2 levels out of 255, because Aseprite uses its own integer arithmetic.
- Aseprite orders cels by z-index across the whole layer list; kpixel orders them within each group.
- By default Aseprite draws groups pass-through and ignores their opacity and blend mode; kpixel always flattens groups first. Files keep Aseprite's setting, so Aseprite renders them as before.
- When Aseprite saves a file, it drops group opacity and blend modes unless its "composite groups separately" preference is on, resets the unused transparent index of RGBA and grayscale sprites, drops empty user-data text, and reorders slices. When a palette shrinks on a later frame, it still writes the old, longer range of entries; kpixel ignores the ones past the new size.
- Saving an indexed sprite as PNG from Aseprite ignores cel and layer opacity, because an indexed PNG can't hold partial alpha. kpixel always applies opacity, matching what Aseprite shows on screen, so its tests compare against Aseprite's RGB renders.

**Conformance.** `formats/aseprite/corpus/` holds sprites built by Aseprite itself from `make-corpus.lua`, with Aseprite's render of every frame; `make-corpus.sh` regenerates them. Tests check that each opens (tilemaps with every flip combination included), renders like Aseprite, and round-trips unchanged, and fuzz the reader with corrupted files. Where Aseprite is installed, `aseprite-compatibility.test.ts` also has Aseprite describe and render kpixel's rewritten files (they must match the originals exactly) and re-save documents made in kpixel (they must read back unchanged, provenance included). It's skipped elsewhere, such as in CI.

## Invariants

`invariants.ts` lists the structural rules the types can't express. They hold after every committed transaction:

- at least one frame, with unique ids and valid durations;
- every layer reachable from the top level exactly once (no cycles, shared children or orphans);
- cels only on image and tilemap layers, at most one per layer and frame, pointing at existing frames and cel data;
- linked cels on the same layer, and no unused cel data;
- images in the document's pixel format with the right byte length, and tilemap cels in `tile32` referring only to tiles their tileset has;
- tilesets with unique ids, an empty tile 0, and every tile at the tileset's size and in the document's format; tilemap layers using existing tilesets;
- palette changes on existing frames other than the first, at most one per frame;
- tags that start no later than they end, slice keys on existing frames, and the transparent index inside every palette in indexed mode.

## Provenance

Each cel data records where its pixels came from: `human`, `algorithmic`, `generated`, `generated-edited` or `imported`, with the generation job id for generated pixels. Each transaction records its actor. These are the inputs for disclosure exports and "No generative AI" mode later.

## Testing

- **Property-based tests** (`document.property.test.ts`) generate long random sequences of transactions, many of them deliberately invalid, and check that every accepted transaction leaves a valid document, that rejected ones change nothing, that undo restores each previous document exactly and redo replays it, and that the JSON transaction log replays to the same document.
- **File properties** (`native-file.test.ts`) check that randomly edited documents round-trip exactly through `.kpixel` files and blob stores, and unit tests cover damaged, foreign and newer files.
- **Unit tests** cover each operation's preconditions and inverses, the session, the wire format and migrations, including opening a real version 1 file (`test-support/fixtures/schema-v1.kpixel`).
- **Rendering and PNG tests** check each blend mode's range, z-index and group behaviour, grayscale, palette changes, every tile flip, every PNG colour type and bit depth (with PNGs written by hand from the spec), and that exported PNGs decode to exactly the rendered pixels.

Random documents (`test-support/random-documents.ts`) cover all three colour modes, and half of them start with a tileset and a tilemap layer, so random edits reach tilemaps often.

`pnpm test` runs 100 random cases per property. To soak them, run `FAST_CHECK_NUM_RUNS=2000 pnpm test --testTimeout=0`.

## Not yet modelled

`.aseprite` files round-trip losslessly, but some of their settings ride along under `kpixel/aseprite` rather than in the model: the grid, background layers, colour profile, tileset flip matching and external files. The editor will model each when a feature needs it.

Blobs are whole images. Splitting large images into tiles, so an edit rewrites only the tiles it touches, can come later if canvases grow large enough to need it.
