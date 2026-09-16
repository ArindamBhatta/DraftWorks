// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Turns a `DxfDrawing` into a sheet of paper primitives.
 *
 * The drawing comes from `nodesToDxf` - the same function DXF and DWG export use. That is
 * the point: a plot then shows exactly what an export would contain, and a curve that
 * plots wrong is a curve that exports wrong, so there is one thing to fix rather than two.
 * It also means plotting inherits layers, colours, lineweights and dimension pictures
 * without re-deriving any of them from the node tree.
 *
 * Curves stay curves. Arcs, circles and ellipses become cubic Beziers rather than being
 * flattened into short segments, because a plot is a vector document that will be viewed
 * at whatever zoom the reader likes and printed at up to A0 - facets that are invisible on
 * screen are not invisible on a metre of paper.
 */

import { layoutText, UnitSetup } from "@draftworks/core";
import { bulgeArc } from "../dxf/dxfGeometry";
import {
    type DxfDrawing,
    type DxfEntity,
    type DxfLayerRecord,
    type DxfPolylineVertex,
    type DxfVec,
    dxfVec,
    ocsToWorld,
} from "../dxf/dxfModel";
import type { PathCommand, PlotExtents, PlotPoint, PlotPrimitive, PlotSheet } from "./plotModel";
import { type PlotSettings, type PlotWindow, sheetOf, unitsPerMillimetre } from "./plotSettings";

/** Lineweight used when neither the entity nor its layer names one, in 1/100 mm. */
const DEFAULT_LINEWEIGHT = 25;

/** A Bezier follows a circular arc to well under a printer's dot over a quarter turn. */
const MAX_ARC_SPAN = Math.PI / 2;

const DEG_TO_RAD = Math.PI / 180;

export interface PlotInput {
    /** Resolves `area: "display"`, which only the viewport knows. In drawing units. */
    displayWindow?: PlotWindow;
}

/**
 * A flat drawing entity paired with the layer it resolves BYLAYER properties through.
 * Blocks are expanded before this point, so nothing here has to recurse.
 */
interface Resolved {
    entity: DxfEntity;
    layer?: DxfLayerRecord;
}

export function buildPlotSheet(
    drawing: DxfDrawing,
    settings: PlotSettings,
    input: PlotInput = {},
): PlotSheet {
    const sheet = sheetOf(settings);
    const layers = new Map(drawing.layers.map((layer) => [layer.name, layer]));
    const blocks = new Map(drawing.blocks.map((block) => [block.name, block]));

    const drawable = collect(drawing.entities, layers, blocks);
    const extents = areaOf(settings, drawable, input.displayWindow);

    // Only a box with no size at all is refused - an empty drawing, a single point, or a
    // window dragged to nothing. A drawing that is one vertical line has zero width and is
    // still a drawing: fitting it uses whichever axis has a size, which is why this tests
    // both together rather than each on its own.
    const degenerate = !extents || (extents.maxX - extents.minX < 1e-9 && extents.maxY - extents.minY < 1e-9);

    if (degenerate) {
        return {
            ...sheet,
            primitives: [],
            scale: settings.scale,
            extents: extents ?? undefined,
            clipped: false,
        };
    }

    const unitsPerMm = resolveScale(settings, extents, sheet.printable);
    const place = placement(settings, extents, sheet.printable, unitsPerMm);
    const toPaper = (point: DxfVec, normal?: DxfVec): PlotPoint => {
        const world = normal ? ocsToWorld(point, normal) : point;
        return {
            x: place.x + (world.x - extents.minX) / unitsPerMm,
            y: place.y + (world.y - extents.minY) / unitsPerMm,
        };
    };

    const primitives: PlotPrimitive[] = [];
    for (const item of drawable) {
        emit(item, settings, unitsPerMm, toPaper, primitives);
    }

    const plottedWidth = (extents.maxX - extents.minX) / unitsPerMm;
    const plottedHeight = (extents.maxY - extents.minY) / unitsPerMm;

    return {
        ...sheet,
        primitives,
        // Reported back as a plot scale, not as the internal units-per-millimetre, so the
        // dialog shows the same kind of number the user typed in.
        scale: unitsPerMm * UnitSetup.millimetresPerUnit(),
        extents,
        clipped: plottedWidth - sheet.printable.width > 1e-6 || plottedHeight - sheet.printable.height > 1e-6,
    };
}

