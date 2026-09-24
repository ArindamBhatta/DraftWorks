// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GeometryUtils,
    type ICurve,
    type IDisposable,
    type IEdge,
    Precision,
    VisualConfig,
} from "@draftworks/core";
import {
    crossingsClearOfEnds,
    type EdgeChange,
    type EdgeContext,
    EndContactTolerance,
    extendChange,
    type ParameterRange,
    TrimExtendCommand,
    type TrimExtendPrompts,
} from "./trimExtendCommand";

/**
 * The picked edge's curve followed past both its own ends, as an edge of its own.
 *
 * OCCT only reports where two *bounded* edges meet, which is exactly what EXTEND does not
 * want to know: the boundary it is reaching for is, by definition, somewhere the edge does
 * not go yet. So the question is asked of a longer stand-in built on the same curve, and
 * the answers come back on the same parameters the edge itself is measured in - an edge
 * built from a trimmed curve is stored against the curve underneath it, so the two agree.
 *
 * How much longer is not a guess: `reach` is the diagonal of everything in play, so a
 * probe that long from either end passes through every boundary there is and stops. A
 * curve with ends of its own - a spline - is followed only as far as it is defined, which
 * is as far as EXTEND could honestly take it.
 *
 * A curve that closes on itself has no ends to run past. Its stand-in is the gap the edge
 * does not cover: the rest of the circle, from where the arc stops round to where it
 * starts again. An arc that has already closed has no gap and cannot be extended.
 */
function probeEdge(
    basis: ICurve,
    span: ParameterRange,
    period: number | undefined,
    reach: number,
    keep: (disposable: IDisposable) => void,
): IEdge | undefined {
    let range: ParameterRange;
    if (period !== undefined) {
        if (span.end - span.start >= period - Precision.Float) return undefined;
        range = { start: span.end, end: span.start + period };
    } else {
        range = {
            start: Math.max(span.start - reach, basis.firstParameter()),
            end: Math.min(span.end + reach, basis.lastParameter()),
        };
        if (range.end - range.start <= span.end - span.start + Precision.Float) return undefined;
    }

    const curve = basis.trim(range.start, range.end);
    keep(curve);
    const edge = shapeFactory.edge(curve);
    keep(edge);
    return edge;
}

/**
 * AutoCAD's EXTEND: click the end of an edge that stops short, and it runs on to the next
 * thing in its way.
 *
 * See TrimExtendCommand for the boundary phase the two commands share, and extendChange
 * for which end a click names and where it stops.
 */
@command({
    key: "modify.extend",
    // The icon set has no EXTEND of its own; the outward arrows are the nearest thing in
    // it to "make this longer", and read the right way round next to TRIM's.
    icon: "icon-expand-alt",
})
export class Extend extends TrimExtendCommand {
    protected override get prompts(): TrimExtendPrompts {
        return {
            label: "command.modify.extend",
            boundaries: "prompt.select.boundaryEdges",
            quickTarget: "prompt.select.objectToExtend.quick",
            standardTarget: "prompt.select.objectToExtend.standard",
            mode: "prompt.extend.mode",
        };
    }

    // An edge is extended precisely because the boundary is out of its reach, so nothing
    // narrower than the whole drawing will do for EXTEND's <Select All>.
    protected override get boundariesCrossTarget(): boolean {
        return false;
    }

    // Green, the app's colour for geometry that is not there yet: the stretch under the
    // cursor is the one the click will bring into being.
    protected override get previewColor(): number {
        return VisualConfig.extendPreviewColor;
    }

    protected override planEdge({
        basis,
        span,
        picked,
        period,
        boundaries,
        reach,
        keep,
    }: EdgeContext): EdgeChange | undefined {
        const probe = probeEdge(basis, span, period, reach, keep);
        if (!probe) return undefined;

        // A boundary an end already sits on is where that end stops now, not where it goes.
        const ends = [basis.value(span.start), basis.value(span.end)];
        const candidates = crossingsClearOfEnds(
            GeometryUtils.intersects(probe, boundaries),
            ends,
            Math.max(reach * EndContactTolerance, Precision.Distance),
        );
        return extendChange(span, picked, candidates, period);
    }
}
