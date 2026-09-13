import type { Serialized } from "../serialize";

/**
 * The optional server half of autosave.
 *
 * This repository ships no backend - compose.yml serves the built bundle from nginx and
 * the CAD kernel runs entirely in the browser - so nothing is registered here by
 * default and IndexedDB is the whole story. The seam exists because the offline queue
 * needs something to be offline *from*: with no remote, autosave settles on `saved`
 * after the local write; with one registered, a failed push settles on `offline` and
 * the id is queued for the next reconnect.
 *
 * A collaboration server would implement this and call `setAutosaveRemote` during
 * startup, without the scheduler, the store, or the indicator changing.
 */
export interface IAutosaveRemote {
    /**
     * Push one drawing upstream. Reject to mean "not delivered" - the caller queues the
     * id and retries; it must not throw for a rejection it wants treated as success.
     */
    push(id: string, data: Serialized): Promise<void>;
}

let remote: IAutosaveRemote | undefined;

export function setAutosaveRemote(value: IAutosaveRemote | undefined) {
    remote = value;
}

export function getAutosaveRemote(): IAutosaveRemote | undefined {
    return remote;
}
