import { VisualConfig } from "../config";
import type { Matrix4, XYZ } from "../math";
import { serializable, serialize } from "../serialize";
import type { LineType } from "./lineType";
import type { ISubShape } from "./shape";

/**
 * This file is the bridge between the exact B-Rep CAD model (solids/faces/edges built from
 * precise curves and surfaces, see `shapeType.ts`) and what actually gets drawn on screen: a GPU
 * can only render triangles and line segments, so every face gets *tessellated* into a triangle
 * mesh and every edge into line segments before rendering (via three.js). These types describe
 * that tessellated data, plus builders that accumulate it while the tessellation algorithm walks
 * the model, plus utilities to merge many small meshes into one big buffer for fast rendering.
 *
 * The recurring challenge these types solve: once many faces/edges are merged into one shared
 * position buffer for a single efficient draw call, you still need to answer "which triangle did
 * the user just click on, and which original B-Rep face/edge does it belong to?" for selection and
 * highlighting. That's what the `range`/`groups` bookkeeping throughout this file is for.
 */

export interface MeshGroupOptions {
    start: number;
    count: number;
    materialIndex: number;
}

/**
 * A sub-range of a face mesh's index buffer that should be drawn with a particular material —
 * mirrors three.js's `BufferGeometry` "groups" concept, letting one mesh contain multiple
 * differently-colored/materialed regions (e.g. per-face colors on a single merged solid) instead of
 * needing a separate draw call per face.
 */
@serializable()
export class MeshGroup {
    @serialize()
    start: number;
    @serialize()
    count: number;
    @serialize()
    materialIndex: number;

    constructor(options: MeshGroupOptions) {
        this.start = options.start;
        this.count = options.count;
        this.materialIndex = options.materialIndex;
    }
}

export type MeshType = "surface" | "linesegments";

export interface MeshOptions {
    meshType?: MeshType;
    position?: Float32Array;
    normal?: Float32Array;
    index?: Uint32Array;
    color?: number | number[];
    uv?: Float32Array;
    groups?: MeshGroup[];
}

/**
 * A raw, renderer-ready mesh: flat typed-array buffers for vertex positions/normals/UVs, a
 * triangle index buffer, per-group material info, and whether it represents a solid `"surface"`
 * (faces) or `"linesegments"` (edges). This is the serializable, GPU-friendly counterpart to the
 * exact geometric `Shape`/B-Rep classes — what actually gets uploaded to three.js for display.
 */
@serializable()
export class Mesh {
    constructor(options?: MeshOptions) {
        this.meshType = options?.meshType ?? "linesegments";
        this.position = options?.position;
        this.normal = options?.normal;
        this.index = options?.index;
        this.color = options?.color ?? 0xfff;
        this.uv = options?.uv;
        this.groups = options?.groups ?? [];
    }

    /** Pre-allocates buffers for a triangle-mesh surface with `positionSize` vertices and `indexSize` triangle-index entries, ready to be filled in-place. */
    static createSurface(positionSize: number, indexSize: number) {
        const mesh = new Mesh();
        mesh.meshType = "surface";
        mesh.normal = new Float32Array(positionSize * 3);
        mesh.uv = new Float32Array(positionSize * 2);
        mesh.position = new Float32Array(positionSize * 3);
        mesh.index = new Uint32Array(indexSize);
        return mesh;
    }

    /** Pre-allocates a position buffer for `size` line-segment vertices (edges/wireframes have no normals/UVs/indices). */
    static createLineSegments(size: number) {
        const mesh = new Mesh();
        mesh.meshType = "linesegments";
        mesh.position = new Float32Array(size * 3);
        return mesh;
    }

    @serialize()
    meshType: MeshType = "linesegments";

    @serialize()
    position: Float32Array | undefined;

    @serialize()
    normal: Float32Array | undefined = undefined;

    @serialize()
    index: Uint32Array | undefined = undefined;

    @serialize()
    color: number | number[] = 0xfff;

    @serialize()
    uv: Float32Array | undefined = undefined;

