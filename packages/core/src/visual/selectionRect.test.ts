// The rules behind AutoCAD's blue window and green crossing rectangles. The cases
// worth pinning down are the ones where a bounding box would give the wrong answer:
// a diagonal line whose box overlaps the rectangle it never touches, and a segment
// that passes clean through without either endpoint landing inside.

import { expect, test } from "@rstest/core";
import {
    doesSegmentTouchRect,
    doRectsOverlap,
    isBoxSelected,
    isPointInTriangle,
    isRectInsideRect,
    isSegmentInRect,
    rectSelectMode,
    screenRect,
} from "./selectionRect";

const box = screenRect(10, 10, 30, 30);

test("dragging right is a window, dragging left is a crossing", () => {
    expect(rectSelectMode(10, 100)).toBe("window");
    expect(rectSelectMode(100, 10)).toBe("crossing");
});

test("only the horizontal direction decides the mode", () => {
    // Same leftward drag, opposite vertical directions: both are crossings.
    expect(rectSelectMode(100, 10)).toBe("crossing");
    expect(rectSelectMode(100, 99)).toBe("crossing");
    // A drag with no horizontal travel encloses nothing either way.
    expect(rectSelectMode(50, 50)).toBe("window");
});

test("corners may be given in any order", () => {
    expect(screenRect(30, 30, 10, 10)).toEqual(box);
});

test("a segment passing clean through is touched but not enclosed", () => {
    // Enters the left edge, leaves the right edge; neither endpoint is inside.
    expect(doesSegmentTouchRect(box, 0, 20, 40, 20)).toBe(true);
    expect(isSegmentInRect(box, 0, 20, 40, 20)).toBe(false);
});

test("a segment wholly inside counts under both tests", () => {
    expect(doesSegmentTouchRect(box, 15, 15, 25, 25)).toBe(true);
    expect(isSegmentInRect(box, 15, 15, 25, 25)).toBe(true);
});

test("one endpoint inside is a crossing but not a window", () => {
    expect(doesSegmentTouchRect(box, 20, 20, 100, 100)).toBe(true);
    expect(isSegmentInRect(box, 20, 20, 100, 100)).toBe(false);
});

test("a diagonal that misses is rejected even though its box swallows the rectangle", () => {
    // A long diagonal well past the far corner. Its bounding box covers the whole
    // rectangle, so this is precisely the case a box-only crossing test gets wrong -
    // and the reason the renderer walks real line segments for a crossing.
    const missing = { x1: 0, y1: 100, x2: 100, y2: 0 };
    expect(doRectsOverlap(screenRect(missing.x1, missing.y1, missing.x2, missing.y2), box)).toBe(true);
    expect(doesSegmentTouchRect(box, missing.x1, missing.y1, missing.x2, missing.y2)).toBe(false);

    // The same diagonal moved in until it really does cut the corner.
    expect(doesSegmentTouchRect(box, 0, 40, 40, 0)).toBe(true);
});

test("a segment running along an edge still touches", () => {
    expect(doesSegmentTouchRect(box, 0, 10, 40, 10)).toBe(true);
    expect(doesSegmentTouchRect(box, 0, 9, 40, 9)).toBe(false);
});

test("a zero-length segment behaves like the point it is", () => {
    expect(doesSegmentTouchRect(box, 20, 20, 20, 20)).toBe(true);
    expect(doesSegmentTouchRect(box, 5, 5, 5, 5)).toBe(false);
});

test("a window takes only what it encloses, a crossing takes what it meets", () => {
    const enclosed = screenRect(12, 12, 20, 20);
    const straddling = screenRect(20, 20, 100, 100);
    const distant = screenRect(60, 60, 80, 80);

    expect(isBoxSelected("window", enclosed, box)).toBe(true);
    expect(isBoxSelected("crossing", enclosed, box)).toBe(true);

    expect(isBoxSelected("window", straddling, box)).toBe(false);
    expect(isBoxSelected("crossing", straddling, box)).toBe(true);

    expect(isBoxSelected("window", distant, box)).toBe(false);
    expect(isBoxSelected("crossing", distant, box)).toBe(false);
});

test("a rectangle contains itself", () => {
    expect(isRectInsideRect(box, box)).toBe(true);
    expect(doRectsOverlap(box, box)).toBe(true);
});

test("a crossing box dropped inside a filled triangle is standing on it", () => {
    // No triangle edge is crossed - the whole rectangle sits in the interior, which
    // is how a small green box in the middle of a hatch still picks the hatch up.
    expect(isPointInTriangle(box.minX, box.minY, 0, 0, 100, 0, 50, 100)).toBe(true);
    expect(isPointInTriangle(0, 99, 0, 0, 100, 0, 50, 100)).toBe(false);
});

test("point-in-triangle does not depend on winding", () => {
    expect(isPointInTriangle(50, 10, 0, 0, 100, 0, 50, 100)).toBe(true);
    expect(isPointInTriangle(50, 10, 50, 100, 100, 0, 0, 0)).toBe(true);
});
