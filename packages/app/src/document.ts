// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AutosaveService,
    Constants,
    History,
    I18n,
    type IApplication,
    type IDocument,
    Id,
    InternalClassName,
    type IPicker,
    type ISelection,
    type IVisual,
    Logger,
    ModelManager,
    Observable,
    PubSub,
    readDocumentWithFallback,
    type Serialized,
} from "@chili3d/core";
import { Picker } from "./picker";
import { SelectionManager } from "./selectionManager";

export class Document extends Observable implements IDocument {
    readonly visual: IVisual;
    readonly history: History;
    readonly selection: ISelection;
    readonly picker: IPicker;
    readonly modelManager: ModelManager;
    userData: Record<string, unknown> = {};

    /** False until the constructor has finished scaffolding. See the History wiring below. */
    #ready = false;

    static readonly version = __DOCUMENT_VERSION__;

    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(name: string) {
        if (this.name === name) return;
        this.setProperty("name", name);
        if (this.modelManager.rootNode) this.modelManager.rootNode.name = name;
    }

    constructor(
        readonly application: IApplication,
        name: string,
        readonly id: string = Id.generate(),
    ) {
        super();
        this.setPrivateValue("name", name);
        // History first: ModelManager records undo entries for its collections (layers,
        // materials, components) and creates the mandatory layer 0 while constructing,
        // so document.history has to exist before it runs.
        //
        // Those construction records are also why the dirty signal is gated on `#ready`:
        // scaffolding a blank drawing is not the user editing anything, and publishing it
        // would have every app start autosave an empty "Drawing1" into the recents list.
        this.history = new History(() => {
            if (this.#ready) PubSub.default.pub("documentDirty", this);
        });
        this.modelManager = new ModelManager(this);
        this.selection = new SelectionManager(this);
        this.picker = new Picker(this);
        this.visual = application.visualFactory.create(this);

        application.documents.add(this);
        this.#ready = true;
    }

    serialize(): Serialized {
        const serialized = {
            [InternalClassName]: "Document",
            version: __DOCUMENT_VERSION__,
            id: this.id,
            name: this.name,
            models: this.modelManager.serialize(),
            userData: this.userData,
        };
        return serialized;
    }

    override disposeInternal(): void {
        super.disposeInternal();

        this.modelManager.dispose();
        this.visual.dispose();
        this.history.dispose();
        this.selection.dispose();
    }

    async save() {
        // Through the autosave scheduler when it is running, so the explicit save gets
        // the same previous-version demotion an autosave gets and the save indicator
        // settles instead of sitting on "unsaved" until the next debounce elapses.
        const scheduler = AutosaveService.instance?.schedulerOf(this);
        if (scheduler) {
            await scheduler.saveNow();
        } else {
            const data = this.serialize();
            await this.application.storage.put(Constants.DBName, Constants.DocumentTable, this.id, data);
        }

        // The thumbnail is only rendered on an explicit save - autosave leaves the last
        // one in place rather than stalling a frame on a GPU readback every few seconds.
        const image = this.application.activeView?.toImage();
        await this.application.storage.put(Constants.DBName, Constants.RecentTable, this.id, {
            id: this.id,
            name: this.name,
            date: Date.now(),
            image,
        });
    }

    async close() {
        if (window.confirm(I18n.translate("prompt.saveDocument{0}", this.name))) {
            await this.save();
        }

        const views = this.application.views.filter((x) => x.document === this);
        this.application.views.remove(...views);
        this.application.activeView = this.application.views.at(0);
        this.application.documents.delete(this);

        PubSub.default.pub("documentClosed", this);

        Logger.info(`document: ${this.name} closed`);
        this.dispose();
    }

    static async open(application: IApplication, id: string) {
        // Falls back to the previous save when the primary slot is gone - the signature
        // of a save interrupted before it committed. See autosave/autosaveStore.ts.
        const data = (await readDocumentWithFallback(application.storage, id)) as Serialized;
        if (data === undefined) {
            Logger.warn(`document: ${id} not find`);
            return;
        }
        const document = await Document.load(application, data);
        if (document !== undefined) {
            Logger.info(`document: ${document.name} opened`);
        }
        return document;
    }

    static async load(app: IApplication, data: Serialized): Promise<IDocument | undefined> {
        if ((data as any).version !== __DOCUMENT_VERSION__) {
            alert(
                "The file version has been upgraded, no compatibility treatment was done in the development phase",
            );
            return undefined;
        }
        const document = new Document(app, data["name"], data["id"]);
        document.history.disabled = true;
        if (data["userData"]) {
            document.userData = data["userData"];
        }

        await document.modelManager.deserialize(data["models"]);
        document.history.disabled = false;
        return document;
    }
}
