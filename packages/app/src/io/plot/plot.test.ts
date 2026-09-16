// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Plotting, from settings through sheet to PDF.
 *
 * The arithmetic is what these cover, because a plot is the one operation whose mistakes
 * are expensive in a way undo cannot reach - a wrong scale is a sheet of A1 in the bin, and
 * a drawing that plots at 1:87 instead of 1:100 is worse than one that fails, because it
 * looks right. So the scale, the fit and the placement are pinned here with numbers that can
 * be checked by hand.
 */

import { UnitSetup } from "@draftworks/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { type DxfDrawing, dxfVec, emptyDrawing } from "../dxf/dxfModel";
import { buildPlotSheet, plotColor, plotWidth } from "./plotGeometry";
import type { PlotPath, PlotText } from "./plotModel";
import { plotToPdf } from "./plotPdf";
import { configurePlot, DEFAULT_PLOT_SETTINGS, type PlotSettings, scaleLabel, sheetOf } from "./plotSettings";
import { plotToSvg } from "./plotSvg";

const layer = (name: string, extra: Partial<DxfDrawing["layers"][number]> = {}) => ({
    name,
    off: false,
    frozen: false,
    locked: false,
    plot: true,
    lineType: "CONTINUOUS",
    ...extra,
});

/** A 100 x 50 drawing-unit rectangle on layer 0, as four lines. */
function rectangleDrawing(): DxfDrawing {
    const drawing = emptyDrawing();
    drawing.layers.push(layer("0"));
    const corners = [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
    ];
    for (let i = 0; i < 4; i++) {
        const [x1, y1] = corners[i];
        const [x2, y2] = corners[(i + 1) % 4];
        drawing.entities.push({
            type: "line",
            layer: "0",
            start: dxfVec(x1, y1, 0),
            end: dxfVec(x2, y2, 0),
        });
    }
    return drawing;
}

const settings = (change: Partial<PlotSettings> = {}): PlotSettings =>
    configurePlot(DEFAULT_PLOT_SETTINGS, change);

const paths = (primitives: { kind: string }[]) => primitives.filter((p) => p.kind === "path") as PlotPath[];
const texts = (primitives: { kind: string }[]) => primitives.filter((p) => p.kind === "text") as PlotText[];

beforeEach(() => {
    // Millimetre drawings, so a plot scale is the ratio it looks like and the expected
    // numbers below can be read off without a unit conversion in the head.
    UnitSetup.configure({ type: "decimal", baseUnit: "mm", precision: 2 });
});

describe("sheet", () => {
    test("A4 is landscape by default and portrait swaps it", () => {
        expect(sheetOf(settings({ paperSize: "A4" }))).toMatchObject({ widthMm: 297, heightMm: 210 });
        expect(sheetOf(settings({ paperSize: "A4", orientation: "portrait" }))).toMatchObject({
            widthMm: 210,
            heightMm: 297,
        });
    });

    test("A3 is twice A4, as the ISO series requires", () => {
        const a3 = sheetOf(settings({ paperSize: "A3" }));
        expect(a3).toMatchObject({ widthMm: 420, heightMm: 297 });
    });

    test("picking a named size discards the previous size's millimetres", () => {
        const a3 = configurePlot(DEFAULT_PLOT_SETTINGS, { paperSize: "A3" });
        expect(a3.paperWidth).toBe(420);
        expect(a3.paperHeight).toBe(297);
    });

    test("the printable area is inset by the margin on all four edges", () => {
        const sheet = sheetOf(settings({ paperSize: "A4", margin: 10 }));
        expect(sheet.printable).toEqual({ x: 10, y: 10, width: 277, height: 190 });
    });

    test("a margin wider than the sheet collapses rather than going negative", () => {
        const sheet = sheetOf(settings({ paperSize: "A4", margin: 500 }));
        expect(sheet.printable.width).toBeGreaterThanOrEqual(0);
        expect(sheet.printable.height).toBeGreaterThanOrEqual(0);
    });
});

