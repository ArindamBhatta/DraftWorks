// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, hideCommandProperty } from "@chili3d/core";
import { PlacementCommand, type PlacementPrompts } from "./placementCommand";

/**
 * AutoCAD's MOVE:
 *
 *     Select objects:                                   (pickbox, Enter to finish)
 *     Specify base point or [Displacement] <Displacement>:
 *     Specify second point or <use first point as displacement>:
 *
 * The selection phase is inherited from TransformedCommand - it shows the bare pickbox
 * cursor, since at that prompt you are picking objects rather than aiming at a point.
 *
 * MOVE moves. It used to carry a Clone checkbox in the command bar, which made it a
 * second, worse COPY: same picks, different place to look for the switch, and no sign
 * of it at the prompt where you were already typing. That is gone - see
 * PlacementCommand, which MOVE and COPY now share, with cloning off here and on there.
 *
 * Displacement is the one option MOVE offers, and it changes what the *next* pick means
 * rather than how objects are chosen: instead of "from here to there", the point you
 * give is read as the shift itself, measured from the origin. Entering `10,0` in
 * displacement mode moves the selection ten units along x wherever it happens to sit,
 * which is how a draftsman nudges something by an exact amount without needing a
 * feature on the drawing to measure from. Enter at the base-point prompt takes that
 * default, and Enter at the second-point prompt reads the base point the same way.
 *
 * Single/Multiple stays with COPY, where it earns its keep. MOVE is always single: the
 * objects can only be in one place, so there is no second answer to ask for.
 */
@command({
    key: "modify.move",
    icon: "icon-move",
})
export class Move extends PlacementCommand {
    protected override get prompts(): PlacementPrompts {
        return {
            basePoint: "prompt.move.basePoint",
            secondPoint: "prompt.move.secondPoint",
            displacement: "prompt.move.displacement",
        };
    }
}

// No mOde prompt here, so the dropdown that mirrors it has nothing to say either.
hideCommandProperty(Move.prototype, ["placementMode"]);
