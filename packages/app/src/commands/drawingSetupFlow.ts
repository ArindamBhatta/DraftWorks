// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { promptDimensionSetup } from "./dimensionSetupCommand";
import { promptMvSetup } from "./mvSetupCommand";
import { promptUnitSetup } from "./unitSetupCommand";

/**
 * AutoCAD's new-drawing question sequence, run back to back: units, then dimension
 * style, then MVSETUP. Each prompt resolves on Confirm *and* on Cancel, so cancelling
 * one step still moves to the next and the whole chain always finishes - the caller is
 * handing over a usable blank drawing either way, not gating on the answers.
 *
 * Used both when a new document is created (NewDocument) and once at start-up, where
 * the app now opens straight into a blank drawing instead of a welcome screen.
 */
export async function promptDrawingSetup(): Promise<void> {
    await promptUnitSetup();
    await promptDimensionSetup();
    await promptMvSetup();
}
