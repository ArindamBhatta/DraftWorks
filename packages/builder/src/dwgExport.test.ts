// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The DXF -> DWG export path, end to end: a drawing written by our own DXF writer, encoded
 * to DWG by LibreDWG, and decoded again to see what arrived.
 *
 * This is a round trip rather than an assertion about bytes because the interesting
 * failures are not in either half alone. Three separate things have to stay true for an
 * exported DWG to contain a drawing at all, and none of them is visible from reading the
 * writer:
 *
 *   - `*Model_Space` has to keep handle 1F, or LibreDWG builds a second model space and
 *     the encoder writes a valid, empty DWG - a silent, total loss.
 *   - MTEXT rotation has to be the group 11 vector, not a group 50 angle, or LibreDWG
 *     rejects the file outright.
 *   - LibreDWG's MTEXT group codes have to be the corrected ones from setup_wasm_deps.mjs,
 *     or text comes back sized 0.
 *
 * Each of those was a real failure, each looked like a success from the writer's side, and
 * only the round trip catches them. The DWG import direction is covered separately by
 * cpp/dwg/verify.mjs, which needs LibreDWG's corpus; this one needs no fixtures, because
 * the drawing it exports is built here.
 */

import fs from "node:fs";
import path from "node:path";
import { dxfVec, emptyDrawing, writeDxf } from "@draftworks/app";
import { dwgToDxf, dxfToDwg } from "@draftworks/wasm";
import { describe, expect, test } from "@rstest/core";

// The module is built for the browser and cannot fetch its own binary under Node, so it
// is handed in - the same thing packages/wasm documents for Node callers.
const wasmBinary = fs.readFileSync(path.resolve(import.meta.dirname, "../../wasm/lib/dwg-wasm.wasm"));

/** A drawing with one of everything the writer emits differently. */
function sampleDxf(): string {
    const drawing = emptyDrawing();
    drawing.insUnits = 4;
    drawing.layers.push(
        { name: "0", off: false, frozen: false, locked: false, plot: true, lineType: "CONTINUOUS" },
        {
            name: "WALLS",
            color: 0xff0000,
            off: false,
            frozen: false,
            locked: false,
            plot: true,
            lineType: "CONTINUOUS",
            lineWeight: 50,
        },
    );
    drawing.entities.push(
        { type: "line", layer: "WALLS", start: dxfVec(0, 0, 0), end: dxfVec(1000, 0, 0) },
        { type: "circle", layer: "0", center: dxfVec(500, 400, 0), radius: 120, normal: dxfVec(0, 0, 1) },
        {
            type: "arc",
            layer: "0",
            center: dxfVec(0, 0, 0),
            radius: 300,
            startAngle: 0,
            endAngle: 90,
            normal: dxfVec(0, 0, 1),
        },
        { type: "point", layer: "0", position: dxfVec(50, 50, 0) },
        {
            type: "text",
            layer: "0",
            content: "ROOM A",
            position: dxfVec(200, 200, 0),
            height: 25,
            rotation: 0,
            boxWidth: 0,
            multiline: false,
            attachment: 1,
            normal: dxfVec(0, 0, 1),
        },
        {
            type: "text",
            layer: "0",
            content: "NOTE",
            position: dxfVec(200, 300, 0),
            height: 20,
            rotation: 90,
            boxWidth: 400,
            multiline: true,
            attachment: 1,
            normal: dxfVec(0, 0, 1),
        },
        {
            type: "polyline",
            layer: "WALLS",
            closed: true,
            elevation: 0,
            normal: dxfVec(0, 0, 1),
            vertices: [
                { x: 0, y: 0, bulge: 0 },
                { x: 200, y: 0, bulge: 0.5 },
                { x: 200, y: 200, bulge: 0 },
            ],
        },
    );
    return writeDxf(drawing);
}

interface Entity {
    type: string;
    tags: Map<number, string>;
}

/** The ENTITIES section of a DXF, as entities with their group codes. */
function entitiesOf(dxf: string): Entity[] {
    const lines = dxf.split(/\r?\n/);
    const entities: Entity[] = [];
    let section: string | undefined;
    let current: Entity | undefined;

    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = Number(lines[i].trim());
        const value = lines[i + 1].trim();

        if (code === 0 && value === "SECTION") {
            section = lines[i + 3]?.trim();
            current = undefined;
            continue;
        }
        if (code === 0 && value === "ENDSEC") {
            section = undefined;
            current = undefined;
            continue;
        }
        if (section !== "ENTITIES") continue;

        if (code === 0) {
            current = { type: value, tags: new Map() };
            entities.push(current);
        } else if (current && !current.tags.has(code)) {
            // First occurrence only: the repeated codes belong to polyline vertices, and
            // nothing here asks about those.
            current.tags.set(code, value);
        }
    }
    return entities;
}

describe("DWG export", () => {
    test("writes a DWG that still holds the drawing", async () => {
        const dwg = await dxfToDwg(sampleDxf(), { wasmBinary });

        // R2000 and nothing else - the label the export format promises.
        expect(new TextDecoder().decode(dwg.slice(0, 6))).toBe("AC1015");

        const entities = entitiesOf(await dwgToDxf(dwg, { wasmBinary }));
        const types = entities.map((entity) => entity.type).sort();
        expect(types).toEqual(["ARC", "CIRCLE", "LINE", "LWPOLYLINE", "MTEXT", "POINT", "TEXT"]);
    });

    test("keeps geometry, layers and text through the encoder", async () => {
        const dwg = await dxfToDwg(sampleDxf(), { wasmBinary });
        const entities = entitiesOf(await dwgToDxf(dwg, { wasmBinary }));
        const byType = (type: string) => entities.find((entity) => entity.type === type)!;

        const circle = byType("CIRCLE");
        expect(Number(circle.tags.get(10))).toBeCloseTo(500);
        expect(Number(circle.tags.get(20))).toBeCloseTo(400);
        expect(Number(circle.tags.get(40))).toBeCloseTo(120);

        const line = byType("LINE");
        expect(line.tags.get(8)).toBe("WALLS");
        expect(Number(line.tags.get(11))).toBeCloseTo(1000);

        const text = byType("TEXT");
        expect(text.tags.get(1)).toBe("ROOM A");
        expect(Number(text.tags.get(40))).toBeCloseTo(25);

        // The three MTEXT fields that each silently broke at some point: height and width
        // survive only with LibreDWG's group codes corrected, and the rotation only
        // because it is written as a direction vector. 90 degrees is (0, 1).
        const mtext = byType("MTEXT");
        expect(mtext.tags.get(1)).toBe("NOTE");
        expect(Number(mtext.tags.get(40))).toBeCloseTo(20);
        expect(Number(mtext.tags.get(41))).toBeCloseTo(400);
        expect(Number(mtext.tags.get(11))).toBeCloseTo(0);
        expect(Number(mtext.tags.get(21))).toBeCloseTo(1);
    });
});
