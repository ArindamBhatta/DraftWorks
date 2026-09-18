export class Constants {
    static readonly DBName = "draftworks-db";
    static readonly DocumentTable = "documents";
    static readonly RecentTable = "recents";
    /**
     * The save before the one in `DocumentTable`. Autosave copies the current primary
     * slot here before overwriting it, so a drawing survives a save that never
     * finished - the tab closed mid-write, the serializer threw on a half-built node.
     * See autosave/autosaveStore.ts.
     */
    static readonly DocumentBackupTable = "document-backups";
    /**
     * Ids whose local save has not reached the remote yet. Holds markers, not payloads -
     * the drawing itself is already in `DocumentTable`, and duplicating megabytes of
     * geometry per queued change would be the expensive way to remember one bit.
     */
    static readonly SyncQueueTable = "autosave-queue";
    /**
     * One AI Draft conversation per drawing, keyed by document id. Kept out of the
     * document itself: the transcript is how the drawing was arrived at, not part of it,
     * and nobody opening a shared file wants someone else's prompts inside their geometry.
     */
    static readonly AiChatTable = "ai-chats";
}
