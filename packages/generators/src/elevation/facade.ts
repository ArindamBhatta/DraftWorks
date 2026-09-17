import { Result } from "@draftworks/core";
import type { Interval } from "../floorPlan/intervals";
import type { Bounds, DrawItem, Vec2 } from "../types";
import { arcEnd } from "../types";
import { LENGTH_EPSILON } from "../units";

/**
 * Reads one face of an existing plan well enough to draw its elevation.
 *
 * This is the one place in the package that runs backwards. Every generator turns a
 * handful of parameters into geometry; this turns geometry the draftsman already has
 * back into a handful of parameters, so an elevation can be built from the plan on the
 * canvas rather than from a plan the model imagined.
 *
 * It deliberately does not try to understand the whole plan. An elevation needs exactly
 * four things - how wide the facade is, how thick its wall is, where the openings sit
 * along it, and which of them are doors - and every one of those is a property of a
 * single wall. Room graphs, circulation and adjacency are someone else's problem.
 *
 * Nothing here trusts a layer name. A plan drawn by hand, or round-tripped through DXF
 * from another application, puts walls on "0" or "A-WALL-FULL" or whatever the office
 * standard was that year, so the rules below are the drafting conventions themselves:
 *
 *   - A wall is two parallel lines a plausible thickness apart.
 *   - A door breaks both faces; the break is closed by a jamb line at each end.
 *   - A window breaks neither face, but is still jambed - so the giveaway is a pair of
 *     jambs with the glass line running between them and the faces continuous across.
 *
 * `ignoreLayers` exists for the caller that does know better, and is a filter, never a
 * requirement - the extraction has to stand up without it.
 */

export type FacadeSide = "south" | "north" | "east" | "west";

export const FACADE_SIDES: readonly FacadeSide[] = ["south", "north", "east", "west"];

/**
 * The viewer's own axes for one side, as an orthonormal basis of the plan.
 *
 * `along` runs left to right across the drawing as the viewer sees it, and `outward`
 * points from the building towards them. The pairs are the plan-view case of
 * right = look x up: standing south of a building and facing it, north is away and east
 * is to the right, which is why the north side's `along` runs the other way. Getting
 * this wrong mirrors the elevation, which is the kind of error that survives review.
 *
 * The names are the compass only under the usual north-up drawing. What they actually
 * mean is which edge of the picked window the viewer is standing at, and "south" is a
 * better word for the bottom edge than "minY" is.
 */
export interface Frame {
    along: Vec2;
    outward: Vec2;
}

export const FRAMES: Record<FacadeSide, Frame> = {
    south: { along: { x: 1, y: 0 }, outward: { x: 0, y: -1 } },
    north: { along: { x: -1, y: 0 }, outward: { x: 0, y: 1 } },
    east: { along: { x: 0, y: 1 }, outward: { x: 1, y: 0 } },
    west: { along: { x: 0, y: -1 }, outward: { x: -1, y: 0 } },
};

export interface FacadeOpening {
    kind: "door" | "window";
    /** Centre of the opening, measured from the facade's left end as the viewer sees it. */
    centerMm: number;
    widthMm: number;
    /**
     * Which jamb carries the hinge, from the viewer's side. Only set when a swing arc was
     * found to say so - a door drawn without one is still a door, just not a handed one.
     */
    hinge?: "left" | "right";
}

export interface Facade {
    side: FacadeSide;
    /** End to end along the outer face, in millimetres. */
    widthMm: number;
    wallThicknessMm: number;
    /** Left to right as the viewer sees them. */
    openings: FacadeOpening[];
    /**
     * World position of the facade's left end, on the outer face.
     *
     * Carried so the elevation can be dropped into the drawing directly below the plan
     * and in line with it, which is where a draftsman would project it by hand.
     */
    origin: Vec2;
    /**
     * Jambs that were found but could not be paired into an opening.
     *
     * Reported rather than swallowed. It is the one honest signal that the plan contains
     * something these rules do not cover, and both the panel and the model are better off
     * knowing the reading was incomplete than being handed a confident wrong answer.
     */
    unpairedJambs: number;
}

