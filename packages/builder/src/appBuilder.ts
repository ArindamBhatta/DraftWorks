import {
    Application,
    CommandService,
    FunctionKeyService,
    HotkeyService,
    ShowPropertyEventHandler,
} from "@draftworks/app";
import {
    AutosaveService,
    Config,
    Constants,
    DimensionSetup,
    findMostRecentDocument,
    I18n,
    type IApplication,
    type IDataExchange,
    type IService,
    type IShapeProvider,
    type IStorage,
    type IVisualFactory,
    type IWindow,
    type Locale,
    Logger,
    UnitSetup,
} from "@draftworks/core";

import { DefaultDataExchange } from "./defaultDataExchange";

export class AppBuilder {
    protected readonly _inits: (() => Promise<void>)[] = [];
    protected _storage?: IStorage;
    protected _visualFactory?: IVisualFactory;
    protected _shapeProvider?: IShapeProvider;
    protected _window?: IWindow;

    constructor() {
        this.initI18n();
        this.initConfig();
        this.ensureAPI();
    }

    protected ensureAPI() {
        this._inits.push(async () => {
            Logger.info("initializing api");

            (globalThis as any).Chili3dCore = await import("@draftworks/core");
            (globalThis as any).Chili3dElement = await import("@draftworks/element");
        });
    }

    protected initConfig() {
        Config.instance.init("config");
        // Before anything formats a length: units and dimension style are chosen once and
        // then expected to stay chosen, so they come back from the last session rather
        // than resetting to the defaults and re-asking on every reload.
        UnitSetup.restore();
        DimensionSetup.restore();
        return this;
    }

    protected initI18n() {
        this._inits.push(async () => {
            Logger.info("initializing i18n");

            const i18n = await import("@draftworks/i18n");
            for (const key of Object.keys(i18n)) {
                I18n.addLanguage((i18n as { [key: string]: Locale })[key]);
            }
        });
    }

    useIndexedDB() {
        this._inits.push(async () => {
            Logger.info("initializing IndexedDBStorage");

            const db = await import("@draftworks/storage");
            this._storage = new db.IndexedDBStorage();
            await this._storage.createDBIfNeeded(Constants.DBName, [
                Constants.DocumentTable,
                Constants.RecentTable,
                Constants.DocumentBackupTable,
                Constants.SyncQueueTable,
                Constants.AiChatTable,
            ]);
        });
        return this;
    }

    useWasmOcc() {
        this._inits.push(async () => {
            // pushed onto a queue, not run yet
            Logger.info("initializing wasm occ");

            const wasm = await import("@draftworks/wasm");
            await wasm.initWasm(); //the actual wasm load
            this._shapeProvider = new wasm.OccShapeProvider();
        });
        return this;
    }

    useThree(): this {
        this._inits.push(async () => {
            Logger.info("initializing three");

            const three = await import("@draftworks/three");
            this._visualFactory = new three.ThreeVisulFactory((d) => new ShowPropertyEventHandler(d));
        });
        return this;
    }

    useUI(): this {
        this._inits.push(async () => {
            Logger.info("initializing MainWindow");

            const ui = await import("@draftworks/ui");
            const app = document.getElementById("app") as HTMLElement;
            this._window = new ui.MainWindow(await this.getRibbonTabs(), "iconfont.js", app);
        });
        return this;
    }

    async getRibbonTabs() {
        const defaultRibbon = await import("./ribbon");
        return defaultRibbon.DefaultRibbon;
    }

    async build(): Promise<IApplication> {
        for (const init of this._inits) {
            await init();
        }
        this.ensureNecessary();

        const app = this.createApp();
        await this._window?.init(app);
        await this.ensureActiveDocument(app);

        Logger.info("Application build completed");

        return app;
    }

    /**
     * There is no start-up Home screen any more - the app opens straight into the
     * drawing editor, AutoCAD-style, so it needs a drawing to open into. A plugin may
     * already have created one, hence the activeView guard. Anything the caller imports
     * afterwards (a startup file URL, a dropped file) lands in this drawing.
     *
     * Reopens the drawing you were last working on rather than always starting a blank
     * one. Autosave has been writing it to IndexedDB every couple of seconds; without
     * this it was writing to a store nothing ever read back, which from the outside looks
     * exactly like the drawing being lost.
     */
    protected async ensureActiveDocument(app: IApplication) {
        if (app.activeView) return;
        if (await this.reopenLastDocument(app)) return;

        await app.newDocument("Drawing1");
    }

    /**
     * Tries to restore the most recently saved drawing. Returns false - leaving the
     * caller to open a blank one - when there is nothing to restore, or when restoring
     * fails for any reason. A corrupt or unreadable saved drawing must degrade to an
     * empty editor, never to an app that will not start.
     */
    protected async reopenLastDocument(app: IApplication): Promise<boolean> {
        try {
            const recent = await findMostRecentDocument(app.storage);
            if (!recent) return false;

            Logger.info(`reopening the last drawing: ${recent.name}`);
            const document = await app.openDocument(recent.id);
            return document !== undefined;
        } catch (error) {
            Logger.warn("could not reopen the last drawing, starting a blank one", error);
            return false;
        }
    }

    createApp() {
        return new Application({
            storage: this._storage!,
            shapeProvider: this._shapeProvider!,
            visualFactory: this._visualFactory!,
            services: this.getServices(),
            mainWindow: this._window,
            dataExchange: this.initDataExchange(),
        });
    }

    initDataExchange(): IDataExchange {
        return new DefaultDataExchange();
    }

    private ensureNecessary() {
        if (this._shapeProvider === undefined) {
            throw new Error("ShapeProvider not set");
        }
        if (this._visualFactory === undefined) {
            throw new Error("VisualFactory not set");
        }
        if (this._storage === undefined) {
            throw new Error("storage has not been initialized");
        }
    }

    protected getServices(): IService[] {
        return [new CommandService(), new HotkeyService(), new FunctionKeyService(), new AutosaveService()];
    }
}
