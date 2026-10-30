# Server skeleton

Documents now have an authoritative home on Cloudflare: a `DocumentRoom` Durable Object per document, with an append-only op log and snapshot in SQLite, pixels in R2, and a JSON API to create, load and edit them. Details are in [document rooms](../design/document-rooms.md).

## Changes

- A custom Worker entry, `src/server.ts`, exporting `DocumentRoom` alongside TanStack Start's handler; `wrangler.jsonc` binds `DOCUMENT_ROOM` (SQLite-backed) and the `kpixel-blobs` R2 bucket.
- `DocumentStore`: commits that are retry-safe (by transaction id), detect conflicts, validate every document rule, and write blobs before an atomic log-and-snapshot update. The log stores operations with pixels as blob references and records each row's schema version.
- `/api/documents` endpoints for create, load, commit and history.
- Tests on Node's built-in SQLite, and Playwright API specs against the Worker running in workerd.

## Decisions

- **Logic behind small interfaces.** `DocumentStore` depends on `SqlDatabase` and `BlobStore` only, so it's tested in Node; Cloudflare's Workers test pool doesn't support Vitest 5 yet.
- **Snapshot plus log.** Loading reads a snapshot and never replays; the log is for sync, history and auditing.
- **Results, not exceptions, across RPC**, and **JSON text for large payloads**: Workers RPC loses error types, and its typings collapsed one deep wire type to `never`, which the type checker accepted silently. Type-aware linting caught it.
- **Forward only the request to TanStack.** Cloudflare's guide wires `fetch: handler.fetch`, which passes `env` where TanStack expects its own request options.

## Next

- The API has no authentication: accounts come before any public deploy (Phase 1).
- Model completeness for `.aseprite`: tilemaps, grayscale and per-frame palettes.
