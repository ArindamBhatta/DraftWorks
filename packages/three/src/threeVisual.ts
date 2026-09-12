import { type IDocument, type IEventHandler, type IVisual, isDisposable, type Plane } from "@draftworks/core";
import { AmbientLight, Object3D, Scene } from "three";
import { ThreeHighlighter } from "./threeHighlighter";
import { ThreeView } from "./threeView";
import { ThreeViewHandler } from "./threeViewEventHandler";
import { ThreeVisualContext } from "./threeVisualContext";

Object3D.DEFAULT_UP.set(0, 0, 1);

export class ThreeVisual implements IVisual {
    readonly context: ThreeVisualContext;
    readonly scene: Scene;
    readonly highlighter: ThreeHighlighter;

    viewHandler: IEventHandler;
    eventHandler: IEventHandler;
    defaultEventHandler: IEventHandler;

    constructor(
        readonly document: IDocument,
        defaultEventHandler: IEventHandler,
    ) {
        this.scene = this.initScene();
        this.defaultEventHandler = defaultEventHandler;
        this.viewHandler = new ThreeViewHandler();
        this.context = new ThreeVisualContext(this, this.scene);
        this.highlighter = new ThreeHighlighter(this.context);
        this.eventHandler = this.defaultEventHandler;
    }

    initScene() {
        const scene = new Scene();
        const envLight = new AmbientLight(0x888888, 4);
        // No world-space AxesHelper here on purpose: a red/blue cross running through
        // the drawing origin is a 3D-viewport convention, not a 2D drafting one, and it
        // pans/zooms with the drawing instead of staying put. The 2D equivalent is the
        // fixed-corner UCS icon drawn as a screen-space HUD - see
        // Viewport.createUcsIcon in packages/ui/src/viewport/viewport.ts.
        scene.add(envLight);
        return scene;
    }

    createView(name: string, workplane: Plane) {
        return new ThreeView(this.document, name, workplane, this.highlighter, this.context);
    }

    update(): void {
        this.document.application.views.forEach((view) => {
            if (view.document === this.document) view.update();
        });
    }

    dispose() {
        this.context.dispose();
        this.defaultEventHandler.dispose();
        this.eventHandler.dispose();
        this.viewHandler.dispose();
        this.scene.traverse((x) => {
            if (isDisposable(x)) x.dispose();
        });
        this.scene.clear();
    }
}
