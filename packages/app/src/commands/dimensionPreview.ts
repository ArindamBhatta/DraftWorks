// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { buildDimensionGeometry, type DimensionInput, type DimensionSettings, XYZ } from "@chili3d/core";

/**
 * The sample drawing in AutoCAD's Dimension Style dialog: a figure with one dimension of
 * each kind on it, redrawn on every keystroke so the settings can be judged by looking
 * rather than by imagining.
 *
 * The dimensions here are laid out by `buildDimensionGeometry` - the same function the
 * DIMLINEAR, DIMANGULAR and DIMRADIUS commands call - with the pending settings passed
 * as an override. Drawing the preview by hand would have been less code and would have
 * started lying the first time the real layout changed.
 */

const NS = "http://www.w3.org/2000/svg";

/** The drawing plane: XY, seen from +Z, with X to the right. */
const FRAME = { normal: XYZ.unitZ, xAxis: XYZ.unitX };

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

/**
 * The figure being measured: a plate with a chamfer, and a hole beside it.
 *
 * Sized against the *default* text height (2.5 units), not chosen for its own sake. A
 * drawing is legible when its text is roughly a tenth of the figure, so the plate is
 * ~28 units across; an earlier 88-unit plate put the labels at a 35:1 ratio and rendered
 * them about 3px tall in the preview pane, which is what "can't see it" looked like.
 */
const PLATE = { left: 0, bottom: 0, right: 28, top: 17 };
const CHAMFER_TO = at(18, PLATE.top);
const HOLE = { center: at(41, 8.5), radius: 6 };

/**
 * What the sample figure measures, in drawing units. Exported so tests can assert on the
 * labels without hard-coding the figure's size - it is chosen for legibility (see above)
 * and may be retuned again.
 */
export const PREVIEW_FIGURE = {
    width: PLATE.right - PLATE.left,
    height: PLATE.top - PLATE.bottom,
    holeRadius: HOLE.radius,
} as const;

/**
 * A fixed viewBox rather than one fitted to the geometry.
 *
 * Fitting would rescale the whole figure every time the arrow size changed, so bigger
 * arrows would render at the same apparent size and the setting would look inert. Held
 * fixed, the sample behaves like a drawing at a fixed zoom: turn the arrows up and the
 * arrows get bigger.
 *
 * Sized to hold the figure at the largest settings anyone is likely to type, with room
 * to spare - the extents grow with text height and arrow size, and geometry outside the
 * box is silently clipped rather than scaled back in. Y is negated on the way out (see
 * `sy`), so the top of the plate is the most negative coordinate here.
 */
const VIEW = { x: -13, y: -21, width: 66, height: 34 };

/** Line weights, in drawing units, chosen to read as hairlines at the view's scale. */
const FIGURE_STROKE = 0.3;
const DIMENSION_STROKE = 0.22;

const dimensions = (settings: Partial<DimensionSettings>): DimensionInput[] => [
    // DIMLINEAR across the bottom.
    {
        type: "linear",
        start: at(PLATE.left, PLATE.bottom),
        end: at(PLATE.right, PLATE.bottom),
        offsetPoint: at(PLATE.right / 2, -6),
        frame: FRAME,
        settings,
    },
    // DIMLINEAR up the left side.
    {
        type: "linear",
        start: at(PLATE.left, PLATE.bottom),
        end: at(PLATE.left, PLATE.top),
        offsetPoint: at(-7, PLATE.top / 2),
        frame: FRAME,
        settings,
    },
    // DIMANGULAR on the chamfer, measured from the bottom edge.
    {
        type: "angular",
        start: at(PLATE.left, PLATE.bottom),
        end: at(PLATE.right, PLATE.bottom),
        third: CHAMFER_TO,
        offsetPoint: at(10, 7),
        frame: FRAME,
        settings,
    },
    // DIMRADIUS on the hole, leader heading up and to the right.
    {
        type: "radius",
        start: HOLE.center,
        end: HOLE.center,
        radius: HOLE.radius,
        offsetPoint: HOLE.center.add(at(5, 5)),
        frame: FRAME,
        settings,
    },
];

