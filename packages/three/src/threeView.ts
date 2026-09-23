import {
    BoundingBox,
    Config,
    debounce,
    doesSegmentTouchRect,
    doRectsOverlap,
    emptyScreenRect,
    GeometryNode,
    growScreenRect,
    type HtmlTextOptions,
    type IDisposable,
    type IDocument,
    type IFace,
    type INode,
    type INodeFilter,
    type IShape,
    type IShapeFilter,
    type ISubShape,
    type IView,
    type IVisualObject,
    isBoxSelected,
    isPointInRect,
    isPointInTriangle,
    isRectInsideRect,
    isScreenRectValid,
    type Matrix4,
    MultiShapeNode,
    Observable,
    type Plane,
    PubSub,
    Ray,
    type RectSelectMode,
    rectSelectMode,
    type ScreenRect,
    type ShapeMeshRange,
    ShapeNode,
    type ShapeType,
    ShapeTypes,
    ShapeTypeUtils,
    screenRect,
    type ViewMode,
    type VisualNode,
    type VisualShapeData,
    XY,
    type XYZ,
    type XYZLike,
} from "@draftworks/core";
import { div, span, svg } from "@draftworks/element";
import {
    type BufferAttribute,
    type BufferGeometry,
    DirectionalLight,
    type InterleavedBufferAttribute,
    type Intersection,
    Line,
    LineSegments,
    Mesh,
    Object3D,
    type OrthographicCamera,
    Points,
    Raycaster,
    type Scene,
    Matrix4 as ThreeMatrix4,
    Vector2,
    Vector3,
    WebGLRenderer,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CameraController } from "./cameraController";
import { Constants } from "./constants";
import { setSelectionDashScale } from "./materials";
import { ThreeRefSegmentAnnotation } from "./threeAnnotation";
import { ThreeDimension } from "./threeDimension";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGrid } from "./threeGrid";
import { ThreeHelper } from "./threeHelper";
import type { ThreeHighlighter } from "./threeHighlighter";
import { ThreeText } from "./threeText";
import style from "./threeView.module.css";
import type { ThreeVisualContext } from "./threeVisualContext";
import { ThreeComponentObject, ThreeMeshObject, ThreeVisualObject } from "./threeVisualObject";

/**
 * Anything the selection rectangle can catch: a visual that can hand over the
 * three.js objects it draws. That covers the shape-backed visuals and the
 * annotations alike, and leaves out the pure containers (groups), which draw
 * nothing of their own.
 */
type RectSelectable = IVisualObject & Object3D & { wholeVisual(): Object3D[] };

function isRectSelectable(visual: IVisualObject): visual is RectSelectable {
    return visual instanceof Object3D && typeof (visual as RectSelectable).wholeVisual === "function";
}

function getGeometry(object: Object3D): BufferGeometry | undefined {
    return (object as Partial<Mesh>).geometry;
}

/**
 * Fat lines (`LineSegments2`/`Line2`) keep their real endpoints in these two
 * instanced attributes. Their `position` attribute is only the quad template that
 * gives the line its width, so reading it would test a unit box instead of the
 * drawing - which is exactly the trap three's own `SelectionBox` fell into here.
 */
function fatLineAttributes(geometry: BufferGeometry) {
    return {
        instanceStart: geometry.getAttribute("instanceStart") as BufferAttribute | undefined,
        instanceEnd: geometry.getAttribute("instanceEnd") as BufferAttribute | undefined,
    };
}

// Scratch space for the per-vertex projection below: it runs over every vertex of
// every straddling object on every pointermove, so it allocates nothing.
const _rectMatrix = new ThreeMatrix4();
const _rectPointA = new Vector3();
const _rectPointB = new Vector3();
const _rectPointC = new Vector3();

const warnedGeometries = new WeakSet<object>();

/**
 * Rejects objects that would make three's raycaster throw rather than miss.
 *
 * Fat lines (LineSegments2/Line2) are raycast by dereferencing the geometry's
 * `instanceStart` attribute with no check of its own, so one object whose geometry was
 * never given positions throws out of `intersectObjects` - and because that call covers
 * the whole scene at once, the failure is total: hover, selection and snapping stop for
 * every object, not just the broken one. A drawing is far more useful missing one
 * entity's pick target than with picking dead everywhere, so the offender is dropped and
 * named once rather than allowed to take the scene down.
 */
function isRaycastable(object: Object3D): boolean {
    if (!(object instanceof LineSegments2)) return true;
    if (object.geometry?.attributes["instanceStart"] !== undefined) return true;

    if (!warnedGeometries.has(object)) {
        warnedGeometries.add(object);
        console.warn("Skipping unpickable line object: its geometry has no positions", object);
    }
    return false;
}

export class ThreeView extends Observable implements IView {
    private _dom?: HTMLElement;
    private _needsUpdate: boolean = false;
    private _workplane: Plane;
    private _isolatedNodes?: INode[];

    private readonly _scene: Scene;
    private readonly _renderer: WebGLRenderer;
    private readonly _cssRenderer: CSS2DRenderer;
    private readonly _resizeObserver: ResizeObserver;
    private readonly _grid: ThreeGrid;

    readonly cameraController: CameraController;
    readonly dynamicLight = new DirectionalLight(0xffffff, 2);

    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    get dom() {
        return this._dom;
    }

    private _isClosed: boolean = false;
    get isClosed(): boolean {
        return this._isClosed;
    }

