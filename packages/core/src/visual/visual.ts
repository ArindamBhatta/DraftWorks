import type { IDocument } from "../document";
import type { IDisposable } from "../foundation";
import type { Plane } from "../math";
import type { IEventHandler } from "./eventHandler";
import type { IHighlighter } from "./highlighter";
import type { IMeshExporter } from "./meshExporter";
import type { IView } from "./view";
import type { IVisualContext } from "./visualContext";

export interface IVisual extends IDisposable {
    readonly document: IDocument;
    readonly context: IVisualContext;
    readonly highlighter: IHighlighter;
    readonly meshExporter: IMeshExporter;
    update(): void;
    viewHandler: IEventHandler;
    defaultEventHandler: IEventHandler;
    eventHandler: IEventHandler;
    createView(name: string, workplane: Plane): IView;
}
