import type { CommandKeys } from "./commandKeys";

type ShortcutMap = Partial<Record<CommandKeys, string | string[]>>;

/**
 * The single keyboard map for the app. This used to be one map per 3D CAD vendor
 * (Chili3d/Revit/Blender/Creo/Solidworks), selected by the "3D Navigation" setting -
 * both the setting and the alternate profiles are gone along with the rest of the 3D
 * feature set, and so are the shortcuts that drove 3D primitives (box, sphere,
 * cylinder, cone, pipe, extrude) and 3D booleans.
 *
 * What is left is deliberately only modifier combinations and non-typing keys. The
 * plain single letters that used to live here (L line, C circle, O offset, M move,
 * T trim, ...) moved to commandAliases.ts, because a letter cannot both fire a command
 * the instant it is pressed and be typed into the command line - and the command line
 * is how commands are entered now (see packages/ui/src/commandLine). Nothing was lost:
 * every one of those letters is still the command's alias, it just wants Enter after
 * it, exactly as in AutoCAD.
 */
export const DefaultShortcuts: ShortcutMap = {
    // System
    "doc.save": "ctrl+s",
    "doc.open": "ctrl+o",
    "edit.undo": "ctrl+z",
    "edit.redo": ["ctrl+y", "ctrl+shift+z"],
    "modify.deleteNode": ["Delete", "Backspace"],
    "special.last": [" ", "Enter"],

    // Modify. Kept as shortcuts as well as aliases because a modifier combination is
    // unambiguous while the command line has focus.
    "modify.rotate": "shift+r",
    "modify.array": "shift+a",
    "modify.chamfer": "shift+c",
    "modify.fillet": "shift+f",
};
