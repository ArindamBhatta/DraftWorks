/**
 * The topological classification of a B-Rep (Boundary Representation) shape — the same hierarchy
 * used by CAD kernels like OpenCascade: a solid model is built from nested topological pieces,
 * from the whole model down to a single point:
 *
 *   Compound / CompoundSolid  (a container grouping several solids/shapes together, e.g. an assembly)
 *     -> Solid   (a fully enclosed 3D volume, e.g. one part/body)
 *       -> Shell   (a connected set of faces forming (part of) a solid's skin)
 *         -> Face    (a bounded piece of a surface, e.g. one flat/curved face of a part)
 *           -> Wire    (a connected chain of edges forming a closed/open loop, e.g. a face's boundary)
 *             -> Edge    (a curve segment between two points, e.g. one line/arc of a sketch or a solid's edge)
 *               -> Vertex  (a single point in space)
 *
 * Each level is encoded as a distinct BIT (0b1, 0b10, 0b100, ...) rather than a sequential enum, so
 * multiple types can be combined into one bitmask with `|` — e.g. a selection filter that should
 * accept "faces or edges" is just `ShapeTypes.face | ShapeTypes.edge`. `ShapeTypeUtils.contains`
 * and the `hasXxx` helpers then use `&` to test whether a given bitmask includes a specific type.
 * This is what powers CAD selection filtering (e.g. "only let the user pick edges" for a Fillet
 * command) and snapping (e.g. "only snap to vertices and edges").
 */
export const ShapeTypes = {
    shape: 0b0,
    compound: 0b1,
    compoundSolid: 0b10,
    solid: 0b100,
    shell: 0b1000,
    face: 0b10000,
    wire: 0b100000,
    edge: 0b1000000,
    vertex: 0b10000000,
} as const;

export type ShapeType = (typeof ShapeTypes)[keyof typeof ShapeTypes];

export class ShapeTypeUtils {
    /**
     * True for the shape kinds that are treated as a single, atomic "whole" rather than something
     * you'd normally break down into sub-shapes for iteration/selection purposes: the generic
     * `shape` wildcard, containers (`compound`/`compoundSolid`), and `vertex` (already the smallest
     * possible piece, nothing to descend into further).
     */
    public static isWhole(type: ShapeType) {
        return (
            type === ShapeTypes.shape ||
            type === ShapeTypes.compound ||
            type === ShapeTypes.compoundSolid ||
            type === ShapeTypes.vertex
        );
    }

    /** Human-readable name for a shape type — used in UI labels, e.g. a status-bar hint like "Face selected" or a tree-view node label. */
    public static stringValue(type: ShapeType) {
        switch (type) {
            case ShapeTypes.shape:
                return "Shape";
            case ShapeTypes.compound:
                return "Compound";
            case ShapeTypes.compoundSolid:
                return "CompoundSolid";
            case ShapeTypes.solid:
                return "Solid";
            case ShapeTypes.shell:
                return "Shell";
            case ShapeTypes.face:
                return "Face";
            case ShapeTypes.wire:
                return "Wire";
            case ShapeTypes.edge:
                return "Edge";
            case ShapeTypes.vertex:
                return "Vertex";
            default:
                return "Unknown";
        }
    }

    /** Generic bitmask test: does `type` (possibly a combination of several kinds) include `target`? */
    public static contains(type: ShapeType, target: ShapeType) {
        return (type & target) !== 0;
    }

    public static hasCompound(type: ShapeType): boolean {
        return (type & ShapeTypes.compound) !== 0;
    }
    public static hasCompoundSolid(type: ShapeType): boolean {
        return (type & ShapeTypes.compoundSolid) !== 0;
    }
    public static hasSolid(type: ShapeType): boolean {
        return (type & ShapeTypes.solid) !== 0;
    }
    public static hasShell(type: ShapeType): boolean {
        return (type & ShapeTypes.shell) !== 0;
    }
    public static hasFace(type: ShapeType): boolean {
        return (type & ShapeTypes.face) !== 0;
    }
    public static hasWire(type: ShapeType): boolean {
        return (type & ShapeTypes.wire) !== 0;
    }
    public static hasEdge(type: ShapeType): boolean {
        return (type & ShapeTypes.edge) !== 0;
    }
    public static hasVertex(type: ShapeType): boolean {
        return (type & ShapeTypes.vertex) !== 0;
    }
}
