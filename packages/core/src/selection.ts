import type { AsyncController, IDisposable, Signal } from "./foundation";
import type { I18nKeys } from "./i18n";
import type { INode, VisualNode } from "./model";
import type { INodeFilter, IShapeFilter } from "./selectionFilter";
import type { ShapeType } from "./shape";
import type { StepOptions } from "./snap";
import type { CursorType, IEventHandler, VisualShapeData, VisualState } from "./visual";

export interface PickShapeOptions {
    shapeType?: ShapeType;
    shapeFilter?: IShapeFilter;
    nodeFilter?: INodeFilter;
    multi?: boolean;
    selectedState?: VisualState;
    highlightState?: VisualState;
    /** In multi mode, finish the pick automatically once this returns true. */
    canFinish?: (selected: VisualShapeData[]) => boolean;
    /**
     * The prompt's bracketed alternatives, so a letter typed during the pick can choose
     * one - the command line half of what the status bar is already showing.
     */
    stepOptions?: StepOptions;
}

export interface PickNodeOptions {
    nodeFilter?: INodeFilter;
    multi?: boolean;
    /** In multi mode, finish the pick automatically once this returns true. */
    canFinish?: (selected: INode[]) => boolean;
}

export interface ISelection extends IDisposable {
    readonly onNodeChanged: Signal<(selected: INode[]) => void>;
    readonly onShapeChanged: Signal<(selected: VisualShapeData[]) => void>;

    setSelectedNodes(nodes: INode[], toggle: boolean): number;
    setSelectedShapes(shapes: VisualShapeData[], selectedState: VisualState, toggle: boolean): number;
    getSelectedNodes(): INode[];
    getSelectedNodeLength(): number;
    getSelectedShapes(): VisualShapeData[];
    getSelectedVisualNodes(): VisualNode[];
    clearSelection(): void;
}

export interface IPicker {
    pickShape(
        prompt: I18nKeys,
        controller: AsyncController,
        options?: PickShapeOptions,
    ): Promise<VisualShapeData[]>;

    pickNode(prompt: I18nKeys, controller: AsyncController, options?: PickNodeOptions): Promise<VisualNode[]>;

    pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType,
    ): Promise<void>;
}
