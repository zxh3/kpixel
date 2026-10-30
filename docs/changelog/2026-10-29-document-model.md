# Document model and transactions

The first Phase 0 slice: kpixel's document model, the operations that change it, and transactions with exact undo and redo, all covered by property-based tests. Design notes are in [document model](../design/document-model.md).

## Changes

- `src/document/`: an Aseprite-shaped model with stable UUIDv7 ids, RGBA and indexed colour, linked cels, tags, slices, user data and per-image provenance.
- 20 operations, each with an exact inverse; transactions that apply all or nothing and are checked against every document rule; a `DocumentSession` with an append-only log, undo, redo and a React-compatible subscription.
- A JSON wire format for documents, operations and transactions, with base64 pixel data and field-level validation errors.
- Vitest and fast-check. `pnpm test` runs unit tests and properties over random edit sequences; CI runs them too.

## Decisions

- **TypeBox schemas are the source of truth** for both in-memory types and the wire format. Pi uses TypeBox for tool parameters, so operations can become agent tools without a second schema.
- **Immutable documents.** Edits return new documents that share unchanged parts, which keeps undo cheap and fits React.
- **Strict operations, no cascades.** An operation fails rather than silently cleaning up references; editor commands emit the cleanup first. Each step stays simple to invert and to explain to an agent.
- **Undo and redo are transactions**, so the log is append-only and replayable, ready for the `DocumentRoom` Durable Object.
- Deferred until the `.aseprite` work needs them: tilesets and tilemap layers, grayscale, per-frame palettes, and region-based pixel patches.

## Next

- Blob store and native file format, then PNG and `.aseprite` I/O with a conformance corpus.
