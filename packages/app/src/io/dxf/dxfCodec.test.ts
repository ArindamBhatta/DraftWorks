// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    aciToRgb,
    type DxfDrawing,
    type DxfEntity,
    dxfVec,
    emptyDrawing,
    lineWeightFromDxf,
    lineWeightToDxf,
    ocsToWorld,
    rgbToAci,
} from "./dxfModel";
import { DxfParseError, readDxf, tokenize, unescapeMText } from "./dxfReader";
import { escapeMText, writeDxf } from "./dxfWriter";

/**
 * DXF is two lines per tag, which makes a literal fixture an unreadable column of
 * alternating codes and values. These helpers take `code value` pairs separated by `|` or
 * by line breaks, so the fixtures below read roughly as the entities they describe.
 */
const dxf = (source: string): string => {
    const pairs = source
        .split(/[|\n]/)
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
            // A value can contain spaces, so only the first one separates it from the code.
            const space = pair.indexOf(" ");
            return space < 0 ? `${pair}\n` : `${pair.slice(0, space)}\n${pair.slice(space + 1)}`;
        });
    return `${pairs.join("\n")}\n`;
};

const section = (name: string, body: string) => dxf(`0 SECTION | 2 ${name} | ${body} | 0 ENDSEC`);

const withEntities = (body: string) => `${section("ENTITIES", body)}${dxf("0 EOF")}`;

const layerTable = (body: string) =>
    `${section("TABLES", `0 TABLE | 2 LAYER | ${body} | 0 ENDTAB`)}${dxf("0 EOF")}`;

describe("tokenizer", () => {
    test("reads group code and value pairs", () => {
        expect(tokenize("0\nLINE\n8\n0\n")).toEqual([
            { code: 0, value: "LINE" },
            { code: 8, value: "0" },
        ]);
    });

    test("accepts CRLF, which is what a file from Windows actually contains", () => {
        expect(tokenize("0\r\nLINE\r\n")).toEqual([{ code: 0, value: "LINE" }]);
    });

    test("a stray line is skipped rather than desynchronising everything after it", () => {
        // Without resynchronising, the junk line would pair "0" with "LINE" one line late
        // and every tag after it would be shifted by one.
        expect(tokenize("junk\n0\nLINE\n8\nWALLS\n")).toEqual([
            { code: 0, value: "LINE" },
            { code: 8, value: "WALLS" },
        ]);
    });
});

