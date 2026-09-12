// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AutosaveService,
    type CommandKeys,
    DOCUMENT_FILE_EXTENSION,
    I18n,
    type IApplication,
    type ICommand,
    type IDataExchange,
    type IDocument,
    type IPluginManager,
    type IService,
    type IShapeProvider,
    type IStorage,
    type IView,
    type IVisualFactory,
    type IWindow,
    Logger,
    Material,
    Observable,
    ObservableCollection,
    PLUGIN_FILE_EXTENSION,
    Plane,
    PubSub,
    type Serialized,
    setCurrentApplication,
    VisualConfig,
    type VisualItemConfig,
} from "@draftworks/core";
import { Document } from "./document";
import { PluginManager } from "./pluginManager";
import { importFiles } from "./utils";

export interface ApplicationOptions {
    visualFactory: IVisualFactory;
    shapeProvider: IShapeProvider;
    services: IService[];
    storage: IStorage;
    dataExchange: IDataExchange;
    mainWindow?: IWindow;
}

export class Application extends Observable implements IApplication {
    readonly dataExchange: IDataExchange;
    readonly visualFactory: IVisualFactory;
    readonly shapeProvider: IShapeProvider;
    readonly services: IService[];
    readonly storage: IStorage;
    readonly mainWindow?: IWindow;
    readonly pluginManager: IPluginManager;
    readonly views = new ObservableCollection<IView>();
    readonly documents: Set<IDocument> = new Set<IDocument>();

    lastCommand: CommandKeys | undefined;

    get executingCommand(): ICommand | undefined {
        return this.getPrivateValue("executingCommand", undefined);
    }
    set executingCommand(value: ICommand | undefined) {
        this.setProperty("executingCommand", value);
    }

