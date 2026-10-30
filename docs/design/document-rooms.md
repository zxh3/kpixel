# Document rooms

**Status:** implemented in [`src/rooms/`](../../src/rooms/) (Phase 0 server skeleton). Single-user and unauthenticated; see [Limits](#limits).

Each document has one authoritative copy on Cloudflare: a **`DocumentRoom` Durable Object** that orders its transactions, keeps its state and log in SQLite, and stores pixels in R2. Editors, agents and the API all reach a document through its room.

## Pieces

| Piece                                 | What it does                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server.ts`                       | The Worker entry: forwards HTTP to TanStack Start and exports `DocumentRoom`.                                                                                        |
| `DocumentRoom` (`document-room.ts`)   | The Durable Object, one per document (`getByName(documentId)`). Validates wire-format input, runs mutations one at a time, and returns expected failures as results. |
| `DocumentStore` (`document-store.ts`) | All the logic, behind two small interfaces (`SqlDatabase`, `BlobStore`), so it runs and is tested in Node on real SQLite.                                            |
| `R2BlobStore`, `KnownBlobStore`       | Pixel blobs in R2 under `blobs/<sha256>`, and a cache of which blobs are known to be stored.                                                                         |
| `/api/documents…` routes              | JSON endpoints over the room (below).                                                                                                                                |

## Storage

The room's SQLite has two tables:

- **`document`**: one row holding the current version and a **snapshot** of the document in its stored form (JSON, with each image referring to an R2 blob). Loading reads the snapshot and fetches blobs; it never replays the log.
- **`transactions`**: the **append-only log**, one row per applied transaction: the version it produced, the schema version it was written with, its id, label and actor, and its operations as JSON with pixel buffers replaced by `{ "$blob": hash }` references.

A commit:

1. returns the original result if the transaction id was already applied, so retries are safe;
2. returns a conflict if the transaction was built on an older version;
3. applies the operations, checking every document rule, and returns a rejection if that fails;
4. writes new pixel blobs to R2;
5. writes the log row and the new snapshot in one SQL transaction.

Blobs go first, so a failure part-way leaves at most unreferenced blobs, never a broken document. Blobs are content-addressed and immutable, so writing one twice is harmless.

Mutations are serialised inside the room: R2 calls are external I/O, during which a Durable Object can start handling another request.

## API

No authentication yet; see [Limits](#limits). Documents travel in the [wire format](document-model.md#schemas-and-wire-format) (pixels as base64).

| Request                                                                                | Result                                                                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/documents` with `{ "document": … }` or `{ "width", "height", "colorMode" }` | `201 { documentId, version }`; `409` if the id exists; `400` if the document is invalid                                    |
| `GET /api/documents/:id`                                                               | `200 { document, version }`; `404`                                                                                         |
| `POST /api/documents/:id/transactions` with a transaction                              | `200 { version }` (also on a retry); `409 { version }` on a stale base version; `400 { error }` if it doesn't apply; `404` |
| `GET /api/documents/:id/transactions?since=N`                                          | `200 { transactions }` applied after version N, oldest first                                                               |

Document payloads cross Workers RPC as JSON text: the room serialises once and the route passes the text straight into the response. Workers RPC's types can't see through deep wire types, which made one method's result type collapse to `never` before this change.

## Testing

- `document-store.test.ts` runs the store on `node:sqlite` with in-memory blobs: create and load, conflicts, rejections, safe retries, atomicity when blob storage fails, deduplication, reloading after a cold start, and random editing sessions that must be mirrored exactly and replay from the log.
- `e2e/documents-api.spec.ts` drives the HTTP API against `vite preview`, which runs the Worker in workerd with local Durable Objects and R2.

Cloudflare's Workers test pool needs Vitest 4, so it isn't used yet; the store's interfaces keep its logic testable without it.

## Limits

- **No authentication.** Anyone who can reach the Worker can create documents and, knowing an id, read and edit them. Don't deploy before accounts exist (Phase 1).
- **Single writer.** There's no live sync or presence yet; clients catch up with `transactions?since=`.
- **Snapshots on every commit.** Fine for sprite-sized documents. Larger ones will want periodic snapshots with log replay.
- **No blob garbage collection.** Blobs from failed commits or old versions stay in R2.
- The R2 bucket `kpixel-blobs` must exist before deploying: `pnpm wrangler r2 bucket create kpixel-blobs`.
