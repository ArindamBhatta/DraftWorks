import { LENGTH_EPSILON } from "../units";

export interface Interval {
    lo: number;
    hi: number;
}

/**
 * `domain` minus `cuts`, as the maximal sub-intervals that survive. This is the whole
 * of the wall-face geometry: a face line is its domain broken by the doors and the
 * junctions that eat into it.
 *
 * Sub-intervals shorter than LENGTH_EPSILON are dropped - they appear whenever an
 * opening sits flush against a junction, and a zero-length line is a kernel error
 * rather than an invisible line.
 */
export function splitInterval(domain: Interval, cuts: Interval[]): Interval[] {
    const ordered = cuts
        .map((c) => ({ lo: Math.min(c.lo, c.hi), hi: Math.max(c.lo, c.hi) }))
        .filter((c) => c.hi > domain.lo && c.lo < domain.hi)
        .sort((a, b) => a.lo - b.lo);

    const pieces: Interval[] = [];
    let cursor = domain.lo;
    for (const cut of ordered) {
        if (cut.lo > cursor) pieces.push({ lo: cursor, hi: Math.min(cut.lo, domain.hi) });
        cursor = Math.max(cursor, cut.hi);
        if (cursor >= domain.hi) break;
    }
    if (cursor < domain.hi) pieces.push({ lo: cursor, hi: domain.hi });

    return pieces.filter((p) => p.hi - p.lo > LENGTH_EPSILON);
}

/**
 * Finds where to put an opening of `width` inside the free parts of `domain`, preferring
 * `preferred` as its centre. Returns the centre, or undefined when nothing fits.
 *
 * The preference is honoured exactly when it is free, and otherwise the opening slides
 * to the nearest position that clears - which is what keeps a window off a corner when
 * a door already occupies the middle of the wall.
 */
export function placeInFree(
    domain: Interval,
    cuts: Interval[],
    width: number,
    preferred: number,
): number | undefined {
    let best: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const free of splitInterval(domain, cuts)) {
        if (free.hi - free.lo < width - LENGTH_EPSILON) continue;
        const lo = free.lo + width / 2;
        const hi = free.hi - width / 2;
        const center = Math.min(Math.max(preferred, lo), hi);
        const distance = Math.abs(center - preferred);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = center;
        }
    }

    return best;
}

/** The interval an opening occupies along its wall. */
export function spanOf(opening: { centerMm: number; widthMm: number }): Interval {
    return { lo: opening.centerMm - opening.widthMm / 2, hi: opening.centerMm + opening.widthMm / 2 };
}
