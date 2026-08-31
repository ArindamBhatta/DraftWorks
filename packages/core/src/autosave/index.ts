// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * AUTOSAVE - Debounced Background Persistence
 *
 * Saves the open drawing to IndexedDB a couple of seconds after the user stops editing,
 * and shows what it is doing beside the drawing name the way Google Drive does.
 *
 * The pieces:
 * - autosaveService:   subscribes to `documentDirty`, one scheduler per open drawing
 * - autosaveScheduler: the debounce, the never-block rule, and the state machine
 * - autosaveStore:     the IndexedDB slots, including the previous-version fallback
 * - autosaveRemote:    the seam a collaboration server would plug into (none ships here)
 * - autosaveState:     the states the indicator renders
 *
 * The change signal comes from History (see foundation/history.ts), so autosave triggers
 * on exactly the edits that undo knows about - not on a parallel change detector that
 * could disagree with it.
 */

export * from "./autosaveRemote";
export * from "./autosaveScheduler";
export * from "./autosaveService";
export * from "./autosaveState";
export * from "./autosaveStore";
