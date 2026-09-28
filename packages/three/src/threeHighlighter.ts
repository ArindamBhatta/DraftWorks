import {
    type EdgeMeshData,
    type IHighlighter,
    isDisposable,
    type LineChange,
    MeshDataUtils,
    MeshUtils,
    type ShapeMeshData,
    type ShapeType,
    ShapeTypeUtils,
    type VisualState,
    VisualStates,
    VisualStateUtils,
} from "@draftworks/core";

import { Group, type Material, Mesh, type Object3D, Points } from "three";

import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import { isHighlightable } from "./highlightable";

import {
    defaultEdgeMaterial,
    dottedMaterial,
    FADED_OPACITY,
    faceTransparentMaterial,
    fadedMaterial,
    highlightFaceMaterial,
    highlightVertexMaterial,
    hilightEdgeMaterial,
    selectedEdgeMaterial,
    selectedFaceColoredMaterial,
    selectedVertexMaterial,
} from "./materials";

import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import type { ThreeVisualContext } from "./threeVisualContext";
import type { ThreeVisualObject } from "./threeVisualObject";

/**
 * Whether a state means "picked" rather than merely "under the cursor". Hover and
 * selection can both be set at once - you can hover something already selected - and
 * selection is the stronger claim, so it wins.
 */
function isSelectedState(state: VisualState): boolean {
    return (
        VisualStateUtils.hasState(state, VisualStates.edgeSelected) ||
        VisualStateUtils.hasState(state, VisualStates.faceSelected)
    );
}

const UNFADED = "unfadedMaterial";

/**
 * VisualStates.faded for the visuals that paint their own feedback (text, dimensions,
 * blocks - see IHighlightable), which ThreeGeometry's temporary materials cannot reach.
 *
 * Every line and mesh in the object trades its material for the faded twin and keeps
 * the original to hand back. A CSS-drawn label has no material, so it takes the same
 * strength as a CSS opacity instead.
 */
function setFaded(object: Object3D, faded: boolean) {
    object.traverse((x) => {
        if (x instanceof CSS2DObject) {
            x.element.style.opacity = faded ? String(FADED_OPACITY) : "";
        } else if (x instanceof Mesh || x instanceof Points) {
            if (faded && !x.userData[UNFADED]) {
                const material: Material | Material[] = x.material;
                x.userData[UNFADED] = material;
                x.material = Array.isArray(material)
                    ? material.map((m) => fadedMaterial(m))
                    : fadedMaterial(material);
            } else if (!faded && x.userData[UNFADED]) {
                x.material = x.userData[UNFADED];
                delete x.userData[UNFADED];
            }
        }
    });
}

export class GeometryState {
    private readonly _states: Map<string, [VisualState, Mesh | undefined]> = new Map();

    constructor(
        readonly highlighter: ThreeHighlighter,
        readonly visual: ThreeVisualObject,
    ) {}

    getState(type: ShapeType, index?: number) {
        const key = this.state_key(type, index);
        return this._states.get(key)?.[0];
    }

    private state_key(type: ShapeType, index?: number) {
        return `${type}_${index}`;
    }

    addState(state: VisualState, type: ShapeType, index: number[]) {
        this.updateState("add", state, type, index);
    }

    removeState(state: VisualState, type: ShapeType, index: number[]) {
        this.updateState("remove", state, type, index);
    }

    private updateState(method: "add" | "remove", state: VisualState, type: ShapeType, index: number[]) {
        if (index.length === 0 || ShapeTypeUtils.isWhole(type)) {
            this.setWholeState(method, state, type);
        } else {
            this.setSubGeometryState(method, state, type, index);
        }
    }

    private setWholeState(method: "add" | "remove", state: VisualState, type: ShapeType) {
        const key = this.state_key(type);
        const [_oldState, newState] = this.updateStates(key, method, state);
        const faded = VisualStateUtils.hasState(newState, VisualStates.faded);
        if (this.visual instanceof ThreeGeometry) {
            // Every state is painted from the object's own materials, so nothing the last
            // one left behind carries into this one - a fade covers the faces as well as
            // the edges, and the states below only repaint the edges.
            this.visual.removeTemperaryMaterial();
            if (VisualStateUtils.hasState(newState, VisualStates.edgeSelected)) {
                // Selected before highlighted, because the cursor is still sitting on
                // what you just clicked: letting hover win would hold the dashed
                // selection back until you moved the mouse away, and "you did pick
                // this" outranks "you could pick this" anyway.
                this.visual.setVertexsMateiralTemperary(selectedVertexMaterial);
                this.visual.setEdgesMateiralTemperary(selectedEdgeMaterial);
            } else if (faded) {
                this.visual.setFadedTemperary();
            } else if (VisualStateUtils.hasState(newState, VisualStates.edgeHighlight)) {
                this.visual.setVertexsMateiralTemperary(highlightVertexMaterial);
                this.visual.setEdgesMateiralTemperary(hilightEdgeMaterial);
            } else if (VisualStateUtils.hasState(newState, VisualStates.faceTransparent)) {
                this.visual.setFacesMateiralTemperary(faceTransparentMaterial);
            } else if (VisualStateUtils.hasState(newState, VisualStates.faceHighlight)) {
                this.visual.setFacesMateiralTemperary(highlightFaceMaterial);
            }
        } else if (isHighlightable(this.visual)) {
            // Unfaded first, for the same reason: highlight() swaps materials too, and
            // the fade has to hand back the originals, not a highlight.
            setFaded(this.visual, false);
            if (isSelectedState(newState)) {
                this.visual.highlight(true);
            } else if (faded) {
                this.visual.unhighlight();
                setFaded(this.visual, true);
            } else if (newState !== VisualStates.normal) {
                this.visual.highlight(false);
            } else {
                this.visual.unhighlight();
            }
        }

        this._states.set(key, [newState, undefined]);
    }

