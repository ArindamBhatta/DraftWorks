// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A sheet as a PDF file.
 *
 * Written here rather than taken from a library for the same reason the DXF codec is:
 * what a plot needs from PDF is a small, closed set - a page of a stated size, stroked and
 * filled paths, and single-line text in one font - and that is a couple of hundred lines of
 * a well-documented format. A PDF library brings a font subsetter, an image pipeline and an
 * object model for a document we are not building, and it would have to be kept current.
 *
 * The structure is the minimum a conforming reader needs: catalog, page tree, one page, one
 * content stream, one font. Content streams are uncompressed - Flate would need a deflate
 * implementation or an async CompressionStream, and a plot is paths and short strings, which
 * compress well in transit and are not usually kept.
 *
 * PDF user space is points, 1/72 inch, with the origin at the bottom-left of the page and y
 * running up - which is why `PlotSheet` uses that convention, so nothing has to be flipped
 * here. Millimetres are converted on the way out and nowhere else.
 */

import { CAP_HEIGHT_RATIO, type PathCommand, type PlotSheet } from "./plotModel";

const PT_PER_MM = 72 / 25.4;

/** The only font used. One of PDF's fourteen standard faces, so nothing is embedded. */
const BASE_FONT = "Helvetica";

export interface PlotPdfResult {
    bytes: Uint8Array<ArrayBuffer>;
    /**
     * Characters that WinAnsiEncoding cannot represent, deduplicated and in the order met.
     *
     * Empty for any Western drawing. Non-empty means the base-14 font could not carry some
     * of the drawing's text - Greek, Cyrillic, CJK - and those characters were dropped. The
     * caller is expected to tell the user rather than let them find it on the paper: fixing
     * it properly means embedding a subset of a Unicode font, which is a larger job than
     * this writer.
     */
    unsupportedCharacters: string[];
}

export function plotToPdf(sheet: PlotSheet, title?: string): PlotPdfResult {
    const unsupported = new Set<string>();
    const content = contentStream(sheet, unsupported);

    const objects: string[] = [
        `<< /Type /Catalog /Pages 2 0 R >>`,
        `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(sheet.widthMm)} ${pt(sheet.heightMm)}] ` +
            `/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
        `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
        `<< /Type /Font /Subtype /Type1 /BaseFont /${BASE_FONT} /Encoding /WinAnsiEncoding >>`,
        `<< /Producer (DraftWorks) ${title ? `/Title (${escapeString(title, unsupported)})` : ""} >>`,
    ];

    return { bytes: assemble(objects), unsupportedCharacters: [...unsupported] };
}

/** Millimetres as PDF points, trimmed - PDF reals need no more than this. */
const pt = (value: number): string => {
    const fixed = (value * PT_PER_MM).toFixed(4);
    const trimmed = fixed.replace(/\.?0+$/, "");
    return trimmed === "" || trimmed === "-" ? "0" : trimmed;
};

/** A colour channel as PDF's 0..1 real. */
const channel = (byte: number): string => {
    const fixed = (byte / 255).toFixed(4);
    return fixed.replace(/\.?0+$/, "") || "0";
};

function colorOperands(hex: string): string {
    const value = Number.parseInt(hex.slice(1), 16);
    const r = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    return `${channel(r)} ${channel(g)} ${channel(b)}`;
}

