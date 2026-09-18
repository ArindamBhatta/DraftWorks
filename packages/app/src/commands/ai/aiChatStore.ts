import type { ConversationTurn } from "@draftworks/ai";
import { Constants, type IStorage, Logger } from "@draftworks/core";
import type { DrawingMode } from "@draftworks/generators";

/**
 * What a reload has to bring back.
 *
 * Only the prompts are stored, not the answers. A drawing is already on the canvas and
 * saved with the document, so re-rendering its preview from a stale transcript would put
 * a second picture of it in the panel - one that no longer has to match what is there.
 * The prompts are what cannot be recovered any other way, and they are what an edit acts
 * on. `turns` is the same history the router is handed, so a reloaded conversation can be
 * continued rather than only read.
 */
export interface StoredChat {
    prompts: string[];
    turns: ConversationTurn[];
}

/** Every tab's conversation for one drawing. Absent modes have simply never been used. */
export type StoredChats = Partial<Record<DrawingMode, StoredChat>>;

interface ChatRecord {
    version: 1;
    savedAt: number;
    modes: StoredChats;
}

/**
 * The AI Draft transcript, per drawing, in IndexedDB.
 *
 * Writes are fire-and-forget and failures are logged rather than surfaced: losing the
 * history of a conversation is a smaller thing than an error dialog over a drawing, and
 * there is nothing the draftsman could do about it anyway. Reads treat anything
 * unrecognised as absent, so a record left by an older shape of this file costs a blank
 * panel rather than a broken one.
 */
export class AiChatStore {
    constructor(private readonly storage: IStorage) {}

    async read(documentId: string): Promise<StoredChats> {
        try {
            const record: ChatRecord | undefined = await this.storage.get(
                Constants.DBName,
                Constants.AiChatTable,
                documentId,
            );
            if (record?.version !== 1 || !record.modes) return {};
            return record.modes;
        } catch (error) {
            Logger.error(`reading ai chat for ${documentId} failed`, error);
            return {};
        }
    }

    async write(documentId: string, modes: StoredChats): Promise<void> {
        const record: ChatRecord = { version: 1, savedAt: Date.now(), modes };
        try {
            await this.storage.put(Constants.DBName, Constants.AiChatTable, documentId, record);
        } catch (error) {
            Logger.error(`saving ai chat for ${documentId} failed`, error);
        }
    }

    async clear(documentId: string): Promise<void> {
        try {
            await this.storage.delete(Constants.DBName, Constants.AiChatTable, documentId);
        } catch (error) {
            Logger.error(`clearing ai chat for ${documentId} failed`, error);
        }
    }
}