    get camera(): OrthographicCamera {
        return this.cameraController.camera;
    }

    get mode(): ViewMode {
        return this.getPrivateValue("mode");
    }
    set mode(value: ViewMode) {
        this.setProperty("mode", value, () => {
            this.cameraController.setCameraLayer(this.camera, this.mode);
        });
    }

    constructor(
        readonly document: IDocument,
        name: string,
        workplane: Plane,
        readonly highlighter: ThreeHighlighter,
        readonly content: ThreeVisualContext,
    ) {
        super();
        this.setPrivateValue("name", name);
        this.setPrivateValue("mode", "wireframe");
        this._scene = content.scene;
        this._workplane = workplane;
        this._resizeObserver = new ResizeObserver(this._resizerObserverCallback);
        this.cameraController = new CameraController(this);
        this._renderer = this.initRenderer();
        this._cssRenderer = this.initCssRenderer();
        this._scene.add(this.dynamicLight);
        this._grid = new ThreeGrid(this, this._scene);
        this.cameraController.setCameraLayer(this.camera, this.mode);
        this.document.application.views.push(this);
        Config.instance.onPropertyChanged(this.handleConfigChanged);
        this.animate();
    }

    /**
     * Settings that change what is already on screen without changing any geometry. The
     * materials themselves are updated where they live - see materials.ts for LWT - so
     * all this has to do is ask for another frame, which nothing else would.
     */
    private readonly handleConfigChanged = (property: keyof Config) => {
        if (property === "showLineWeight") this.update();
    };

    override disposeInternal(): void {
        super.disposeInternal();
        Config.instance.removePropertyChanged(this.handleConfigChanged);
        this._grid.dispose();
        this._resizeObserver.disconnect();
    }

    close(): void {
        if (this._isClosed) return;
        this._isClosed = true;
        this.document.application.views.remove(this);
        const otherView = this.document.application.views.find((x) => x.document === this.document);
        if (!otherView) {
            this.document.close();
        } else if (this.document.application.activeView === this) {
            this.document.application.activeView = otherView;
        }
        this.dispose();
        PubSub.default.pub("viewClosed", this);
    }

