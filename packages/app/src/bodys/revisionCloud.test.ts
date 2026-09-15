// REVCLOUD's geometry: how a picked path divides into scallops, and which way they bulge.
// cloudArcSpans is the whole of that decision, worked out without the kernel - what it
// returns is exactly what shapeFactory.arc is then called with.

import { XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { type CloudArcSpan, cloudArcSpans } from "./revisionCloud";

const at = (x: number, y: number, z = 0) => new XYZ({ x, y, z });
const Z = at(0, 0, 1);

/**
 * Sweeps a span the way shapeFactory.arc does - `start` turned about `center` by `angle`
 * degrees, counter-clockwise about the normal - and returns the point it reaches.
 *
 * The span is only ever a set of arguments to the kernel, so the tests have to do the
 * sweep themselves to see where the arc really lands. Without that they cannot tell a
 * correct scallop from one drawn the long way round, which is exactly the mistake that
 * leaves consecutive edges not meeting and the wire refusing to build.
 */
function sweep(span: CloudArcSpan, normal: XYZ): XYZ {
    const radial = span.start.sub(span.center);
    return span.center.add(radial.rotate(normal, (span.angle * Math.PI) / 180)!);
}

/** Where the arc reaches at its halfway point - the top of the bulge. */
function apex(span: CloudArcSpan, normal: XYZ): XYZ {
    return sweep({ ...span, angle: span.angle / 2 }, normal);
}

test("a run divides into whole arcs of near-nominal length, never a stub", () => {
    // 100 at a nominal 30 is 3.33 arcs, so three of 33.3 - not three of 30 and a 10.
    const spans = cloudArcSpans([at(0, 0, 0), at(100, 0, 0)], Z, 30);

    expect(spans.isOk).toBe(true);
    expect(spans.value.length).toBe(3);
});

test("the nominal length is rounded to, not floored", () => {
    // 100 at 26 is 3.85 arcs. Flooring would give three arcs of 33.3, well over nominal.
    const spans = cloudArcSpans([at(0, 0, 0), at(100, 0, 0)], Z, 26);

    expect(spans.value.length).toBe(4);
});

test("a run shorter than one nominal arc still gets a single scallop", () => {
    const spans = cloudArcSpans([at(0, 0, 0), at(5, 0, 0)], Z, 30);

    expect(spans.value.length).toBe(1);
});

test("each segment of the path divides on its own", () => {
    const spans = cloudArcSpans([at(0, 0, 0), at(60, 0, 0), at(60, 30, 0)], Z, 30);

    // Two arcs along the 60 run, one along the 30.
    expect(spans.value.length).toBe(3);
});

test("arcs are laid end to end, each starting where the last one finished", () => {
    const spans = cloudArcSpans([at(0, 0, 0), at(90, 0, 0)], Z, 30);

    expect(spans.value.length).toBe(3);
    expect(spans.value[0].start.x).toBeCloseTo(0);
    expect(spans.value[1].start.x).toBeCloseTo(30);
    expect(spans.value[2].start.x).toBeCloseTo(60);
});

test("a scallop starts and ends on its chord, sweeping a little over a quarter turn", () => {
    // The arc has to *land* on the far end of its chord. An arc of the right radius swept
    // the wrong way round is still a valid arc - it just ends somewhere else, and the
    // cloud then fails to build as a wire rather than merely looking wrong.
    const spans = cloudArcSpans([at(0, 0, 0), at(40, 0, 0)], Z, 40);
    const span = spans.value[0];
    const end = sweep(span, Z);

    expect(span.start.x).toBeCloseTo(0);
    expect(span.start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(40);
    expect(end.y).toBeCloseTo(0);
    expect(Math.abs(span.angle)).toBeGreaterThan(90);
    expect(Math.abs(span.angle)).toBeLessThan(100);
});

test("a scallop bulges left of its chord", () => {
    const spans = cloudArcSpans([at(0, 0, 0), at(40, 0, 0)], Z, 40);
    const span = spans.value[0];

    // Left of a +x chord about +z is +y: the arc rides above the chord, and its apex
    // stands off by the sagitta the bulge was built to.
    expect(apex(span, Z).y).toBeCloseTo(40 * 0.5 * 0.42);
});

test("consecutive scallops meet, so the cloud closes into a single wire", () => {
    // The failure this pins is not cosmetic: arcs that do not share endpoints cannot be
    // sewn into a wire at all, and the command fails outright.
    const path = [at(0, 0, 0), at(60, 0, 0), at(60, 40, 0), at(0, 40, 0), at(0, 0, 0)];
    const spans = cloudArcSpans(path, Z, 25);

    expect(spans.isOk).toBe(true);
    for (let i = 0; i < spans.value.length - 1; i++) {
        const end = sweep(spans.value[i], Z);
        const next = spans.value[i + 1].start;
        expect(end.distanceTo(next)).toBeCloseTo(0);
    }

    // And a closed path comes back to where it started.
    const last = sweep(spans.value.at(-1)!, Z);
    expect(last.distanceTo(spans.value[0].start)).toBeCloseTo(0);
});

test("every scallop has the same shape whatever its length", () => {
    // A long run and a short one divide into differently sized arcs; the roundness of
    // each - its swept angle - has to match, or the cloud looks uneven where they meet.
    const long = cloudArcSpans([at(0, 0, 0), at(100, 0, 0)], Z, 30);
    const short = cloudArcSpans([at(0, 0, 0), at(7, 0, 0)], Z, 30);

    expect(short.value[0].angle).toBeCloseTo(long.value[0].angle);
});

test("reversing the path flips which side the scallops fall on", () => {
    const forward = cloudArcSpans([at(0, 0, 0), at(40, 0, 0)], Z, 40);
    const backward = cloudArcSpans([at(40, 0, 0), at(0, 0, 0)], Z, 40);

    // Same chord walked the other way, so the bulges land on opposite sides of it. This
    // is what lets the command correct a clockwise pick by reversing the points, rather
    // than by flipping a sign somewhere in the geometry.
    expect(apex(forward.value[0], Z).y).toBeGreaterThan(0);
    expect(apex(backward.value[0], Z).y).toBeLessThan(0);
});

test("the cloud follows the workplane it was drawn on", () => {
    // Same path, but drawn on the XZ plane: the bulge has to stay in that plane rather
    // than always bulging in Y, and the arc still has to land on its chord.
    const spans = cloudArcSpans([at(0, 0, 0), at(40, 0, 0)], at(0, 1, 0), 40);
    const end = sweep(spans.value[0], at(0, 1, 0));

    expect(end.x).toBeCloseTo(40);
    expect(end.y).toBeCloseTo(0);
    expect(end.z).toBeCloseTo(0);
    expect(apex(spans.value[0], at(0, 1, 0)).y).toBeCloseTo(0);
    expect(spans.value[0].center.y).toBeCloseTo(0);
    expect(spans.value[0].center.z).not.toBeCloseTo(0);
});

test("a repeated pick contributes no arc rather than one of no length", () => {
    const spans = cloudArcSpans([at(0, 0, 0), at(0, 0, 0), at(40, 0, 0)], Z, 40);

    expect(spans.value.length).toBe(1);
});

test("a path with nothing to draw is refused rather than returning an empty cloud", () => {
    expect(cloudArcSpans([at(0, 0, 0)], Z, 30).isOk).toBe(false);
    expect(cloudArcSpans([at(0, 0, 0), at(0, 0, 0)], Z, 30).isOk).toBe(false);
});

test("a zero arc length cannot ask the kernel for an unbounded number of arcs", () => {
    const spans = cloudArcSpans([at(0, 0, 0), at(100, 0, 0)], Z, 0);

    expect(spans.isOk).toBe(true);
    expect(Number.isFinite(spans.value.length)).toBe(true);
    expect(spans.value.length).toBe(1000);
});
