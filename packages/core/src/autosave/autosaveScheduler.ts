import type { IDocument } from "../document";
import { Logger, Observable } from "../foundation";
import type { Serialized } from "../serialize";
import { getAutosaveRemote, type IAutosaveRemote } from "./autosaveRemote";
import type { AutosaveState } from "./autosaveState";
import type { AutosaveStore } from "./autosaveStore";

/** Quiet time after the last edit before a save starts. */
export const AUTOSAVE_DELAY_MS = 2000;

/** How long to wait before retrying a local write that failed. */
const RETRY_DELAY_MS = 5000;

export interface TimerHandle {
    cancel(): void;
}

/** Injected so tests can drive the debounce window by hand instead of by clock. */
export type TimerFactory = (callback: () => void, ms: number) => TimerHandle;

const defaultTimerFactory: TimerFactory = (callback, ms) => {
    const handle = setTimeout(callback, ms);
    return { cancel: () => clearTimeout(handle) };
};

export interface AutosaveSchedulerOptions {
    delayMs?: number;
    timerFactory?: TimerFactory;
    now?: () => number;
    isOnline?: () => boolean;
    /** Overrides the globally registered remote. Mostly for tests. */
    remote?: IAutosaveRemote;
}

/**
 * One drawing's autosave loop.
 *
 * Two rules shape everything here. Nothing the user does ever awaits a save: `notify()`
 * only touches a timer, and the write runs as a promise nobody holds, so a command that
 * finishes while the last save is still in flight does not wait for it. And a save in
 * flight is never joined by a second one - a change arriving mid-write sets a flag and
 * the loop starts again once the current write settles, which keeps IndexedDB from
 * being handed two versions of the same drawing at once.
 */
export class AutosaveScheduler extends Observable {
    #timer?: TimerHandle;
    #dirty = false;
    #saving = false;
    #disposed = false;

    private readonly delayMs: number;
    private readonly timerFactory: TimerFactory;
    private readonly now: () => number;
    private readonly isOnline: () => boolean;
    private readonly explicitRemote?: IAutosaveRemote;

    /** Bindable - the save indicator listens through `onPropertyChanged`. */
    get state(): AutosaveState {
        return this.getPrivateValue("state", "idle");
    }

    get lastSavedAt(): number | undefined {
        return this.getPrivateValue("lastSavedAt", undefined);
    }

    private setState(value: AutosaveState) {
        this.setProperty("state", value);
    }

    /** True while an edit is known to be newer than the last completed local write. */
    get hasUnsavedChanges(): boolean {
        return this.#dirty;
    }

    /**
     * True while anything is still owed to the store: an edit waiting out the debounce,
     * a retry after a failed write, or a write currently in flight.
     *
     * `hasUnsavedChanges` alone is not enough to answer "is it safe to close the tab" -
     * it is cleared the moment a save starts, so a save still in flight reads as clean.
     */
    get hasPendingWork(): boolean {
        return this.#dirty || this.#saving;
    }

