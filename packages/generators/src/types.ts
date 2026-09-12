/**
 * A point in the generator's own coordinate space. Always millimetres, always planar -
 * see units.ts for why generators never touch drawing units.
 */
export interface Vec2 {
    x: number;
    y: number;
}

/** Formats a millimetre length for display, e.g. 3600 -> "3600" or "11'-10"". */
export type LengthFormatter = (mm: number) => string;

/**
 * The layers a generator wants its output on. Each generator declares its own set - a
 * floor plan needs WALL/DOOR/WINDOW/TEXT, a rebar detail would want CONCRETE/REBAR/TEXT -
 * so nothing about layers is hardcoded in the renderer that consumes DrawItems.
 *
 * `color` is 0xRRGGBB, or LAYER_COLOR_BY_THEME (-1) from @draftworks/core to follow the
 * light/dark theme instead of pinning one colour.
 */
export interface LayerSpec {
    /** Stable key referenced by DrawItem.layer. */
    tag: string;
    /** The layer name as it appears in the Layer Properties Manager. */
    name: string;
    color: number;
}

/**
 * The one output format every generator produces: a flat list of drawing primitives in
 * millimetres, tagged by layer. It deliberately knows nothing about IDocument, node
 * classes or the geometry kernel, which is what lets the same list feed both the real
 * renderer and an SVG preview - and what makes every generator testable with plain
 * arithmetic assertions.
 *
 * `sweepDeg` maps 1:1 onto ArcNode.angle, which is in DEGREES (packages/wasm/src/factory.ts
 * converts with degToRad before calling the kernel). Positive is counter-clockwise.
 */
export type DrawItem =
    | { kind: "line"; layer: string; a: Vec2; b: Vec2 }
    | { kind: "arc"; layer: string; center: Vec2; start: Vec2; sweepDeg: number }
    | { kind: "circle"; layer: string; center: Vec2; radiusMm: number }
    | {
          kind: "ellipse";
          layer: string;
          center: Vec2;
          radiusXMm: number;
          radiusYMm: number;
          /** Rotation of the X radius away from the drawing's X axis. */
          rotationDeg: number;
      }
    | {
          kind: "polyline";
          layer: string;
          /** Two or more points. A closed run repeats nothing - set `closed` instead. */
          points: Vec2[];
          closed: boolean;
      }
    | {
          kind: "text";
          layer: string;
          /** Left baseline of the text, matching TextAnnotation.position for boxWidth 0. */
          at: Vec2;
          text: string;
          heightMm: number;
          rotationDeg: number;
      };

/** Axis-aligned extent of a drawing, in millimetres. */
export interface Bounds {
    min: Vec2;
    max: Vec2;
}

export function boundsOf(items: DrawItem[]): Bounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const include = (p: Vec2) => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    };

    for (const item of items) {
        if (item.kind === "line") {
            include(item.a);
            include(item.b);
        } else if (item.kind === "arc") {
            // The centre and the start point bound the arc closely enough for a preview
            // viewBox; every arc this package emits is a 90 degree door swing.
            include(item.center);
            include(item.start);
            include(arcEnd(item));
        } else if (item.kind === "circle") {
            include({ x: item.center.x - item.radiusMm, y: item.center.y - item.radiusMm });
            include({ x: item.center.x + item.radiusMm, y: item.center.y + item.radiusMm });
        } else if (item.kind === "ellipse") {
            // A rotated ellipse's axis-aligned extent, rather than the naive rx/ry box -
            // otherwise a 45 degree ellipse gets clipped out of the preview viewBox.
            const rad = (item.rotationDeg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const halfW = Math.hypot(item.radiusXMm * cos, item.radiusYMm * sin);
            const halfH = Math.hypot(item.radiusXMm * sin, item.radiusYMm * cos);
            include({ x: item.center.x - halfW, y: item.center.y - halfH });
            include({ x: item.center.x + halfW, y: item.center.y + halfH });
        } else if (item.kind === "polyline") {
            for (const point of item.points) include(point);
        } else {
            include(item.at);
        }
    }

    if (minX > maxX) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** The far end of an arc, derived by rotating its start point about its centre. */
export function arcEnd(arc: { center: Vec2; start: Vec2; sweepDeg: number }): Vec2 {
    const rad = (arc.sweepDeg * Math.PI) / 180;
    const dx = arc.start.x - arc.center.x;
    const dy = arc.start.y - arc.center.y;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
        x: arc.center.x + dx * cos - dy * sin,
        y: arc.center.y + dx * sin + dy * cos,
    };
}