    private readonly _resizerObserverCallback = debounce((entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
            if (entry.target === this._dom) {
                this.resize(entry.contentRect.width, entry.contentRect.height);
                return;
            }
        }
    }, 100);

    get renderer(): WebGLRenderer {
        return this._renderer;
    }

    protected initRenderer() {
        const renderer = new WebGLRenderer({
            antialias: true,
            alpha: true,
        });
        renderer.setPixelRatio(window.devicePixelRatio);

        return renderer;
    }

    protected initCssRenderer() {
        const renderer = new CSS2DRenderer();
        return renderer;
    }

    setDom(element: HTMLElement) {
        if (this._dom) {
            this._resizeObserver.unobserve(this._dom);
        }
        this._dom = element;

        this._renderer.domElement.remove();
        this._renderer.domElement.style.userSelect = "none";
        this._renderer.domElement.style.webkitUserSelect = "none";
        element.appendChild(this._renderer.domElement);

        this._cssRenderer.domElement.remove();
        this._cssRenderer.domElement.style.position = "absolute";
        this._cssRenderer.domElement.style.top = "0px";
        this._cssRenderer.domElement.style.userSelect = "none";
        this._cssRenderer.domElement.style.webkitUserSelect = "none";
        element.appendChild(this._cssRenderer.domElement);

        this.resize(element.clientWidth, element.clientHeight);
        this._resizeObserver.observe(element);
        this.cameraController.updateCameraPosionTarget();
    }

    htmlText(text: string, point: XYZLike, options?: HtmlTextOptions): IDisposable {
        const dispose = () => {
            options?.onDispose?.();
            this.content.cssObjects.remove(cssObject);
            cssObject.element.remove();
        };
        const cssObject = new CSS2DObject(this.htmlElement(text, dispose, options));
        cssObject.position.set(point.x, point.y, point.z);
        if (options?.center) cssObject.center.set(options.center.x, options.center.y);
        this.content.cssObjects.add(cssObject);
        return { dispose };
    }

    private htmlElement(text: string, dispose: () => void, options?: HtmlTextOptions): HTMLElement {
        const className = options?.className || style.htmlText;
        return div(
            {
                className: options?.hideDelete ? `${className} ${style.noEvent}` : className,
            },
            span({ textContent: text, style: { color: "inherit" } }),
            options?.hideDelete === true
                ? ""
                : svg({
                      className: style.delete,
                      icon: "icon-times",
                      onclick: (e) => {
                          e.stopPropagation();
                          dispose();
                      },
                  }),
        );
    }

    toImage(): string {
        this._renderer.render(this._scene, this.camera);
        return this.renderer.domElement.toDataURL();
    }

    get workplane(): Plane {
        return this._workplane;
    }

    set workplane(value: Plane) {
        this.setProperty("workplane", value);
    }

    update() {
        this._needsUpdate = true;
    }

    private animate() {
        if (this._isClosed) {
            return;
        }
        requestAnimationFrame(() => {
            this.animate();
        });
        if (!this._needsUpdate) return;

        // _needsUpdate is set on every pan/zoom/resize, so this is exactly when the
        // grid's visible extent and anything else sized in pixels may have changed.
        this._grid.update();
        this.updateScreenScales();

        const dir = this.camera.position.clone().sub(this.cameraController.target);
        this.dynamicLight.position.copy(dir);
        this._renderer.render(this._scene, this.camera);
        this._cssRenderer.render(this._scene, this.camera);

        this._needsUpdate = false;
    }

    /**
     * Everything whose size is fixed in *pixels* while it lives in a world measured in
     * drawing units has to be re-derived whenever the zoom moves: dimension text (sized
     * in drawing units, so its pixel size follows the zoom - see
     * ThreeDimension.updateScale, which no-ops unless the size really moved) and the
     * selection dash (sized in pixels, so its drawing-unit length has to follow instead).
     */
    private updateScreenScales() {
        const worldHeight = this.camera.top - this.camera.bottom;
        if (worldHeight <= 0) return;

        const pixelsPerUnit = this.height / worldHeight;
        setSelectionDashScale(pixelsPerUnit);
        this.content.visualShapes.traverse((object) => {
            if (object instanceof ThreeDimension || object instanceof ThreeText) {
                object.updateScale(pixelsPerUnit);
            }
        });
    }

    resize(width: number, height: number) {
        if (height < 0.00001) {
            return;
        }
        this.camera.updateProjectionMatrix();
        this._renderer.setSize(width, height);
        this._cssRenderer.setSize(width, height);
        this.cameraController.setSize(width, height);
        this.update();
    }

    get width() {
        return this._dom?.clientWidth ?? 1;
    }

    get height() {
        return this._dom?.clientHeight ?? 1;
    }

    screenToCameraRect(mx: number, my: number) {
        return new Vector2((mx / this.width) * 2 - 1, -(my / this.height) * 2 + 1);
    }

    rayAt(mx: number, my: number): Ray {
        const { x, y } = this.screenToCameraRect(mx, my);

        // Orthographic only - the perspective branch went away with the 3D camera.
        const origin = new Vector3();
        const direction = new Vector3(x, y, 0.5);
        const z = (this.camera.near + this.camera.far) / (this.camera.near - this.camera.far);
        origin.set(x, y, z).unproject(this.camera);
        direction.set(0, 0, -1).transformDirection(this.camera.matrixWorld);

        return new Ray({ point: ThreeHelper.toXYZ(origin), direction: ThreeHelper.toXYZ(direction) });
    }

    screenToWorld(mx: number, my: number): XYZ {
        const vec = this.mouseToWorld(mx, my);
        return ThreeHelper.toXYZ(vec);
    }

    worldToScreen(point: XYZ): XY {
        const cx = this.width / 2;
        const cy = this.height / 2;
        const vec = new Vector3(point.x, point.y, point.z).project(this.camera);
        return new XY({ x: Math.round(cx * vec.x + cx), y: Math.round(-cy * vec.y + cy) });
    }

    direction(): XYZ {
        const vec = new Vector3();
        this.camera.getWorldDirection(vec);
        return ThreeHelper.toXYZ(vec);
    }

    up(): XYZ {
        return ThreeHelper.toXYZ(this.camera.up);
    }

    private mouseToWorld(mx: number, my: number, z: number = 0.5) {
        const { x, y } = this.screenToCameraRect(mx, my);
        return new Vector3(x, y, z).unproject(this.camera);
    }

    isolate(nodes: INode[]) {
        const visuals = nodes
            .map((x) => this.content.getVisual(x))
            .filter((x) => x !== undefined) as IVisualObject[];
        for (const shape of visuals) {
            if (shape instanceof Object3D) {
                shape.layers.set(Constants.Layers.Isolation);
                shape.children.forEach((x) => {
                    x.layers.set(Constants.Layers.Isolation);
                });
            }
        }

        this.cameraController.camera.layers.disableAll();
        this.cameraController.camera.layers.enable(Constants.Layers.Default);
        this.cameraController.camera.layers.enable(Constants.Layers.Isolation);

        if (!this._isolatedNodes) {
            this._isolatedNodes = nodes;
        } else {
            this._isolatedNodes = this._isolatedNodes.concat(nodes);
        }
    }

    unisolate() {
        if (!this._isolatedNodes) return;

        const shapes = this._isolatedNodes
            .map((x) => this.content.getVisual(x))
            .filter((x) => x !== undefined) as IVisualObject[];
        for (const shape of shapes) {
            if (shape instanceof Object3D) {
                shape.layers.set(Constants.Layers.Default);
                shape.children.forEach((x) => {
                    if (
                        x instanceof LineSegments2 ||
                        x instanceof Line2 ||
                        x instanceof Line ||
                        x instanceof LineSegments
                    ) {
                        x.layers.set(Constants.Layers.Wireframe);
                    } else if (x instanceof Mesh) {
                        // Keep a hatched face on the Fill layer - putting every mesh
                        // back on Solid would hide it, since 2D wireframe mode does not
                        // draw that layer.
                        const node = this.getNodeFromObject(shape);
                        const filled = node instanceof GeometryNode && node.filled;
                        x.layers.set(filled ? Constants.Layers.Fill : Constants.Layers.Solid);
                    } else {
                        console.error(`Unsupported object type: ${x}`);
                    }
                });
            }
        }

        this.cameraController.camera.layers.enableAll();
        this._isolatedNodes = undefined;
    }

    detectVisual(x: number, y: number, nodeFilter?: INodeFilter): IVisualObject[] {
        const visual: IVisualObject[] = [];
        const detecteds = this.findIntersectedNodes(x, y);
        for (const detected of detecteds) {
            const threeObject = detected.object.parent as ThreeVisualObject;
            if (!threeObject) continue;
            // One object usually yields several hits - a dimension's dimension line,
            // extension lines and arrows, or both segments meeting at a polyline vertex.
            // Kept once, or a click on a lone dimension offers the cycling menu a stack
            // of copies of itself.
            if (visual.includes(threeObject)) continue;

            const node = this.getNodeFromObject(threeObject);
            if (node === undefined) continue;
            if (nodeFilter !== undefined && !nodeFilter.allow(node)) {
                continue;
            }
            visual.push(threeObject);
        }
        return visual;
    }

    detectVisualRect(
        mx1: number,
        my1: number,
        mx2: number,
        my2: number,
        nodeFilter?: INodeFilter,
    ): IVisualObject[] {
        return this.detectVisualsInRect(screenRect(mx1, my1, mx2, my2), rectSelectMode(mx1, mx2), nodeFilter);
    }

    private getNodeFromObject(threeObject: Object3D) {
        let node: VisualNode | undefined;
        if (threeObject instanceof ThreeMeshObject) {
            node = threeObject.meshNode;
        } else if (threeObject instanceof ThreeGeometry) {
            node = threeObject.geometryNode;
        } else if (threeObject instanceof ThreeComponentObject) {
            node = threeObject.componentNode;
        } else if (threeObject instanceof ThreeRefSegmentAnnotation) {
            node = threeObject.annotation;
        } else if (threeObject instanceof ThreeDimension) {
            node = threeObject.annotation;
        } else if (threeObject instanceof ThreeText) {
            node = threeObject.annotation;
        }
        return node;
    }

    detectShapesRect(
        shapeType: ShapeType,
        mx1: number,
        my1: number,
        mx2: number,
        my2: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[] {
        const rect = screenRect(mx1, my1, mx2, my2);
        const mode = rectSelectMode(mx1, mx2);

        if (ShapeTypeUtils.isWhole(shapeType)) {
            return this.detectWholeShapesInRect(this.threeVisualsInRect(rect, mode, nodeFilter), shapeFilter);
        }

        // Sub-shape picks apply the mode one sub-shape at a time, so the object-level
        // pass has to stay a crossing whatever the drag direction: an object only half
        // inside a window can still own edges that are wholly inside it, and a window
        // pass here would throw the whole object away before those were ever looked at.
        return this.detectSubShapesInRect(
            shapeType,
            this.threeVisualsInRect(rect, "crossing", nodeFilter),
            rect,
            mode,
            shapeFilter,
        );
    }

    private detectWholeShapesInRect(
        visuals: ThreeVisualObject[],
        shapeFilter?: IShapeFilter,
    ): VisualShapeData[] {
        const result: VisualShapeData[] = [];
        const added = new Set<string>();
        const addShape = (
            shapes: IShape[] | readonly IShape[],
            worldTransform: Matrix4,
            visual: ThreeVisualObject,
        ) => {
            for (const shape of shapes) {
                if (added.has(shape.id)) continue;
                if (shapeFilter && !shapeFilter.allow(shape, worldTransform)) continue;

                added.add(shape.id);
                result.push({
                    owner: visual,
                    shape,
                    transform: worldTransform,
                    indexes: [],
                });
            }
        };

        for (const visual of visuals) {
            const worldTransform = visual.worldTransform();

            if (visual.node instanceof ShapeNode && visual.node.shape.isOk) {
                addShape([visual.node.shape.value], worldTransform, visual);
            } else if (visual.node instanceof MultiShapeNode) {
                addShape(visual.node.shapes, worldTransform, visual);
            }
        }

        return result;
    }

    /**
     * Everything on screen the rubber band catches, under the given mode. Dimensions,
     * text and the other annotations come back too - they are picked whole, like any
     * other object, even though there is no B-Rep shape behind them.
     */
    private detectVisualsInRect(
        rect: ScreenRect,
        mode: RectSelectMode,
        nodeFilter?: INodeFilter,
    ): IVisualObject[] {
        const result: IVisualObject[] = [];
        this.document.visual.context.visuals().forEach((visual) => {
            // Objects on a locked layer stay on screen but are not pickable, the way
            // AutoCAD's layer lock works - see ThreeVisualContext.applyLayerStyling.
            if (!visual.visible || visual.locked) return;
            if (!isRectSelectable(visual)) return;

            const node = this.getNodeFromObject(visual);
            if (node === undefined) return;
            if (nodeFilter && !nodeFilter.allow(node)) return;

            if (this.isVisualInRect(visual, rect, mode)) result.push(visual);
        });
        return result;
    }

    /** As `detectVisualsInRect`, narrowed to the visuals that carry CAD shapes. */
    private threeVisualsInRect(
        rect: ScreenRect,
        mode: RectSelectMode,
        nodeFilter?: INodeFilter,
    ): ThreeVisualObject[] {
        return this.detectVisualsInRect(rect, mode, nodeFilter).filter(
            (x): x is ThreeVisualObject => x instanceof ThreeVisualObject,
        );
    }

    private detectSubShapesInRect(
        shapeType: ShapeType,
        visuals: ThreeVisualObject[],
        rect: ScreenRect,
        mode: RectSelectMode,
        shapeFilter?: IShapeFilter,
    ): VisualShapeData[] {
        const result: VisualShapeData[] = [];
        const added = new Set<string>();

        for (const visual of visuals) {
            const worldMatrix = visual.worldTransform();
            const entries = this.collectSubShapeEntries(shapeType, visual);

            for (const entry of entries) {
                if (added.has(entry.shape.id)) continue;

                if (!this.isShapeInRect(entry.shape, entry.transform, worldMatrix, rect, mode)) {
                    continue;
                }

                const shapeTransform = entry.transform ? worldMatrix.multiply(entry.transform) : worldMatrix;

                if (shapeFilter && !shapeFilter.allow(entry.shape, shapeTransform)) {
                    continue;
                }

                added.add(entry.shape.id);
                result.push({
                    owner: visual,
                    shape: entry.shape,
                    transform: shapeTransform,
                    indexes: entry.indexes,
                });
            }
        }

        return result;
    }

    private collectSubShapeEntries(
        shapeType: ShapeType,
        visual: ThreeVisualObject,
    ): { shape: IShape; transform?: Matrix4; indexes: number[] }[] {
        const entries: { shape: IShape; transform?: Matrix4; indexes: number[] }[] = [];
        const added = new Set<string>();

        const iterateFaces =
            ShapeTypeUtils.hasFace(shapeType) ||
            ShapeTypeUtils.hasSolid(shapeType) ||
            ShapeTypeUtils.hasShell(shapeType);
        const iterateEdges = ShapeTypeUtils.hasEdge(shapeType) || ShapeTypeUtils.hasWire(shapeType);

        if (visual instanceof ThreeGeometry) {
            const node = visual.geometryNode;
            const rootShape = node instanceof ShapeNode ? node.shape.unchecked() : undefined;

            if (iterateFaces && node.mesh.faces?.range) {
                this.resolveRangeGroups(shapeType, node.mesh.faces.range, rootShape, added, entries);
            }
            if (iterateEdges && node.mesh.edges?.range) {
                this.resolveRangeGroups(shapeType, node.mesh.edges.range, rootShape, added, entries);
            }
        } else if (visual instanceof ThreeComponentObject) {
            const mesh = visual.componentNode.component.mesh;

            if (iterateFaces && mesh.face.range.length > 0) {
                this.resolveRangeGroups(shapeType, mesh.face.range, undefined, added, entries);
            }
            if (iterateEdges && mesh.edge.range.length > 0) {
                this.resolveRangeGroups(shapeType, mesh.edge.range, undefined, added, entries);
            }
        }

        return entries;
    }

    private resolveRangeGroups(
        shapeType: ShapeType,
        groups: ShapeMeshRange[],
        rootShape: IShape | undefined,
        added: Set<string>,
        entries: { shape: IShape; transform?: Matrix4; indexes: number[] }[],
    ) {
        const addShape = (visual: ReturnType<typeof this.getAncestorAndIndex>) => {
            if (visual.shape && !added.has(visual.shape.id)) {
                added.add(visual.shape.id);
                entries.push({
                    shape: visual.shape,
                    transform: visual.transform,
                    indexes: visual.indexes,
                });
            }
        };
        for (let i = 0; i < groups.length; i++) {
            const subShape = groups[i].shape as ISubShape;
            if (!subShape) continue;

            const rShape = rootShape ?? subShape;
            if (ShapeTypeUtils.hasSolid(shapeType) && subShape.shapeType === ShapeTypes.face) {
                addShape(this.getAncestorAndIndex(ShapeTypes.solid, subShape, rShape, groups));
            } else if (ShapeTypeUtils.hasShell(shapeType) && subShape.shapeType === ShapeTypes.face) {
                addShape(this.getAncestorAndIndex(ShapeTypes.shell, subShape, rShape, groups));
            } else if (ShapeTypeUtils.hasWire(shapeType) && subShape.shapeType === ShapeTypes.edge) {
                addShape(this.getAncestorAndIndex(ShapeTypes.wire, subShape, rShape, groups));
            } else {
                if (!ShapeTypeUtils.hasFace(shapeType) && subShape.shapeType === ShapeTypes.face) {
                    continue;
                } else if (!ShapeTypeUtils.hasEdge(shapeType) && subShape.shapeType === ShapeTypes.edge) {
                    continue;
                }
                addShape({ indexes: [i], ...groups[i] });
            }
        }
    }

    /** The screen-space extent of a world-space box, as the box of its eight projected corners. */
    private projectBoundingBox(box: BoundingBox, worldMatrix: Matrix4): ScreenRect {
        const result = emptyScreenRect();
        const { min, max } = box;
        for (let i = 0; i < 8; i++) {
            const { x, y } = this.worldToScreen(
                worldMatrix.ofPoint({
                    x: i & 1 ? max.x : min.x,
                    y: i & 2 ? max.y : min.y,
                    z: i & 4 ? max.z : min.z,
                }),
            );
            growScreenRect(result, x, y);
        }
        return result;
    }

    /**
     * Window-vs-crossing for a single sub-shape, judged on its bounding box rather
     * than its real outline. That is exact for a vertex - a point's box is the point,
     * so both modes reduce to "is it in the rectangle", which is what STRETCH leans on
     * when it grabs the vertices a crossing window caught - and slightly generous for
     * a long diagonal edge, whose box is bigger than the edge itself.
     */
    private isShapeInRect(
        shape: IShape,
        localTransform: Matrix4 | undefined,
        worldMatrix: Matrix4,
        rect: ScreenRect,
        mode: RectSelectMode,
    ): boolean {
        const box = shape.boundingBox();
        if (!box || !BoundingBox.isValid(box)) return false;

        const composed = localTransform ? worldMatrix.multiply(localTransform) : worldMatrix;
        return isBoxSelected(mode, this.projectBoundingBox(box, composed), rect);
    }

    /**
     * The heart of window-vs-crossing (see `selectionRect.ts` for what the two modes
     * mean).
     *
     * Bounding boxes settle most objects on their own: one that does not even reach the
     * rectangle is out under either mode, and one lying wholly inside it is in. Only the
     * objects straddling an edge of the rectangle - never many - are worth walking
     * vertex by vertex, which is what keeps this cheap enough to run on every
     * pointermove while the band is being dragged.
     *
     * The precise pass earns its keep on crossings especially: a diagonal line's
     * bounding box is far larger than the line, so a box test alone would hand back
     * objects the green band never actually touched.
     */
    private isVisualInRect(visual: RectSelectable, rect: ScreenRect, mode: RectSelectMode): boolean {
        let tested = 0;
        for (const object of visual.wholeVisual()) {
            // A face hidden by 2D wireframe mode is not drawn, so it must not be
            // selectable either - same rule the raycaster follows for a click.
            if (!object.visible || !this.camera.layers.test(object.layers)) continue;

            const box = this.projectObjectBox(object);
            if (!box) continue;

            tested++;
            if (!doRectsOverlap(box, rect)) {
                // Nowhere near: out of a crossing, and proof of geometry outside a window.
                if (mode === "window") return false;
                continue;
            }
            if (isRectInsideRect(box, rect)) {
                if (mode === "crossing") return true;
                continue;
            }

            if (mode === "crossing") {
                if (this.doesObjectTouchRect(object, rect)) return true;
            } else if (!this.isObjectInsideRect(object, rect)) {
                return false;
            }
        }
        return mode === "window" && tested > 0;
    }

    /** One object's own geometry bounds, projected to pixels; undefined when it draws nothing. */
    private projectObjectBox(object: Object3D): ScreenRect | undefined {
        const geometry = getGeometry(object);
        if (!geometry) return undefined;
        if (!geometry.boundingBox) geometry.computeBoundingBox();

        const box = geometry.boundingBox;
        if (!box || box.isEmpty()) return undefined;

        const matrix = this.screenMatrix(object);
        const result = emptyScreenRect();
        for (let i = 0; i < 8; i++) {
            _rectPointA.set(
                i & 1 ? box.max.x : box.min.x,
                i & 2 ? box.max.y : box.min.y,
                i & 4 ? box.max.z : box.min.z,
            );
            this.toScreen(_rectPointA, matrix);
            growScreenRect(result, _rectPointA.x, _rectPointA.y);
        }
        return isScreenRectValid(result) ? result : undefined;
    }

    /** Local coordinates straight to clip space, folded into one matrix so a vertex costs one multiply. */
    private screenMatrix(object: Object3D) {
        return _rectMatrix
            .multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
            .multiply(object.matrixWorld);
    }

    /** Projects a point in place, from the matrix's source space to pixels. */
    private toScreen(point: Vector3, matrix: ThreeMatrix4) {
        point.applyMatrix4(matrix);
        point.x = (point.x * 0.5 + 0.5) * this.width;
        point.y = (-point.y * 0.5 + 0.5) * this.height;
    }

    private isVertexInRect(
        attribute: BufferAttribute | InterleavedBufferAttribute,
        index: number,
        matrix: ThreeMatrix4,
        rect: ScreenRect,
    ): boolean {
        _rectPointA.fromBufferAttribute(attribute, index);
        this.toScreen(_rectPointA, matrix);
        return isPointInRect(rect, _rectPointA.x, _rectPointA.y);
    }

    /** The window test: every vertex the object draws has to land inside the rectangle. */
    private isObjectInsideRect(object: Object3D, rect: ScreenRect): boolean {
        const geometry = getGeometry(object);
        if (!geometry) return true;

        const matrix = this.screenMatrix(object);
        const { instanceStart, instanceEnd } = fatLineAttributes(geometry);
        if (instanceStart && instanceEnd) {
            for (let i = 0; i < instanceStart.count; i++) {
                if (!this.isVertexInRect(instanceStart, i, matrix, rect)) return false;
                if (!this.isVertexInRect(instanceEnd, i, matrix, rect)) return false;
            }
            return true;
        }

        const position = geometry.getAttribute("position");
        if (!position) return true;
        for (let i = 0; i < position.count; i++) {
            if (!this.isVertexInRect(position, i, matrix, rect)) return false;
        }
        return true;
    }

    /** The crossing test: does any line the object draws meet the rectangle. */
    private doesObjectTouchRect(object: Object3D, rect: ScreenRect): boolean {
        const geometry = getGeometry(object);
        if (!geometry) return false;

        const matrix = this.screenMatrix(object);
        const { instanceStart, instanceEnd } = fatLineAttributes(geometry);
        if (instanceStart && instanceEnd) {
            for (let i = 0; i < instanceStart.count; i++) {
                _rectPointA.fromBufferAttribute(instanceStart, i);
                _rectPointB.fromBufferAttribute(instanceEnd, i);
                this.toScreen(_rectPointA, matrix);
                this.toScreen(_rectPointB, matrix);
                if (doesSegmentTouchRect(rect, _rectPointA.x, _rectPointA.y, _rectPointB.x, _rectPointB.y)) {
                    return true;
                }
            }
            return false;
        }

        const position = geometry.getAttribute("position");
        if (!position) return false;

        if (object instanceof Points) {
            for (let i = 0; i < position.count; i++) {
                if (this.isVertexInRect(position, i, matrix, rect)) return true;
            }
            return false;
        }

        return this.doesMeshTouchRect(geometry, position, matrix, rect);
    }

    /**
     * A triangle mesh is caught when the band crosses one of its triangle edges, or
     * when the band is standing entirely on the fill - the second case being how a
     * small crossing box dropped in the middle of a hatch still selects it, as it does
     * in AutoCAD. Faces the view is not drawing never reach here (see `isVisualInRect`),
     * so an unfilled outline in wireframe mode is not silently selectable through its
     * hollow interior.
     */
    private doesMeshTouchRect(
        geometry: BufferGeometry,
        position: BufferAttribute | InterleavedBufferAttribute,
        matrix: ThreeMatrix4,
        rect: ScreenRect,
    ): boolean {
        const index = geometry.index;
        const count = index ? index.count : position.count;

        for (let i = 0; i + 2 < count; i += 3) {
            const a = index ? index.getX(i) : i;
            const b = index ? index.getX(i + 1) : i + 1;
            const c = index ? index.getX(i + 2) : i + 2;

            _rectPointA.fromBufferAttribute(position, a);
            _rectPointB.fromBufferAttribute(position, b);
            _rectPointC.fromBufferAttribute(position, c);
            this.toScreen(_rectPointA, matrix);
            this.toScreen(_rectPointB, matrix);
            this.toScreen(_rectPointC, matrix);

            const ax = _rectPointA.x;
            const ay = _rectPointA.y;
            const bx = _rectPointB.x;
            const by = _rectPointB.y;
            const cx = _rectPointC.x;
            const cy = _rectPointC.y;

            if (
                doesSegmentTouchRect(rect, ax, ay, bx, by) ||
                doesSegmentTouchRect(rect, bx, by, cx, cy) ||
                doesSegmentTouchRect(rect, cx, cy, ax, ay) ||
                isPointInTriangle(rect.minX, rect.minY, ax, ay, bx, by, cx, cy)
            ) {
                return true;
            }
        }
        return false;
    }

    detectShapes(
        shapeType: ShapeType,
        mx: number,
        my: number,
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[] {
        const intersections = this.findIntersectedShapes(shapeType, mx, my);
        if (ShapeTypeUtils.isWhole(shapeType)) {
            return this.detectThreeShapes(intersections, shapeFilter, nodeFilter);
        }
        const subs = this.detectSubShapes(shapeType, intersections, shapeFilter, nodeFilter);
        // When an edge is on a face, the face will be snapped first,
        // so the nearest edge needs to be placed at the beginning of the array.
        if (subs.length > 1 && subs[0].shape.shapeType === ShapeTypes.face) {
            const i = subs.findIndex((x) => x.shape.shapeType === ShapeTypes.edge);
            if (i < 0) return subs;

            const nearest = (subs[0].shape as IFace).surface().nearestPoint(subs[i].point!);
            if (nearest![0].distanceTo(subs[i].point!) < 0.001) {
                const v = subs.splice(i, 1);
                subs.splice(0, 0, ...v);
            }
        }
        return subs;
    }

    private detectThreeShapes(
        intersections: Intersection[],
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ): VisualShapeData[] {
        for (const element of intersections) {
            const parent = element.object.parent;
            if (!(parent instanceof ThreeGeometry)) continue;

            let shape: IShape | undefined;
            if (parent.geometryNode instanceof ShapeNode) {
                shape = parent.geometryNode.shape.unchecked();
            } else if (parent.geometryNode instanceof MultiShapeNode) {
                shape = this.findShapeAndIndex(parent, element).shape;
            }

            if (
                !shape ||
                (shapeFilter && !shapeFilter.allow(shape, parent.worldTransform())) ||
                (nodeFilter && !nodeFilter.allow(parent.geometryNode))
            ) {
                continue;
            }

            return [
                {
                    owner: parent,
                    shape,
                    transform: parent.worldTransform(),
                    point: ThreeHelper.toXYZ(element.pointOnLine ?? element.point),
                    indexes: [],
                },
            ];
        }
        return [];
    }

    private detectSubShapes(
        shapeType: ShapeType,
        intersections: Intersection<Object3D>[],
        shapeFilter?: IShapeFilter,
        nodeFilter?: INodeFilter,
    ) {
        const result: VisualShapeData[] = [];
        for (const intersected of intersections) {
            const visualShape = intersected.object.parent;
            if (visualShape instanceof ThreeVisualObject) {
                const { shape, indexes, transform } = this.getSubShapeFromInsection(
                    shapeType,
                    visualShape,
                    intersected,
                );
                const nodeWorldTransform = visualShape.worldTransform();
                const shapeTransform = transform
                    ? nodeWorldTransform.multiply(transform)
                    : nodeWorldTransform;
                if (
                    !shape ||
                    (shapeFilter && !shapeFilter.allow(shape, shapeTransform)) ||
                    (nodeFilter && !nodeFilter.allow(visualShape.node))
                ) {
                    continue;
                }
                result.push({
                    owner: visualShape,
                    shape,
                    transform: shapeTransform,
                    point: ThreeHelper.toXYZ(intersected.pointOnLine ?? intersected.point),
                    indexes,
                });
            }
        }
        return result;
    }

    private getSubShapeFromInsection(
        shapeType: ShapeType,
        parent: ThreeVisualObject,
        intersection: Intersection,
    ): {
        shape: IShape | undefined;
        transform?: Matrix4;
        indexes: number[];
    } {
        const { shape, subShape, index, groups, transform } = this.findShapeAndIndex(parent, intersection);
        if (!subShape || !shape) return { shape: undefined, indexes: [] };

        if (ShapeTypeUtils.hasSolid(shapeType) && subShape.shapeType === ShapeTypes.face) {
            const solid = this.getAncestorAndIndex(ShapeTypes.solid, subShape, shape, groups);
            if (solid.shape) return solid;
        }
        if (ShapeTypeUtils.hasShell(shapeType) && subShape.shapeType === ShapeTypes.face) {
            const shell = this.getAncestorAndIndex(ShapeTypes.shell, subShape, shape, groups);
            if (shell.shape) return shell;
        }
        if (ShapeTypeUtils.hasWire(shapeType) && subShape.shapeType === ShapeTypes.edge) {
            const wire = this.getAncestorAndIndex(ShapeTypes.wire, subShape, shape, groups);
            if (wire.shape) return wire;
        }
        if (!ShapeTypeUtils.hasFace(shapeType) && subShape.shapeType === ShapeTypes.face) {
            return { shape: undefined, indexes: [index] };
        }
        if (!ShapeTypeUtils.hasEdge(shapeType) && subShape.shapeType === ShapeTypes.edge) {
            return { shape: undefined, indexes: [index] };
        }

        return { shape: subShape, indexes: [index], transform };
    }

    private getAncestorAndIndex(
        type: ShapeType,
        subShape: ISubShape,
        shape: IShape,
        groups: ShapeMeshRange[],
    ): {
        shape: IShape | undefined;
        indexes: number[];
        subShape?: ISubShape;
        transform?: Matrix4;
    } {
        const ancestor = subShape.findAncestor(type, shape).at(0);
        if (!ancestor) return { shape: undefined, indexes: [] };

        const indexes: number[] = [];
        for (const sub of ancestor.findSubShapes(subShape.shapeType)) {
            this.findIndex(groups, sub, indexes);
        }
        return { shape: ancestor, indexes, subShape, transform: groups.at(0)?.transform };
    }

    private findIndex(groups: ShapeMeshRange[], shape: IShape, indexes: number[]) {
        for (let i = 0; i < groups.length; i++) {
            if (shape.isEqual(groups[i].shape)) {
                indexes.push(i);
            }
        }
    }

    private findShapeAndIndex(parent: ThreeVisualObject, element: Intersection) {
        let type: "edge" | "face" | "vertex" = "edge";
        let subVisualIndex = element.faceIndex! * 2;
        if (!element.pointOnLine && !Number.isInteger(element.faceIndex)) {
            type = "vertex";
            subVisualIndex = element.index!;
        } else if (!element.pointOnLine) {
            type = "face";
            subVisualIndex = element.faceIndex! * 3;
        }

        return parent.getSubShapeAndIndex(type, subVisualIndex);
    }

    private findIntersectedNodes(mx: number, my: number) {
        let visuals: Object3D[] = [];
        this.document.visual.context.visuals().forEach((x) => {
            // Objects on a locked layer stay on screen but are not pickable, the way
            // AutoCAD's layer lock works - see ThreeVisualContext.applyLayerStyling.
            if (!x.visible || x.locked) return;
            if (x instanceof ThreeVisualObject) {
                visuals.push(...x.wholeVisual());
            } else if (
                x instanceof ThreeRefSegmentAnnotation ||
                x instanceof ThreeDimension ||
                x instanceof ThreeText
            ) {
                visuals.push(...x.wholeVisual());
            }
        });
        visuals = visuals.filter((x) => x !== undefined && x !== null && isRaycastable(x));
        return this.initRaycaster(mx, my).intersectObjects(visuals, false);
    }

    private findIntersectedShapes(shapeType: ShapeType, mx: number, my: number) {
        const raycaster = this.initRaycaster(mx, my);
        const shapes = this.initIntersectableShapes(shapeType);
        return raycaster.intersectObjects(shapes, false);
    }

    private initIntersectableShapes(shapeType: ShapeType) {
        let shapes: Object3D[] = [];
        this.document.visual.context.visuals().forEach((x) => {
            if (x instanceof ThreeVisualObject && x.node.visible && !x.locked) {
                shapes.push(...x.subShapeVisual(shapeType));
            }
        });
        shapes = shapes.filter((x) => x !== undefined && x !== null && isRaycastable(x));
        return shapes;
    }

    private initRaycaster(mx: number, my: number) {
        const threshold = Config.instance.SnapDistance;
        const { x, y } = this.screenToCameraRect(mx, my);
        const mousePos = new Vector2(x, y);

        const raycaster = new Raycaster();
        if (this.mode === "wireframe") {
            raycaster.layers.disableAll();
            raycaster.layers.enable(Constants.Layers.Wireframe);
        } else if (this.mode === "solid") {
            raycaster.layers.disableAll();
            raycaster.layers.enable(Constants.Layers.Solid);
        } else {
            raycaster.layers.enableAll();
        }
        raycaster.setFromCamera(mousePos, this.camera);
        raycaster.params = {
            ...raycaster.params,
            Line2: { threshold },
            Line: { threshold },
            Points: { threshold },
        };
        return raycaster;
    }
}
