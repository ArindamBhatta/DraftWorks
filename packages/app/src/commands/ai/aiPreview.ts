import { LAYER_COLOR_BY_THEME } from "@chili3d/core";
import { arcEnd, boundsOf, type DrawItem, type LayerSpec, type Vec2 } from "@chili3d/generators";

const NS = "http://www.w3.org/2000/svg";

/** How each layer reads in the preview. Deliberately close to the layer colours. */
interface Stroke {
    color: string;
    width: number;
}

const DEFAULT_STROKE: Stroke = { color: "currentColor", width: 1.6 };

const STROKE: Record<string, Stroke> = {
    WALL: DEFAULT_STROKE,
    DOOR: { color: "#2e9e4f", width: 0.9 },
    WINDOW: { color: "#2b8fb3", width: 0.9 },
    TEXT: { color: "currentColor", width: 0.6 },
};

/**
 * The palette for a drawing whose layers were not known when this file was written -
 * anything the model named itself. Hand-tuned entries above still win, so a floor plan
 * looks exactly as it did.
 */
function strokesFor(layers: LayerSpec[] | undefined): Record<string, Stroke> {
    if (!layers) return STROKE;
    const strokes: Record<string, Stroke> = {};
    for (const layer of layers) {
        strokes[layer.tag] = STROKE[layer.tag] ?? {
            // A theme-following layer has no colour of its own, and currentColor is what
            // makes it legible in the panel whichever theme is up.
            color:
                layer.color === LAYER_COLOR_BY_THEME
                    ? "currentColor"
                    : `#${layer.color.toString(16).padStart(6, "0")}`,
            width: DEFAULT_STROKE.width,
        };
    }
    return strokes;
}

function el<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
}

/**
 * Draws the generator's own output at a glance, before any of it reaches the document.
 *
 * This costs almost nothing because it consumes the same DrawItem list the renderer
 * does - so it cannot drift from what will actually be drawn, which a hand-built preview
 * inevitably would. It is also what makes eight numbers judgeable: a draftsman can see
 * that the kitchen ended up behind the entrance far faster than they can read it.
 */
export function renderPreview(items: DrawItem[], layers?: LayerSpec[], maxSize = 320): SVGSVGElement {
    const strokes = strokesFor(layers);
    const bounds = boundsOf(items);
    const width = Math.max(bounds.max.x - bounds.min.x, 1);
    const height = Math.max(bounds.max.y - bounds.min.y, 1);
    const pad = Math.max(width, height) * 0.04;

    // SVG's Y axis points down and the drawing's points up, so each Y is negated on the
    // way out rather than flipping the whole group - a flip transform would mirror the
    // room labels too.
    const sy = (y: number) => -y;
    const svg = el("svg", {
        xmlns: NS,
        viewBox: [bounds.min.x - pad, -bounds.max.y - pad, width + 2 * pad, height + 2 * pad].join(" "),
        width: height > width ? (maxSize * width) / height : maxSize,
        height: height > width ? maxSize : (maxSize * height) / width,
        fill: "none",
        "stroke-linecap": "round",
    });

    // Scale strokes to the drawing so the line weights read the same on any plot size.
    const unit = Math.max(width, height) / 300;

    for (const item of items) {
        const style = strokes[item.layer] ?? DEFAULT_STROKE;
        const stroke = { stroke: style.color, "stroke-width": style.width * unit };
        if (item.kind === "line") {
            svg.append(
                el("line", {
                    x1: item.a.x,
                    y1: sy(item.a.y),
                    x2: item.b.x,
                    y2: sy(item.b.y),
                    ...stroke,
                }),
            );
        } else if (item.kind === "arc") {
            svg.append(el("path", { d: arcPath(item, sy), ...stroke }));
        } else if (item.kind === "circle") {
            svg.append(
                el("circle", { cx: item.center.x, cy: sy(item.center.y), r: item.radiusMm, ...stroke }),
            );
        } else if (item.kind === "ellipse") {
            svg.append(
                el("ellipse", {
                    cx: item.center.x,
                    cy: sy(item.center.y),
                    rx: item.radiusXMm,
                    ry: item.radiusYMm,
                    // Negating Y mirrors the plane, so the rotation reverses with it.
                    transform: `rotate(${-item.rotationDeg} ${item.center.x} ${sy(item.center.y)})`,
                    ...stroke,
                }),
            );
        } else if (item.kind === "polyline") {
            const points = item.points.map((p) => `${p.x},${sy(p.y)}`).join(" ");
            svg.append(el(item.closed ? "polygon" : "polyline", { points, ...stroke }));
        } else {
            svg.append(
                Object.assign(
                    el("text", {
                        x: item.at.x,
                        y: sy(item.at.y),
                        "font-size": item.heightMm,
                        fill: style.color,
                        stroke: "none",
                    }),
                    { textContent: item.text },
                ),
            );
        }
    }

    return svg;
}

function arcPath(arc: { center: Vec2; start: Vec2; sweepDeg: number }, sy: (y: number) => number): string {
    const end = arcEnd(arc);
    const r = Math.hypot(arc.start.x - arc.center.x, arc.start.y - arc.center.y);
    const largeArc = Math.abs(arc.sweepDeg) > 180 ? 1 : 0;
    // Negating Y mirrors the plane, so a counter-clockwise sweep becomes clockwise here.
    const sweepFlag = arc.sweepDeg > 0 ? 0 : 1;
    return `M ${arc.start.x} ${sy(arc.start.y)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end.x} ${sy(end.y)}`;
}