    constructor(
        readonly document: IDocument,
        private readonly store: AutosaveStore,
        options: AutosaveSchedulerOptions = {},
    ) {
        super();
        this.setPrivateValue("state", "idle");
        this.setPrivateValue("lastSavedAt", undefined);
        this.delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
        this.timerFactory = options.timerFactory ?? defaultTimerFactory;
        this.now = options.now ?? Date.now;
        this.isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine ?? true);
        this.explicitRemote = options.remote;
    }

    private get remote(): IAutosaveRemote | undefined {
        return this.explicitRemote ?? getAutosaveRemote();
    }

    /**
     * "The drawing changed." Restarts the quiet window, so a run of edits - a drag that
     * lands sixty history records, a command executed twice in a second - collapses into
     * one write once the user pauses.
     */
    notify(): void {
        if (this.#disposed) return;

        this.#dirty = true;
        if (this.state !== "saving") this.setState("pending");
        this.restartTimer(this.delayMs);
    }

    /**
     * Save now, skipping the quiet window, and resolve when the write has settled.
     *
     * The one place autosave is allowed to be awaited: closing a drawing or leaving the
     * page, where the alternative to waiting is losing the edit. Interactive paths call
     * `notify()` instead.
     */
    async flush(): Promise<void> {
        if (this.#disposed) return;

        this.#timer?.cancel();
        this.#timer = undefined;
        await this.run();
    }

    /**
     * Write the drawing whether or not it looks dirty, and settle the indicator.
     *
     * This is what the explicit `doc.save` command runs, so a manual save and an autosave
     * go through the same version-safe write and leave the indicator saying the same
     * thing. Saving an unchanged drawing on request is not a no-op - the user asked.
     */
    async saveNow(): Promise<void> {
        if (this.#disposed) return;

        this.#timer?.cancel();
        this.#timer = undefined;
        await this.run(true);
    }

    /**
     * Retry the queued remote push, if there is one. Called when connectivity returns;
     * a no-op when the local store is already in sync with the remote.
     */
    async retrySync(): Promise<void> {
        if (this.#disposed || this.#saving) return;
        if (!this.remote || !this.isOnline()) return;
        if (!(await this.store.isQueued(this.document.id))) return;

        const data = await this.store.readSaved(this.document.id);
        if (data === undefined) return;

        await this.push(data);
    }

    private restartTimer(ms: number) {
        this.#timer?.cancel();
        this.#timer = this.timerFactory(() => {
            this.#timer = undefined;
            // Deliberately not awaited - this is a timer callback, and the save has to
            // be able to run long without anything piling up behind it.
            void this.run();
        }, ms);
    }

    private async run(force = false): Promise<void> {
        if (this.#disposed || this.#saving) return;
        if (!this.#dirty && !force) return;

        this.#saving = true;
        // Cleared before the write, not after: an edit made while this save is in flight
        // must set it again and earn its own save, rather than being swallowed by this one.
        this.#dirty = false;
        this.setState("saving");

        try {
            const data = this.document.serialize();
            const savedAt = this.now();

            await this.store.save(this.document.id, data);
            await this.store.touchRecent(this.document.id, this.document.name, savedAt);
            this.setProperty("lastSavedAt", savedAt);

            await this.push(data);
        } catch (error) {
            // The local write is the one failure the user has to know about - nothing
            // durable holds this edit. Everything else degrades to "saved locally".
            Logger.error(`autosave failed for document ${this.document.id}`, error);
            this.#dirty = true;
            this.setState("error");
            this.restartTimer(RETRY_DELAY_MS);
        } finally {
            this.#saving = false;
        }

        if (this.#dirty && this.state !== "error") this.restartTimer(this.delayMs);
    }

    /**
     * Hand the saved drawing to the remote, or queue it. Never rethrows: the local write
     * already succeeded by this point, so a dead network is a status to display, not a
     * failure to propagate.
     */
    private async push(data: Serialized): Promise<void> {
        const remote = this.remote;
        if (!remote) {
            this.setState("saved");
            return;
        }

        if (!this.isOnline()) {
            await this.queueQuietly();
            this.setState("offline");
            return;
        }

        try {
            await remote.push(this.document.id, data);
            await this.store.dequeueSync(this.document.id);
            this.setState("saved");
        } catch (error) {
            Logger.warn(`autosave could not reach the remote for ${this.document.id}`, error);
            await this.queueQuietly();
            this.setState("offline");
        }
    }

    private async queueQuietly(): Promise<void> {
        try {
            await this.store.enqueueSync(this.document.id, this.now());
        } catch (error) {
            // The queue is a convenience - losing it costs a retry on reconnect, not work.
            Logger.warn(`autosave could not queue ${this.document.id} for sync`, error);
        }
    }

    protected override disposeInternal(): void {
        this.#disposed = true;
        this.#timer?.cancel();
        this.#timer = undefined;
        super.disposeInternal();
    }
}