/**
 * Flattens the drawing to the entities that actually mark the paper.
 *
 * A dimension contributes its picture block and not the DIMENSION entity itself: the
 * entity carries the measured points so a receiving CAD application can rebuild the
 * dimension, while the block is the lines, arrowheads and label that were on screen. On
 * paper only the picture means anything.
 */
function collect(
    entities: DxfEntity[],
    layers: Map<string, DxfLayerRecord>,
    blocks: Map<string, { entities: DxfEntity[] }>,
    depth = 0,
): Resolved[] {
    const out: Resolved[] = [];

    for (const entity of entities) {
        const layer = layers.get(entity.layer);

        // AutoCAD's layer switches, in the order a drafter thinks about them. A layer that
        // is off or frozen is not on the plot; "plot: false" is the one that exists purely
        // for plotting - construction lines stay visible on screen and off the paper.
        if (layer && (layer.off || layer.frozen || !layer.plot)) continue;

        if (entity.type === "dimension") {
            const block = entity.blockName ? blocks.get(entity.blockName) : undefined;
            // No picture block means the drawing came from elsewhere and the dimension was
            // never drawn out. Dropping it is better than inventing geometry for it.
            if (block && depth < 8) out.push(...collect(block.entities, layers, blocks, depth + 1));
            continue;
        }

        if (entity.type === "insert") {
            const block = blocks.get(entity.blockName);
            // Depth-guarded: a block that references itself would otherwise recurse until
            // the stack gives out, and a corrupt file should not take the tab down.
            if (block && depth < 8) {
                const inner = collect(block.entities, layers, blocks, depth + 1);
                out.push(...inner.map((item) => ({ ...item, entity: transform(item.entity, entity) })));
            }
            continue;
        }

        out.push({ entity, layer });
    }

    return out;
}

/** Places a block's entity into the drawing, applying the INSERT's scale and rotation. */
function transform(entity: DxfEntity, insert: DxfEntity & { type: "insert" }): DxfEntity {
    const cos = Math.cos(insert.rotation * DEG_TO_RAD);
    const sin = Math.sin(insert.rotation * DEG_TO_RAD);
    const map = (p: DxfVec): DxfVec => {
        const sx = p.x * insert.scale.x;
        const sy = p.y * insert.scale.y;
        return dxfVec(
            insert.position.x + sx * cos - sy * sin,
            insert.position.y + sx * sin + sy * cos,
            insert.position.z + p.z * insert.scale.z,
        );
    };
    return mapPoints(entity, map, Math.abs(insert.scale.x), insert.rotation);
}

/**
 * Rebuilds an entity with every point put through `map`.
 *
 * Radii and heights take a single scale factor rather than the mapped points, because a
 * circle under a non-uniform scale is an ellipse and this returns a circle. That is a
 * limitation of flattening INSERTs this way; `nodesToDxf` never writes a non-uniform
 * INSERT, so it costs nothing here and is only reachable through an imported drawing.
 */