describe("reading entities", () => {
    test("a line keeps its two endpoints and its layer", () => {
        const drawing = readDxf(withEntities("0 LINE | 8 WALLS | 10 1 | 20 2 | 30 0 | 11 4 | 21 6 | 31 0"));
        expect(drawing.entities).toHaveLength(1);
        const line = drawing.entities[0];
        if (line.type !== "line") throw new Error(`expected a line, got ${line.type}`);
        expect(line.layer).toBe("WALLS");
        expect(line.start).toEqual(dxfVec(1, 2, 0));
        expect(line.end).toEqual(dxfVec(4, 6, 0));
    });

    test("an LWPOLYLINE reads its vertices in stream order, with bulges on the right ones", () => {
        // The codes interleave: each 10 opens a vertex and the 20/42 after it belong to
        // that vertex. A reader that looked each code up once would collapse all three
        // vertices into one.
        const drawing = readDxf(
            withEntities(`
                0 LWPOLYLINE | 8 0 | 90 3 | 70 1
                10 0 | 20 0
                10 10 | 20 0 | 42 0.5
                10 10 | 20 10
            `),
        );
        const entity = drawing.entities[0];
        if (entity.type !== "polyline") throw new Error(`expected a polyline, got ${entity.type}`);
        expect(entity.closed).toBe(true);
        expect(entity.vertices).toEqual([
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0.5 },
            { x: 10, y: 10, bulge: 0 },
        ]);
    });

    test("an old-style POLYLINE with VERTEX records reads the same as an LWPOLYLINE", () => {
        const drawing = readDxf(
            withEntities(`
                0 POLYLINE | 8 0 | 66 1 | 70 0
                0 VERTEX | 10 0 | 20 0
                0 VERTEX | 10 5 | 20 5 | 42 0.25
                0 SEQEND
            `),
        );
        expect(drawing.entities).toHaveLength(1);
        const entity = drawing.entities[0];
        if (entity.type !== "polyline") throw new Error(`expected a polyline, got ${entity.type}`);
        expect(entity.vertices).toEqual([
            { x: 0, y: 0, bulge: 0 },
            { x: 5, y: 5, bulge: 0.25 },
        ]);
    });

    test("a true colour is preferred over the palette index beside it", () => {
        const drawing = readDxf(
            withEntities(`0 LINE | 8 0 | 62 1 | 420 ${0x336699} | 10 0 | 20 0 | 11 1 | 21 1`),
        );
        expect(drawing.entities[0].color).toBe(0x336699);
    });

    test("colour 256 is BYLAYER and leaves the entity with no colour of its own", () => {
        const drawing = readDxf(withEntities("0 LINE | 8 0 | 62 256 | 10 0 | 20 0 | 11 1 | 21 1"));
        expect(drawing.entities[0].color).toBeUndefined();
    });

    test("an unknown entity type is reported rather than silently dropped", () => {
        const drawing = readDxf(withEntities("0 HATCH | 8 0 | 0 LINE | 10 0 | 20 0 | 11 1 | 21 1"));
        expect(drawing.unsupported).toContain("HATCH");
        expect(drawing.entities).toHaveLength(1);
    });

    test("a triangular SOLID repeats its third corner, as DXF defines it", () => {
        const drawing = readDxf(withEntities("0 SOLID | 8 0 | 10 0 | 20 0 | 11 1 | 21 0 | 12 0 | 22 1"));
        const entity = drawing.entities[0];
        if (entity.type !== "solid") throw new Error(`expected a solid, got ${entity.type}`);
        expect(entity.corners[3]).toEqual(entity.corners[2]);
    });

    test("a record in an unread section does not leak into the drawing", () => {
        // A CLASSES section holds records that open with code 0 exactly as entities do, so
        // a reader that scanned for 0 records without tracking sections would import them.
        const drawing = readDxf(
            `${section("CLASSES", "0 CLASS | 1 LWPOLYLINE | 2 AcDbPolyline")}${withEntities(
                "0 LINE | 8 0 | 10 0 | 20 0 | 11 1 | 21 1",
            )}`,
        );
        expect(drawing.entities).toHaveLength(1);
        expect(drawing.entities[0].type).toBe("line");
    });
});

describe("reading layers", () => {
    test("a negative colour index means the layer is off, not a negative colour", () => {
        const drawing = readDxf(layerTable("0 LAYER | 2 HIDDEN_STUFF | 70 0 | 62 -3 | 6 CONTINUOUS"));
        expect(drawing.layers[0].off).toBe(true);
        expect(drawing.layers[0].color).toBe(aciToRgb(3));
    });

    test("flags separate frozen from locked", () => {
        const drawing = readDxf(layerTable("0 LAYER | 2 L | 70 5 | 62 7 | 6 CONTINUOUS"));
        expect(drawing.layers[0].frozen).toBe(true);
        expect(drawing.layers[0].locked).toBe(true);
    });
});

describe("MTEXT formatting codes", () => {
    test("\\P becomes a line break", () => {
        expect(unescapeMText("first\\Psecond")).toBe("first\nsecond");
    });

    test("style runs are stripped but the text they styled is kept", () => {
        expect(unescapeMText("{\\fArial|b1;bold} text")).toBe("bold text");
        expect(unescapeMText("\\H2.5;sized")).toBe("sized");
    });

    test("escaped braces and backslashes survive", () => {
        expect(unescapeMText("a \\{b\\} c")).toBe("a {b} c");
    });

    test("escaping and unescaping round trip", () => {
        for (const value of ["plain", "two\nlines", "braces {and} slashes \\", "a\r\nb"]) {
            expect(unescapeMText(escapeMText(value))).toBe(value.replace(/\r\n/g, "\n"));
        }
    });
});

describe("colour and lineweight conversion", () => {
    test("the named palette entries are exact", () => {
        expect(aciToRgb(1)).toBe(0xff0000);
        expect(aciToRgb(5)).toBe(0x0000ff);
        expect(rgbToAci(0xff0000)).toBe(1);
    });

    test("lineweight maps to a plottable width and back to the same pixel step", () => {
        for (const pixels of [1, 2, 3, 4, 6]) {
            expect(lineWeightFromDxf(lineWeightToDxf(pixels))).toBe(pixels);
        }
    });

    test("BYLAYER and DEFAULT lineweights name no width", () => {
        expect(lineWeightFromDxf(-1)).toBeUndefined();
        expect(lineWeightFromDxf(-3)).toBeUndefined();
    });
});