describe("scale", () => {
    test("1:1 puts one drawing millimetre on one paper millimetre", () => {
        const sheet = buildPlotSheet(rectangleDrawing(), settings({ fitToPaper: false, scale: 1 }));
        const xs = paths(sheet.primitives).flatMap((p) =>
            p.commands.flatMap((c) => ("to" in c ? [c.to.x] : [])),
        );
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 6);
    });

    test("1:100 shrinks the drawing a hundredfold", () => {
        const sheet = buildPlotSheet(rectangleDrawing(), settings({ fitToPaper: false, scale: 100 }));
        const xs = paths(sheet.primitives).flatMap((p) =>
            p.commands.flatMap((c) => ("to" in c ? [c.to.x] : [])),
        );
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6);
    });

    test("2:1 enlarges it", () => {
        const sheet = buildPlotSheet(rectangleDrawing(), settings({ fitToPaper: false, scale: 0.5 }));
        const xs = paths(sheet.primitives).flatMap((p) =>
            p.commands.flatMap((c) => ("to" in c ? [c.to.x] : [])),
        );
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200, 6);
    });

    test("the base unit decides what a scale means", () => {
        // The same 100-unit rectangle in metres is 100 m, so at 1:100 it is a metre of paper.
        UnitSetup.configure({ type: "decimal", baseUnit: "m", precision: 2 });
        const sheet = buildPlotSheet(
            rectangleDrawing(),
            settings({ fitToPaper: false, scale: 100, paperSize: "A0" }),
        );
        const xs = paths(sheet.primitives).flatMap((p) =>
            p.commands.flatMap((c) => ("to" in c ? [c.to.x] : [])),
        );
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1000, 3);
    });

    test("fit to paper fills the limiting axis and keeps the aspect ratio", () => {
        // 100 x 50 into A4's 287 x 200 printable: width runs out first at 100/287.
        const sheet = buildPlotSheet(rectangleDrawing(), settings({ fitToPaper: true, margin: 5 }));
        const points = paths(sheet.primitives).flatMap((p) =>
            p.commands.flatMap((c) => ("to" in c ? [c.to] : [])),
        );
        const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
        const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));

        expect(width).toBeCloseTo(287, 3);
        expect(width / height).toBeCloseTo(2, 6);
        expect(sheet.clipped).toBe(false);
    });

    test("a fitted plot reports the scale it arrived at", () => {
        const sheet = buildPlotSheet(rectangleDrawing(), settings({ fitToPaper: true, margin: 5 }));
        // 100 drawing mm across 287 paper mm is a shade under 1:0.35, i.e. an enlargement.
        expect(sheet.scale).toBeCloseTo(100 / 287, 6);
    });

    test("an over-scaled plot is reported as clipped", () => {
        const sheet = buildPlotSheet(rectangleDrawing(), settings({ fitToPaper: false, scale: 0.1 }));
        expect(sheet.clipped).toBe(true);
    });
});

describe("placement", () => {
    test("centring leaves equal margins on opposite edges", () => {
        const sheet = buildPlotSheet(
            rectangleDrawing(),
            settings({ fitToPaper: false, scale: 1, centered: true }),
        );
        const points = paths(sheet.primitives).flatMap((p) =>
            p.commands.flatMap((c) => ("to" in c ? [c.to] : [])),
        );
        const left = Math.min(...points.map((p) => p.x));
        const right = sheet.widthMm - Math.max(...points.map((p) => p.x));
        expect(left).toBeCloseTo(right, 6);
    });

    test("an offset is measured from the printable corner, not the sheet corner", () => {
        const sheet = buildPlotSheet(
            rectangleDrawing(),
            settings({ fitToPaper: false, scale: 1, centered: false, offsetX: 20, offsetY: 10, margin: 5 }),
        );
        const points = paths(sheet.primitives).flatMap((p) =>
            p.commands.flatMap((c) => ("to" in c ? [c.to] : [])),
        );
        expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(25, 6);
        expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(15, 6);
    });
});

describe("plot area", () => {
    test("a window plots only its own rectangle", () => {
        const sheet = buildPlotSheet(
            rectangleDrawing(),
            settings({ area: "window", window: { minX: 0, minY: 0, maxX: 50, maxY: 50 }, fitToPaper: true }),
        );
        expect(sheet.extents).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
    });

    test("a window typed with its corners the wrong way round still plots", () => {
        const sheet = buildPlotSheet(
            rectangleDrawing(),
            settings({ area: "window", window: { minX: 80, minY: 40, maxX: 20, maxY: 10 } }),
        );
        expect(sheet.extents).toEqual({ minX: 20, minY: 10, maxX: 80, maxY: 40 });
        expect(sheet.primitives.length).toBeGreaterThan(0);
    });

    test("an empty drawing produces a sheet and no primitives", () => {
        const empty = emptyDrawing();
        empty.layers.push(layer("0"));
        const sheet = buildPlotSheet(empty, settings());
        expect(sheet.primitives).toEqual([]);
        expect(sheet.widthMm).toBe(297);
    });
});