function mapPoints(
    entity: DxfEntity,
    map: (p: DxfVec) => DxfVec,
    scale: number,
    rotation: number,
): DxfEntity {
    switch (entity.type) {
        case "line":
            return { ...entity, start: map(entity.start), end: map(entity.end) };
        case "circle":
            return { ...entity, center: map(entity.center), radius: entity.radius * scale };
        case "arc":
            return {
                ...entity,
                center: map(entity.center),
                radius: entity.radius * scale,
                startAngle: entity.startAngle + rotation,
                endAngle: entity.endAngle + rotation,
            };
        case "ellipse": {
            const origin = map(dxfVec());
            const axis = map(entity.majorAxis);
            return {
                ...entity,
                center: map(entity.center),
                majorAxis: dxfVec(axis.x - origin.x, axis.y - origin.y, axis.z - origin.z),
            };
        }
        case "polyline":
            return {
                ...entity,
                vertices: entity.vertices.map((v) => {
                    const p = map(dxfVec(v.x, v.y, entity.elevation));
                    return { x: p.x, y: p.y, bulge: v.bulge };
                }),
            };
        case "point":
            return { ...entity, position: map(entity.position) };
        case "text":
            return {
                ...entity,
                position: map(entity.position),
                height: entity.height * scale,
                boxWidth: entity.boxWidth * scale,
                rotation: entity.rotation + rotation,
            };
        case "solid":
            return {
                ...entity,
                corners: entity.corners.map(map) as [DxfVec, DxfVec, DxfVec, DxfVec],
            };
        case "spline":
            return {
                ...entity,
                controlPoints: entity.controlPoints.map(map),
                fitPoints: entity.fitPoints.map(map),
            };
        default:
            return entity;
    }
}

/** The rectangle of the drawing that goes on the sheet. */
function areaOf(
    settings: PlotSettings,
    drawable: Resolved[],
    displayWindow?: PlotWindow,
): PlotExtents | undefined {
    if (settings.area === "window") return settings.window;
    if (settings.area === "display") return displayWindow ?? extentsOf(drawable);
    return extentsOf(drawable);
}

/** The bounding box of everything that will be drawn. */
export function extentsOf(drawable: Resolved[]): PlotExtents | undefined {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const include = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    };

    for (const { entity } of drawable) {
        for (const point of outlineOf(entity)) include(point.x, point.y);
    }

    if (minX > maxX) return undefined;
    return { minX, minY, maxX, maxY };
}

/**
 * Enough points to bound an entity.
 *
 * Curves are solved for their true extreme points rather than bounded by their whole
 * circle. The cheap way - taking the full circle of every arc - is safe but wasteful, and
 * not slightly: one quarter-arc in a corner of a drawing pushes the box out by a radius on
 * two sides, and "fit to paper" then prints the whole plan smaller to make room for
 * nothing. On a sheet of A1 that is a visible loss of scale.
 */
function* outlineOf(entity: DxfEntity): Generator<{ x: number; y: number }> {
    switch (entity.type) {
        case "line":
            yield entity.start;
            yield entity.end;
            return;
        case "circle":
            yield { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius };
            yield { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius };
            return;
        case "arc": {
            const start = entity.startAngle * DEG_TO_RAD;
            let sweep = (entity.endAngle - entity.startAngle) * DEG_TO_RAD;
            while (sweep <= 0) sweep += Math.PI * 2;
            yield* arcExtremes(entity.center, entity.radius, entity.radius, 0, start, sweep);
            return;
        }
        case "ellipse": {
            const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
            const tilt = Math.atan2(entity.majorAxis.y, entity.majorAxis.x);
            let sweep = entity.endParam - entity.startParam;
            while (sweep <= 0) sweep += Math.PI * 2;
            yield* arcExtremes(entity.center, major, major * entity.ratio, tilt, entity.startParam, sweep);
            return;
        }
        case "polyline": {
            for (let i = 0; i < entity.vertices.length; i++) {
                const from = entity.vertices[i];
                yield { x: from.x, y: from.y };

                const isLast = i === entity.vertices.length - 1;
                if (isLast && !entity.closed) break;
                if (Math.abs(from.bulge) < 1e-12) continue;

                // A bulged segment bows outside the straight line between its vertices, so
                // the vertices alone under-state the box. Under-stating is the dangerous
                // direction here: it is what silently clips an arc off the edge of a plot.
                const to = entity.vertices[(i + 1) % entity.vertices.length];
                const arc = bulgeSegment(from, to);
                if (arc)
                    yield* arcExtremes(
                        dxfVec(arc.cx, arc.cy, 0),
                        arc.radius,
                        arc.radius,
                        0,
                        arc.start,
                        arc.sweep,
                    );
            }
            return;
        }
        case "point":
            yield entity.position;
            return;
        case "text": {
            const layout = layoutText(entity.content, entity.height, entity.boxWidth);
            yield entity.position;
            // The block hangs below its top-left anchor, so the box reaches down and right.
            yield { x: entity.position.x + layout.width, y: entity.position.y - layout.height };
            yield { x: entity.position.x, y: entity.position.y + entity.height };
            return;
        }
        case "solid":
            yield* entity.corners;
            return;
        case "spline":
            yield* entity.fitPoints.length > 0 ? entity.fitPoints : entity.controlPoints;
            return;
        default:
            return;
    }
}