    get activeView(): IView | undefined {
        return this.getPrivateValue("activeView", undefined);
    }
    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value, () => {
            PubSub.default.pub("activeViewChanged", value);
        });
    }

    constructor(option: ApplicationOptions) {
        super();

        setCurrentApplication(this);
        this.visualFactory = option.visualFactory;
        this.shapeProvider = option.shapeProvider;
        this.services = option.services;
        this.storage = option.storage;
        this.dataExchange = option.dataExchange;
        this.mainWindow = option.mainWindow;
        this.pluginManager = new PluginManager(this);
        this.services.forEach((x) => x.register(this));
        this.services.forEach((x) => x.start());
        this.initEvents();
    }

    private initEvents() {
        window.onbeforeunload = this.handleWindowUnload;
        this.mainWindow?.addEventListener("dragstart", this.handleDragStart);
        this.mainWindow?.addEventListener("dragover", this.handleDragOver);
        this.mainWindow?.addEventListener("drop", this.handleDrop);
        VisualConfig.onPropertyChanged(this.onVisualConfigChanged);
    }

    private readonly onVisualConfigChanged = (property: keyof VisualItemConfig) => {
        if (property === "defaultEdgeColor") {
            this.views.forEach((x) => x.update());
        }
    };

    /**
     * Warn on leaving only when work would actually be lost.
     *
     * This used to fire whenever a drawing was open, which predates autosave: with every
     * edit written a couple of seconds after it is made, an open drawing is almost always
     * a fully saved one, and prompting anyway trains people to click through a dialog
     * that is usually crying wolf. Now it asks autosave whether anything is still owed to
     * the store - a change inside the debounce window, a write in flight, or a failed
     * write awaiting retry - and stays silent otherwise, the way Drive does.
     *
     * The prompt is still worth showing in that narrow case: `beforeunload` cannot await,
     * so the seconds it buys are the only chance the pending write has to finish. The
     * flush itself is started from AutosaveService's own `pagehide` handler.
     *
     * With no autosave service running, fall back to the old always-warn behaviour -
     * nothing is saving anything, so an open drawing really is unsaved work.
     */
    private readonly handleWindowUnload = (event: BeforeUnloadEvent) => {
        if (!this.activeView) return;

        const autosave = AutosaveService.instance;
        if (autosave && !autosave.hasPendingWork()) return;

        // Cancel the event as stated by the standard.
        event.preventDefault();
        // Chrome requires returnValue to be set.
        event.returnValue = "";
    };

    private readonly handleDragStart = (ev: DragEvent) => {
        ev.preventDefault();
    };

    private readonly handleDragOver = (ev: DragEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (ev.dataTransfer) {
            ev.dataTransfer.dropEffect = "copy";
        }
    };

    private readonly handleDrop = (ev: DragEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        const files = this.extractDroppedFiles(ev.dataTransfer);
        this.importFiles(files);
    };

    async importFiles(files: File[] | FileList | undefined) {
        if (!files || files.length === 0) {
            return;
        }
        const { opens, imports, plugins } = this.groupFiles(files);
        this.loadPluginsWithLoading(plugins);
        this.loadDocumentsWithLoading(opens);
        importFiles(this, imports);
    }

    private loadPluginsWithLoading(plugins: File[]) {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                for (const pluginFile of plugins) {
                    await this.pluginManager.loadFromFile(pluginFile);
                }
            },
            "toast.excuting{0}",
            I18n.translate("command.doc.open"),
        );
    }

    private loadDocumentsWithLoading(opens: File[]) {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                for (const file of opens) {
                    const json: Serialized = JSON.parse(await file.text());
                    await this.loadDocument(json);
                    this.activeView?.cameraController.fitContent();
                }
            },
            "toast.excuting{0}",
            I18n.translate("command.doc.open"),
        );
    }

    private groupFiles(files: FileList | File[]) {
        const opens: File[] = [];
        const imports: File[] = [];
        const plugins: File[] = [];
        for (const element of files) {
            const fileName = element.name.toLowerCase();
            if (fileName.endsWith(DOCUMENT_FILE_EXTENSION)) {
                opens.push(element);
            } else if (fileName.endsWith(PLUGIN_FILE_EXTENSION)) {
                plugins.push(element);
            } else {
                imports.push(element);
            }
        }
        return { opens, imports, plugins };
    }

    private extractDroppedFiles(dataTransfer: DataTransfer | null): File[] {
        if (!dataTransfer) return [];
        const fromFileList = Array.from(dataTransfer.files ?? []);
        if (fromFileList.length > 0) return fromFileList;
        const fromItems = Array.from(dataTransfer.items ?? [])
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
        return fromItems;
    }

    async openDocument(id: string): Promise<IDocument | undefined> {
        const document = await Document.open(this, id);
        await this.createActiveView(document);
        return document;
    }

    async newDocument(name: string): Promise<IDocument> {
        const document = new Document(this, name);
        const lightGray = new Material({ document, name: "LightGray", color: 0xdedede });
        const deepGray = new Material({ document, name: "DeepGray", color: 0x898989 });
        document.modelManager.materials.push(lightGray, deepGray);
        await this.createActiveView(document);
        return document;
    }

    async loadDocument(data: Serialized): Promise<IDocument | undefined> {
        const document = await Document.load(this, data);
        await this.createActiveView(document);
        return document;
    }

    async loadFileFromUrl(url: string): Promise<void> {
        return Promise.try(async () => {
            const filename = url.substring(url.lastIndexOf("/") + 1);
            if (!filename || !filename.includes(".")) {
                throw new Error(`No file name in url: ${url}`);
            }

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch model: ${url}, statusText: ${response.statusText}`);
            }

            const blob = await response.blob();
            const file = new File([blob], filename, { type: blob.type });
            await this.importFiles([file]);
        }).catch((err) => {
            Logger.error(err);
        });
    }

    // Every document gets exactly one view, on the one drawing plane. There is no view
    // gizmo or working-plane command to switch it any more - see Plane.Top.
    protected async createActiveView(document: IDocument | undefined) {
        if (document === undefined) return undefined;
        const view = document.visual.createView("Top", Plane.Top);
        this.activeView = view;
    }
}
