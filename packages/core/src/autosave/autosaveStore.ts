// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Constants } from "../constants";
import type { IStorage } from "../foundation";
import { Logger } from "../foundation";
import type { Serialized } from "../serialize";

/**
 * The IndexedDB half of autosave: one primary slot per drawing, one prior slot behind it.
 *
 * The primary slot holds exactly what a manual `doc.save` writes - a bare `Serialized` in
 * `Constants.DocumentTable` - so `Document.open`, the recents list, and file export all
 * keep reading what they already read. Autosave adds a second table and nothing else.
 *
 * Write order is backup first, then primary. That ordering is the whole guarantee: the
 * previous drawing is durable somewhere else before the slot holding it is touched, so a
 * tab that dies between the two writes leaves the old drawing in both slots rather than
 * one slot and a gap. IndexedDB commits a single put atomically, so the primary is never
 * half-written - what the backup actually buys is a fallback for the save that failed
 * *before* the put, on a serializer that threw partway through a half-built node.
 */
export class AutosaveStore {
    /**
     * What we believe is sitting in the primary slot. Kept so a save costs one read of
     * the previous drawing at most - the first one - instead of re-reading megabytes of
     * geometry out of IndexedDB before every write. The cost is holding one extra
     * serialized copy in memory; the alternative was paying a full read per keystroke-
     * sized edit.
     */
    #lastGood?: Serialized;

    constructor(private readonly storage: IStorage) {}

    /**
     * Demote the current primary to the backup slot, then write `data` over it. Rejects
     * if either write fails, leaving the caller to report the drawing as unsaved.
     */
    async save(id: string, data: Serialized): Promise<void> {
        const previous =
            this.#lastGood ?? (await this.storage.get(Constants.DBName, Constants.DocumentTable, id));
        if (previous !== undefined) {
            await this.storage.put(Constants.DBName, Constants.DocumentBackupTable, id, previous);
        }

        await this.storage.put(Constants.DBName, Constants.DocumentTable, id, data);
        this.#lastGood = data;
    }

    /** The save before the current one, or undefined when this drawing has only ever been saved once. */
    async readBackup(id: string): Promise<Serialized | undefined> {
        return await this.storage.get(Constants.DBName, Constants.DocumentBackupTable, id);
    }

    /**
     * Refresh the recents entry the way `Document.save` does, minus the thumbnail.
     *
     * Re-rendering the view to an image is a GPU readback that stalls the frame it lands
     * on, which is precisely what autosave promised not to do every two seconds. The
     * existing thumbnail is carried forward instead, so the recents list keeps the
     * picture from the last explicit save and gets a current name and timestamp.
     */
    async touchRecent(id: string, name: string, savedAt: number): Promise<void> {
        const existing = await this.storage.get(Constants.DBName, Constants.RecentTable, id);
        await this.storage.put(Constants.DBName, Constants.RecentTable, id, {
            ...existing,
            id,
            name,
            date: savedAt,
        });
    }

    /** Remember that `id` has local changes the remote has not accepted yet. */
    async enqueueSync(id: string, savedAt: number): Promise<void> {
        await this.storage.put(Constants.DBName, Constants.SyncQueueTable, id, { id, savedAt });
    }

    async dequeueSync(id: string): Promise<void> {
        await this.storage.delete(Constants.DBName, Constants.SyncQueueTable, id);
    }

    async isQueued(id: string): Promise<boolean> {
        return (await this.storage.get(Constants.DBName, Constants.SyncQueueTable, id)) !== undefined;
    }

    /**
     * The drawing as last written locally. Used to push a queued change after a
     * reconnect, when the in-memory document may have moved on or been closed.
     */
    async readSaved(id: string): Promise<Serialized | undefined> {
        return this.#lastGood ?? (await this.storage.get(Constants.DBName, Constants.DocumentTable, id));
    }
}

/** A row of the recents table, as `Document.save` and `AutosaveStore.touchRecent` write it. */
export interface RecentDocument {
    id: string;
    name: string;
    /** Epoch millis of the last save. */
    date: number;
    image?: string;
}

/**
 * The drawing saved most recently, or undefined if this browser has never saved one.
 *
 * The counterpart to autosave: saving every couple of seconds is only half a promise if
 * start-up then opens a blank sheet. Reads the recents table rather than the documents
 * table because the rows are small - ids and timestamps, not geometry - so picking the
 * newest costs one cheap scan instead of deserializing every drawing ever saved.
 */
export async function findMostRecentDocument(storage: IStorage): Promise<RecentDocument | undefined> {
    try {
        const page = (await storage.page(Constants.DBName, Constants.RecentTable, 0)) as RecentDocument[];
        return page
            ?.filter((entry) => typeof entry?.id === "string")
            .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
            .at(0);
    } catch (error) {
        // A missing or unreadable recents table must not stop the app from starting.
        Logger.warn("could not read the recent documents list", error);
        return undefined;
    }
}

/**
 * Read a drawing, falling back to the previous save when the primary slot is unusable.
 *
 * A missing primary alongside a present backup is the signature of a save that was
 * interrupted before it committed. Opening one edit stale beats opening nothing.
 */
export async function readDocumentWithFallback(
    storage: IStorage,
    id: string,
): Promise<Serialized | undefined> {
    const primary = await storage.get(Constants.DBName, Constants.DocumentTable, id);
    if (primary !== undefined) return primary;

    const backup = await storage.get(Constants.DBName, Constants.DocumentBackupTable, id);
    if (backup !== undefined) {
        Logger.warn(`document: ${id} missing from the primary slot, recovered from the previous save`);
    }
    return backup;
}
