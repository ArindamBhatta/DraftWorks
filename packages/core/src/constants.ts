// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export class Constants {
    static readonly DBName = "chili3d-db";
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
}
