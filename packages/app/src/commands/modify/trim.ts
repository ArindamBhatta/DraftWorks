// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, GeometryUtils, VisualConfig } from "@draftworks/core";
import {
    type EdgeChange,
    type EdgeContext,
    TrimExtendCommand,
    type TrimExtendPrompts,
    trimChange,
} from "./trimExtendCommand";

/**
 * AutoCAD's TRIM: click the part of an edge you want gone, and it goes back to the
 * nearest thing crossing it on either side.
 *
 * See TrimExtendCommand for the boundary phase the two commands share, and trimChange
 * for which piece a click actually names.
 */
@command({
    key: "modify.trim",
    icon: "icon-trim",
})
export class Trim extends TrimExtendCommand {
    protected override get prompts(): TrimExtendPrompts {
        return {
            label: "command.modify.trim",
            boundaries: "prompt.select.cuttingEdges",
            quickTarget: "prompt.select.objectToTrim.quick",
            standardTarget: "prompt.select.objectToTrim.standard",
            mode: "prompt.trim.mode",
        };
    }

    // Nothing can cut an edge without crossing it, so TRIM's <Select All> need only look
    // at what the edge's own extent touches.
    protected override get boundariesCrossTarget(): boolean {
        return true;
    }

    // Red: the stretch under the cursor is the one that will stop existing.
    protected override get previewColor(): number {
        return VisualConfig.trimPreviewColor;
    }

    protected override planEdge({ edge, span, picked, boundaries }: EdgeContext): EdgeChange | undefined {
        const crossings = GeometryUtils.intersects(edge, boundaries).map((x) => x.parameter);
        // The edge's own ends count as crossings: they are where the outermost pieces
        // stop, and including them means a pick anywhere on the edge falls inside the
        // list rather than off the end of it.
        const intersections = Array.from(new Set([...crossings, span.start, span.end])).sort((a, b) => a - b);
        return trimChange(intersections, picked);
    }
}
