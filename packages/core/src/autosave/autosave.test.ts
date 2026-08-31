// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Autosave has three promises that are easy to break silently, because breaking them
// looks like nothing at all until someone loses a drawing: it must coalesce a burst of
// edits into one write, it must never let a caller wait on a save, and it must have the
// previous version somewhere before it overwrites the current one.

import { expect, test } from "@rstest/core";
import { Constants } from "../constants";
import type { IDocument } from "../document";
import type { IStorage } from "../foundation";
import type { Serialized } from "../serialize";
import { AutosaveScheduler, type TimerFactory, type TimerHandle } from "./autosaveScheduler";
import { AutosaveStore, findMostRecentDocument, readDocumentWithFallback } from "./autosaveStore";

/** An IStorage backed by a Map, recording the order writes actually landed in. */
class FakeStorage implements IStorage {
    readonly data = new Map<string, any>();
    readonly writes: string[] = [];
    failOn?: string;

    private key(table: string, id: string) {
        return `${table}/${id}`;
    }

    async createDBIfNeeded(): Promise<void> {}

    async get(_database: string, table: string, id: string): Promise<any> {
        return this.data.get(this.key(table, id));
    }

    async put(_database: string, table: string, id: string, value: any): Promise<boolean> {
        const key = this.key(table, id);
        if (this.failOn === table) throw new Error(`storage refused a write to ${table}`);
        this.writes.push(key);
        this.data.set(key, value);
        return true;
    }

    async delete(_database: string, table: string, id: string): Promise<boolean> {
        return this.data.delete(this.key(table, id));
    }

    async page(_database: string, table: string): Promise<any[]> {
        return Array.from(this.data.entries())
            .filter(([key]) => key.startsWith(`${table}/`))
            .map(([, value]) => value);
    }
}

/** Holds pending callbacks so a test can advance the debounce window by hand. */
class ManualTimers {
    private pending: (() => void)[] = [];

    readonly factory: TimerFactory = (callback): TimerHandle => {
        this.pending.push(callback);
        return {
            cancel: () => {
                this.pending = this.pending.filter((x) => x !== callback);
            },
        };
    };

    get pendingCount() {
        return this.pending.length;
    }

    /** Fire everything currently scheduled, then let the save's promise chain drain. */
    async fire() {
        const due = this.pending;
        this.pending = [];
        due.forEach((callback) => {
            callback();
        });
        await flushMicrotasks();
    }
}

/** Autosave awaits several storage calls in sequence; a few turns settles them all. */
async function flushMicrotasks() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

function fakeDocument(id = "doc-1", name = "Drawing1") {
    let counter = 0;
    return {
        id,
        name,
        serialize: () => ({ id, name, revision: ++counter }) as unknown as Serialized,
    } as unknown as IDocument;
}

function setup(options: { remote?: any; isOnline?: () => boolean } = {}) {
    const storage = new FakeStorage();
    const timers = new ManualTimers();
    const document = fakeDocument();
    const scheduler = new AutosaveScheduler(document, new AutosaveStore(storage), {
        timerFactory: timers.factory,
        now: () => 1000,
        isOnline: options.isOnline ?? (() => true),
        remote: options.remote,
    });
    return { storage, timers, document, scheduler };
}

const documentKey = `${Constants.DocumentTable}/doc-1`;
const backupKey = `${Constants.DocumentBackupTable}/doc-1`;
const queueKey = `${Constants.SyncQueueTable}/doc-1`;

test("a drawing nobody has edited claims nothing", () => {
    const { scheduler } = setup();
    expect(scheduler.state).toBe("idle");
});

test("an edit does not write until the quiet window elapses", async () => {
    const { storage, timers, scheduler } = setup();

    scheduler.notify();
    expect(scheduler.state).toBe("pending");
    expect(storage.writes).toEqual([]);

    await timers.fire();
    expect(storage.data.has(documentKey)).toBe(true);
    expect(scheduler.state).toBe("saved");
});

test("a burst of edits collapses into one write", async () => {
    const { storage, timers, scheduler } = setup();

    // Six changes in a row - a drag landing history records, not six pauses.
    for (let i = 0; i < 6; i++) scheduler.notify();
    expect(timers.pendingCount).toBe(1);

    await timers.fire();
    expect(storage.data.get(documentKey).revision).toBe(1);
});

test("notify() returns before the save runs, so drawing never waits on IndexedDB", () => {
    const { storage, scheduler } = setup();

    scheduler.notify();

    // Nothing has touched storage by the time the caller has control back.
    expect(storage.writes).toEqual([]);
    expect(scheduler.state).toBe("pending");
});

