// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A sheet as SVG, for the plot preview.
 *
 * The preview exists because a plot is the one operation whose result the user cannot undo
 * - the paper is spent - and because "fit to paper" and offsets are far easier to judge by
 * eye than by number. It renders the same `PlotSheet` the PDF does, so what it shows is not
 * an approximation of the plot; it is the plot, in a format a browser will draw directly.
 *
 * SVG's y axis runs down and the sheet's runs up, so every point is flipped here as it is
 * written. That is done per point rather than with an enclosing transform, because a global
 * flip would also mirror the glyphs and each text run would need its own counter-transform
 * to undo it.
 */

import { CAP_HEIGHT_RATIO, type PathCommand, type PlotSheet } from "./plotModel";

/** Millimetres, rounded to a resolution far finer than any printer. */
const mm = (value: number): string => {
    const fixed = value.toFixed(3);
    return fixed.replace(/\.?0+$/, "") || "0";
};

const escapeXml = (text: string): string =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PlotSvgOptions {
    /**
     * Draws the sheet edge and the printable boundary. Wanted in the dialog, where the
     * user is judging margins, and not in anything meant to be the drawing alone.
     */
    showSheet?: boolean;
}

export function plotToSvg(sheet: PlotSheet, options: PlotSvgOptions = {}): string {
    const flip = (y: number) => sheet.heightMm - y;
    const body: string[] = [];

    if (options.showSheet) {
        // Behind everything: the sheet itself, then a dashed line where the printer stops
        // being able to mark. Both are preview furniture and never reach the PDF.
        body.push(
            `<rect x="0" y="0" width="${mm(sheet.widthMm)}" height="${mm(sheet.heightMm)}" fill="#ffffff" stroke="#9aa0a6" stroke-width="0.2"/>`,
            `<rect x="${mm(sheet.printable.x)}" y="${mm(sheet.printable.y)}" width="${mm(sheet.printable.width)}" height="${mm(sheet.printable.height)}" fill="none" stroke="#c0c4c8" stroke-width="0.15" stroke-dasharray="1.5 1.5"/>`,
        );
    }

    for (const primitive of sheet.primitives) {
        if (primitive.kind === "text") {
            const size = primitive.heightMm / CAP_HEIGHT_RATIO;
            const x = mm(primitive.at.x);
            const y = mm(flip(primitive.at.y));
            // SVG rotates clockwise and the sheet's angles run counter-clockwise, so the
            // sign flips; the rotation centre is the baseline start, as DXF measures it.
            const rotate =
                primitive.rotation === 0 ? "" : ` transform="rotate(${mm(-primitive.rotation)} ${x} ${y})"`;
            body.push(
                `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${mm(size)}" fill="${primitive.color}"${rotate}>${escapeXml(primitive.content)}</text>`,
            );
            continue;
        }

        const d = pathData(primitive.commands, flip);
        if (d === "") continue;

        if (primitive.filled) {
            body.push(`<path d="${d}" fill="${primitive.color}" stroke="none"/>`);
        } else {
            // A hairline has no width to give, so it is drawn at the thinnest stroke that
            // still renders on screen rather than at 0, which some engines drop entirely.
            const width = primitive.widthMm > 0 ? primitive.widthMm : 0.05;
            body.push(
                `<path d="${d}" fill="none" stroke="${primitive.color}" stroke-width="${mm(width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
            );
        }
    }

    // The clip keeps anything past the printable edge out of the preview, so an overscaled
    // plot looks cut off here in the same way it will come out cut off on paper.
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(sheet.widthMm)}mm" height="${mm(sheet.heightMm)}mm" viewBox="0 0 ${mm(sheet.widthMm)} ${mm(sheet.heightMm)}">`,
        `<clipPath id="printable"><rect x="${mm(sheet.printable.x)}" y="${mm(flip(sheet.printable.y + sheet.printable.height))}" width="${mm(sheet.printable.width)}" height="${mm(sheet.printable.height)}"/></clipPath>`,
        options.showSheet ? body[0] : "",
        options.showSheet ? body[1] : "",
        `<g clip-path="url(#printable)">`,
        ...(options.showSheet ? body.slice(2) : body),
        `</g>`,
        `</svg>`,
    ]
        .filter((line) => line !== "")
        .join("\n");
}

function pathData(commands: PathCommand[], flip: (y: number) => number): string {
    const parts: string[] = [];
    for (const command of commands) {
        switch (command.type) {
            case "move":
                parts.push(`M${mm(command.to.x)} ${mm(flip(command.to.y))}`);
                break;
            case "line":
                parts.push(`L${mm(command.to.x)} ${mm(flip(command.to.y))}`);
                break;
            case "curve":
                parts.push(
                    `C${mm(command.c1.x)} ${mm(flip(command.c1.y))} ${mm(command.c2.x)} ${mm(flip(command.c2.y))} ${mm(command.to.x)} ${mm(flip(command.to.y))}`,
                );
                break;
            case "close":
                parts.push("Z");
                break;
        }
    }
    return parts.join(" ");
}