/**
 * The arc a polyline bulge stands for, in the form the plot needs: centre, radius, start
 * angle and signed sweep in radians.
 *
 * The bulge itself is resolved by `bulgeArc` in dxfGeometry, which the DXF importer already
 * uses and which has the sign conventions pinned by its own tests - a positive bulge is
 * counter-clockwise, so on a left-to-right chord the arc dips below it. Plotting a bulge the
 * other way up from the way it imports would be a subtle and very confusing bug, and
 * sharing the one function is what rules it out.
 */
function bulgeSegment(
    from: DxfPolylineVertex,
    to: DxfPolylineVertex,
): { cx: number; cy: number; radius: number; start: number; sweep: number } | undefined {
    const arc = bulgeArc(from, to, from.bulge);
    if (!arc) return undefined;

    return {
        cx: arc.center.x,
        cy: arc.center.y,
        radius: arc.radius,
        start: Math.atan2(from.y - arc.center.y, from.x - arc.center.x),
        sweep: arc.sweep * DEG_TO_RAD,
    };
}

/**
 * The points that bound an arc or elliptical arc: its two ends, plus any axis-aligned
 * extreme the sweep actually passes through.
 *
 * x and y each reach a turning point where their derivative vanishes, which for the
 * general rotated ellipse is `tan t = -(b sin f)/(a cos f)` and `tan t = (b cos f)/(a sin f)`.
 * Each has two roots half a turn apart, giving four candidates; those inside the sweep are
 * on the arc and the rest are not. For a circle this degenerates to the four compass
 * points, which is the familiar rule and falls out rather than being special-cased.
 */
function* arcExtremes(
    center: DxfVec,
    a: number,
    b: number,
    tilt: number,
    startParam: number,
    sweep: number,
): Generator<{ x: number; y: number }> {
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const at = (t: number) => ({
        x: center.x + a * Math.cos(t) * cosTilt - b * Math.sin(t) * sinTilt,
        y: center.y + a * Math.cos(t) * sinTilt + b * Math.sin(t) * cosTilt,
    });

    yield at(startParam);
    yield at(startParam + sweep);

    const forX = Math.atan2(-b * sinTilt, a * cosTilt);
    const forY = Math.atan2(b * cosTilt, a * sinTilt);

    for (const candidate of [forX, forX + Math.PI, forY, forY + Math.PI]) {
        if (withinSweep(candidate, startParam, sweep)) yield at(candidate);
    }
}

const TWO_PI = Math.PI * 2;

/** Whether `angle` lies on the arc that starts at `start` and turns through `sweep`. */
function withinSweep(angle: number, start: number, sweep: number): boolean {
    // Measured in the direction of travel, so one comparison covers both senses: a
    // clockwise arc is the same question asked from the other end.
    const travelled = sweep >= 0 ? angle - start : start - angle;
    const normalised = ((travelled % TWO_PI) + TWO_PI) % TWO_PI;
    return normalised <= Math.abs(sweep) + 1e-9;
}