describe("layers", () => {
    test.each([
        ["off", { off: true }],
        ["frozen", { frozen: true }],
        ["set not to plot", { plot: false }],
    ])("a layer that is %s contributes nothing", (_name, flags) => {
        const drawing = rectangleDrawing();
        drawing.layers[0] = layer("0", flags);
        expect(buildPlotSheet(drawing, settings()).primitives).toEqual([]);
    });

    test("a locked layer still plots", () => {
        const drawing = rectangleDrawing();
        drawing.layers[0] = layer("0", { locked: true });
        expect(buildPlotSheet(drawing, settings()).primitives.length).toBe(4);
    });
});

describe("plot style", () => {
    test("monochrome forces every colour to black", () => {
        expect(plotColor(0xff0000, "monochrome")).toBe("#000000");
        expect(plotColor(0x00ff00, "monochrome")).toBe("#000000");
    });

    test("colour keeps the drawing's colours", () => {
        expect(plotColor(0xff0000, "color")).toBe("#ff0000");
    });

    test("white plots black, because white means the default pen", () => {
        expect(plotColor(0xffffff, "color")).toBe("#000000");
        expect(plotColor(undefined, "color")).toBe("#000000");
    });

    test("greyscale keeps relative darkness", () => {
        // Green reads lighter than blue to the eye, and Rec. 601 says so.
        const green = plotColor(0x00ff00, "grayscale");
        const blue = plotColor(0x0000ff, "grayscale");
        expect(Number.parseInt(green.slice(1, 3), 16)).toBeGreaterThan(Number.parseInt(blue.slice(1, 3), 16));
    });
});

describe("lineweights", () => {
    test("a lineweight plots at its stated millimetres", () => {
        expect(plotWidth(50, settings())).toBeCloseTo(0.5, 9);
    });

    test("turning object lineweights off plots hairlines", () => {
        expect(plotWidth(50, settings({ plotLineweights: false }))).toBe(0);
    });

    test("by default a pen is the same width whatever the scale", () => {
        expect(plotWidth(50, settings({ scale: 100, scaleLineweights: false }))).toBeCloseTo(0.5, 9);
    });

    test("scaling lineweights divides them by the plot scale", () => {
        expect(plotWidth(50, settings({ scale: 2, scaleLineweights: true }))).toBeCloseTo(0.25, 9);
    });
});

describe("entities", () => {
    test("a circle becomes Bezier curves rather than segments", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "circle",
            layer: "0",
            center: dxfVec(0, 0, 0),
            radius: 10,
            normal: dxfVec(0, 0, 1),
        });

        const [path] = paths(buildPlotSheet(drawing, settings()).primitives);
        const curves = path.commands.filter((c) => c.type === "curve");
        // Four quarter turns: enough to stay within a printer's dot, and no more.
        expect(curves.length).toBe(4);
        expect(path.commands.some((c) => c.type === "close")).toBe(true);
    });

    test("a dimension plots its picture block, not the DIMENSION entity", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.blocks.push({
            name: "*D1",
            basePoint: dxfVec(),
            entities: [
                { type: "line", layer: "0", start: dxfVec(0, 0, 0), end: dxfVec(50, 0, 0) },
                { type: "line", layer: "0", start: dxfVec(0, -2, 0), end: dxfVec(0, 2, 0) },
            ],
        });
        drawing.entities.push({
            type: "dimension",
            layer: "0",
            dimensionType: "linear",
            definitionPoint: dxfVec(0, 0, 0),
            textMidPoint: dxfVec(25, 3, 0),
            rotation: 0,
            normal: dxfVec(0, 0, 1),
            blockName: "*D1",
        });

        expect(paths(buildPlotSheet(drawing, settings()).primitives).length).toBe(2);
    });

    test("a dimension with no picture block is dropped rather than guessed at", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "dimension",
            layer: "0",
            dimensionType: "linear",
            definitionPoint: dxfVec(0, 0, 0),
            textMidPoint: dxfVec(25, 3, 0),
            rotation: 0,
            normal: dxfVec(0, 0, 1),
        });
        expect(buildPlotSheet(drawing, settings()).primitives).toEqual([]);
    });

    test("multi-line text becomes one run per line, stepped down the page", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "text",
            layer: "0",
            content: "FIRST\nSECOND",
            position: dxfVec(0, 100, 0),
            height: 10,
            rotation: 0,
            boxWidth: 0,
            multiline: true,
            attachment: 1,
            normal: dxfVec(0, 0, 1),
        });

        const runs = texts(buildPlotSheet(drawing, settings({ fitToPaper: false, scale: 1 })).primitives);
        expect(runs.map((r) => r.content)).toEqual(["FIRST", "SECOND"]);
        expect(runs[0].at.y).toBeGreaterThan(runs[1].at.y);
    });

    test("an arrowhead SOLID is filled, not stroked", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "solid",
            layer: "0",
            corners: [dxfVec(0, 0, 0), dxfVec(5, 1, 0), dxfVec(5, -1, 0), dxfVec(5, -1, 0)],
            normal: dxfVec(0, 0, 1),
        });
        expect(paths(buildPlotSheet(drawing, settings()).primitives)[0].filled).toBe(true);
    });
});