test("the previous save reaches the backup slot before the primary is overwritten", async () => {
    const { storage, timers, scheduler } = setup();

    scheduler.notify();
    await timers.fire();
    const firstRevision = storage.data.get(documentKey).revision;

    scheduler.notify();
    await timers.fire();

    // Order matters: the old drawing has to be durable elsewhere before its slot is reused.
    const secondSaveWrites = storage.writes.slice(2);
    expect(secondSaveWrites.indexOf(backupKey)).toBeLessThan(secondSaveWrites.indexOf(documentKey));
    expect(storage.data.get(backupKey).revision).toBe(firstRevision);
    expect(storage.data.get(documentKey).revision).toBe(firstRevision + 1);
});

test("the first save has no previous version to demote", async () => {
    const { storage, timers, scheduler } = setup();

    scheduler.notify();
    await timers.fire();

    expect(storage.data.has(backupKey)).toBe(false);
});

test("a drawing whose primary slot was lost opens from the backup", async () => {
    const { storage, timers, scheduler } = setup();

    scheduler.notify();
    await timers.fire();
    scheduler.notify();
    await timers.fire();

    // A save interrupted after the backup landed but before the primary committed.
    storage.data.delete(documentKey);

    const recovered = await readDocumentWithFallback(storage, "doc-1");
    expect(recovered).toBeDefined();
    expect((recovered as any).revision).toBe(1);
});

test("an edit arriving mid-save earns its own save rather than being swallowed", async () => {
    const { storage, timers, scheduler } = setup();

    scheduler.notify();
    const firstSave = scheduler.flush();
    // Lands while the write above is still in flight.
    scheduler.notify();
    await firstSave;
    await flushMicrotasks();

    expect(timers.pendingCount).toBe(1);
    await timers.fire();
    expect(storage.data.get(documentKey).revision).toBe(2);
});

test("a failed local write is reported, kept dirty, and retried", async () => {
    const { storage, timers, scheduler } = setup();
    storage.failOn = Constants.DocumentTable;

    scheduler.notify();
    await timers.fire();

    expect(scheduler.state).toBe("error");
    expect(scheduler.hasUnsavedChanges).toBe(true);
    expect(timers.pendingCount).toBe(1);

    storage.failOn = undefined;
    await timers.fire();
    expect(scheduler.state).toBe("saved");
});

test("with no remote registered, a local write is the whole job", async () => {
    const { timers, scheduler, storage } = setup();

    scheduler.notify();
    await timers.fire();

    expect(scheduler.state).toBe("saved");
    expect(storage.data.has(queueKey)).toBe(false);
});

test("offline keeps saving locally and queues the sync", async () => {
    const remote = { push: async () => {} };
    const { storage, timers, scheduler } = setup({ remote, isOnline: () => false });

    scheduler.notify();
    await timers.fire();

    expect(scheduler.state).toBe("offline");
    expect(storage.data.has(documentKey)).toBe(true);
    expect(storage.data.has(queueKey)).toBe(true);
});

test("a remote that rejects is treated as offline, not as lost work", async () => {
    const remote = {
        push: async () => {
            throw new Error("network unreachable");
        },
    };
    const { storage, timers, scheduler } = setup({ remote });

    scheduler.notify();
    await timers.fire();

    expect(scheduler.state).toBe("offline");
    expect(storage.data.has(documentKey)).toBe(true);
    expect(storage.data.has(queueKey)).toBe(true);
});

test("reconnecting drains the queue without a further edit", async () => {
    let online = false;
    const pushed: string[] = [];
    const remote = {
        push: async (id: string) => {
            if (!online) throw new Error("network unreachable");
            pushed.push(id);
        },
    };
    const { storage, timers, scheduler } = setup({ remote, isOnline: () => online });

    scheduler.notify();
    await timers.fire();
    expect(scheduler.state).toBe("offline");

    online = true;
    await scheduler.retrySync();

    expect(pushed).toEqual(["doc-1"]);
    expect(storage.data.has(queueKey)).toBe(false);
    expect(scheduler.state).toBe("saved");
});

test("retrying with nothing queued does not push", async () => {
    const pushed: string[] = [];
    const remote = { push: async (id: string) => void pushed.push(id) };
    const { timers, scheduler } = setup({ remote });

    scheduler.notify();
    await timers.fire();
    expect(pushed).toEqual(["doc-1"]);

    await scheduler.retrySync();
    expect(pushed).toEqual(["doc-1"]);
});