/** Drawing units per paper millimetre, either fitted to the sheet or as asked for. */
function resolveScale(
    settings: PlotSettings,
    extents: PlotExtents,
    printable: { width: number; height: number },
): number {
    if (!settings.fitToPaper) return unitsPerMillimetre(settings.scale);

    if (printable.width <= 0 || printable.height <= 0) return unitsPerMillimetre(settings.scale);

    // The larger ratio wins: whichever side runs out of paper first sets the scale, which
    // is what makes the whole drawing fit rather than only one axis of it. An axis with no
    // extent contributes 0 and so never wins, which is how a single straight line fits by
    // its length.
    return Math.max(
        (extents.maxX - extents.minX) / printable.width,
        (extents.maxY - extents.minY) / printable.height,
    );
}

/** Where the drawing's lower-left corner lands on the sheet, in millimetres. */
function placement(
    settings: PlotSettings,
    extents: PlotExtents,
    printable: { x: number; y: number; width: number; height: number },
    unitsPerMm: number,
): PlotPoint {
    if (!settings.centered) {
        return { x: printable.x + settings.offsetX, y: printable.y + settings.offsetY };
    }

    const width = (extents.maxX - extents.minX) / unitsPerMm;
    const height = (extents.maxY - extents.minY) / unitsPerMm;
    return {
        x: printable.x + (printable.width - width) / 2,
        y: printable.y + (printable.height - height) / 2,
    };
}

/** Resolves an entity's colour and width, then appends its primitives. */
function emit(
    item: Resolved,
    settings: PlotSettings,
    unitsPerMm: number,
    toPaper: (p: DxfVec, normal?: DxfVec) => PlotPoint,
    out: PlotPrimitive[],
): void {
    const { entity, layer } = item;
    const color = plotColor(entity.color ?? layer?.color, settings.style);
    const widthMm = plotWidth(entity.lineWeight ?? layer?.lineWeight, settings);

    if (entity.type === "text") {
        const layout = layoutText(entity.content, entity.height, entity.boxWidth);
        const heightMm = entity.height / unitsPerMm;
        const lineMm = layout.lineHeight / unitsPerMm;
        const angle = entity.rotation * DEG_TO_RAD;

        layout.lines.forEach((line, index) => {
            if (line.length === 0) return;
            // Each line is stepped down the text's own rotated y axis, so a rotated block
            // stays a block instead of stair-stepping down the page.
            const drop = index * lineMm;
            const anchor = toPaper(entity.position, entity.normal);
            out.push({
                kind: "text",
                content: line,
                at: { x: anchor.x + drop * Math.sin(angle), y: anchor.y - drop * Math.cos(angle) },
                heightMm,
                rotation: entity.rotation,
                color,
            });
        });
        return;
    }

    const commands = pathOf(entity, toPaper);
    if (commands.length === 0) return;

    out.push({
        kind: "path",
        commands,
        widthMm,
        color,
        // SOLID is DXF's filled quadrilateral, and is how dimension arrowheads are drawn.
        filled: entity.type === "solid",
    });
}

