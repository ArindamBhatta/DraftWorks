import type { IApplication } from "../application";
import type { IDocument } from "../document";
import { Logger, PubSub } from "../foundation";
import type { IService } from "../service";
import { AutosaveScheduler, type AutosaveSchedulerOptions } from "./autosaveScheduler";
import { AutosaveStore } from "./autosaveStore";

/**
 * Wires the document's dirty signal to one scheduler per open drawing.
 *
 * The service owns no save logic of its own - it subscribes to `documentDirty` (raised
 * by History, the same event that grows the undo stack) and forwards it. Everything
 * about *when* and *how* a save happens lives in AutosaveScheduler.
 */
export class AutosaveService implements IService {
    /**
     * The running instance, so the save indicator can find a drawing's scheduler without
     * the UI package having to reach into the app package to get one. Matches how
     * `Config.instance` and `getCurrentApplication()` are already reached.
     */
    static #instance?: AutosaveService;
    static get instance(): AutosaveService | undefined {
        return AutosaveService.#instance;
    }

    private readonly schedulers = new Map<IDocument, AutosaveScheduler>();
    private store?: AutosaveStore;

    constructor(private readonly options: AutosaveSchedulerOptions = {}) {}

    register(app: IApplication): void {
        this.store = new AutosaveStore(app.storage);
        Logger.info(`${AutosaveService.name} registed`);
    }

    start(): void {
        AutosaveService.#instance = this;
        PubSub.default.sub("documentDirty", this.onDocumentDirty);
        PubSub.default.sub("documentClosed", this.onDocumentClosed);
        globalThis.addEventListener?.("online", this.onOnline);
        // `pagehide` rather than `beforeunload`: it is the one that fires on mobile and
        // on bfcache eviction, where `beforeunload` is skipped outright.
        globalThis.addEventListener?.("pagehide", this.onPageHide);
        Logger.info(`${AutosaveService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("documentDirty", this.onDocumentDirty);
        PubSub.default.remove("documentClosed", this.onDocumentClosed);
        globalThis.removeEventListener?.("online", this.onOnline);
        globalThis.removeEventListener?.("pagehide", this.onPageHide);
        this.schedulers.forEach((scheduler) => {
            scheduler.dispose();
        });
        this.schedulers.clear();
        if (AutosaveService.#instance === this) AutosaveService.#instance = undefined;
        Logger.info(`${AutosaveService.name} stoped`);
    }

    /**
     * This drawing's scheduler, created on first ask.
     *
     * Lazy because there is no `documentCreated` event to hang eager creation off, and
     * because a drawing nobody has edited and nobody is displaying does not need one.
     * A scheduler that exists but has never been notified sits in `idle`.
     */
    schedulerOf(document: IDocument): AutosaveScheduler | undefined {
        if (!this.store) return undefined;

        let scheduler = this.schedulers.get(document);
        if (!scheduler) {
            scheduler = new AutosaveScheduler(document, this.store, this.options);
            this.schedulers.set(document, scheduler);
        }
        return scheduler;
    }

    /** Save every drawing with outstanding changes and wait for all of them. */
    async flushAll(): Promise<void> {
        await Promise.all(Array.from(this.schedulers.values(), (scheduler) => scheduler.flush()));
    }

    /**
     * Whether any open drawing still owes the store a write. This is the only honest
     * basis for a "you may lose work" prompt on unload - with autosave running, an open
     * drawing is not by itself a reason to warn anybody.
     */
    hasPendingWork(): boolean {
        return Array.from(this.schedulers.values()).some((scheduler) => scheduler.hasPendingWork);
    }

    private readonly onDocumentDirty = (document: IDocument) => {
        this.schedulerOf(document)?.notify();
    };

    private readonly onDocumentClosed = (document: IDocument) => {
        // `Document.close` has already offered an explicit save by this point, so a
        // pending autosave here would only rewrite what the user just decided about.
        this.schedulers.get(document)?.dispose();
        this.schedulers.delete(document);
    };

    private readonly onOnline = () => {
        this.schedulers.forEach((scheduler) => {
            void scheduler.retrySync().catch((error) => {
                Logger.warn("autosave failed to resync after reconnecting", error);
            });
        });
    };

    private readonly onPageHide = () => {
        // Unload gives us no time to await anything, so this is best-effort: it starts
        // the writes that were still sitting in a debounce window. The version-safe
        // ordering in AutosaveStore is what covers the ones that do not finish.
        void this.flushAll();
    };
}