export interface FacadeOptions {
    side: FacadeSide;
    /** The two corners the draftsman picked. Geometry is clipped to it, not merely filtered. */
    window: Bounds;
    /** Lines off by more than this are not parallel. Degrees. */
    angleToleranceDeg?: number;
    /** Two faces closer than this are the same face. Millimetres. */
    bandToleranceMm?: number;
    minWallThicknessMm?: number;
    maxWallThicknessMm?: number;
    /** A face shorter than this is a stray line, not a wall. Millimetres. */
    minFaceLengthMm?: number;
    /** Layer tags to drop before reading. A convenience, never load-bearing. */
    ignoreLayers?: ReadonlySet<string>;
}

/** The options above with every default filled in, which is all the rules ever read. */
export interface Tolerances {
    /** A sine, because every use of it compares against a cross product. */
    angleTolerance: number;
    bandTolerance: number;
    minThickness: number;
    maxThickness: number;
    minFaceLength: number;
}

export function resolveTolerances(options: FacadeOptions): Tolerances {
    return {
        angleTolerance: Math.sin(((options.angleToleranceDeg ?? 1) * Math.PI) / 180),
        bandTolerance: options.bandToleranceMm ?? 1,
        // Wide enough for a 4" stud partition at one end and a 600 mm stone wall at the
        // other. The bounds are what keeps a dimension line from being read as a wall.
        minThickness: options.minWallThicknessMm ?? 50,
        maxThickness: options.maxWallThicknessMm ?? 600,
        minFaceLength: options.minFaceLengthMm ?? 1000,
    };
}

/** A straight run of a drawing, reduced to what the rules below actually look at. */
export interface Segment {
    a: Vec2;
    b: Vec2;
    layer: string;
}

/** A door swing, kept only to hand the door it belongs to. */
export interface Swing {
    center: Vec2;
    radiusMm: number;
}

const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;
const cross = (p: Vec2, q: Vec2) => p.x * q.y - p.y * q.x;

// ---------------------------------------------------------------------------
// Clipping
// ---------------------------------------------------------------------------

/**
 * Liang-Barsky, returning the part of the segment inside the box.
 *
 * Clipped rather than filtered because the window is a statement about what the
 * draftsman means, not just about what to look at: a facade wall running on past the
 * picked corner ends at the corner, and an elevation of "this much of the building" is
 * a perfectly ordinary thing to ask for.
 */
export function clipSegment(segment: Segment, window: Bounds): Segment | undefined {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;

    let t0 = 0;
    let t1 = 1;

    const edges: [number, number][] = [
        [-dx, segment.a.x - window.min.x],
        [dx, window.max.x - segment.a.x],
        [-dy, segment.a.y - window.min.y],
        [dy, window.max.y - segment.a.y],
    ];

    for (const [p, q] of edges) {
        if (Math.abs(p) < LENGTH_EPSILON) {
            // Parallel to this edge: inside forever, or outside forever.
            if (q < 0) return undefined;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1) return undefined;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return undefined;
            if (t < t1) t1 = t;
        }
    }

    if (t1 - t0 < LENGTH_EPSILON) return undefined;

    return {
        a: { x: segment.a.x + dx * t0, y: segment.a.y + dy * t0 },
        b: { x: segment.a.x + dx * t1, y: segment.a.y + dy * t1 },
        layer: segment.layer,
    };
}

/**
 * Flattens the drawing to straight runs and swings, clipped to the window.
 *
 * Circles, ellipses and text are dropped. A circle in a plan is a column or a fitting
 * and neither appears in an elevation drawn from these rules; text is the room labels,
 * which belong to the plan and not to the face of the building.
 */
