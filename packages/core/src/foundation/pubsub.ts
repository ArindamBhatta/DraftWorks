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
import type { DynamicInputState, StepOption } from "../snap";
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
    clearDynamicInput: () => void;
    clearSelectionControl: () => void;
    clearStatusBarTip: () => void;
    clearStepOptions: () => void;
    closeCommandContext: () => void;
    displayError: (message: string) => void;
    documentClosed: (document: IDocument) => void;
    editMaterial: (document: IDocument, material: Material, callback: (material: Material) => void) => void;
    executeCommand: (commandName: CommandKeys) => void;
    modelUpdate: (model: INode) => void;
    openCommandContext: (command: ICommand) => void;
    parentVisibleChanged: (model: INode) => void;
    /**
     * "Command state that the live prompt depends on has changed - re-read it."
     *
     * The running step re-derives its own tip and options and republishes both, so a
     * change made anywhere (typed at the prompt, clicked in the status bar, picked
     * from the ribbon's property panel) shows up on every surface. The publisher does
     * not need to know which step is live, and the step does not need to know what
     * changed - the command's observable property stays the single source of truth.
     */
    refreshStepPrompt: () => void;
    showDialog: (title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) => void;
    /**
     * The cursor's live distance/angle boxes. Published on every mouse move while a
     * point with a reference is being picked, so the boxes read the point the snap
     * layer actually settled on rather than the raw cursor.
     */
    showDynamicInput: (state: DynamicInputState) => void;
    /**
     * "The user has started typing at the crosshair" - focus the distance box and
     * seed it with `text`. Keeps the first keystroke from being swallowed, the same
     * problem the command line solves in its own global key handler.
     */
    focusDynamicInput: (text: string) => void;
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
    /**
     * The bracketed alternatives for the prompt now showing, rendered as clickable
     * chips beside the status bar tip. Republished (not just cleared) whenever an
     * option changes what the remaining options are - see the Circle command's
     * Radius/Diameter pair, which swap places once one is chosen.
     */
    showStepOptions: (options: StepOption[]) => void;
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