    private updateStates(
        key: string,
        method: "add" | "remove",
        state: VisualState,
    ): [VisualState | undefined, VisualState] {
        const oldState = this._states.get(key)?.[0];
        let newState = oldState;
        if (newState === undefined) {
            if (method === "remove") return [undefined, VisualStates.normal];
            newState = state;
        } else {
            const func = method === "add" ? VisualStateUtils.addState : VisualStateUtils.removeState;
            newState = func(newState, state);
        }
        return [oldState, newState];
    }

    resetState() {
        this.highlighter.container.children.forEach((x) => {
            (x as any).geometry?.dispose();
        });
        this.highlighter.container.clear();
        if (this.visual instanceof ThreeGeometry) {
            this.visual.removeTemperaryMaterial();
        } else if (isHighlightable(this.visual)) {
            setFaded(this.visual, false);
            this.visual.unhighlight();
        }
        this._states.clear();
    }

    private setSubGeometryState(
        method: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index: number[],
    ) {
        const shouldRemoved: string[] = [];
        index.forEach((i) => {
            const key = this.state_key(type, i);
            const [oldState, newState] = this.updateStates(key, method, state);
            if (oldState !== undefined && newState === VisualStates.normal) {
                shouldRemoved.push(key);
            } else if (this.isFaceState(state, type)) {
                this.addSubFaceState(type, key, i, newState);
            } else {
                this.addSubEdgeState(type, key, i, newState);
            }
        });

        shouldRemoved.forEach((key) => {
            const item = this._states.get(key)?.[1];
            if (item) {
                this.highlighter.container.remove(item);
                item.geometry?.dispose();
                this._states.delete(key);
            }
        });
    }

    private isFaceState(state: VisualState, type: ShapeType) {
        return (
            !VisualStateUtils.hasState(VisualStates.edgeHighlight, state) &&
            !VisualStateUtils.hasState(VisualStates.edgeSelected, state) &&
            (ShapeTypeUtils.hasFace(type) || ShapeTypeUtils.hasShell(type) || ShapeTypeUtils.hasSolid(type))
        );
    }

    private addSubEdgeState(type: ShapeType, key: string, i: number, newState: VisualState) {
        const geometry = this.getOrCloneEdgeGeometry(type, key, i);
        if (geometry && "material" in geometry) {
            // Selection outranks hover here for the same reason it does in setWholeState.
            const material = isSelectedState(newState) ? selectedEdgeMaterial : hilightEdgeMaterial;
            geometry.material = material;
            this._states.set(key, [newState, geometry]);
        }
    }

    private addSubFaceState(type: ShapeType, key: string, i: number, newState: VisualState) {
        const geometry = this.getOrCloneFaceGeometry(type, key, i);
        if (geometry && "material" in geometry) {
            let material;
            if (VisualStateUtils.hasState(newState, VisualStates.faceTransparent)) {
                material = faceTransparentMaterial;
            } else if (VisualStateUtils.hasState(newState, VisualStates.faceSelected)) {
                material = selectedFaceColoredMaterial;
            } else {
                material = highlightFaceMaterial;
            }
            geometry.material = material;
            geometry.renderOrder = 999;
            this._states.set(key, [newState, geometry]);
        }
    }

    private getOrCloneEdgeGeometry(type: ShapeType, key: string, index: number) {
        if (!(this.visual instanceof ThreeGeometry)) return undefined;

        const geometry = this._states.get(key)?.[1];
        if (geometry) return geometry;

        let points: Float32Array | undefined;
        if (ShapeTypeUtils.hasFace(type) || ShapeTypeUtils.hasShell(type) || ShapeTypeUtils.hasSolid(type)) {
            points = MeshUtils.subFaceOutlines(this.visual.geometryNode.mesh.faces!, index);
        }
        if (points === undefined && (ShapeTypeUtils.hasEdge(type) || ShapeTypeUtils.hasWire(type))) {
            points = MeshUtils.subEdge(this.visual.geometryNode.mesh.edges!, index);
        }

        if (!points) {
            console.warn(`Invalid type ${type} for ${key}`);
            return undefined;
        }

        const lineGeometry = new LineSegmentsGeometry();
        lineGeometry.setPositions(points);
        const segment = new LineSegments2(lineGeometry);
        // The selected-edge material is dashed, and three's dash shader needs the
        // distance-along-the-line attribute this computes. Without it the clone would
        // come out solid, so a sub-shape pick would look nothing like a whole-object one.
        segment.computeLineDistances();
        this.highlighter.container.add(segment);
        segment.applyMatrix4(this.visual.matrixWorld);
        return segment;
    }