test("saveNow writes a drawing that autosave considers clean", async () => {
    const { storage, scheduler } = setup();

    await scheduler.saveNow();

    expect(storage.data.has(documentKey)).toBe(true);
    expect(scheduler.state).toBe("saved");
});

test("disposing cancels the pending write", async () => {
    const { storage, timers, scheduler } = setup();

    scheduler.notify();
    scheduler.dispose();
    await timers.fire();

    expect(storage.writes).toEqual([]);
});

test("the recents entry keeps the thumbnail autosave did not render", async () => {
    const { storage, timers, scheduler } = setup();
    storage.data.set(`${Constants.RecentTable}/doc-1`, { id: "doc-1", name: "Drawing1", image: "png" });

    scheduler.notify();
    await timers.fire();

    const recent = storage.data.get(`${Constants.RecentTable}/doc-1`);
    expect(recent.image).toBe("png");
    expect(recent.date).toBe(1000);
});

// The "leave site?" prompt hangs off this, so it has to mean "work would be lost" and
// not merely "a drawing is open" - see Application.handleWindowUnload.
test("nothing is owed before the first edit", () => {
    const { scheduler } = setup();

    expect(scheduler.hasPendingWork).toBe(false);
});

test("an edit inside the debounce window is still owed", () => {
    const { scheduler } = setup();

    scheduler.notify();

    expect(scheduler.hasPendingWork).toBe(true);
});

test("a completed save owes nothing", async () => {
    const { timers, scheduler } = setup();

    scheduler.notify();
    await timers.fire();

    expect(scheduler.hasPendingWork).toBe(false);
});

test("a write still in flight counts as owed, though it reads as clean", async () => {
    let release: (() => void) | undefined;
    const storage = new FakeStorage();
    const timers = new ManualTimers();
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    const slow = Object.assign(Object.create(Object.getPrototypeOf(storage)), storage, {
        put: async (...args: [string, string, string, any]) => {
            await blocked;
            return storage.put(...args);
        },
    });
    const scheduler = new AutosaveScheduler(fakeDocument(), new AutosaveStore(slow), {
        timerFactory: timers.factory,
        now: () => 1000,
        isOnline: () => true,
    });

    scheduler.notify();
    await timers.fire();

    // The dirty flag is cleared when the write starts, so it alone would say "safe to go".
    expect(scheduler.hasUnsavedChanges).toBe(false);
    expect(scheduler.hasPendingWork).toBe(true);

    release?.();
    await flushMicrotasks();
    expect(scheduler.hasPendingWork).toBe(false);
});

test("a failed write leaves work owed until the retry lands", async () => {
    const { storage, timers, scheduler } = setup();
    storage.failOn = Constants.DocumentTable;

    scheduler.notify();
    await timers.fire();
    expect(scheduler.hasPendingWork).toBe(true);

    storage.failOn = undefined;
    await timers.fire();
    expect(scheduler.hasPendingWork).toBe(false);
});

// Saving every two seconds is only half a promise if start-up then opens a blank sheet.
// findMostRecentDocument is what tells start-up which drawing to reopen.
test("the most recently saved drawing is the one offered back", async () => {
    const storage = new FakeStorage();
    await storage.put("db", Constants.RecentTable, "old", { id: "old", name: "Old", date: 100 });
    await storage.put("db", Constants.RecentTable, "new", { id: "new", name: "New", date: 900 });
    await storage.put("db", Constants.RecentTable, "mid", { id: "mid", name: "Mid", date: 500 });

    const recent = await findMostRecentDocument(storage);

    expect(recent?.id).toBe("new");
});

test("a browser that has never saved anything offers nothing", async () => {
    expect(await findMostRecentDocument(new FakeStorage())).toBeUndefined();
});

test("an unreadable recents table degrades to a blank start rather than a crash", async () => {
    const broken = Object.assign(new FakeStorage(), {
        page: async () => {
            throw new Error("object store missing");
        },
    });

    expect(await findMostRecentDocument(broken)).toBeUndefined();
});

test("malformed recents rows are skipped", async () => {
    const storage = new FakeStorage();
    await storage.put("db", Constants.RecentTable, "junk", { name: "no id" });
    await storage.put("db", Constants.RecentTable, "good", { id: "good", name: "Good", date: 5 });

    expect((await findMostRecentDocument(storage))?.id).toBe("good");
});

test("a save makes the drawing findable at start-up", async () => {
    const { storage, timers, scheduler } = setup();

    scheduler.notify();
    await timers.fire();

    expect((await findMostRecentDocument(storage))?.id).toBe("doc-1");
});