describe("extents", () => {
    const arcDrawing = (startAngle: number, endAngle: number) => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "arc",
            layer: "0",
            center: dxfVec(0, 0, 0),
            radius: 10,
            startAngle,
            endAngle,
            normal: dxfVec(0, 0, 1),
        });
        return drawing;
    };

    test("an arc is bounded by the part of it that exists, not by its whole circle", () => {
        // The first quadrant only: from (10,0) round to (0,10). Nothing reaches negative.
        const sheet = buildPlotSheet(arcDrawing(0, 90), settings());
        expect(sheet.extents!.minX).toBeCloseTo(0, 9);
        expect(sheet.extents!.minY).toBeCloseTo(0, 9);
        expect(sheet.extents!.maxX).toBeCloseTo(10, 9);
        expect(sheet.extents!.maxY).toBeCloseTo(10, 9);
    });

    test("an arc that crosses an axis still reaches its extreme there", () => {
        // 45 degrees either side of the top: the highest point is the 90 degree mark, which
        // is in the middle of the sweep rather than at either end.
        const sheet = buildPlotSheet(arcDrawing(45, 135), settings());
        expect(sheet.extents!.maxY).toBeCloseTo(10, 9);
        expect(sheet.extents!.maxX).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    });

    test("a full circle still bounds to its whole box", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "circle",
            layer: "0",
            center: dxfVec(5, 5, 0),
            radius: 10,
            normal: dxfVec(0, 0, 1),
        });
        expect(buildPlotSheet(drawing, settings()).extents).toEqual({
            minX: -5,
            minY: -5,
            maxX: 15,
            maxY: 15,
        });
    });

    test("a bulged polyline segment is bounded by its bow, not by its chord", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        // A half circle from (0,0) to (10,0). A positive bulge is counter-clockwise, which
        // on a left-to-right chord dips below it - the convention dxfGeometry's own tests
        // pin down - so the bow to catch is at y = -5, not +5.
        drawing.entities.push({
            type: "polyline",
            layer: "0",
            closed: false,
            elevation: 0,
            normal: dxfVec(0, 0, 1),
            vertices: [
                { x: 0, y: 0, bulge: 1 },
                { x: 10, y: 0, bulge: 0 },
            ],
        });

        const extents = buildPlotSheet(drawing, settings()).extents!;
        expect(extents.minY).toBeCloseTo(-5, 6);
        expect(extents.maxY).toBeCloseTo(0, 6);
    });
});

describe("scale labels", () => {
    test.each([
        [1, "1:1"],
        [100, "1:100"],
        [0.5, "2:1"],
    ])("%p reads as %s", (scale, label) => {
        expect(scaleLabel(scale)).toBe(label);
    });
});

