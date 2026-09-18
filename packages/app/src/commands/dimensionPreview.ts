import {
    buildDimensionGeometry,
    type DimensionGeometry,
    type DimensionInput,
    type DimensionLabel,
    type DimensionLineType,
    type DimensionSettings,
    DimensionSetup,
    type I18nKeys,
    pixelsForLineWeight,
    resolveDimensionColor,
    resolveDimensionLineType,
    XYZ,
} from "@draftworks/core";

/**
 * The sample drawings in AutoCAD's Dimension Style dialog: a figure with one dimension of
 * each kind on it, redrawn on every keystroke so the settings can be judged by looking
 * rather than by imagining.
 *
 * The dimensions here are laid out by `buildDimensionGeometry` - the same function the
 * DIMLINEAR, DIMANGULAR and DIMRADIUS commands call - with the pending settings passed
 * as an override. Drawing the preview by hand would have been less code and would have
 * started lying the first time the real layout changed.
 *
 * There are two samples, and the difference between them is the point. A dimension style
 * is written in drawing units, so the same 2.5-unit text that reads properly on a 28-unit
 * machined part is a speck on an 11,400-unit building plan. Paging to the second sample
 * shows exactly that, and shows the Fit tab's overall scale (DIMSCALE) putting it right -
 * which is a thing no single figure at one size can demonstrate.
 */

const NS = "http://www.w3.org/2000/svg";

/** The drawing plane: XY, seen from +Z, with X to the right. */
const FRAME = { normal: XYZ.unitZ, xAxis: XYZ.unitX };

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

/**
 * SVG's Y axis points down and the drawing's points up, so every Y is negated on the way
 * out. Doing it per coordinate rather than with a flip transform keeps the text upright -
 * a mirrored group would mirror the labels too.
 */
const sy = (y: number) => -y;

