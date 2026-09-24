// Autosave triggers off this callback, so "when does History say something changed" is
// now a load-bearing question rather than an internal detail. The cases that matter are
// the quiet ones: work that history deliberately ignores must stay quiet here too, or
// autosave starts writing during deserialization and rollbacks.

import { expect, test } from "@rstest/core";
import { History, type IHistoryRecord } from "./history";

function record(name = "test"): IHistoryRecord {
    return { name, undo: () => {}, redo: () => {}, dispose: () => {} };
}

function trackedHistory() {
    let changes = 0;
    const history = new History(() => changes++);
    return { history, changes: () => changes };
}

test("adding an undoable record announces a change", () => {
    const { history, changes } = trackedHistory();

    history.add(record());

    expect(changes()).toBe(1);
});

test("undo announces a change - the file still holds the edit just taken back", () => {
    const { history, changes } = trackedHistory();
    history.add(record());

    history.undo();

    expect(changes()).toBe(2);
});

test("redo announces a change", () => {
    const { history, changes } = trackedHistory();
    history.add(record());
    history.undo();

    history.redo();

    expect(changes()).toBe(3);
});

test("undo with an empty stack changes nothing and says nothing", () => {
    const { history, changes } = trackedHistory();

    history.undo();
    history.redo();

    expect(changes()).toBe(0);
});

test("work done while history is disabled stays silent", () => {
    // This is the path deserialization and Transaction.rollback run through. Announcing
    // here would have autosave rewriting a file the moment it was opened.
    const { history, changes } = trackedHistory();
    history.disabled = true;

    history.add(record());

    expect(changes()).toBe(0);
});

test("a history with no observer still works", () => {
    const history = new History();

    history.add(record());
    history.undo();

    expect(history.redoCount()).toBe(1);
});