export function readGeometry(
    items: DrawItem[],
    window: Bounds,
    ignoreLayers?: ReadonlySet<string>,
): { segments: Segment[]; swings: Swing[] } {
    const segments: Segment[] = [];
    const swings: Swing[] = [];

    const push = (a: Vec2, b: Vec2, layer: string) => {
        const clipped = clipSegment({ a, b, layer }, window);
        if (clipped) segments.push(clipped);
    };

    const inside = (p: Vec2) =>
        p.x >= window.min.x && p.x <= window.max.x && p.y >= window.min.y && p.y <= window.max.y;

    for (const item of items) {
        if (ignoreLayers?.has(item.layer)) continue;

        if (item.kind === "line") {
            push(item.a, item.b, item.layer);
        } else if (item.kind === "polyline") {
            for (let i = 1; i < item.points.length; i++) push(item.points[i - 1], item.points[i], item.layer);
            if (item.closed && item.points.length > 2) {
                push(item.points[item.points.length - 1], item.points[0], item.layer);
            }
        } else if (item.kind === "arc") {
            // Tested by its centre alone. A swing is only ever consulted to hand a door
            // whose jambs are already inside the window, so its centre is the part that
            // has to be there - and clipping an arc to say the same thing costs more.
            const end = arcEnd(item);
            if (inside(item.center)) {
                swings.push({
                    center: item.center,
                    radiusMm: Math.hypot(end.x - item.center.x, end.y - item.center.y),
                });
            }
        }
    }

    return { segments, swings };
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/**
 * A set of collinear runs at one distance from the viewer - a candidate wall face.
 *
 * `offset` grows towards the viewer, so the outermost face of the building is the band
 * with the largest one, whichever side is being looked at. That is the whole reason the
 * frame is expressed as `outward` rather than as a signed axis: every comparison below
 * reads the same for all four sides.
 */
export interface Band {
    offset: number;
    /** Merged and sorted, in `along` coordinates. */
    runs: Interval[];
    /** Total length actually drawn, which is the run total and not the span. */
    coverage: number;
    span: Interval;
}

function mergeRuns(runs: Interval[]): Interval[] {
    const sorted = [...runs].sort((p, q) => p.lo - q.lo);
    const merged: Interval[] = [];

    for (const run of sorted) {
        const last = merged[merged.length - 1];
        if (last && run.lo <= last.hi + LENGTH_EPSILON) {
            last.hi = Math.max(last.hi, run.hi);
        } else {
            merged.push({ ...run });
        }
    }

    return merged;
}

/** Groups the segments running along the facade into faces, nearest the viewer first. */
export function bandsOf(
    segments: Segment[],
    frame: Frame,
    tolerance: number,
    angleTolerance: number,
): Band[] {
    const entries: { offset: number; run: Interval }[] = [];

    for (const segment of segments) {
        const dx = segment.b.x - segment.a.x;
        const dy = segment.b.y - segment.a.y;
        const length = Math.hypot(dx, dy);
        if (length < LENGTH_EPSILON) continue;

        const dir = { x: dx / length, y: dy / length };
        if (Math.abs(cross(dir, frame.along)) > angleTolerance) continue;

        const oa = dot(segment.a, frame.outward);
        const ob = dot(segment.b, frame.outward);
        const sa = dot(segment.a, frame.along);
        const sb = dot(segment.b, frame.along);

        entries.push({
            // Averaged: a segment a hair off parallel has two slightly different offsets,
            // and its midpoint is the one that clusters correctly with its neighbours.
            offset: (oa + ob) / 2,
            run: { lo: Math.min(sa, sb), hi: Math.max(sa, sb) },
        });
    }

    entries.sort((p, q) => q.offset - p.offset);

    const bands: Band[] = [];
    let group: { offset: number; run: Interval }[] = [];

    const flush = () => {
        if (group.length === 0) return;
        const runs = mergeRuns(group.map((e) => e.run));
        bands.push({
            offset: group.reduce((sum, e) => sum + e.offset, 0) / group.length,
            runs,
            coverage: runs.reduce((sum, r) => sum + (r.hi - r.lo), 0),
            span: { lo: runs[0].lo, hi: runs[runs.length - 1].hi },
        });
        group = [];
    };

    for (const entry of entries) {
        // Compared against the group's first member rather than its running mean, so a
        // long shallow ramp of near-coincident lines cannot drift a band wider than the
        // tolerance it was given.
        if (group.length > 0 && group[0].offset - entry.offset > tolerance) flush();
        group.push(entry);
    }
    flush();

    return bands;
}

const overlapOf = (p: Interval, q: Interval) => Math.max(0, Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo));

/**
 * How much line the two faces actually have in common.
 *
 * Measured over the runs rather than end to end, because end to end is exactly what a
 * row of window glass lines fakes. Each of them sits on the wall's centreline, so they
 * cluster into one band, and a band holding the first and the last window on the wall
 * spans nearly all of it while covering almost none of it. Against the outer face's run
 * list it is what it is: a few hundred millimetres in a wall six metres long.
 */