    @serialize()
    groups: MeshGroup[] = [];
}

/** The tessellated render data for one whole shape, split by topology kind — its faces, edges and vertices are kept as separate mesh buffers (e.g. so edges can be drawn as crisp lines on top of shaded faces). */
export interface IShapeMeshData {
    edges: EdgeMeshData | undefined;
    faces: FaceMeshData | undefined;
    vertexs: VertexMeshData | undefined;
}

/**
 * Records which slice `[start, start + count)` of a merged mesh buffer came from a particular
 * original B-Rep sub-shape (`ISubShape`) — e.g. "vertices 120-180 in this shared buffer are the
 * triangles of Face #3". This is what makes it possible to click a triangle on screen and know
 * exactly which face/edge/vertex of the CAD model it belongs to, for selection and highlighting.
 * `transform`, if present, is the extra placement to apply for that specific sub-shape.
 */
export interface ShapeMeshRange {
    start: number;
    count: number;
    shape: ISubShape;
    transform?: Matrix4;
}

/** Base shape of tessellated mesh data: a flat position buffer plus the `range` mapping back to original sub-shapes, and an optional color. `VertexMeshData`/`EdgeMeshData`/`FaceMeshData` below extend this per topology kind. */
export interface ShapeMeshData {
    position: Float32Array;
    range: ShapeMeshRange[];
    color?: number | number[];
}

/** A duck-typed "anything with the standard mesh buffers" shape, independent of where the data came from — used where code just needs generic mesh buffers (e.g. handing data to the renderer) without caring about `ShapeMeshData`'s CAD-specific `range` bookkeeping. */
export interface MeshLike {
    position: Float32Array;
    index: Uint32Array;
    normal: Float32Array;
    uv: Float32Array;
    color?: number | number[];
}

/**
 * Helpers for working with `ShapeMeshData`: type guards to tell vertex/edge/face mesh data apart,
 * factories for lightweight single-point/single-line meshes (e.g. a snap-point marker or a rubber-band
 * preview line while a command is running), and functions to merge two mesh buffers into one — the
 * key trick behind drawing a whole solid's edges (or faces) in a single GPU draw call instead of one
 * per edge/face, while still preserving each piece's `range` so it stays individually selectable.
 */
export class MeshDataUtils {
    static isVertexMesh(data: ShapeMeshData): data is VertexMeshData {
        return (data as VertexMeshData)?.size !== undefined;
    }

    static isEdgeMesh(data: ShapeMeshData): data is EdgeMeshData {
        return (data as EdgeMeshData)?.lineType !== undefined;
    }

    static isFaceMesh(data: ShapeMeshData): data is FaceMeshData {
        return (data as FaceMeshData)?.index !== undefined;
    }

    /** Builds mesh data for a single point marker (e.g. a snap indicator) of screen `size` at `point`. */
    static createVertexMesh(point: XYZ, size: number, color: number): VertexMeshData {
        return {
            position: new Float32Array([point.x, point.y, point.z]),
            range: [],
            color,
            size,
        };
    }

