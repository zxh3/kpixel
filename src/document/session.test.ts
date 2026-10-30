import { describe, expect, test, vi } from "vitest";

import { DocumentInvariantError, VersionConflictError } from "./errors";
import { createId } from "./ids";
import { newSession, testActor } from "./test-support/builders";

function addFrameOperation(index = 1) {
  return { type: "addFrame" as const, frame: { id: createId(), durationMs: 100 }, index };
}

describe("DocumentSession", () => {
  test("commit applies the operations, bumps the version and records the transaction", () => {
    const session = newSession();
    const transaction = session.commit({
      label: "Add frame",
      actor: testActor,
      operations: [addFrameOperation()],
    });
    expect(session.document.frames).toHaveLength(2);
    expect(session.version).toBe(1);
    expect(transaction).toMatchObject({ label: "Add frame", actor: testActor, baseVersion: 0 });
    expect(session.transactions).toEqual([transaction]);
  });

  test("undo and redo step through history and are logged as transactions", () => {
    const session = newSession();
    const initial = session.document;
    session.commit({ label: "Add frame", actor: testActor, operations: [addFrameOperation()] });
    const edited = session.document;

    expect(session.undoLabel).toBe("Add frame");
    const undoTransaction = session.undo(testActor);
    expect(session.document).toStrictEqual(initial);
    expect(undoTransaction?.label).toBe("Undo Add frame");
    expect(session.redoLabel).toBe("Add frame");

    session.redo(testActor);
    expect(session.document).toStrictEqual(edited);
    expect(session.transactions.map((t) => t.label)).toEqual([
      "Add frame",
      "Undo Add frame",
      "Redo Add frame",
    ]);
    expect(session.version).toBe(3);
  });

  test("a new commit clears the redo stack", () => {
    const session = newSession();
    session.commit({ label: "First", actor: testActor, operations: [addFrameOperation()] });
    session.undo(testActor);
    session.commit({ label: "Second", actor: testActor, operations: [addFrameOperation()] });
    expect(session.canRedo).toBe(false);
    expect(session.redo(testActor)).toBeUndefined();
  });

  test("undo with an empty history does nothing", () => {
    const session = newSession();
    expect(session.undo(testActor)).toBeUndefined();
    expect(session.version).toBe(0);
  });

  test("a failing transaction changes nothing, even if earlier operations succeeded", () => {
    const session = newSession("indexed");
    const before = session.document;
    const listener = vi.fn();
    session.subscribe(listener);

    expect(() =>
      session.commit({
        label: "Broken",
        actor: testActor,
        // Adding the frame succeeds, but a transparent index outside the palette breaks a
        // document rule that is checked when the transaction ends.
        operations: [addFrameOperation(), { type: "setSpriteProperties", transparentIndex: 200 }],
      }),
    ).toThrow(DocumentInvariantError);

    expect(session.document).toBe(before);
    expect(session.version).toBe(0);
    expect(session.transactions).toEqual([]);
    expect(session.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  test("applyTransaction rejects transactions built against another version", () => {
    const session = newSession();
    const transaction = {
      id: createId(),
      label: "Add frame",
      actor: testActor,
      baseVersion: 5,
      operations: [addFrameOperation()],
    };
    expect(() => session.applyTransaction(transaction)).toThrow(VersionConflictError);
  });

  test("subscribers are notified on every change until they unsubscribe", () => {
    const session = newSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.commit({ label: "Add frame", actor: testActor, operations: [addFrameOperation()] });
    session.undo(testActor);
    unsubscribe();
    session.redo(testActor);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toBe(session.document);
  });
});
