import type { IDocument } from "../document";
import type { IDisposable, IPropertyChanged } from "../foundation";
import type { I18nKeys } from "../i18n";
import type { Plane, Ray, XY, XYLike, XYZ, XYZLike } from "../math";
import type { INode } from "../model";
import type { INodeFilter, IShapeFilter } from "../selectionFilter";
import type { ShapeType } from "../shape";
import type { ICameraController } from "./cameraController";
import type { VisualShapeData } from "./detectedData";
import type { IVisualObject } from "./visualObject";

export const ViewModes = ["solid", "wireframe", "solidAndWireframe"] as const;

export type ViewMode = (typeof ViewModes)[number];

export const ViewModeI18nKeys = {
    [ViewModes[0]]: "viewport.mode.solid",
    [ViewModes[1]]: "viewport.mode.wireframe",
    [ViewModes[2]]: "viewport.mode.solidAndWireframe",
} satisfies Record<
    ViewMode,
    Extract<I18nKeys, "viewport.mode.solid" | "viewport.mode.wireframe" | "viewport.mode.solidAndWireframe">
>;

export type HtmlTextOptions = {
    hideDelete?: boolean;
    className?: string;
    center?: XYLike;
    onDispose?: () => void;
};

export interface IView extends IPropertyChanged, IDisposable {
    readonly document: IDocument;
    readonly cameraController: ICameraController;
    get isClosed(): boolean;
    get width(): number;
    get height(): number;
    get dom(): HTMLElement | undefined;
    mode: ViewMode;
    name: string;
    workplane: Plane;
    update(): void;
    up(): XYZ;
    toImage(): string;
    direction(): XYZ;
    rayAt(mx: number, my: number): Ray;
    screenToWorld(mx: number, my: number): XYZ;
    worldToScreen(point: XYZ): XY;
    isolate(nodes: INode[]): void;
    unisolate(): void;
    resize(width: number, heigth: number): void;
    setDom(element: HTMLElement): void;
    htmlText(text: string, point: XYZLike, options?: HtmlTextOptions): IDisposable;
    close(): void;
    detectVisual(x: number, y: number, nodeFilter?: INodeFilter): IVisualObject[];
    /**
     * Objects caught by a rubber-band rectangle. The corners must be passed **in the
     * order the user dragged them**, not sorted: `x1 <= x2` is AutoCAD's window
     * (enclosed only), `x1 > x2` its crossing (anything touched). See
     * `rectSelectMode` in `selectionRect.ts`.
     */
    detectVisualRect(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        nodeFilter?: INodeFilter,
    ): IVisualObject[];
    detectShapes(
        shapeType: ShapeType,
        x: number,
        y: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[];
    /** As `detectVisualRect`, for shapes and sub-shapes; the corner order carries the same meaning. */
    detectShapesRect(
        shapeType: ShapeType,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[];
}

/**
 * How many drawing units one screen pixel covers on the workplane. Anything that has to
 * stay a fixed size on screen while living in world space - the object-snap markers -
 * scales by this, recomputed whenever it is drawn so it tracks the zoom.
 */
export function worldUnitsPerPixel(view: IView): number {
    const scale = view.screenToWorld(0, 0).distanceTo(view.screenToWorld(1, 0));
    return Number.isFinite(scale) && scale > 0 ? scale : 0;
}

export function screenDistance(view: IView, mx: number, my: number, point: XYZ) {
    const xy = view.worldToScreen(point);
    const dx = xy.x - mx;
    const dy = xy.y - my;
    return Math.sqrt(dx * dx + dy * dy);
}