    /** Builds mesh data for a single straight line segment (e.g. a temporary preview line, like the mirror-axis line shown while running the Mirror command). */
    static createEdgeMesh(start: XYZ, end: XYZ, color: number, lineType: LineType): EdgeMeshData {
        return {
            position: new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]),
            color,
            lineType,
            range: [],
        };
    }

    /**
     * Appends `other`'s line-segment buffer onto `data`'s, producing one merged `EdgeMeshData`.
     * `other`'s range entries are shifted by how many vertices `data` already had, so each merged
     * range still points at the correct slice of the new, combined position buffer.
     */
    static mergeEdgeMesh(data: EdgeMeshData, other: EdgeMeshData): EdgeMeshData {
        const otherRange = other.range.map((range) => {
            return {
                start: range.start + data.position.length / 3,
                count: range.count,
                shape: range.shape,
                transform: range.transform,
            };
        });
        return {
            position: concatTypedArrays([data.position, other.position]),
            range: data.range.concat(otherRange),
            color: data.color,
            lineType: data.lineType,
            lineWidth: data.lineWidth,
        };
    }

    /**
     * Same idea as `mergeEdgeMesh` but for triangle meshes: concatenates positions/normals/UVs/
     * indices, and shifts both the sub-shape `range` offsets and the material `groups` offsets so
     * they still refer to the right slice of the newly combined buffers.
     */
    static mergeFaceMesh(data: FaceMeshData, other: FaceMeshData): FaceMeshData {
        const otherRange = other.range.map((range) => {
            return {
                start: range.start + data.position.length / 3,
                count: range.count,
                shape: range.shape,
                transform: range.transform,
            };
        });
        const groups = other.groups.map((group) => {
            return {
                start: group.start + data.index.length,
                count: group.count,
                materialIndex: group.materialIndex,
            };
        });
        return {
            position: concatTypedArrays([data.position, other.position]),
            range: data.range.concat(otherRange),
            index: concatTypedArrays([data.index, other.index]),
            normal: concatTypedArrays([data.normal, other.normal]),
            uv: concatTypedArrays([data.uv, other.uv]),
            color: data.color,
            groups,
        };
    }
}

/** Mesh data for a rendered point/vertex marker; `size` is its on-screen point size. */
export interface VertexMeshData extends ShapeMeshData {
    size: number;
}

/** Mesh data for rendered edges/lines; carries the drafting `lineType` (solid/dash/hidden/dot, see `lineType.ts`) and optional pixel `lineWidth`. */
export interface EdgeMeshData extends ShapeMeshData {
    lineType: LineType;
    lineWidth?: number;
}

