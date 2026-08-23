/**
 * PUBSUB EVENT SYSTEM - Decoupled Communication Architecture
 *
 * The heart of CAD UI responsiveness and inter-component communication:
 *
 * Key Events in 2D CAD:
 * - Selection changes → Update properties panel, highlight in viewport
 * - Model modifications → Redraw viewport, update undo/redo
 * - Layer visibility changes → Filter entities, redraw
 * - Drawing entity added → Update layers panel, model tree
 * - View changes (zoom, pan) → Redraw viewport, update status bar
 * - Command execution → Show input prompts, enable/disable tools
 * - Document open/close → Switch between multiple drawings
 *
 * Design Benefits:
 * 1. Loose coupling: CAD core doesn't depend on UI implementation
 * 2. Easy to add new UI panels without modifying drawing engine
 * 3. Efficient: only components that care get notified
 * 4. Supports undo/redo by publishing model changes for history
 * 5. Enables collaborative features (notify other users of changes)
 * 6. Multi-view support: same document in multiple viewports
 *
 * Typical flow:
 * User draws line → Core publishes "modelUpdate" → Viewport redraws → Properties show line props
 */

import type { CommandKeys, ICommand } from "../command";
import type { IDocument } from "../document";
import type { I18nKeys } from "../i18n";
import type { Material } from "../material";
import type { INode } from "../model";
import type { DialogButton, FloatPanelOptions } from "../ui";
import type { CursorType, IView } from "../visual";
import type { AsyncController } from "./asyncController";
import type { IDisposable } from "./disposable";
import type { MessageType } from "./messageType";
import type { Result } from "./result";

export interface PubSubEventMap {
    activeViewChanged: (view: IView | undefined) => void;
    clearFloatTip: () => void;
    clearInput: () => void;
    clearSelectionControl: () => void;
    clearStatusBarTip: () => void;
    closeCommandContext: () => void;
    displayError: (message: string) => void;
    documentClosed: (document: IDocument) => void;
    editMaterial: (document: IDocument, material: Material, callback: (material: Material) => void) => void;
    executeCommand: (commandName: CommandKeys) => void;
    modelUpdate: (model: INode) => void;
    openCommandContext: (command: ICommand) => void;
    parentVisibleChanged: (model: INode) => void;
    showDialog: (title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) => void;
    showFloatPanel: (options: FloatPanelOptions) => void;
    showFloatTip: (dom: HTMLElement | { level: MessageType; msg: string }) => void;
    /** Opens AutoCAD's Layer Properties Manager (the LA command). */
    showLayerPanel: (document: IDocument) => void;
    /**
     * Shows the flyout text box. `onCancelled` fires when the user dismisses it with
     * Escape - callers that block on the typed value (rather than just offering it
     * alongside a live pick, the way the snap handlers do) need that to unblock.
     */
    showInput: (
        text: string,
        handler: (text: string) => Result<string, I18nKeys>,
        onCancelled?: () => void,
    ) => void;
    showPermanent: (action: () => Promise<void>, message: I18nKeys, ...args: any[]) => void;
    /** Fills whatever properties UI is already open. Published on every selection change. */
    showProperties(document: IDocument, nodes: INode[]): void;
    /**
     * Opens the properties palette on the given nodes, the way AutoCAD's PROPERTIES (PR)
     * does. Only the PROPERTIES command publishes this - a selection change alone never
     * pops the palette up, it just refreshes it through `showProperties`.
     */
    showPropertiesPanel(document: IDocument, nodes: INode[]): void;
    showSelectionControl: (controller: AsyncController) => void;
    showToast: (message: I18nKeys, ...args: any[]) => void;
    statusBarTip: (tip: I18nKeys) => void;
    viewClosed: (view: IView) => void;
    viewCursor: (cursor: CursorType) => void;
    visibleChanged: (model: INode) => void;
}

type EventCallback = (...args: any[]) => void;
type EventMap = Map<keyof PubSubEventMap, Set<EventCallback>>;

export class PubSub implements IDisposable {
    static readonly default = new PubSub();
    private readonly events: EventMap = new Map();
    private isDisposed = false;

    dispose(): void {
        this.isDisposed = true;
        this.events.forEach((callbacks) => callbacks.clear());
        this.events.clear();
    }

    sub<K extends keyof PubSubEventMap>(event: K, callback: PubSubEventMap[K]): void {
        if (this.isDisposed) {
            return;
        }

        const callbacks = this.events.get(event) ?? new Set<EventCallback>();
        callbacks.add(callback);
        this.events.set(event, callbacks);
    }

    pub<K extends keyof PubSubEventMap>(event: K, ...args: Parameters<PubSubEventMap[K]>): void {
        if (this.isDisposed) {
            return;
        }

        this.events.get(event)?.forEach((callback) => callback(...args));
    }

    remove<K extends keyof PubSubEventMap>(event: K, callback: PubSubEventMap[K]): void {
        if (this.isDisposed) {
            return;
        }

        this.events.get(event)?.delete(callback);
    }

    removeAll<K extends keyof PubSubEventMap>(event: K): void {
        if (this.isDisposed) {
            return;
        }

        this.events.get(event)?.clear();
    }
}
