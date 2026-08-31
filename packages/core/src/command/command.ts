import type { IApplication } from "../application";
import { type AsyncController, type IDisposable, Observable, PubSub } from "../foundation";
import { type Property, PropertyUtils, property } from "../property";

export interface ICommand {
    execute(application: IApplication): Promise<void>;
}

export interface ICancelableCommand extends ICommand, IDisposable {
    cancel(): Promise<void>;
}

export function isCancelableCommand(command: ICommand): command is ICancelableCommand {
    return "cancel" in command;
}

export abstract class CancelableCommand extends Observable implements ICancelableCommand {
    private static readonly _propertiesCache: Map<string, any> = new Map();
    protected readonly disposeStack: Set<IDisposable> = new Set();

    private _isCompleted: boolean = false;
    get isCompleted() {
        return this._isCompleted;
    }

    private _isCanceled: boolean = false;
    get isCanceled() {
        return this._isCanceled;
    }

    private _application: IApplication | undefined;
    get application() {
        if (!this._application) {
            throw new Error("application is not set");
        }
        return this._application;
    }

    get document() {
        return this.application.activeView?.document!;
    }

    #controller?: AsyncController;
    protected get controller() {
        return this.#controller;
    }
    protected set controller(value: AsyncController | undefined) {
        if (this.#controller === value) return;
        this.#controller?.dispose();
        this.#controller = value;
    }

    @property("common.cancel")
    async cancel() {
        this._isCanceled = true;

        this.controller?.cancel();
        while (!this._isCompleted) {
            await new Promise((r) => setTimeout(r, 30));
        }
    }

    get repeatOperation() {
        return this.getPrivateValue("repeatOperation", false);
    }

    set repeatOperation(value: boolean) {
        this.setProperty("repeatOperation", value);
    }

    protected _isRestarting: boolean = false;
    protected async restart() {
        this._isRestarting = true;
        await this.cancel();
    }

    protected onRestarting() {}

    async execute(application: IApplication): Promise<void> {
        if (!application.activeView?.document) return;
        this._application = application;

        await Promise.try(async () => {
            this.beforeExecute();

            await this.executeAsync();

            while (this._isRestarting || (!this.checkCanceled() && this.repeatOperation)) {
                this._isRestarting = false;

                this.onRestarting();
                await this.executeAsync();
            }
        }).finally(() => {
            this.afterExecute();
        });
    }

    protected checkCanceled() {
        if (this.isCanceled) {
            return true;
        }

        if (this.controller?.result?.status === "cancel") {
            return true;
        }

        return false;
    }

    protected abstract executeAsync(): Promise<void>;

    protected beforeExecute() {
        this.readProperties();
        PubSub.default.pub("openCommandContext", this);
    }

    protected afterExecute() {
        this.saveProperties();
        PubSub.default.pub("closeCommandContext");
        this.controller?.dispose();
        this.disposeStack.forEach((x) => x.dispose());
        this.disposeStack.clear();
        this._isCompleted = true;
    }

    private readProperties() {
        PropertyUtils.getProperties(this).forEach((x) => {
            const cacheKey = this.cacheKeyOfProperty(x);
            if (CancelableCommand._propertiesCache.has(cacheKey)) {
                this.setPrivateValue(x.name as keyof this, CancelableCommand._propertiesCache.get(cacheKey));
            }
        });
    }

    private saveProperties() {
        PropertyUtils.getProperties(this).forEach((x) => {
            const value = (this as any)[x.name];
            if (typeof value === "function") return;
            CancelableCommand._propertiesCache.set(this.cacheKeyOfProperty(x), value);
        });
    }

    /**
     * The cache is one static map shared by every command, so the key has to name the
     * command as well as the property. Keying on the bare property name let unrelated
     * commands overwrite each other's remembered settings whenever they happened to
     * agree on a name - Move's `isClone` became Mirror's, Circle's `mode` would become
     * any other command's `mode` - which also made it impossible for two commands to
     * hold different defaults for the same-named option.
     */
    private cacheKeyOfProperty(property: Property) {
        const commandKey = Object.getPrototypeOf(this)?.data?.key ?? "";
        return `${commandKey}.${property.name}`;
    }
}