/** Concatenates several typed arrays of the same kind (`Float32Array`/`Uint32Array`) into one contiguous array — the low-level operation that lets many small per-shape buffers be combined into one shared buffer for a single draw call. */
export function concatTypedArrays<T extends Float32Array | Uint32Array>(arrays: T[]): T {
    const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
    const result = new (arrays[0].constructor as new (length: number) => T)(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/** Mesh data for rendered (triangulated) faces: a full indexed triangle mesh with normals, UVs, and material `groups` for per-region coloring. */
export interface FaceMeshData extends ShapeMeshData {
    index: Uint32Array;
    normal: Float32Array;
    uv: Float32Array;
    groups: MeshGroup[];
}

/**
 * Shared "builder" base class for accumulating tessellated mesh data incrementally, as a
 * tessellation algorithm walks a shape's sub-shapes one at a time. Subclasses (`EdgeMeshDataBuilder`,
 * `FaceMeshDataBuilder`) fill in the topology-specific parts (line segments vs. triangles); this
 * base class handles what's common: the shared position buffer, the per-sub-shape `range` groups
 * (via `newGroup`/`endGroup`), and color — either one flat color for the whole mesh, or a distinct
 * color per vertex (falling back to flat color if per-vertex colors weren't supplied for every
 * vertex, see `getColor`).
 */
export abstract class MeshDataBuilder<T extends ShapeMeshData> {
    protected readonly _positions: number[] = [];
    protected readonly _groups: ShapeMeshRange[] = [];
    protected _color: number | undefined;
    protected _vertexColor: number[] | undefined;

    setColor(color: number) {
        this._color = color;
    }

    addColor(r: number, g: number, b: number) {
        this._vertexColor ??= [];
        this._vertexColor.push(r, g, b);
        return this;
    }

    /** Returns per-vertex colors if a color was added for every vertex, otherwise falls back to the single flat `_color`. */
    protected getColor() {
        let color: number | number[] | undefined = this._vertexColor;
        if (this._vertexColor?.length !== this._positions.length) {
            color = this._color;
        }
        return color;
    }

    /** Starts tracking a new sub-shape's contribution (resets the "where does this sub-shape's data begin" marker). */
    abstract newGroup(): this;

    /** Finishes the current sub-shape's contribution, recording a `range` entry that maps its slice of the buffer back to `shape`. */
    abstract endGroup(shape: ISubShape): this;

    abstract addPosition(x: number, y: number, z: number): this;

    /** Finalizes everything accumulated so far into a plain `ShapeMeshData` with real typed arrays. */
    abstract build(): T;
}

/**
 * Builds line-segment ("LineSegments") mesh data for edges/wireframes — the three.js line-segments
 * format, where every PAIR of consecutive points is one independent segment (unlike a continuous
 * line strip), so segments never accidentally connect across a boundary.
 */
export class EdgeMeshDataBuilder extends MeshDataBuilder<EdgeMeshData> {
    protected _positionStart: number = 0;
    // The previous point added, so `addPosition` can emit it together with the new point as one
    // (previous -> current) segment pair. `undefined` means "no segment to close yet" — true right
    // after construction or after `newGroup()`, so the first point of a new group only sets the
    // anchor instead of drawing a stray segment back to the previous group's last point.
    private _previousVertex: [number, number, number] | undefined = undefined;
    private _lineType: LineType = "solid";

    constructor() {
        super();
        this._color = VisualConfig.defaultEdgeColor;
    }

    setType(type: LineType) {
        this._lineType = type;
    }

    override newGroup() {
        this._positionStart = this._positions.length;
        this._previousVertex = undefined;
        return this;
    }

    override endGroup(shape: ISubShape) {
        this._groups.push({
            start: this._positionStart / 3,
            count: (this._positions.length - this._positionStart) / 3,
            shape,
        });
        return this;
    }

    /** Adds a point along the edge's polyline approximation; from the second point on, each call emits one (previous, current) segment pair into the buffer. */
    override addPosition(x: number, y: number, z: number) {
        if (this._previousVertex) {
            this._positions.push(...this._previousVertex, x, y, z);
        }
        this._previousVertex = [x, y, z];
        return this;
    }

    override build(): EdgeMeshData {
        const color = this.getColor()!;
        return {
            position: new Float32Array(this._positions),
            range: this._groups,
            lineType: this._lineType,
            color,
        };
    }
}

/**
 * Builds indexed triangle mesh data for faces — accumulates positions, normals, UVs and triangle
 * indices as the tessellation algorithm emits them per-face, merging every face of a solid into one
 * shared, indexed mesh.
 */
export class FaceMeshDataBuilder extends MeshDataBuilder<FaceMeshData> {
    private _indexStart: number = 0;
    private _groupStart: number = 0;
    private readonly _normals: number[] = [];
    private readonly _uvs: number[] = [];
    private readonly _indices: number[] = [];

    constructor() {
        super();
        this._color = VisualConfig.defaultFaceColor;
    }

    override newGroup() {
        this._groupStart = this._indices.length;
        // Remember how many vertices already exist, so this face's local (0-based) triangle
        // indices can be offset into the correct place in the shared position buffer (see `addIndices`).
        this._indexStart = this._positions.length / 3;
        return this;
    }

    override endGroup(shape: ISubShape) {
        this._groups.push({
            start: this._groupStart,
            count: this._indices.length - this._groupStart,
            shape,
        });
        return this;
    }

    override addPosition(x: number, y: number, z: number) {
        this._positions.push(x, y, z);
        return this;
    }

    addNormal(x: number, y: number, z: number) {
        this._normals.push(x, y, z);
        return this;
    }

    addUV(u: number, v: number) {
        this._uvs.push(u, v);
        return this;
    }

    /** Adds one triangle, given indices local to the current face (0, 1, 2, ...) — shifted by `_indexStart` so they point at this face's vertices within the shared, merged position buffer. */
    addIndices(i1: number, i2: number, i3: number) {
        this._indices.push(this._indexStart + i1, this._indexStart + i2, this._indexStart + i3);
        return this;
    }

    build(): FaceMeshData {
        return {
            position: new Float32Array(this._positions),
            color: this.getColor()!,
            normal: new Float32Array(this._normals),
            index: new Uint32Array(this._indices),
            uv: new Float32Array(this._uvs),
            range: this._groups,
            groups: [],
        };
    }
}
