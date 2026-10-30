import { DurableObject } from "cloudflare:workers";

import {
  decodeDocument,
  decodeTransaction,
  DocumentInvariantError,
  encodeDocument,
  encodeTransaction,
  WireFormatError,
} from "@/document";

import type { CommitResult } from "./document-store";

import { DocumentStore } from "./document-store";
import { KnownBlobStore } from "./known-blob-store";
import { R2BlobStore } from "./r2-blob-store";
import { durableObjectSqlDatabase } from "./sql-database";

export type CreateResult =
  | { status: "created"; version: number }
  | { status: "exists" }
  | { status: "rejected"; reason: string };

/**
 * One Durable Object per document: the single authority that orders its transactions. State
 * lives in the object's SQLite storage and pixels in R2 (see DocumentStore).
 *
 * Methods take and return the JSON wire format, so callers never share in-memory objects with
 * the room and every input is validated here. Expected failures are returned as results rather
 * than thrown, because Workers RPC doesn't preserve error types.
 */
export class DocumentRoom extends DurableObject<Env> {
  readonly #store: DocumentStore;
  /** Mutations run one at a time: R2 calls are external I/O, which lets other requests interleave. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = new DocumentStore(
      durableObjectSqlDatabase(ctx.storage),
      new KnownBlobStore(new R2BlobStore(env.BLOBS)),
    );
  }

  async create(encodedDocument: unknown): Promise<CreateResult> {
    let document;
    try {
      document = decodeDocument(encodedDocument);
    } catch (error) {
      return { status: "rejected", reason: describeInputError(error) };
    }
    return this.#serially(async () =>
      (await this.#store.create(document))
        ? { status: "created", version: 0 }
        : { status: "exists" },
    );
  }

  /**
   * The current document as JSON text, `{ "document": …, "version": n }`, or undefined if it
   * doesn't exist. Payloads cross RPC as JSON text: serialised once here and passed straight into
   * HTTP responses, and simple for RPC's type checking, which can't see through deep wire types.
   */
  async load(): Promise<string | undefined> {
    const current = await this.#store.load();
    return (
      current &&
      JSON.stringify({ document: encodeDocument(current.document), version: current.version })
    );
  }

  async commit(encodedTransaction: unknown): Promise<CommitResult> {
    let transaction;
    try {
      transaction = decodeTransaction(encodedTransaction);
    } catch (error) {
      return { status: "rejected", reason: describeInputError(error) };
    }
    return this.#serially(() => this.#store.commit(transaction));
  }

  /** Transactions after `version` as JSON text, `{ "transactions": […] }`, oldest first. */
  async transactionsSince(version: number): Promise<string> {
    const transactions = await this.#store.transactionsSince(version);
    return JSON.stringify({ transactions: transactions.map(encodeTransaction) });
  }

  #serially<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(task, task);
    this.#queue = result.catch(() => undefined);
    return result;
  }
}

function describeInputError(error: unknown): string {
  if (error instanceof WireFormatError || error instanceof DocumentInvariantError) {
    return error.message;
  }
  throw error;
}