/** The path an entity draws, already in paper millimetres. */
function pathOf(entity: DxfEntity, toPaper: (p: DxfVec, normal?: DxfVec) => PlotPoint): PathCommand[] {
    switch (entity.type) {
        case "line":
            // LINE carries no extrusion in this model, so its points are already world
            // space and no OCS mapping applies. Same for POINT and SPLINE below.
            return [
                { type: "move", to: toPaper(entity.start) },
                { type: "line", to: toPaper(entity.end) },
            ];

        case "circle":
            return arcPath(
                entity.center,
                entity.radius,
                entity.radius,
                0,
                0,
                Math.PI * 2,
                entity.normal,
                toPaper,
                true,
            );

        case "arc": {
            const start = entity.startAngle * DEG_TO_RAD;
            let sweep = (entity.endAngle - entity.startAngle) * DEG_TO_RAD;
            // DXF arcs always run counter-clockwise from start to end, so an end angle
            // below the start has wrapped past zero rather than meaning a negative sweep.
            while (sweep <= 0) sweep += Math.PI * 2;
            return arcPath(
                entity.center,
                entity.radius,
                entity.radius,
                0,
                start,
                sweep,
                entity.normal,
                toPaper,
                false,
            );
        }

        case "ellipse": {
            const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
            const tilt = Math.atan2(entity.majorAxis.y, entity.majorAxis.x);
            let sweep = entity.endParam - entity.startParam;
            while (sweep <= 0) sweep += Math.PI * 2;
            const whole = sweep >= Math.PI * 2 - 1e-9;
            return arcPath(
                entity.center,
                major,
                major * entity.ratio,
                tilt,
                entity.startParam,
                sweep,
                entity.normal,
                toPaper,
                whole,
            );
        }

        case "polyline":
            return polylinePath(entity.vertices, entity.closed, entity.elevation, entity.normal, toPaper);

        case "solid": {
            const [a, b, c, d] = entity.corners.map((corner) => toPaper(corner, entity.normal));
            // DXF's SOLID numbers its corners in a Z, not around the outline, so the third
            // and fourth are swapped to walk the perimeter. A triangle repeats a corner,
            // which closes harmlessly.
            return [
                { type: "move", to: a },
                { type: "line", to: b },
                { type: "line", to: d },
                { type: "line", to: c },
                { type: "close" },
            ];
        }

        case "point": {
            // A bare point has no size of its own. It plots as a small cross, the way
            // AutoCAD's default PDMODE does, sized in paper units so it stays visible at
            // any plot scale.
            const at = toPaper(entity.position);
            const arm = 0.5;
            return [
                { type: "move", to: { x: at.x - arm, y: at.y } },
                { type: "line", to: { x: at.x + arm, y: at.y } },
                { type: "move", to: { x: at.x, y: at.y - arm } },
                { type: "line", to: { x: at.x, y: at.y + arm } },
            ];
        }

        case "spline": {
            // nodesToDxf never writes a SPLINE - it samples curves it cannot name into
            // polylines - so this is only reachable through an imported drawing, and a
            // polyline through the fit points is a fair likeness rather than a NURBS
            // evaluator that would other never run.
            const points = entity.fitPoints.length > 0 ? entity.fitPoints : entity.controlPoints;
            if (points.length < 2) return [];
            const commands: PathCommand[] = [{ type: "move", to: toPaper(points[0]) }];
            for (const point of points.slice(1)) {
                commands.push({ type: "line", to: toPaper(point) });
            }
            if (entity.closed) commands.push({ type: "close" });
            return commands;
        }

        default:
            return [];
    }
}

/** A polyline, turning each bulged segment into the arc it stands for. */
function polylinePath(
    vertices: DxfPolylineVertex[],
    closed: boolean,
    elevation: number,
    normal: DxfVec,
    toPaper: (p: DxfVec, normal?: DxfVec) => PlotPoint,
): PathCommand[] {
    if (vertices.length < 2) return [];

    const at = (v: DxfPolylineVertex) => toPaper(dxfVec(v.x, v.y, elevation), normal);
    const commands: PathCommand[] = [{ type: "move", to: at(vertices[0]) }];

    const last = closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < last; i++) {
        const from = vertices[i];
        const to = vertices[(i + 1) % vertices.length];

        const arc = Math.abs(from.bulge) < 1e-12 ? undefined : bulgeSegment(from, to);
        if (!arc) {
            commands.push({ type: "line", to: at(to) });
            continue;
        }

        commands.push(
            ...arcPath(
                dxfVec(arc.cx, arc.cy, elevation),
                arc.radius,
                arc.radius,
                0,
                arc.start,
                arc.sweep,
                normal,
                toPaper,
                false,
            ).slice(1),
        );
    }

    if (closed) commands.push({ type: "close" });
    return commands;
}

/**
 * An arc or ellipse as cubic Beziers, split so no span exceeds a quarter turn.
 *
 * The control-point distance `k` is the standard circular-arc approximation: for a span of
 * `d` radians the handles run 4/3 * tan(d/4) of the radius along the tangents. Held to a
 * quarter turn the error is under one part in ten thousand of the radius, which on a metre
 * of paper is a few microns - well inside the dot of any plotter.
 */
