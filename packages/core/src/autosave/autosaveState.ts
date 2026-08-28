// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";

/**
 * What the save indicator beside the drawing name is currently saying, modelled on the
 * one Google Drive puts beside a document title.
 *
 * `idle` is the state a drawing opens in: nothing has been edited, so there is nothing
 * to claim about it and the indicator renders blank. Saying "All changes saved" about a
 * drawing that was never saved would be a lie the user has no way to check.
 */
export type AutosaveState =
    /** Untouched since it was opened - the indicator shows nothing. */
    | "idle"
    /** Edited, waiting out the debounce window before the write starts. */
    | "pending"
    /** A write is in flight. */
    | "saving"
    /** Local store is current, and the remote is too (or there is no remote). */
    | "saved"
    /** Local store is current; the remote could not be reached and the change is queued. */
    | "offline"
    /** The local write itself failed. The work is only in memory - the loud case. */
    | "error";

const LABELS: Record<AutosaveState, I18nKeys | undefined> = {
    idle: undefined,
    pending: "autosave.pending",
    saving: "autosave.saving",
    saved: "autosave.saved",
    offline: "autosave.offline",
    error: "autosave.error",
};

/** The i18n key for a state, or undefined when the indicator should render nothing. */
export function autosaveStateLabel(state: AutosaveState): I18nKeys | undefined {
    return LABELS[state];
}