describe("PDF", () => {
    const pdfOf = (settingsChange: Partial<PlotSettings> = {}) =>
        plotToPdf(buildPlotSheet(rectangleDrawing(), settings(settingsChange)), "test");

    const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

    test("starts with a PDF header and ends with EOF", () => {
        const body = text(pdfOf().bytes);
        expect(body.startsWith("%PDF-1.7")).toBe(true);
        expect(body.trimEnd().endsWith("%%EOF")).toBe(true);
    });

    test("the page is the sheet size in points", () => {
        const body = text(pdfOf({ paperSize: "A4" }).bytes);
        // 297 mm and 210 mm at 72/25.4 points per millimetre.
        expect(body).toContain("/MediaBox [0 0 841.8898 595.2756]");
    });

    test("every xref offset points at the object it claims", () => {
        const bytes = pdfOf().bytes;
        const body = text(bytes);
        const table = body.slice(body.lastIndexOf("\nxref\n"), body.lastIndexOf("trailer"));
        const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));

        expect(offsets.length).toBeGreaterThan(0);
        offsets.forEach((offset, index) => {
            expect(body.slice(offset, offset + 12)).toContain(`${index + 1} 0 obj`);
        });
    });

    test("startxref points at the cross-reference table", () => {
        const body = text(pdfOf().bytes);
        const startxref = Number(
            body
                .slice(body.lastIndexOf("startxref") + 9)
                .trim()
                .split("\n")[0],
        );
        expect(body.slice(startxref, startxref + 4)).toBe("xref");
    });

    test("the stream length is the byte length of the stream", () => {
        const body = text(pdfOf().bytes);
        const declared = Number(/<< \/Length (\d+) >>/.exec(body)![1]);
        const start = body.indexOf("stream\n") + "stream\n".length;
        const end = body.indexOf("\nendstream");
        expect(end - start).toBe(declared);
    });

    test("text that WinAnsi cannot carry is reported rather than mangled", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "text",
            layer: "0",
            content: "ROOM 中文",
            position: dxfVec(0, 0, 0),
            height: 5,
            rotation: 0,
            boxWidth: 0,
            multiline: false,
            attachment: 1,
            normal: dxfVec(0, 0, 1),
        });

        const result = plotToPdf(buildPlotSheet(drawing, settings()));
        expect(result.unsupportedCharacters).toEqual(["中", "文"]);
    });

    test("a Western drawing reports nothing unsupported", () => {
        expect(pdfOf().unsupportedCharacters).toEqual([]);
    });

    test("parentheses in text are escaped, not left to close the string early", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "text",
            layer: "0",
            content: "A (B) C",
            position: dxfVec(0, 0, 0),
            height: 5,
            rotation: 0,
            boxWidth: 0,
            multiline: false,
            attachment: 1,
            normal: dxfVec(0, 0, 1),
        });
        expect(text(plotToPdf(buildPlotSheet(drawing, settings())).bytes)).toContain("(A \\(B\\) C)");
    });
});

describe("SVG preview", () => {
    test("is the sheet size in millimetres", () => {
        const svg = plotToSvg(buildPlotSheet(rectangleDrawing(), settings({ paperSize: "A3" })));
        expect(svg).toContain('width="420mm"');
        expect(svg).toContain('height="297mm"');
    });

    test("parses as a DOM tree, which is how the dialog renders it", () => {
        // The preview is set as innerHTML, so malformed markup would fail silently and show
        // an empty sheet rather than throwing anywhere a test would see it.
        const sheet = buildPlotSheet(rectangleDrawing(), settings());
        const host = document.createElement("div");
        host.innerHTML = plotToSvg(sheet, { showSheet: true });

        const svg = host.querySelector("svg");
        expect(svg).not.toBeNull();
        // Four lines, plus the sheet and printable-area rectangles the option adds.
        expect(svg!.querySelectorAll("path").length).toBe(4);
        expect(svg!.querySelectorAll("rect").length).toBeGreaterThanOrEqual(2);
    });

    test("escapes text rather than letting it close a tag", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "text",
            layer: "0",
            content: "<b>A & B</b>",
            position: dxfVec(0, 0, 0),
            height: 5,
            rotation: 0,
            boxWidth: 0,
            multiline: false,
            attachment: 1,
            normal: dxfVec(0, 0, 1),
        });

        const host = document.createElement("div");
        host.innerHTML = plotToSvg(buildPlotSheet(drawing, settings()));
        expect(host.querySelectorAll("b").length).toBe(0);
        expect(host.querySelector("text")?.textContent).toBe("<b>A & B</b>");
    });

    test("flips y, so the drawing is not upside down", () => {
        const drawing = emptyDrawing();
        drawing.layers.push(layer("0"));
        drawing.entities.push({
            type: "line",
            layer: "0",
            start: dxfVec(0, 0, 0),
            end: dxfVec(0, 100, 0),
        });

        const sheet = buildPlotSheet(drawing, settings({ fitToPaper: false, scale: 1 }));
        const [path] = paths(sheet.primitives);
        const move = path.commands[0] as { to: { y: number } };
        const line = path.commands[1] as { to: { y: number } };

        // Up the sheet in plot space has to come out as a smaller y in SVG space.
        const svg = plotToSvg(sheet);
        const [, firstY, , secondY] = /M([\d.-]+) ([\d.-]+) L([\d.-]+) ([\d.-]+)/.exec(svg)!.slice(1);
        expect(line.to.y).toBeGreaterThan(move.to.y);
        expect(Number(secondY)).toBeLessThan(Number(firstY));
    });
});