function element<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
        node.setAttribute(name, String(value));
    }
    return node;
}

/**
 * SVG's Y axis points down and the drawing's points up, so every Y is negated on the way
 * out. Doing it per coordinate rather than with a flip transform keeps the text upright -
 * a mirrored group would mirror the labels too.
 */
const sy = (y: number) => -y;

/** Flat [ax,ay,az, bx,by,bz, ...] vertex pairs into one polyline path per pair. */
function linePath(points: number[]): string {
    const parts: string[] = [];
    for (let i = 0; i + 5 < points.length; i += 6) {
        parts.push(`M${points[i]} ${sy(points[i + 1])}L${points[i + 3]} ${sy(points[i + 4])}`);
    }
    return parts.join("");
}

/** Flat triangle vertices into one filled polygon per triangle. */
function arrowPaths(points: number[]): string {
    const parts: string[] = [];
    for (let i = 0; i + 8 < points.length; i += 9) {
        const [ax, ay, , bx, by, , cx, cy] = points.slice(i, i + 9);
        parts.push(`M${ax} ${sy(ay)}L${bx} ${sy(by)}L${cx} ${sy(cy)}Z`);
    }
    return parts.join("");
}

/** The measured figure itself - drawn muted, so the dimensions read as the subject. */
function figurePath(): string {
    const { left, bottom, right, top } = PLATE;
    return (
        `M${left} ${sy(bottom)}L${right} ${sy(bottom)}L${right} ${sy(top)}` +
        `L${CHAMFER_TO.x} ${sy(CHAMFER_TO.y)}L${left} ${sy(bottom)}Z`
    );
}

/**
 * Renders the sample drawing for `settings`. Returns a fresh `<svg>`; the caller swaps it
 * in wholesale rather than mutating one in place, which keeps redraw code to one path.
 */
export function renderDimensionPreview(settings: Partial<DimensionSettings>): SVGSVGElement {
    const svg = element("svg", {
        viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`,
        // Height follows the aspect ratio; the CSS gives it its width.
        preserveAspectRatio: "xMidYMid meet",
        role: "img",
    });

    svg.append(
        element("path", {
            d: figurePath(),
            fill: "none",
            stroke: "currentColor",
            "stroke-width": FIGURE_STROKE,
            "stroke-opacity": 0.45,
        }),
        element("circle", {
            cx: HOLE.center.x,
            cy: sy(HOLE.center.y),
            r: HOLE.radius,
            fill: "none",
            stroke: "currentColor",
            "stroke-width": FIGURE_STROKE,
            "stroke-opacity": 0.45,
        }),
    );

    const textHeight = settings.textHeight ?? 0;
    for (const input of dimensions(settings)) {
        const geometry = buildDimensionGeometry(input);
        // A degenerate setting (a zero-length span, a collinear angle) draws nothing
        // rather than a malformed dimension - the same contract the commands get.
        if (!geometry) continue;

        svg.append(
            element("path", {
                d: linePath(geometry.lines),
                fill: "none",
                stroke: "currentColor",
                "stroke-width": DIMENSION_STROKE,
            }),
            element("path", { d: arrowPaths(geometry.arrows), fill: "currentColor" }),
        );

        // Centred on the anchor in both axes, because the viewport renders these labels
        // as CSS2DObjects and CSS2DRenderer centres its element on the world position.
        // Anchoring the preview any other way would put the text somewhere the drawing
        // will not put it.
        const label = element("text", {
            x: geometry.textPosition.x,
            y: sy(geometry.textPosition.y),
            "font-size": textHeight,
            "text-anchor": "middle",
            "dominant-baseline": "central",
            fill: "currentColor",
        });
        label.textContent = geometry.text;
        svg.append(label);
    }

    return svg;
}