describe("object coordinate systems", () => {
    test("the ordinary +Z extrusion leaves coordinates alone", () => {
        expect(ocsToWorld(dxfVec(3, 4, 5), dxfVec(0, 0, 1))).toEqual(dxfVec(3, 4, 5));
    });

    test("a -Z extrusion mirrors X, which is how a flipped entity is stored", () => {
        const world = ocsToWorld(dxfVec(2, 3, 0), dxfVec(0, 0, -1));
        expect(world.x).toBeCloseTo(-2);
        expect(world.y).toBeCloseTo(3);
    });
});

const drawingWith = (...entities: DxfEntity[]): DxfDrawing => {
    const drawing = emptyDrawing();
    drawing.insUnits = 4;
    drawing.layers = [
        {
            name: "0",
            color: 0xffffff,
            off: false,
            frozen: false,
            locked: false,
            plot: true,
            lineType: "CONTINUOUS",
        },
        {
            name: "WALLS",
            color: 0x336699,
            off: true,
            frozen: true,
            locked: true,
            plot: false,
            lineType: "DASHED",
            lineWeight: 50,
        },
    ];
    drawing.entities = entities;
    return drawing;
};

describe("writing", () => {
    const output = writeDxf(
        drawingWith({ type: "line", layer: "WALLS", start: dxfVec(0, 0, 0), end: dxfVec(10, 5, 0) }),
    );

    test("emits the sections a reader expects", () => {
        for (const name of ["HEADER", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS"]) {
            expect(output).toContain(`\n${name}\n`);
        }
        expect(output.trimEnd().endsWith("EOF")).toBe(true);
    });

    test("declares AC1015, the oldest version that has everything a drawing can hold", () => {
        expect(output).toContain("AC1015");
    });

    test("writes the tables R2000 requires, not only the ones carrying our data", () => {
        // AutoCAD rejects a file missing any of these, even though lenient viewers open it.
        for (const table of ["VPORT", "LTYPE", "LAYER", "STYLE", "APPID", "DIMSTYLE", "BLOCK_RECORD"]) {
            expect(output).toContain(`\n${table}\n`);
        }
    });

    test("every handle is unique and below $HANDSEED", () => {
        const tags = tokenize(output);
        // Group 5 carries the handle everywhere except DIMSTYLE records, which use 105.
        const handles = tags.filter((t) => t.code === 5 || t.code === 105).map((t) => t.value.trim());
        // The first group 5 in the file is $HANDSEED in the header.
        const [seed, ...rest] = handles;

        expect(rest.length).toBeGreaterThan(10);
        expect(new Set(rest).size).toBe(rest.length);
        for (const handle of rest) {
            expect(Number.parseInt(handle, 16)).toBeLessThan(Number.parseInt(seed, 16));
        }
    });

    test("reals are written in fixed notation, never as exponents", () => {
        // toFixed switches to exponent notation at 1e21, which would be unparseable.
        const extreme = writeDxf(
            drawingWith({
                type: "line",
                layer: "0",
                start: dxfVec(0.0000001, 0, 0),
                end: dxfVec(1e21, 0, 0),
            }),
        );
        expect(extreme).not.toMatch(/\de[+-]\d/);
    });
});

describe("round trip", () => {
    const roundTrip = (...entities: DxfEntity[]) => readDxf(writeDxf(drawingWith(...entities)));

    test("a line comes back unchanged", () => {
        const drawing = roundTrip({
            type: "line",
            layer: "WALLS",
            start: dxfVec(1, 2, 3),
            end: dxfVec(4, 5, 6),
        });
        const line = drawing.entities[0];
        if (line.type !== "line") throw new Error(`expected a line, got ${line.type}`);
        expect(line.start).toEqual(dxfVec(1, 2, 3));
        expect(line.end).toEqual(dxfVec(4, 5, 6));
        expect(line.layer).toBe("WALLS");
    });

    test("an arc keeps its centre, radius and angles", () => {
        const drawing = roundTrip({
            type: "arc",
            layer: "0",
            center: dxfVec(5, 5, 0),
            radius: 2.5,
            startAngle: 30,
            endAngle: 200,
            normal: dxfVec(0, 0, 1),
        });
        const arc = drawing.entities[0];
        if (arc.type !== "arc") throw new Error(`expected an arc, got ${arc.type}`);
        expect(arc.center).toEqual(dxfVec(5, 5, 0));
        expect(arc.radius).toBeCloseTo(2.5);
        expect(arc.startAngle).toBeCloseTo(30);
        expect(arc.endAngle).toBeCloseTo(200);
    });

    test("an elliptical arc keeps its ratio and trim parameters", () => {
        const drawing = roundTrip({
            type: "ellipse",
            layer: "0",
            center: dxfVec(1, 1, 0),
            majorAxis: dxfVec(4, 0, 0),
            ratio: 0.5,
            startParam: 0.25,
            endParam: 2.5,
            normal: dxfVec(0, 0, 1),
        });
        const ellipse = drawing.entities[0];
        if (ellipse.type !== "ellipse") throw new Error(`expected an ellipse, got ${ellipse.type}`);
        expect(ellipse.ratio).toBeCloseTo(0.5);
        expect(ellipse.startParam).toBeCloseTo(0.25);
        expect(ellipse.endParam).toBeCloseTo(2.5);
        expect(ellipse.majorAxis).toEqual(dxfVec(4, 0, 0));
    });

    test("a polyline keeps its bulges and its closed flag", () => {
        const drawing = roundTrip({
            type: "polyline",
            layer: "0",
            vertices: [
                { x: 0, y: 0, bulge: 0 },
                { x: 10, y: 0, bulge: 0.4142 },
                { x: 10, y: 10, bulge: 0 },
            ],
            closed: true,
            elevation: 0,
            normal: dxfVec(0, 0, 1),
        });
        const polyline = drawing.entities[0];
        if (polyline.type !== "polyline") throw new Error(`expected a polyline, got ${polyline.type}`);
        expect(polyline.closed).toBe(true);
        expect(polyline.vertices).toHaveLength(3);
        expect(polyline.vertices[1].bulge).toBeCloseTo(0.4142);
    });

    test("single-line text stays TEXT and multi-line text stays MTEXT", () => {
        const drawing = roundTrip(
            {
                type: "text",
                layer: "0",
                content: "PLAN",
                position: dxfVec(1, 1, 0),
                height: 2.5,
                rotation: 45,
                boxWidth: 0,
                multiline: false,
                attachment: 1,
                normal: dxfVec(0, 0, 1),
            },
            {
                type: "text",
                layer: "0",
                content: "two\nlines",
                position: dxfVec(0, 0, 0),
                height: 3,
                rotation: 0,
                boxWidth: 50,
                multiline: true,
                attachment: 1,
                normal: dxfVec(0, 0, 1),
            },
        );

        const [single, multi] = drawing.entities;
        if (single.type !== "text" || multi.type !== "text") throw new Error("expected two texts");
        expect(single.multiline).toBe(false);
        expect(single.content).toBe("PLAN");
        expect(single.rotation).toBeCloseTo(45);
        expect(multi.multiline).toBe(true);
        expect(multi.content).toBe("two\nlines");
        expect(multi.boxWidth).toBeCloseTo(50);
    });

    test("text longer than one tag is reassembled from its chunks", () => {
        // MTEXT carries at most 250 characters per tag, so anything longer is split across
        // repeated group 3 chunks with the tail in group 1.
        const long = "x".repeat(600);
        const drawing = roundTrip({
            type: "text",
            layer: "0",
            content: long,
            position: dxfVec(0, 0, 0),
            height: 2.5,
            rotation: 0,
            boxWidth: 100,
            multiline: true,
            attachment: 1,
            normal: dxfVec(0, 0, 1),
        });
        const entity = drawing.entities[0];
        if (entity.type !== "text") throw new Error(`expected text, got ${entity.type}`);
        expect(entity.content).toBe(long);
    });

    test("layers keep colour, state and linetype", () => {
        const drawing = roundTrip({
            type: "line",
            layer: "WALLS",
            start: dxfVec(0, 0, 0),
            end: dxfVec(1, 1, 0),
        });
        const walls = drawing.layers.find((layer) => layer.name === "WALLS");
        expect(walls).toBeDefined();
        expect(walls?.color).toBe(0x336699);
        expect(walls?.off).toBe(true);
        expect(walls?.frozen).toBe(true);
        expect(walls?.locked).toBe(true);
        expect(walls?.plot).toBe(false);
        expect(walls?.lineType).toBe("DASHED");
        expect(walls?.lineWeight).toBe(2);
    });

    test("the drawing units survive", () => {
        expect(roundTrip().insUnits).toBe(4);
    });

    test("an entity colour survives exactly, not to the nearest palette entry", () => {
        // 0x123456 is not in the ACI palette, so a writer that only emitted group 62 would
        // lose it. Writing 420 alongside is what keeps it exact.
        const drawing = roundTrip({
            type: "line",
            layer: "0",
            color: 0x123456,
            start: dxfVec(0, 0, 0),
            end: dxfVec(1, 0, 0),
        });
        expect(drawing.entities[0].color).toBe(0x123456);
    });

    test("a dimension keeps its measured points and its picture block", () => {
        const drawing = readDxf(
            writeDxf({
                ...drawingWith({
                    type: "dimension",
                    layer: "0",
                    dimensionType: "linear",
                    definitionPoint: dxfVec(5, 10, 0),
                    textMidPoint: dxfVec(5, 11, 0),
                    point1: dxfVec(0, 0, 0),
                    point2: dxfVec(10, 0, 0),
                    rotation: 0,
                    text: "10.00",
                    normal: dxfVec(0, 0, 1),
                    blockName: "*D1",
                }),
                blocks: [
                    {
                        name: "*D1",
                        basePoint: dxfVec(),
                        entities: [
                            { type: "line", layer: "0", start: dxfVec(0, 10, 0), end: dxfVec(10, 10, 0) },
                        ],
                    },
                ],
            }),
        );

        const dimension = drawing.entities[0];
        if (dimension.type !== "dimension") throw new Error("expected a dimension");
        expect(dimension.dimensionType).toBe("linear");
        expect(dimension.blockName).toBe("*D1");
        expect(dimension.point1).toEqual(dxfVec(0, 0, 0));
        expect(dimension.point2).toEqual(dxfVec(10, 0, 0));
        expect(dimension.text).toBe("10.00");

        // The picture block has to come back as a block: an application that does not
        // rebuild dimensions draws that, and model space must not hold a second copy of it.
        expect(drawing.blocks.find((b) => b.name === "*D1")?.entities).toHaveLength(1);
        expect(drawing.entities).toHaveLength(1);
    });

    test("a dimension keeps the style it names", () => {
        const drawing = readDxf(
            writeDxf(
                drawingWith({
                    type: "dimension",
                    layer: "0",
                    dimensionType: "linear",
                    definitionPoint: dxfVec(5, 10, 0),
                    textMidPoint: dxfVec(5, 11, 0),
                    point1: dxfVec(0, 0, 0),
                    point2: dxfVec(10, 0, 0),
                    rotation: 0,
                    normal: dxfVec(0, 0, 1),
                    styleName: "Arch-48",
                }),
            ),
        );

        const dimension = drawing.entities[0];
        if (dimension.type !== "dimension") throw new Error("expected a dimension");
        // Group 3 is the whole point of the style table surviving the trip: without it
        // every dimension comes back on Standard whatever it was drawn in.
        expect(dimension.styleName).toBe("Arch-48");
    });

    test("every dimension style is written, not just the current one", () => {
        const dxf = writeDxf(drawingWith({ type: "line", layer: "0", start: dxfVec(), end: dxfVec(1) }), {
            dimensionStyles: [
                { name: "Standard", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, decimals: 2 },
                { name: "Arch-48", textHeight: 96, arrowSize: 96, extensionOffset: 24, decimals: 0 },
            ],
        });

        // Both records, and a table count that matches - a reader that trusts group 70
        // would otherwise stop after the first.
        expect(dxf).toContain("Arch-48");
        const table = dxf.slice(dxf.indexOf("DIMSTYLE"));
        expect(table.slice(0, table.indexOf("ENDTAB")).match(/AcDbDimStyleTableRecord/g)).toHaveLength(2);
    });
});

describe("rejecting what is not an ASCII DXF", () => {
    test("a binary DXF is refused rather than parsed into nothing", () => {
        expect(() => readDxf("AutoCAD Binary DXF\r\n ")).toThrow(DxfParseError);
    });

    test("a DWG renamed to .dxf is refused", () => {
        // A real DWG opens with its version string followed by binary, which contains no
        // SECTION - this is the case a user hits by renaming the file.
        expect(() => readDxf("AC1015    binary junk")).toThrow(DxfParseError);
    });
});
