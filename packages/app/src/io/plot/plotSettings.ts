// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * What a plot is: the settings AutoCAD's PLOT dialog collects, and the arithmetic that
 * turns them into a sheet.
 *
 * This file is deliberately free of both geometry and DOM. It answers only the questions
 * the dialog asks - how big is the sheet, how many drawing units go in a millimetre, where
 * on the paper does the drawing land - so that every one of them can be tested without a
 * drawing or a browser, and so the dialog has nowhere to keep a second opinion.
 *
 * Which of AutoCAD's controls are here, and which are not:
 *
 * Paper size, orientation, plot area, plot scale, plot offset, centre the plot, plot
 * object lineweights, scale lineweights and a monochrome/colour/greyscale plot style are
 * all present, because each of them changes the sheet that comes out.
 *
 * Named page setups, .ctb/.stb plot style tables, plot stamp, shaded viewport options and
 * the paper-space controls (plot paperspace last, hide paperspace objects) are not. The
 * last two have nothing to act on - this application has no layout tabs, so everything is
 * model space - and the rest are a file format and a UI around it rather than a change to
 * what gets drawn. A control that cannot alter the output is worse than a missing one: it
 * tells the user something was applied.
 */

import { PAPER_SIZES, type PaperSizeName, UnitSetup } from "@draftworks/core";

/** What part of the drawing goes on the sheet. */
export type PlotArea = "display" | "extents" | "window";

/**
 * Stands in for AutoCAD's plot style table. These three are what a .ctb is almost always
 * used for in practice - forcing a drawing to print black on a mono printer, or keeping
 * screen colours - without the file format.
 */
export type PlotStyle = "color" | "monochrome" | "grayscale";

export type PlotOrientation = "portrait" | "landscape";