    private getOrCloneFaceGeometry(type: ShapeType, key: string, index: number) {
        if (!(this.visual instanceof ThreeGeometry)) return undefined;

        const geometry = this._states.get(key)?.[1];
        if (geometry) return geometry;

        let face: Mesh | undefined;
        if (ShapeTypeUtils.hasFace(type) || ShapeTypeUtils.hasShell(type) || ShapeTypeUtils.hasSolid(type)) {
            face = this.visual.cloneSubFace(index);
        }

        if (!face) {
            console.warn(`Invalid type ${type} for ${key}`);
            return undefined;
        }

        this.highlighter.container.add(face);
        return face;
    }
}

export class ThreeHighlighter implements IHighlighter {
    private readonly _stateMap = new Map<ThreeVisualObject, GeometryState>();
    readonly container: Group;

    constructor(readonly content: ThreeVisualContext) {
        this.container = new Group();
        this.container.name = "highlighter";
        this.content.scene.add(this.container);
    }

    clear(): void {
        this._stateMap.forEach((v, k) => {
            this.resetState(k);
        });
        this._stateMap.clear();
    }

    resetState(geometry: ThreeVisualObject): void {
        if (!this._stateMap.has(geometry)) return;
        const geometryState = this._stateMap.get(geometry);
        geometryState!.resetState();
        this._stateMap.delete(geometry);
    }

    getState(shape: ThreeVisualObject, type: ShapeType, index?: number): VisualState | undefined {
        if (this._stateMap.has(shape)) {
            return this._stateMap.get(shape)!.getState(type, index);
        }
        return undefined;
    }

    addState(geometry: ThreeVisualObject, state: VisualState, type: ShapeType, ...index: number[]) {
        const geometryState = this.getOrInitState(geometry);
        geometryState.addState(state, type, index);
    }

    removeState(geometry: ThreeVisualObject, state: VisualState, type: ShapeType, ...index: number[]) {
        const geometryState = this.getOrInitState(geometry);
        geometryState.removeState(state, type, index);
    }

    private getOrInitState(geometry: ThreeVisualObject) {
        let geometryState = this._stateMap.get(geometry);
        if (!geometryState) {
            geometryState = new GeometryState(this, geometry);
            this._stateMap.set(geometry, geometryState);
        }
        return geometryState;
    }

    highlightMesh(...datas: ShapeMeshData[]): number {
        const group = new Group();
        datas.forEach((data) => {
            if (MeshDataUtils.isVertexMesh(data)) {
                group.add(ThreeGeometryFactory.createVertexGeometry(data));
            } else if (MeshDataUtils.isEdgeMesh(data)) {
                group.add(ThreeGeometryFactory.createEdgeGeometry(data));
            } else if (MeshDataUtils.isFaceMesh(data)) {
                group.add(ThreeGeometryFactory.createFaceGeometry(data));
            }
        });
        this.container.add(group);
        return group.id;
    }

    /** How to take each highlightChange down again, by the id it returned. */
    private readonly _changes = new Map<number, () => void>();

    highlightChange(visual: ThreeVisualObject, change: LineChange): number {
        // TRIM's targets are always ThreeGeometry - the only visual it can detect an edge
        // on - but anything else still gets the preview, drawn over itself in the default
        // look rather than standing in for it.
        const geometry = visual instanceof ThreeGeometry ? visual : undefined;
        const own = geometry?.baseEdgeMaterial ?? defaultEdgeMaterial;

        const group = new Group();
        const draw = (data: EdgeMeshData, material: LineMaterial) => {
            const segments = new LineSegments2(ThreeGeometryFactory.createEdgeBufferGeometry(data), material);
            // Needed by the dots, and by a kept piece whose own linetype is dashed.
            segments.computeLineDistances();
            group.add(segments);
        };
        for (const data of change.kept) draw(data, own);
        for (const data of change.removed) draw(data, dottedMaterial(own));

        this.container.add(group);
        geometry?.setLinesStoodIn(true);
        this._changes.set(group.id, () => {
            geometry?.setLinesStoodIn(false);
            this.container.remove(group);
            // The geometry only: the materials are the object's own and its dotted twin,
            // both shared, and disposing them would repaint every object that uses them.
            group.children.forEach((x) => {
                if (x instanceof LineSegments2) x.geometry.dispose();
            });
        });
        return group.id;
    }

    removeHighlightMesh(id: number) {
        const restore = this._changes.get(id);
        if (restore) {
            this._changes.delete(id);
            restore();
            return;
        }

        const shape = this.container.getObjectById(id);
        if (shape === undefined) return;
        shape.children.forEach((x) => {
            if (x instanceof Mesh || x instanceof LineSegments2 || x instanceof Points) {
                x.geometry.dispose();
                x.material.dispose();
            }
            if (isDisposable(x)) {
                x.dispose();
            }
        });
        shape.children.length = 0;
        this.container.remove(shape);
    }
}
