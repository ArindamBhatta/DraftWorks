// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type I18nKeys } from "@draftworks/core";
import { PlacementCommand, PlacementModes, type PlacementPrompts } from "./placementCommand";

/**
 * AutoCAD's COPY:
 *
 *     Select objects:
 *     Specify base point or [Displacement/mOde] <Displacement>:
 *     Specify second point or [Array] <use first point as displacement>:
 *     Specify second point or [Array/Exit/Undo] <Exit>:
 *
 * The same command as MOVE with the originals left behind, which is why the two share
 * PlacementCommand. This used to be a stub whose transform threw, so the button did
 * nothing but raise an error - the copying anyone actually did was MOVE's Clone
 * checkbox. That checkbox is gone and this is the command that does the job.
 *
 * Multiple is the default here, as AutoCAD's COPYMODE has it: the base point stays put
 * and every further pick drops another copy at its own offset from it, so laying out a
 * row of the same object is one command rather than one command per object. Enter or
 * Escape at the second-point prompt ends the run.
 */
@command({
    key: "modify.copy",
    icon: "icon-copy",
})
export class Copy extends PlacementCommand {
    /**
     * A COPY that did not copy would just be MOVE, so this flips PlacementCommand's
     * default and nothing offers to flip it back.
     */
    override get isClone() {
        return this.getPrivateValue("isClone", true);
    }
    override set isClone(value: boolean) {
        this.setProperty("isClone", value);
    }

    protected override get defaultPlacementMode(): I18nKeys {
        return PlacementModes.multiple;
    }

    protected override get prompts(): PlacementPrompts {
        return {
            basePoint: "prompt.copy.basePoint",
            secondPoint: "prompt.copy.secondPoint",
            displacement: "prompt.copy.displacement",
            mode: "prompt.copy.mode",
        };
    }
}
