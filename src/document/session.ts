import type { Operation } from "./operations";
import type { SpriteDocument } from "./schema";
import type { Actor, Transaction } from "./transaction";

import { VersionConflictError } from "./errors";
import { createId } from "./ids";
import { assertValidDocument } from "./invariants";
import { applyOperations } from "./transaction";

interface HistoryEntry {
  label: string;
  /** Operations that revert the entry when applied to the current document. */
  revert: Operation[];
}

export interface CommitInput {
  label: string;
  actor: Actor;
  operations: Operation[];
}

/**
 * Holds one open document: its current state, version, transaction log, and undo and redo
 * stacks. Every change goes through a transaction, including undo and redo, so the log is
 * append-only and can be replayed or synced.
 *
 * Compatible with React's useSyncExternalStore via `subscribe` and `getSnapshot`.
 */
export class DocumentSession {
  #document: SpriteDocument;
  #version: number;
  #transactions: Transaction[] = [];
  #undoStack: HistoryEntry[] = [];
  #redoStack: HistoryEntry[] = [];
  #listeners = new Set<() => void>();

  constructor(document: SpriteDocument, version = 0) {
    assertValidDocument(document);
    this.#document = document;
    this.#version = version;
  }

  get document(): SpriteDocument {
    return this.#document;
  }

  /** Increments once per applied transaction. */
  get version(): number {
    return this.#version;
  }

  /** Every applied transaction, oldest first. */
  get transactions(): readonly Transaction[] {
    return this.#transactions;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  /** The label of the step `undo` would revert, for menus such as "Undo Pencil". */
  get undoLabel(): string | undefined {
    return this.#undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.#redoStack.at(-1)?.label;
  }

  getSnapshot = (): SpriteDocument => this.#document;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Applies a batch of operations as one undoable step. On any error the document is left
   * unchanged and the error is rethrown.
   */
  commit(input: CommitInput): Transaction {
    const { transaction, revert } = this.#apply(input);
    this.#undoStack.push({ label: input.label, revert });
    this.#redoStack = [];
    this.#notify();
    return transaction;
  }

  /** Reverts the most recent step. Returns undefined when there is nothing to undo. */
  undo(actor: Actor): Transaction | undefined {
    const entry = this.#undoStack.at(-1);
    if (!entry) {
      return undefined;
    }
    const { transaction, revert } = this.#apply({
      label: `Undo ${entry.label}`,
      actor,
      operations: entry.revert,
    });
    this.#undoStack.pop();
    this.#redoStack.push({ label: entry.label, revert });
    this.#notify();
    return transaction;
  }

  /** Reapplies the most recently undone step. Returns undefined when there is nothing to redo. */
  redo(actor: Actor): Transaction | undefined {
    const entry = this.#redoStack.at(-1);
    if (!entry) {
      return undefined;
    }
    const { transaction, revert } = this.#apply({
      label: `Redo ${entry.label}`,
      actor,
      operations: entry.revert,
    });
    this.#redoStack.pop();
    this.#undoStack.push({ label: entry.label, revert });
    this.#notify();
    return transaction;
  }

  /**
   * Applies a transaction built elsewhere, such as one replayed from a log. It must target the
   * current version. Applied transactions are not added to the undo history.
   */
  applyTransaction(transaction: Transaction): void {
    if (transaction.baseVersion !== this.#version) {
      throw new VersionConflictError(transaction.baseVersion, this.#version);
    }
    const { document } = applyOperations(this.#document, transaction.operations);
    this.#document = document;
    this.#version += 1;
    this.#transactions.push(transaction);
    this.#notify();
  }

  #apply(input: CommitInput): { transaction: Transaction; revert: Operation[] } {
    const transaction: Transaction = {
      id: createId(),
      label: input.label,
      actor: input.actor,
      baseVersion: this.#version,
      operations: input.operations,
    };
    const { document, inverse } = applyOperations(this.#document, transaction.operations);
    this.#document = document;
    this.#version += 1;
    this.#transactions.push(transaction);
    return { transaction, revert: inverse };
  }

  #notify() {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