function contentStream(sheet: PlotSheet, unsupported: Set<string>): string {
    const out: string[] = [];

    // Everything is drawn inside one clip to the printable area, so an overscaled plot is
    // cut at the margin instead of running off the page edge. `W n` sets the clip from the
    // current path without painting it.
    out.push("q");
    out.push(
        `${pt(sheet.printable.x)} ${pt(sheet.printable.y)} ${pt(sheet.printable.width)} ${pt(sheet.printable.height)} re W n`,
    );

    // Round caps and joins, which is what a pen plotter does and what the preview shows.
    out.push("1 J 1 j");

    let currentStroke = "";
    let currentFill = "";
    let currentWidth = -1;

    for (const primitive of sheet.primitives) {
        if (primitive.kind === "text") {
            const encoded = escapeString(primitive.content, unsupported);
            if (encoded === "") continue;

            const fill = colorOperands(primitive.color);
            if (fill !== currentFill) {
                out.push(`${fill} rg`);
                currentFill = fill;
            }

            const size = primitive.heightMm / CAP_HEIGHT_RATIO;
            const radians = (primitive.rotation * Math.PI) / 180;
            const cos = Math.cos(radians).toFixed(6);
            const sin = Math.sin(radians).toFixed(6);

            // Tm is the text matrix: rotation in the top four numbers, position in the last
            // two. Set per run rather than accumulated, so one run cannot displace the next.
            out.push(
                `BT /F1 ${pt(size)} Tf ${cos} ${sin} ${-Number(sin)} ${cos} ${pt(primitive.at.x)} ${pt(primitive.at.y)} Tm (${encoded}) Tj ET`,
            );
            continue;
        }

        const path = pathOperators(primitive.commands);
        if (path === "") continue;

        if (primitive.filled) {
            const fill = colorOperands(primitive.color);
            if (fill !== currentFill) {
                out.push(`${fill} rg`);
                currentFill = fill;
            }
            out.push(`${path} f`);
            continue;
        }

        const stroke = colorOperands(primitive.color);
        if (stroke !== currentStroke) {
            out.push(`${stroke} RG`);
            currentStroke = stroke;
        }
        // A zero width is PDF's own hairline: the thinnest line the device can render.
        const width = primitive.widthMm > 0 ? primitive.widthMm : 0;
        if (width !== currentWidth) {
            out.push(`${pt(width)} w`);
            currentWidth = width;
        }
        out.push(`${path} S`);
    }

    out.push("Q");
    return out.join("\n");
}

function pathOperators(commands: PathCommand[]): string {
    const parts: string[] = [];
    for (const command of commands) {
        switch (command.type) {
            case "move":
                parts.push(`${pt(command.to.x)} ${pt(command.to.y)} m`);
                break;
            case "line":
                parts.push(`${pt(command.to.x)} ${pt(command.to.y)} l`);
                break;
            case "curve":
                parts.push(
                    `${pt(command.c1.x)} ${pt(command.c1.y)} ${pt(command.c2.x)} ${pt(command.c2.y)} ${pt(command.to.x)} ${pt(command.to.y)} c`,
                );
                break;
            case "close":
                parts.push("h");
                break;
        }
    }
    return parts.join(" ");
}

/**
 * A PDF literal string: parentheses and backslashes escaped, and everything outside
 * printable ASCII written as an octal byte.
 *
 * WinAnsiEncoding is Latin-1 with a handful of substitutions in 0x80-0x9F, so codepoints up
 * to 0xFF map to themselves closely enough for drawing text. Anything above that has no byte
 * in this encoding; it is recorded and dropped rather than replaced with a wrong glyph,
 * because a silent substitution on a drawing is worse than a visible gap.
 */
function escapeString(text: string, unsupported: Set<string>): string {
    let out = "";
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;

        if (code > 0xff) {
            unsupported.add(character);
            continue;
        }
        if (character === "(" || character === ")" || character === "\\") {
            out += `\\${character}`;
        } else if (code < 0x20 || code > 0x7e) {
            out += `\\${code.toString(8).padStart(3, "0")}`;
        } else {
            out += character;
        }
    }
    return out;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Wraps the objects in a file: header, numbered bodies, a cross-reference table of their
 * byte offsets, and the trailer.
 *
 * The offsets are why this is assembled in one pass over the encoded bytes rather than by
 * joining strings - an xref entry that is off by one byte makes the whole file unreadable,
 * and a multi-byte character anywhere earlier would do exactly that if lengths were counted
 * in JavaScript string units.
 */
function assemble(objects: string[]): Uint8Array<ArrayBuffer> {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let offset = 0;

    const push = (text: string) => {
        const bytes = encoder.encode(text);
        chunks.push(bytes);
        offset += bytes.length;
    };

    // The binary comment on line two tells anything transferring the file to treat it as
    // binary rather than text, which is what stops a transport from rewriting line endings.
    push("%PDF-1.7\n%âãÏÓ\n");

    const offsets: number[] = [];
    objects.forEach((body, index) => {
        offsets.push(offset);
        push(`${index + 1} 0 obj\n${body}\nendobj\n`);
    });

    const xrefOffset = offset;
    const count = objects.length + 1;

    // Every entry is exactly twenty bytes, including the trailing space before the newline.
    // Readers are entitled to index the table arithmetically, so the padding is structural.
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (const entry of offsets) {
        xref += `${entry.toString().padStart(10, "0")} 00000 n \n`;
    }
    push(xref);
    push(
        `trailer\n<< /Size ${count} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
    }
    return bytes;
}