/** A polyline through drawing-space points, closed or not, as SVG path data. */
const path = (points: XYZ[], close = false) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${sy(p.y)}`).join("") + (close ? "Z" : "");

export interface PreviewSample {
    /** Caption naming what is being drawn, and how big it is. */
    name: I18nKeys;
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
     * box is silently clipped rather than scaled back in. The width is what sets the
     * drawing's scale on screen, because the preview pane is wider than it is tall in the
     * same proportion or more; the height is therefore free, and is set taller than the
     * figure needs so a large text height has somewhere to grow into. Y is negated here
     * (see `sy`), so the top of a figure is the most negative coordinate.
     */
    view: { x: number; y: number; width: number; height: number };
    /** The thing being measured, as stroked SVG path data. */
    outline: string[];
    /** Round features, in drawing space. */
    circles: { center: XYZ; radius: number }[];
    dimensions: (settings: Partial<DimensionSettings>) => DimensionInput[];
}

// --- Sample 1: a machined part ---------------------------------------------------

/**
 * A plate with a chamfer, and a hole beside it.
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
 * What the first sample measures, in drawing units. Exported so tests can assert on the
 * labels without hard-coding the figure's size - it is chosen for legibility (see above)
 * and may be retuned again.
 */
export const PREVIEW_FIGURE = {
    width: PLATE.right - PLATE.left,
    height: PLATE.top - PLATE.bottom,
    holeRadius: HOLE.radius,
} as const;

const mechanical: PreviewSample = {
    name: "dimstyle.sample.mechanical",
    view: { x: -13, y: -26, width: 66, height: 42 },
    outline: [
        path(
            [
                at(PLATE.left, PLATE.bottom),
                at(PLATE.right, PLATE.bottom),
                at(PLATE.right, PLATE.top),
                CHAMFER_TO,
            ],
            true,
        ),
    ],
    circles: [{ center: HOLE.center, radius: HOLE.radius }],
    dimensions: (settings) => [
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
    ],
};

// --- Sample 2: a building plan ---------------------------------------------------

/**
 * The same four dimensions on a plot 11,400 units across - 11.4 m in a millimetre
 * drawing, which is an ordinary house footprint and the scale most of this app's drawings
 * are actually at.
 *
 * Four hundred times the machined part, and deliberately so: at the default style its
 * arrowheads and text land well under a pixel here, which is not a fault in the preview
 * but the honest answer to "what does a 2.5-unit text height look like on a building?".
 * Overall scale on the Fit tab is what fixes it, and `suggestedOverallScale` works out by
 * how much - around 260, which is the ratio of the two viewBoxes rather than of the two
 * figures, because it is the drawing on screen that has to end up legible.
 */
const PLOT = { left: 0, bottom: 0, right: 11400, top: 5600 };
/** The top right corner is cut away, which is what the angular dimension measures. */
const CANT_FROM = at(PLOT.right, 3400);
const CANT_TO = at(9200, PLOT.top);
/** An internal partition, dimensioned on the near row below the plan. */
const PARTITION_X = 4600;
/**
 * The stair sits in the left room, well away from the cut corner. At the scale this
 * sample is meant to be read at, a label is a couple of thousand units wide - a fifth of
 * the building - so the radius and the angle have to be given separate rooms to sit in or
 * they land on top of each other.
 */
const STAIR = { center: at(2400, 2600), radius: 900 };
/** Chained outwards: the partition on the near row, the overall width beyond it. */
const NEAR_ROW = -1800;
const OUTER_ROW = -3600;

const architectural: PreviewSample = {
    name: "dimstyle.sample.architectural",
    // Proportioned to match the first sample's viewBox, so paging between the two does not
    // jump - only the size of what is drawn inside changes, which is the whole lesson.
    view: { x: -4700, y: -6100, width: 16900, height: 11100 },
    outline: [
        path(
            [
                at(PLOT.left, PLOT.bottom),
                at(PLOT.right, PLOT.bottom),
                CANT_FROM,
                CANT_TO,
                at(PLOT.left, PLOT.top),
            ],
            true,
        ),
        path([at(PARTITION_X, PLOT.bottom), at(PARTITION_X, PLOT.top)]),
    ],
    circles: [{ center: STAIR.center, radius: STAIR.radius }],
    dimensions: (settings) => [
        // The partition, on the row nearest the plan - architectural drawings chain their
        // dimensions outwards like this, detail first and overall furthest out.
        {
            type: "linear",
            start: at(PLOT.left, PLOT.bottom),
            end: at(PARTITION_X, PLOT.bottom),
            offsetPoint: at(PARTITION_X / 2, NEAR_ROW),
            frame: FRAME,
            settings,
        },
        // Overall width, on the outer row.
        {
            type: "linear",
            start: at(PLOT.left, PLOT.bottom),
            end: at(PLOT.right, PLOT.bottom),
            offsetPoint: at(PLOT.right / 2, OUTER_ROW),
            frame: FRAME,
            settings,
        },
        // Overall depth, up the left side.
        {
            type: "linear",
            start: at(PLOT.left, PLOT.bottom),
            end: at(PLOT.left, PLOT.top),
            offsetPoint: at(-2600, PLOT.top / 2),
            frame: FRAME,
            settings,
        },
        // The cut corner, measured on the inside where the arc has room.
        {
            type: "angular",
            start: CANT_FROM,
            end: CANT_TO,
            third: at(PLOT.right, PLOT.bottom),
            offsetPoint: at(9950, 2800),
            frame: FRAME,
            settings,
        },
        // The stair, radius leader heading up and to the left - into the open half of the
        // left room, rather than towards the partition its label would otherwise cross.
        {
            type: "radius",
            start: STAIR.center,
            end: STAIR.center,
            radius: STAIR.radius,
            offsetPoint: STAIR.center.add(at(-700, 700)),
            frame: FRAME,
            settings,
        },
    ],
};

/** The samples the preview pages through, in the order the arrow steps them. */
export const PREVIEW_SAMPLES: readonly PreviewSample[] = [mechanical, architectural];

/**
 * Text height as a fraction of the drawing, at the proportion the default style hits on
 * the machined part - 2.5 units in a 66-unit view. A dimension is legible at roughly this
 * ratio whatever the drawing's absolute size.
 */
const READABLE_TEXT_RATIO = 2.5 / 66;
/** Under this fraction of the view, text lands beneath about five pixels in the pane. */
const LEGIBLE_MIN_RATIO = 1 / 120;

/** Rounded to two significant figures, because it is offered as "about this much". */
const round2 = (value: number) => {
    const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
    return Math.round(value / magnitude) * magnitude;
};

/**
 * The overall scale this sample would need before the style's text is legible on it, or
 * undefined when it already is.
 *
 * This exists because the second sample at the default style draws its line work and
 * nothing else - the text and arrowheads are real but sub-pixel - and a pane that has
 * gone blank looks like a broken preview rather than the answer to a question. It is the
 * answer: the style is four hundred times too small for a building, and this says by how
 * much.
 */
export function suggestedOverallScale(settings: Partial<DimensionSettings>, index = 0): number | undefined {
    const sample = PREVIEW_SAMPLES[index] ?? PREVIEW_SAMPLES[0];
    const style = DimensionSetup.resolve(settings);
    const drawn = style.textHeight * style.overallScale;
    if (drawn / sample.view.width >= LEGIBLE_MIN_RATIO) return undefined;

    return round2((sample.view.width * READABLE_TEXT_RATIO) / style.textHeight);
}

// --- Rendering -------------------------------------------------------------------

/**
 * Line weights as a fraction of the viewBox width, rather than a fixed number of drawing
 * units.
 *
 * They stand for screen hairlines, not for anything the drawing contains, so they have to
 * be relative: a 0.22-unit stroke that reads as a hairline on the 66-unit machined part is
 * three thousandths of a pixel on the 18,200-unit plan, and the whole figure would come
 * out blank. Expressed as a ratio, both samples draw at the same apparent weight.
 */
const FIGURE_STROKE_RATIO = 0.3 / 66;
const DIMENSION_STROKE_RATIO = 0.22 / 66;

/** Matches the width estimate the Fit rules use, so the two agree about what fits. */
const TEXT_WIDTH_RATIO = 0.6;

/**
 * Dash and gap lengths per linetype, as multiples of the dimension stroke width. The
 * proportions match `LineDashPatterns` in the three renderer - the sample has to show
 * the same pattern the viewport will draw, or it is not a preview of anything.
 */
const PREVIEW_DASH_PATTERNS: Record<string, [number, number]> = {
    dash: [10, 10],
    hidden: [5, 5],
    dot: [1, 5],
};

/**
 * The SVG dash attribute for a linetype, or nothing at all for a continuous one -
 * `stroke-dasharray` has no "off" value, so a solid line omits the attribute entirely.
 */
function dashAttribute(lineType: DimensionLineType, stroke: number): { "stroke-dasharray"?: string } {
    const pattern = PREVIEW_DASH_PATTERNS[resolveDimensionLineType(lineType)];
    if (pattern === undefined) return {};
    return { "stroke-dasharray": `${pattern[0] * stroke} ${pattern[1] * stroke}` };
}

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

const textElement = (x: number, y: number, size: number, fill: string, content: string) => {
    const node = element("text", {
        x,
        y,
        "font-size": size,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill,
    });
    node.textContent = content;
    return node;
};

const estimateWidth = (text: string, size: number) => text.length * size * TEXT_WIDTH_RATIO;

/**
 * The label: the measurement, its stacked tolerance, the alternate units beneath it, and
 * the box a Basic tolerance draws round the lot.
 *
 * Grouped and rotated as a whole rather than drawn as one `<text>`, because the parts sit
 * at different sizes and offsets - which is exactly what the Tolerances and Alternate
 * Units tabs are for.
 */
function renderLabel(geometry: DimensionGeometry, style: DimensionSettings, stroke: number): SVGGElement {
    const label: DimensionLabel = geometry.label;
    const size = style.textHeight * style.overallScale;
    const fill = resolveDimensionColor(style.textColor) ?? "currentColor";
    const x = geometry.textPosition.x;
    const y = sy(geometry.textPosition.y);

    const group = element("g", {});
    const parts: SVGElement[] = [];

    const mainWidth = estimateWidth(label.text, size);
    let width = mainWidth;
    let height = size;

    if (label.text) parts.push(textElement(0, 0, size, fill, label.text));

    if (label.tolerance) {
        const toleranceSize = size * label.toleranceScale;
        const { upper, lower } = label.tolerance;
        const toleranceWidth = estimateWidth(
            upper.length >= (lower?.length ?? 0) ? upper : (lower as string),
            toleranceSize,
        );
        // Stacked to the right of the measurement, or centred on the anchor when there is
        // no measurement to sit beside - which is the Limits method.
        const dx = label.text ? mainWidth / 2 + toleranceWidth / 2 : 0;

        if (lower === undefined) {
            // Symmetrical: one ± line, on the measurement's own baseline.
            parts.push(textElement(dx, 0, toleranceSize, fill, upper));
        } else {
            // DIMTOLJ decides which of the two lines the measurement lines up with.
            const shift =
                label.toleranceAlignment === "top"
                    ? toleranceSize * 0.6
                    : label.toleranceAlignment === "bottom"
                      ? -toleranceSize * 0.6
                      : 0;
            parts.push(
                textElement(dx, -toleranceSize * 0.6 + shift, toleranceSize, fill, upper),
                textElement(dx, toleranceSize * 0.6 + shift, toleranceSize, fill, lower),
            );
            height = Math.max(height, toleranceSize * 2.2);
        }
        width += toleranceWidth;
    }

    if (label.secondary) {
        parts.push(textElement(0, size, size, fill, label.secondary));
        width = Math.max(width, estimateWidth(label.secondary, size));
        height += size;
    }

    // Text fill and the Basic box are both rectangles behind or around the same block, so
    // they are measured once and drawn in that order beneath the text.
    const pad = style.textOffset * style.overallScale * 0.5;
    const box = {
        x: -width / 2 - pad,
        y: -height / 2 - pad,
        width: width + pad * 2,
        height: height + pad * 2,
    };

    if (style.textFill !== "none") {
        group.append(
            element("rect", {
                ...box,
                fill:
                    style.textFill === "background"
                        ? "var(--title-background)"
                        : (resolveDimensionColor(style.textFillColor) ?? "var(--title-background)"),
            }),
        );
    }
    if (label.boxed) {
        group.append(element("rect", { ...box, fill: "none", stroke: fill, "stroke-width": stroke }));
    }

    group.append(...parts);
    // Rotation is applied about the anchor, then the anchor translated into place, so the
    // parts above could all be laid out about the origin.
    const degrees = (-geometry.textRotation * 180) / Math.PI;
    group.setAttribute("transform", `translate(${x} ${y}) rotate(${degrees})`);
    return group;
}

/**
 * Renders sample `index` for `settings`. Returns a fresh `<svg>`; the caller swaps it in
 * wholesale rather than mutating one in place, which keeps redraw code to one path.
 */
export function renderDimensionPreview(settings: Partial<DimensionSettings>, index = 0): SVGSVGElement {
    const sample = PREVIEW_SAMPLES[index] ?? PREVIEW_SAMPLES[0];
    const { view } = sample;

    const svg = element("svg", {
        viewBox: `${view.x} ${view.y} ${view.width} ${view.height}`,
        // Height follows the aspect ratio; the CSS gives it its width.
        preserveAspectRatio: "xMidYMid meet",
        role: "img",
    });

    const figureStroke = view.width * FIGURE_STROKE_RATIO;
    const dimensionStroke = view.width * DIMENSION_STROKE_RATIO;

    // The measured figure itself - drawn muted, so the dimensions read as the subject.
    for (const outline of sample.outline) {
        svg.append(
            element("path", {
                d: outline,
                fill: "none",
                stroke: "currentColor",
                "stroke-width": figureStroke,
                "stroke-opacity": 0.45,
            }),
        );
    }
    for (const circle of sample.circles) {
        svg.append(
            element("circle", {
                cx: circle.center.x,
                cy: sy(circle.center.y),
                r: circle.radius,
                fill: "none",
                stroke: "currentColor",
                "stroke-width": figureStroke,
                "stroke-opacity": 0.45,
            }),
        );
    }

    // The dialog hands over a complete draft, but this is also reachable with a partial
    // one, so the style is resolved against the active settings either way.
    const style = DimensionSetup.resolve(settings);
    const dimColor = resolveDimensionColor(style.dimLineColor) ?? "currentColor";
    const extColor = resolveDimensionColor(style.extLineColor) ?? "currentColor";

    for (const input of sample.dimensions(settings)) {
        const geometry = buildDimensionGeometry(input);
        // A degenerate setting (a zero-length span, a collinear angle) draws nothing
        // rather than a malformed dimension - the same contract the commands get.
        if (!geometry) continue;

        svg.append(
            element("path", {
                d: linePath(geometry.extensionLines),
                fill: "none",
                stroke: extColor,
                "stroke-width": dimensionStroke * pixelsForLineWeight(style.extLineWeight),
                ...dashAttribute(style.extLineType1, dimensionStroke),
            }),
            element("path", {
                d: linePath(geometry.dimensionLines),
                fill: "none",
                stroke: dimColor,
                "stroke-width": dimensionStroke * pixelsForLineWeight(style.dimLineWeight),
                ...dashAttribute(style.dimLineType, dimensionStroke),
            }),
            element("path", { d: arrowPaths(geometry.arrows), fill: dimColor }),
        );

        // Centred on the anchor in both axes, because the viewport renders these labels
        // as CSS2DObjects and CSS2DRenderer centres its element on the world position.
        // Anchoring the preview any other way would put the text somewhere the drawing
        // will not put it.
        svg.append(renderLabel(geometry, style, dimensionStroke));
    }

    return svg;
}