/** A rectangle of the drawing, in drawing units. */
export interface PlotWindow {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface PlotSettings {
    paperSize: PaperSizeName;
    /** Sheet size in millimetres, landscape - see LANDSCAPE_PAPER. Custom sizes own these. */
    paperWidth: number;
    paperHeight: number;
    orientation: PlotOrientation;
    area: PlotArea;
    /** Only read when `area` is "window". */
    window?: PlotWindow;
    fitToPaper: boolean;
    /**
     * Drawing units per paper millimetre, so 1:100 is 100 and 2:1 is 0.5. Ignored while
     * `fitToPaper` is on, and overwritten by the fitted value when it is turned off, so
     * the number in the box is always the one that was plotted.
     */
    scale: number;
    centered: boolean;
    /** Millimetres from the lower-left of the printable area. Ignored while centred. */
    offsetX: number;
    offsetY: number;
    plotLineweights: boolean;
    /**
     * Whether lineweights grow and shrink with the plot scale. AutoCAD defaults this off,
     * and so does this: a 0.5 mm pen is 0.5 mm on paper whatever the scale, which is the
     * whole point of specifying it in millimetres.
     */
    scaleLineweights: boolean;
    style: PlotStyle;
    /** Unprintable margin on all four edges, in millimetres. */
    margin: number;
}

/**
 * The standard plot scales, as drawing units per paper millimetre.
 *
 * Metric ratios, because the sheet is metric. A drawing in inches or feet still plots at
 * these: the unit conversion happens in `unitsPerMillimetre`, so 1:100 means the same
 * thing - one hundred real millimetres to the paper millimetre - whatever the drawing is
 * measured in.
 */
export const PLOT_SCALES: readonly { label: string; scale: number }[] = [
    { label: "1:1", scale: 1 },
    { label: "1:2", scale: 2 },
    { label: "1:5", scale: 5 },
    { label: "1:10", scale: 10 },
    { label: "1:20", scale: 20 },
    { label: "1:25", scale: 25 },
    { label: "1:50", scale: 50 },
    { label: "1:100", scale: 100 },
    { label: "1:200", scale: 200 },
    { label: "1:500", scale: 500 },
    { label: "1:1000", scale: 1000 },
    { label: "2:1", scale: 0.5 },
    { label: "5:1", scale: 0.2 },
    { label: "10:1", scale: 0.1 },
] as const;

/**
 * A printer cannot reach the edge of the sheet. 5 mm is the commonest hardware margin and
 * is what the printable area is inset by, so a plot that fits the preview also fits the
 * page instead of losing its border to the printer.
 */
export const DEFAULT_MARGIN_MM = 5;

export const DEFAULT_PLOT_SETTINGS: PlotSettings = {
    paperSize: "A4",
    paperWidth: PAPER_SIZES.A4.width,
    paperHeight: PAPER_SIZES.A4.height,
    orientation: "landscape",
    area: "extents",
    fitToPaper: true,
    scale: 1,
    centered: true,
    offsetX: 0,
    offsetY: 0,
    plotLineweights: true,
    scaleLineweights: false,
    style: "monochrome",
    margin: DEFAULT_MARGIN_MM,
};

const positive = (value: number | undefined, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const finite = (value: number | undefined, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Folds a change onto existing settings, keeping the paper dimensions consistent with the
 * named size.
 *
 * A named size owns its millimetres, the same rule MvSetup follows: picking "A3" must not
 * leave A4's width behind, and only "Custom" takes the numbers from the caller. Going the
 * other way - typing a width - is the dialog's job to turn into a "Custom" selection.
 */
export function configurePlot(current: PlotSettings, change: Partial<PlotSettings>): PlotSettings {
    const paperSize = change.paperSize ?? current.paperSize;
    const named = paperSize === "Custom" ? undefined : PAPER_SIZES[paperSize];

    return {
        paperSize,
        paperWidth: positive(named?.width ?? change.paperWidth, current.paperWidth),
        paperHeight: positive(named?.height ?? change.paperHeight, current.paperHeight),
        orientation: change.orientation ?? current.orientation,
        area: change.area ?? current.area,
        window: normalizeWindow(change.window ?? current.window),
        fitToPaper: change.fitToPaper ?? current.fitToPaper,
        scale: positive(change.scale, current.scale),
        centered: change.centered ?? current.centered,
        offsetX: finite(change.offsetX, current.offsetX),
        offsetY: finite(change.offsetY, current.offsetY),
        plotLineweights: change.plotLineweights ?? current.plotLineweights,
        scaleLineweights: change.scaleLineweights ?? current.scaleLineweights,
        style: change.style ?? current.style,
        margin: Math.max(0, finite(change.margin, current.margin)),
    };
}

/**
 * Puts a window's corners the right way round.
 *
 * A picked window arrives normalised, but the same rectangle can be typed into the boxes,
 * and "from X 100, to X 0" is a perfectly reasonable thing to type. Left inverted it has a
 * negative width, which reads as a window of no size and plots an empty sheet - a silent
 * and thoroughly confusing answer to a reasonable input.
 */
function normalizeWindow(window: PlotWindow | undefined): PlotWindow | undefined {
    if (!window) return undefined;
    return {
        minX: Math.min(window.minX, window.maxX),
        minY: Math.min(window.minY, window.maxY),
        maxX: Math.max(window.minX, window.maxX),
        maxY: Math.max(window.minY, window.maxY),
    };
}

/** The sheet in millimetres as it will be printed, with orientation applied. */
export interface Sheet {
    widthMm: number;
    heightMm: number;
    /** The area a printer can actually mark, inset from the sheet by the margin. */
    printable: { x: number; y: number; width: number; height: number };
}

/**
 * PAPER_SIZES stores every sheet landscape (A4 is 297x210), so portrait is the swap rather
 * than the other way round.
 */
export function sheetOf(settings: PlotSettings): Sheet {
    const long = Math.max(settings.paperWidth, settings.paperHeight);
    const short = Math.min(settings.paperWidth, settings.paperHeight);
    const widthMm = settings.orientation === "landscape" ? long : short;
    const heightMm = settings.orientation === "landscape" ? short : long;

    // Halved before doubling so a margin wider than the sheet cannot produce a negative
    // printable area; it collapses to zero instead, and the caller reports "nothing fits".
    const margin = Math.min(settings.margin, Math.min(widthMm, heightMm) / 2);

    return {
        widthMm,
        heightMm,
        printable: {
            x: margin,
            y: margin,
            width: widthMm - margin * 2,
            height: heightMm - margin * 2,
        },
    };
}

/**
 * Drawing units per paper millimetre at a given plot scale.
 *
 * The plot scale is a ratio of real size to paper size, so it has to be read through the
 * drawing's base unit: at 1:100 a metre-based drawing puts 0.1 units in a millimetre and a
 * millimetre-based one puts 100. Getting this backwards is the difference between a plan
 * that fills an A1 and one the size of a postage stamp.
 */
export function unitsPerMillimetre(scale: number): number {
    return scale / UnitSetup.millimetresPerUnit();
}

/** The label PLOT_SCALES uses for a scale, or a computed ratio for one that has no entry. */
export function scaleLabel(scale: number): string {
    const known = PLOT_SCALES.find((entry) => Math.abs(entry.scale - scale) < 1e-9);
    if (known) return known.label;

    // Custom and fitted scales are almost never round, so they are written as the ratio a
    // drafter would read off a title block rather than as a raw multiplier.
    return scale >= 1 ? `1:${round(scale)}` : `${round(1 / scale)}:1`;
}

const round = (value: number): string => {
    const fixed = value.toFixed(2);
    return fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed.replace(/0$/, "");
};