function sharedCover(p: Interval[], q: Interval[]): number {
    let total = 0;
    let i = 0;
    let j = 0;

    while (i < p.length && j < q.length) {
        total += overlapOf(p[i], q[j]);
        if (p[i].hi < q[j].hi) i++;
        else j++;
    }

    return total;
}

/**
 * Finds the facade wall as the outermost pair of faces a wall's thickness apart.
 *
 * Insisting on the pair is what makes this survive a real drawing. The outermost long
 * line parallel to a facade is very often not the building at all - it is the dimension
 * line running outside it, or the plot boundary, or a setback line - and every one of
 * those is alone out there. A wall is the outermost thing with a partner.
 */
export function findWall(bands: Band[], resolved: Tolerances): { outer: Band; inner: Band } | undefined {
    const candidates = bands.filter((band) => band.coverage >= resolved.minFaceLength);

    for (const outer of candidates) {
        for (const inner of candidates) {
            const thickness = outer.offset - inner.offset;
            if (thickness < resolved.minThickness || thickness > resolved.maxThickness) continue;
            // The two faces have to be faces of the same wall - running alongside each
            // other for most of their length, not merely a plausible distance apart at
            // opposite ends of the plan.
            if (sharedCover(outer.runs, inner.runs) < 0.6 * outer.coverage) continue;
            return { outer, inner };
        }
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

/**
 * The positions along the wall where a line crosses it from face to face.
 *
 * This is the reveal of an opening, drawn to close the wall off where it stops. It is
 * the one mark a door and a window are guaranteed to share, which is why the search
 * starts here and asks what kind it is afterwards.
 */
export function jambsOf(
    segments: Segment[],
    frame: Frame,
    wall: { outer: Band; inner: Band },
    resolved: Tolerances,
): number[] {
    const found: number[] = [];

    // Scaled off the wall, not off the band tolerance alone. Band clustering wants to be
    // strict - two faces 2 mm apart are two faces - but a jamb only has to land on a face
    // it was drawn to meet, and in a plan drawn by hand it lands within a percent or two.
    const thickness = wall.outer.offset - wall.inner.offset;
    const tolerance = Math.max(resolved.bandTolerance, 0.05 * thickness);

    for (const segment of segments) {
        const dx = segment.b.x - segment.a.x;
        const dy = segment.b.y - segment.a.y;
        const length = Math.hypot(dx, dy);
        if (length < LENGTH_EPSILON) continue;

        const dir = { x: dx / length, y: dy / length };
        if (Math.abs(dot(dir, frame.along)) > resolved.angleTolerance) continue;

        const oa = dot(segment.a, frame.outward);
        const ob = dot(segment.b, frame.outward);
        const lo = Math.min(oa, ob);
        const hi = Math.max(oa, ob);

        // It has to land on both faces and stop there. Bridging alone is not enough: the
        // side walls returning at the building's corners cross this wall too, and so does
        // every dimension extension line, and all of them run on well past the far face.
        // A reveal is exactly as deep as the wall is thick.
        if (Math.abs(lo - wall.inner.offset) > tolerance) continue;
        if (Math.abs(hi - wall.outer.offset) > tolerance) continue;

        const s = (dot(segment.a, frame.along) + dot(segment.b, frame.along)) / 2;
        if (s < wall.outer.span.lo - tolerance) continue;
        if (s > wall.outer.span.hi + tolerance) continue;

        found.push(s);
    }

    found.sort((p, q) => p - q);

    // Both faces of a wall are usually jambed by two coincident lines where a partition
    // returns; collapsing them here keeps the pairing below counting openings and not
    // line work.
    const unique: number[] = [];
    for (const s of found) {
        if (unique.length === 0 || s - unique[unique.length - 1] > tolerance) unique.push(s);
    }

    return unique;
}

/** The unbuilt parts of a face, which on an outer face are its doorways. */
export function gapsOf(runs: Interval[], span: Interval): Interval[] {
    const gaps: Interval[] = [];
    let cursor = span.lo;

    for (const run of runs) {
        if (run.lo - cursor > LENGTH_EPSILON) gaps.push({ lo: cursor, hi: run.lo });
        cursor = Math.max(cursor, run.hi);
    }
    if (span.hi - cursor > LENGTH_EPSILON) gaps.push({ lo: cursor, hi: span.hi });

    return gaps;
}

/**
 * Whether the glass line runs between two jambs.
 *
 * A window in plan is drawn as the two wall faces carried straight past the opening with
 * one or more lines between them for the glass. The faces being continuous is what says
 * it is not a door; the line in between is what says it is an opening at all rather than
 * two unrelated jambs with solid wall in between.
 */
function glazedBetween(
    bands: Band[],
    wall: { outer: Band; inner: Band },
    gap: Interval,
    tolerance: number,
): boolean {
    const width = gap.hi - gap.lo;

    for (const band of bands) {
        if (band.offset >= wall.outer.offset - tolerance) continue;
        if (band.offset <= wall.inner.offset + tolerance) continue;
        for (const run of band.runs) {
            if (overlapOf(run, gap) > 0.8 * width) return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** How many faces the refusal lists before it stops. Enough to see the pattern. */
const FACES_REPORTED = 6;

/**
 * The range a facade's length has to fall in to be a building at all, in millimetres.
 *
 * Deliberately far outside anything anyone would draw - a metre and a half is narrower
 * than one room, a kilometre longer than any elevation - so these only ever catch a
 * drawing being read at the wrong scale, never a real one that is merely unusual.
 */
const SMALLEST_BUILDING_MM = 1500;
const LARGEST_BUILDING_MM = 1_000_000;

/**
 * Whether what was read is the wrong size to be a building at all.
 *
 * Everything in this package is millimetres, and the conversion into them is one
 * multiplication by the drawing's base unit - so a base unit that does not match the
 * coordinates the plan was drawn in scales the whole building by a thousand, and every
 * rule here then fails on numbers that look almost reasonable. A plan drawn in metres and
 * read as millimetres puts the two faces of a 230 wall 0.23 apart, which is inside the
 * band tolerance, so they merge into one face and no wall can be found however the rest
 * of the geometry is tested.
 *
 * Worth naming explicitly rather than leaving as a puzzle. It is the one failure here
 * whose fix is not in the drawing or in the pick but in the drawing's unit setup, and
 * nothing about the face list hints at that.
 */
function scaleComplaint(widestMm: number): string | undefined {
    if (widestMm < SMALLEST_BUILDING_MM) {
        return (
            `but the longest face along it measures only ${widestMm.toFixed(widestMm < 10 ? 2 : 0)} mm, ` +
            "which is far too small to be a building. That is what a drawing whose base unit does not " +
            "match the coordinates it was drawn in looks like - a plan drawn in metres and read as " +
            "millimetres comes out a thousand times too small. Check the drawing's units and try again."
        );
    }

    if (widestMm > LARGEST_BUILDING_MM) {
        return (
            `but the longest face along it measures ${Math.round(widestMm)} mm, which is far too large ` +
            "to be a building. That is what a drawing whose base unit does not match the coordinates it " +
            "was drawn in looks like. Check the drawing's units and try again."
        );
    }

    return undefined;
}
/**
 * Says what was actually found, rather than only that it was not a wall.
 *
 * The three tests a wall has to pass - long enough, a plausible thickness apart, running
 * alongside each other - all fail with the same word, and which one failed is the whole
 * of what the draftsman needs to know. A plan whose faces come back 1450 apart has walls
 * thicker than this was told to expect; one that lists dozens of faces a few millimetres
 * apart was drawn with its wall lines not quite collinear; one that lists none at all was
 * read from the wrong side. Guessing between those from the outside is hopeless, and the
 * numbers are right here.
 *
 * Distances are quoted inward from the outermost face rather than as raw coordinates,
 * because the gaps between the faces are what the rules actually test.
 */
function explainNoWall(bands: Band[], segmentCount: number, resolved: Tolerances): string {
    const lead = `No wall was found on that side. ${segmentCount} line${segmentCount === 1 ? "" : "s"} lay inside the picked area`;

    if (bands.length === 0) {
        return `${lead}, but none of them run along that side at all - so either the building faces another way, or the picked area missed it.`;
    }

    // Checked before the face list, because when the scale is wrong the face list is
    // arithmetically correct and completely useless - millimetre gaps between the walls
    // of a house, which tells the draftsman nothing about what to do next.
    const widest = Math.max(...bands.map((band) => band.span.hi - band.span.lo));
    const scale = scaleComplaint(widest);
    if (scale) return `${lead}, ${scale}`;

    const outermost = bands[0].offset;
    const listed = bands.slice(0, FACES_REPORTED).map((band) => {
        const inward = Math.round(outermost - band.offset);
        return `${inward} in, ${Math.round(band.coverage)} long`;
    });
    const more = bands.length > FACES_REPORTED ? `, and ${bands.length - FACES_REPORTED} more` : "";

    return (
        `${lead}. Working in from the outside, the faces along that side are: ${listed.join("; ")}${more}. ` +
        `A wall is two of those between ${resolved.minThickness} and ${resolved.maxThickness} apart, ` +
        `each at least ${resolved.minFaceLength} long, running alongside each other for most of their length. ` +
        "All lengths are millimetres."
    );
}

export function extractFacade(items: DrawItem[], options: FacadeOptions): Result<Facade, string> {
    const frame = FRAMES[options.side];
    const resolved = resolveTolerances(options);

    const { segments, swings } = readGeometry(items, options.window, options.ignoreLayers);
    if (segments.length === 0) return Result.err("Nothing was picked.");

    const bands = bandsOf(segments, frame, resolved.bandTolerance, resolved.angleTolerance);
    const wall = findWall(bands, resolved);
    if (!wall) return Result.err(explainNoWall(bands, segments.length, resolved));

    const span = wall.outer.span;
    const jambs = jambsOf(segments, frame, wall, resolved);
    const openings: FacadeOpening[] = [];
    const consumed = new Set<number>();

    // Doors first: they are the breaks in the face, so they are found without having to
    // guess at pairing. Every one of them takes its two jambs out of the running.
    for (const gap of gapsOf(wall.outer.runs, span)) {
        const left = jambs.findIndex((s) => Math.abs(s - gap.lo) <= resolved.bandTolerance);
        const right = jambs.findIndex((s) => Math.abs(s - gap.hi) <= resolved.bandTolerance);
        if (left < 0 || right < 0) continue;

        consumed.add(left);
        consumed.add(right);
        openings.push({
            kind: "door",
            centerMm: (gap.lo + gap.hi) / 2 - span.lo,
            widthMm: gap.hi - gap.lo,
            hinge: handOf(swings, frame, gap),
        });
    }

    // Then windows, from what is left. Scanned rather than zipped: a pair that does not
    // validate drops only its left jamb, so one unreadable mark cannot mis-pair every
    // window to its right.
    const remaining = jambs.map((s, i) => ({ s, i })).filter((j) => !consumed.has(j.i));
    let unpaired = 0;
    let cursor = 0;

    while (cursor < remaining.length - 1) {
        const gap: Interval = { lo: remaining[cursor].s, hi: remaining[cursor + 1].s };
        if (glazedBetween(bands, wall, gap, resolved.bandTolerance)) {
            openings.push({
                kind: "window",
                centerMm: (gap.lo + gap.hi) / 2 - span.lo,
                widthMm: gap.hi - gap.lo,
            });
            cursor += 2;
        } else {
            unpaired++;
            cursor++;
        }
    }
    if (cursor === remaining.length - 1) unpaired++;

    openings.sort((p, q) => p.centerMm - q.centerMm);

    return Result.ok({
        side: options.side,
        widthMm: span.hi - span.lo,
        wallThicknessMm: wall.outer.offset - wall.inner.offset,
        openings,
        origin: {
            x: frame.along.x * span.lo + frame.outward.x * wall.outer.offset,
            y: frame.along.y * span.lo + frame.outward.y * wall.outer.offset,
        },
        unpairedJambs: unpaired,
    });
}

/**
 * Which jamb the swing is centred on, expressed from the viewer's side.
 *
 * The radius has to match the opening too. A door in a plan is often drawn near other
 * arcs - a wash basin, a sink, a stair nosing - and position alone would let one of them
 * hand the door backwards.
 */
function handOf(swings: Swing[], frame: Frame, gap: Interval): "left" | "right" | undefined {
    const width = gap.hi - gap.lo;
    const tolerance = Math.max(width * 0.15, 25);

    for (const swing of swings) {
        if (Math.abs(swing.radiusMm - width) > tolerance) continue;
        const s = dot(swing.center, frame.along);
        if (Math.abs(s - gap.lo) <= tolerance) return "left";
        if (Math.abs(s - gap.hi) <= tolerance) return "right";
    }

    return undefined;
}
