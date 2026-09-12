// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    DefaultShortcuts,
    type IApplication,
    type IService,
    Logger,
    PubSub,
} from "@draftworks/core";

export interface Keys {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export interface HotkeyMap {
    [key: string]: CommandKeys;
}

const hasModifier = (e: KeyboardEvent) => e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;

export class HotkeyService implements IService {
    protected keys: string[] = [];
    private app?: IApplication;
    private readonly _keyMap = new Map<string, CommandKeys>();

    constructor() {
        this.loadProfile();
    }

    private loadProfile() {
        this._keyMap.clear();

        for (const [command, keyOrKeys] of Object.entries(DefaultShortcuts)) {
            if (Array.isArray(keyOrKeys)) {
                keyOrKeys.forEach((k) => this._keyMap.set(k.toLowerCase(), command as CommandKeys));
            } else if (typeof keyOrKeys === "string") {
                this._keyMap.set(keyOrKeys.toLowerCase(), command as CommandKeys);
            }
        }
        Logger.info("Loaded shortcuts");
    }

    register(app: IApplication): void {
        this.app = app;
        Logger.info(`${HotkeyService.name} registed`);
    }

    start(): void {
        PubSub.default.sub("executeCommand", this.executeCommand);
        window.addEventListener("keydown", this.eventHandlerKeyDown);
        window.addEventListener("keydown", this.commandKeyDown);
        Logger.info(`${HotkeyService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("executeCommand", this.executeCommand);
        window.removeEventListener("keydown", this.eventHandlerKeyDown);
        window.removeEventListener("keydown", this.commandKeyDown);
        Logger.info(`${HotkeyService.name} stoped`);
    }

    private readonly executeCommand = (_commandName: CommandKeys) => {
        this.keys = [];
    };

    protected canHandleKey(e: KeyboardEvent): boolean {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
            // The command line holds focus almost all the time, so treating it like any
            // other text box would make Ctrl+S, Delete and the Shift shortcuts dead
            // everywhere. It opts in, and only for combinations that carry a modifier -
            // plain typing still belongs to the box. A matched shortcut calls
            // preventDefault below, so the character is never typed as well.
            return target.dataset["chiliHotkeys"] === "true" && hasModifier(e);
        }
        return true;
    }

    private readonly eventHandlerKeyDown = (e: KeyboardEvent) => {
        if (!this.canHandleKey(e)) return;

        const visual = this.app?.activeView?.document?.visual;
        const view = this.app?.activeView;
        if (view && visual) {
            if (visual.eventHandler.isEnabled) visual.eventHandler.keyDown(view, e);
            if (visual.viewHandler.isEnabled) visual.viewHandler.keyDown(view, e);
        }
    };

    private readonly commandKeyDown = (e: KeyboardEvent) => {
        if (!this.canHandleKey(e)) return;

        const keys: Keys = {
            key: e.key.toLowerCase(),
            ctrlKey: e.ctrlKey || e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
        };

        const command = this.getCommand(keys);
        if (command !== undefined) {
            e.preventDefault();
            e.stopImmediatePropagation();
            PubSub.default.pub("executeCommand", command);
        }
    };

    getCommand(keys: Keys): CommandKeys | undefined {
        const maxKeyLength = 20;
        const totleLength = this.keys.length + keys.key.length;
        if (totleLength > maxKeyLength) {
            this.keys = this.keys.slice(totleLength - maxKeyLength);
        }
        this.keys.push(keys.key);

        for (let i = 0; i < this.keys.length; i++) {
            let key = this.keys.slice(i).join("+");
            if (keys.ctrlKey) key = `ctrl+${key}`;
            if (keys.shiftKey) key = `shift+${key}`;
            if (keys.altKey) key = `alt+${key}`;
            if (this._keyMap.has(key)) {
                return this._keyMap.get(key);
            }
        }
        return undefined;
    }

    addMap(map: HotkeyMap) {
        const keys = Object.keys(map);
        keys.forEach((key) => {
            this._keyMap.set(key.toLowerCase(), map[key]);
        });
    }
}
