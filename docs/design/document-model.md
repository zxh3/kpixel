# Document model

**Status:** implemented in [`src/document/`](../../src/document/) (Phase 0, first slice). Tilesets, grayscale and per-frame palettes are still to come; see [Not yet modelled](#not-yet-modelled).

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

A **transaction** (`transaction.ts`) is one logical edit: a labelled batch of operations with an actor (`user`, `agent`, `job` or `system`) and the document version it was built against. It applies all or nothing, and the result is checked against every document rule before it is accepted.

A **`DocumentSession`** (`session.ts`) holds one open document with its version, an append-only transaction log, and undo and redo stacks. Undo and redo are themselves transactions, so the log can be replayed or synced. The session implements `subscribe` and `getSnapshot` for React's `useSyncExternalStore`.

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
- **Unit tests** cover each operation's preconditions and inverses, the session, and the wire format.

`pnpm test` runs 100 random cases per property. To soak them, run `FAST_CHECK_NUM_RUNS=2000 pnpm test --testTimeout=0`.

## Not yet modelled

These are needed for lossless `.aseprite` round-trips and are tracked in the [roadmap](../roadmap.md):

- tilesets and tilemap layers;
- grayscale colour mode;
- per-frame palettes (the model has one palette per document);
- a schema version stored with persisted transaction logs, so logs can be migrated alongside documents.

Pixel edits currently replace a cel's whole image. Region patches can be added with the blob store, when undo memory starts to matter.