function arcPath(
    center: DxfVec,
    majorRadius: number,
    minorRadius: number,
    tilt: number,
    startParam: number,
    sweep: number,
    normal: DxfVec,
    toPaper: (p: DxfVec, normal?: DxfVec) => PlotPoint,
    closed: boolean,
): PathCommand[] {
    if (!(majorRadius > 0) || !Number.isFinite(sweep) || sweep === 0) return [];

    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);

    // A point on the un-rotated ellipse, turned by the tilt and moved to the centre.
    const pointAt = (t: number): DxfVec => {
        const x = majorRadius * Math.cos(t);
        const y = minorRadius * Math.sin(t);
        return dxfVec(center.x + x * cosTilt - y * sinTilt, center.y + x * sinTilt + y * cosTilt, center.z);
    };

    // The derivative, which is what the Bezier handles run along.
    const tangentAt = (t: number): DxfVec => {
        const dx = -majorRadius * Math.sin(t);
        const dy = minorRadius * Math.cos(t);
        return dxfVec(dx * cosTilt - dy * sinTilt, dx * sinTilt + dy * cosTilt, 0);
    };

    const spans = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_ARC_SPAN));
    const step = sweep / spans;
    const k = (4 / 3) * Math.tan(step / 4);

    const commands: PathCommand[] = [{ type: "move", to: toPaper(pointAt(startParam), normal) }];

    for (let i = 0; i < spans; i++) {
        const t0 = startParam + step * i;
        const t1 = t0 + step;
        const p0 = pointAt(t0);
        const p1 = pointAt(t1);
        const d0 = tangentAt(t0);
        const d1 = tangentAt(t1);

        commands.push({
            type: "curve",
            c1: toPaper(dxfVec(p0.x + k * d0.x, p0.y + k * d0.y, p0.z), normal),
            c2: toPaper(dxfVec(p1.x - k * d1.x, p1.y - k * d1.y, p1.z), normal),
            to: toPaper(p1, normal),
        });
    }

    if (closed) commands.push({ type: "close" });
    return commands;
}

/**
 * The colour an entity plots in.
 *
 * White and near-white become black, which is what every plot style table in use does: a
 * drawing is drafted on a dark background, so "white" means "the default pen", and leaving
 * it white would plot nothing at all on white paper.
 */
export function plotColor(rgb: number | undefined, style: PlotSettings["style"]): string {
    if (style === "monochrome") return "#000000";

    const value = rgb ?? 0xffffff;
    let r = (value >> 16) & 0xff;
    let g = (value >> 8) & 0xff;
    let b = value & 0xff;

    if (r > 0xf0 && g > 0xf0 && b > 0xf0) return "#000000";

    if (style === "grayscale") {
        // Rec. 601 luma, which is what image tools mean by "greyscale" and keeps the
        // relative darkness of the drawing's colours.
        const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        r = g = b = luma;
    }

    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The width an entity's lineweight plots at, in millimetres. */
export function plotWidth(hundredthsMm: number | undefined, settings: PlotSettings): number {
    // Zero is a hairline: the thinnest mark the device can make. That is what AutoCAD
    // plots with object lineweights turned off, and it is a real choice - it keeps a
    // check plot fast and legible without committing to any pen width.
    if (!settings.plotLineweights) return 0;

    const hundredths = hundredthsMm !== undefined && hundredthsMm >= 0 ? hundredthsMm : DEFAULT_LINEWEIGHT;
    const mm = hundredths / 100;

    // Scaling lineweights is off by default and rarely wanted: a 0.5 mm pen is specified in
    // paper millimetres, so it should be 0.5 mm on the sheet whatever the drawing scale.
    return settings.scaleLineweights ? mm / Math.max(settings.scale, 1e-9) : mm;
}
