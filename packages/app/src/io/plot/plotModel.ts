// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * What a rendered sheet is made of.
 *
 * Two primitives, paths and text, in millimetres on the paper. That is deliberately close
 * to what both PDF content streams and SVG accept, so neither emitter has to think: they
 * walk this list and write it out. Anything that needs a decision - what colour a
 * BYLAYER entity is, how wide a lineweight plots, where on the sheet the drawing sits -
 * has already been decided by the time a primitive exists, which is what keeps the two
 * emitters from disagreeing about the same drawing.
 *
 * The origin is the bottom-left of the sheet and y runs up, because that is PDF's own
 * convention and PDF is the output that has to be exact. SVG flips once, in its emitter.
 */

/**
 * Cap height as a fraction of font size, for Helvetica.
 *
 * A DXF text height is the height of a capital letter, while both SVG's `font-size` and
 * PDF's `Tf` take the em size, which is larger. Dividing by this converts one to the other.
 * Both emitters use it, so the preview and the PDF agree about how big 2.5 mm text is -
 * 718/1000 is Helvetica's own declared capHeight.
 */
export const CAP_HEIGHT_RATIO = 0.718;

/** A point on the sheet, in millimetres from the bottom-left corner. */
export interface PlotPoint {
    x: number;
    y: number;
}

export type PathCommand =
    | { type: "move"; to: PlotPoint }
    | { type: "line"; to: PlotPoint }
    /** Cubic Bezier. Arcs and ellipses become these rather than being flattened. */
    | { type: "curve"; c1: PlotPoint; c2: PlotPoint; to: PlotPoint }
    | { type: "close" };

export interface PlotPath {
    kind: "path";
    commands: PathCommand[];
    /**
     * Stroke width in millimetres. Zero means the thinnest line the device can draw,
     * which is what both PDF and SVG do with a zero width, and what AutoCAD plots when
     * object lineweights are off.
     */
    widthMm: number;
    /** `#rrggbb`. Already resolved through the layer and the plot style. */
    color: string;
    /** Filled rather than stroked - dimension arrowheads and SOLIDs. */
    filled: boolean;
}

export interface PlotText {
    kind: "text";
    content: string;
    /** Start of the baseline, in millimetres. */
    at: PlotPoint;
    /** Cap height in millimetres. */
    heightMm: number;
    /** Degrees, counter-clockwise. */
    rotation: number;
    color: string;
}

export type PlotPrimitive = PlotPath | PlotText;

/** A drawing's bounding box in drawing units. */
export interface PlotExtents {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface PlotSheet {
    widthMm: number;
    heightMm: number;
    /** The area the printer can mark; both emitters clip to it. */
    printable: { x: number; y: number; width: number; height: number };
    primitives: PlotPrimitive[];
    /**
     * The plot scale actually used, as drawing units per paper millimetre. Equal to the
     * requested scale unless "fit to paper" computed one, which the dialog reports back so
     * the user can see what a fitted plot came out at.
     */
    scale: number;
    /** What was plotted. Undefined when the plot area held nothing. */
    extents?: PlotExtents;
    /** True when the drawing did not fit the printable area and will be cut off. */
    clipped: boolean;
}

export const emptySheet = (widthMm: number, heightMm: number): PlotSheet => ({
    widthMm,
    heightMm,
    printable: { x: 0, y: 0, width: widthMm, height: heightMm },
    primitives: [],
    scale: 1,
    clipped: false,
});
