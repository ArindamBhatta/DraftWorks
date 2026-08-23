/**
 * How a text annotation's content breaks into lines, and roughly how much room it
 * takes on the drawing.
 *
 * "Roughly" is the honest word: the glyphs are drawn by the browser from a proportional
 * font, so the only exact width is the one the DOM reports after layout. This module is
 * what the model can compute on its own without a renderer - it drives the node's
 * bounding box (zoom-to-fit, crossing selection) and seeds the pick target before the
 * first measurement comes back. The renderer replaces the estimate with the measured
 * size once it has one.
 */

/** Mean glyph advance as a fraction of text height, for a typical sans-serif face. */
const AVERAGE_GLYPH_RATIO = 0.55;

/** Baseline-to-baseline spacing as a multiple of text height - AutoCAD's default. */
export const LINE_SPACING = 1.5;

export interface TextLayout {
    /** The content broken into displayed lines, after wrapping. */
    lines: string[];
    /** Estimated width of the widest line, in drawing units. */
    width: number;
    /** Total height of the block, in drawing units. */
    height: number;
    /** Baseline-to-baseline distance, in drawing units. */
    lineHeight: number;
}

/**
 * Breaks `content` into lines and estimates the block's extents.
 *
 * `boxWidth` of 0 means "no wrapping" - single-line TEXT. Anything larger wraps on word
 * boundaries at that width, which is what MTEXT's picked box does. A word longer than
 * the box is left to overflow rather than being cut mid-word; the browser will do the
 * same thing when it renders.
 */
export function layoutText(content: string, textHeight: number, boxWidth = 0): TextLayout {
    const lineHeight = textHeight * LINE_SPACING;
    const glyphWidth = textHeight * AVERAGE_GLYPH_RATIO;
    const paragraphs = content.split("\n");

    const lines =
        boxWidth > glyphWidth
            ? paragraphs.flatMap((p) => wrap(p, Math.max(1, Math.floor(boxWidth / glyphWidth))))
            : paragraphs;

    const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
    return {
        lines,
        width: boxWidth > glyphWidth ? boxWidth : longest * glyphWidth,
        height: Math.max(1, lines.length) * lineHeight,
        lineHeight,
    };
}

function wrap(paragraph: string, maxChars: number): string[] {
    if (paragraph.length <= maxChars) return [paragraph];

    const lines: string[] = [];
    let current = "";
    for (const word of paragraph.split(" ")) {
        if (current === "") {
            current = word;
        } else if (current.length + 1 + word.length <= maxChars) {
            current += ` ${word}`;
        } else {
            lines.push(current);
            current = word;
        }
    }
    lines.push(current);
    return lines;
}
