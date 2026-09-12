// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DimensionSetup, UnitSetup } from "@draftworks/core";
import { promptDimensionSetup } from "./dimensionSetupCommand";
import { promptUnitSetup } from "./unitSetupCommand";

/**
 * AutoCAD's new-drawing question sequence, run back to back: units, then dimension
 * style. Each prompt resolves on Confirm *and* on Cancel, so cancelling one step still
 * moves to the next and the whole chain always finishes - the caller is handing over a
 * usable blank drawing either way, not gating on the answers.
 *
 * A third step, MVSETUP (plot scale and sheet size), used to run after these two. It was
 * removed because nothing in the app read what it collected - see MvSetup in
 * core/foundation/unitSetup/drawingSetup.ts, which is kept as groundwork for plotting but
 * has no UI. Put the step back only once something downstream consumes those settings.
 *
 * Used both when a new document is created (NewDocument) and once at start-up, where
 * the app now opens straight into a blank drawing instead of a welcome screen.
 */
export async function promptDrawingSetup(): Promise<void> {
    await promptUnitSetup();
    await promptDimensionSetup();
}

/**
 * The start-up variant: ask only on a genuine first run.
 *
 * Both settings blocks now persist, so a returning user has already answered these
 * questions and being asked again on every reload is just an obstacle between them and
 * their drawing. Explicitly creating a *new* drawing still runs the full flow
 * (NewDocument), and both dialogs stay on the ribbon under UN and the dimension button.
 */
export async function promptDrawingSetupIfFirstRun(): Promise<void> {
    if (UnitSetup.isRestored && DimensionSetup.isRestored) return;

    await promptDrawingSetup();

    // Persist whatever we ended up with, including the untouched defaults. Both dialogs
    // only write on Confirm, so without this a user who dismissed them would be asked
    // again on every single launch - "asked once" has to mean once, not once per Confirm.
    UnitSetup.configure(UnitSetup.settings);
    DimensionSetup.configure(DimensionSetup.settings);
}
