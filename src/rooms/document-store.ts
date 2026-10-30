import type { BlobHash, BlobStore, Operation, SpriteDocument, Transaction } from "@/document";

import {
  applyOperations,
  DOCUMENT_SCHEMA_VERSION,
  loadFromBlobStore,
  saveToBlobStore,
} from "@/document";

import type { SqlDatabase } from "./sql-database";

import { externalizeBinary, internalizeBinary, referencedBlobs } from "./binary-references";

// The authoritative copy of one document: its current state, plus an append-only log of every
// transaction applied to it. The state is kept as a stored-form snapshot (small JSON, with pixels
// in content-addressed blobs), so loading never replays the log; the log serves sync, history
// and auditing.
//
// Durability order: blobs are written first, then the log row and snapshot in one SQL
// transaction. A failure in between leaves only unreferenced blobs, never a broken document.

export type CommitResult =
  /** Applied, or already applied earlier: `version` is the version it produced. */
  | { status: "committed"; version: number }
  /** Built against an older version; the client must rebase onto `version`. */
  | { status: "conflict"; version: number }
  /** The operations don't apply to the current document. */
  | { status: "rejected"; reason: string };

interface DocumentRow extends Record<string, number | string> {
  version: number;
  schema_version: number;
  snapshot: string;
}

interface TransactionRow extends Record<string, number | string> {
  version: number;
  schema_version: number;
  transaction_id: string;
  label: string;
  actor_kind: string;
  actor_id: string;
  operations: string;
}

export class DocumentStore {
  readonly #sql: SqlDatabase;
  readonly #blobs: BlobStore;
  /** The loaded document, kept to avoid rebuilding it on every request. */
  #current: { document: SpriteDocument; version: number } | undefined;

  constructor(sql: SqlDatabase, blobs: BlobStore) {
    this.#sql = sql;
    this.#blobs = blobs;
    sql.query(`CREATE TABLE IF NOT EXISTS document (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    sql.query(`CREATE TABLE IF NOT EXISTS transactions (
      version INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      transaction_id TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      operations TEXT NOT NULL,
      committed_at INTEGER NOT NULL
    )`);
  }

  /** Stores a new document at version 0. Returns false if this store already holds one. */
  async create(document: SpriteDocument): Promise<boolean> {
    if (this.#readDocumentRow()) {
      return false;
    }
    const snapshot = await saveToBlobStore(document, this.#blobs);
    this.#sql.query(
      "INSERT INTO document (id, version, schema_version, snapshot, updated_at) VALUES (1, 0, ?, ?, ?)",
      DOCUMENT_SCHEMA_VERSION,
      JSON.stringify(snapshot),
      Date.now(),
    );
    this.#current = { document, version: 0 };
    return true;
  }

  /** The current document and version, or undefined if none has been created. */
  async load(): Promise<{ document: SpriteDocument; version: number } | undefined> {
    if (this.#current) {
      return this.#current;
    }
    const row = this.#readDocumentRow();
    if (!row) {
      return undefined;
    }
    // loadFromBlobStore migrates older snapshots to the current schema.
    const document = await loadFromBlobStore(JSON.parse(row.snapshot), this.#blobs);
    this.#current = { document, version: row.version };
    return this.#current;
  }

  /**
   * Applies a transaction built against the current version. Retrying a transaction that was
   * already applied returns its original result instead of applying it twice.
   */
  async commit(transaction: Transaction): Promise<CommitResult> {
    const existing = this.#sql.query<{ version: number }>(
      "SELECT version FROM transactions WHERE transaction_id = ?",
      transaction.id,
    )[0];
    if (existing) {
      return { status: "committed", version: existing.version };
    }

    const current = await this.load();
    if (!current) {
      return { status: "rejected", reason: "the document doesn't exist" };
    }
    if (transaction.baseVersion !== current.version) {
      return { status: "conflict", version: current.version };
    }

    let document: SpriteDocument;
    try {
      document = applyOperations(current.document, transaction.operations).document;
    } catch (error) {
      return { status: "rejected", reason: error instanceof Error ? error.message : String(error) };
    }

    const version = current.version + 1;
    const snapshot = await saveToBlobStore(document, this.#blobs);
    const operations = await externalizeBinary(transaction.operations);
    await this.#putBlobs(operations.blobs);

    this.#sql.transaction(() => {
      this.#sql.query(
        `INSERT INTO transactions
          (version, schema_version, transaction_id, label, actor_kind, actor_id, operations, committed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        version,
        DOCUMENT_SCHEMA_VERSION,
        transaction.id,
        transaction.label,
        transaction.actor.kind,
        transaction.actor.id,
        JSON.stringify(operations.value),
        Date.now(),
      );
      this.#sql.query(
        "UPDATE document SET version = ?, schema_version = ?, snapshot = ?, updated_at = ? WHERE id = 1",
        version,
        DOCUMENT_SCHEMA_VERSION,
        JSON.stringify(snapshot),
        Date.now(),
      );
    });
    this.#current = { document, version };
    return { status: "committed", version };
  }

  /** Transactions applied after `version`, oldest first, for clients catching up. */
  async transactionsSince(version: number): Promise<Transaction[]> {
    const rows = this.#sql.query<TransactionRow>(
      "SELECT * FROM transactions WHERE version > ? ORDER BY version",
      version,
    );
    const parsed = rows.map((row) => {
      if (row.schema_version !== DOCUMENT_SCHEMA_VERSION) {
        // No older log format exists yet. When the schema changes, migrate rows here.
        throw new Error(`Transaction log schema ${row.schema_version} needs a migration`);
      }
      return { row, operations: JSON.parse(row.operations) as unknown }; // oxlint-disable-line typescript/no-unsafe-type-assertion -- JSON.parse returns any
    });

    const hashes = new Set(parsed.flatMap(({ operations }) => [...referencedBlobs(operations)]));
    const blobs = await this.#getBlobs(hashes);
    return parsed.map(({ row, operations }) => ({
      id: row.transaction_id,
      label: row.label,
      actor: { kind: row.actor_kind as Transaction["actor"]["kind"], id: row.actor_id }, // oxlint-disable-line typescript/no-unsafe-type-assertion -- written from a validated transaction
      baseVersion: row.version - 1,
      operations: internalizeBinary(operations, blobs) as Operation[], // oxlint-disable-line typescript/no-unsafe-type-assertion -- written from validated operations
    }));
  }

  #readDocumentRow(): DocumentRow | undefined {
    return this.#sql.query<DocumentRow>(
      "SELECT version, schema_version, snapshot FROM document WHERE id = 1",
    )[0];
  }

  async #putBlobs(blobs: Map<BlobHash, Uint8Array>) {
    await Promise.all(
      [...blobs].map(async ([hash, bytes]) => {
        if (!(await this.#blobs.has(hash))) {
          await this.#blobs.put(bytes);
        }
      }),
    );
  }

  async #getBlobs(hashes: Set<BlobHash>): Promise<Map<BlobHash, Uint8Array>> {
    const blobs = new Map<BlobHash, Uint8Array>();
    await Promise.all(
      [...hashes].map(async (hash) => {
        const bytes = await this.#blobs.get(hash);
        if (bytes) blobs.set(hash, bytes);
      }),
    );
    return blobs;
  }
}
