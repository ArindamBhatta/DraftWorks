import type { CommandKeys } from "./commandKeys";

/**
 * What you can type at the command line, keyed by the command it runs.
 *
 * The aliases are AutoCAD's own wherever this app has the matching command (L, C, REC,
 * O, TR, M, RO, MI, AR, F, CHA, X, DT, T, DLI, ...), because that is the muscle memory
 * a student arrives with - the point of a command line is that what you already know
 * works. The first alias in each list is the short form shown in the suggestion list.
 *
 * The full command key ("create.line") is always accepted too, so every command is
 * reachable whether or not it has an alias here.
 */
export const CommandAliases: Partial<Record<CommandKeys, string[]>> = {
    // Draw
    "create.line": ["l", "line"],
    // "r" is not AutoCAD's (there it is REDRAW, which this app has no need of), but it
    // was this app's instant shortcut for rectangle before the command line existed.
    "create.rect": ["rec", "r", "rectang", "rectangle"],
    "create.circle": ["c", "circle"],
    "create.ellipse": ["el", "ellipse"],
    "create.arc": ["a", "arc"],
    "create.arc2point": ["a2", "arc2"],
    "create.arc3point": ["a3", "arc3"],
    "create.polygon": ["pl", "pline", "polyline"],
    "create.regularPolygon": ["pol", "polygon"],
    "create.bezier": ["spl", "spline", "bezier"],
    "create.hatch": ["h", "bh", "hatch", "bhatch"],
    "create.point": ["po", "point"],
    "create.text": ["dt", "text", "dtext"],
    "create.mtext": ["t", "mt", "mtext"],

    // Modify
    "modify.move": ["m", "move"],
    "modify.rotate": ["ro", "rotate"],
    "modify.mirror": ["mi", "mirror"],
    "modify.array": ["ar", "array"],
    "modify.trim": ["tr", "trim"],
    "modify.split": ["sp", "split"],
    "modify.break": ["br", "break"],
    "modify.fillet": ["f", "fillet"],
    "modify.chamfer": ["cha", "chamfer"],
    "modify.explode": ["x", "explode"],
    // AutoCAD's four ways of saying PROPERTIES, all of which open the same palette.
    "modify.properties": ["pr", "ch", "mo", "props", "properties", "ddmodify"],
    "modify.deleteNode": ["e", "erase", "del", "delete"],
    "create.offset": ["o", "off", "offset"],
    "create.copyShape": ["co", "cp", "copy"],
    "create.group": ["g", "group"],
    "create.folder": ["fo", "folder"],

    // Annotation and measurement
    "dimension.object": ["dim", "dimension"],
    "dimension.linear": ["dli", "dimlinear"],
    "dimension.aligned": ["dal", "dimaligned"],
    "dimension.radius": ["dra", "dimradius"],
    "dimension.diameter": ["ddi", "dimdiameter"],
    "dimension.angular": ["dan", "dimangular"],
    "dimension.setup": ["d", "dimstyle", "dimsetup"],
    "measure.length": ["di", "dist", "distance"],
    "measure.angle": ["ang", "angle"],
    "measure.select": ["li", "list"],

    // Document, view and settings
    "doc.new": ["new"],
    "doc.open": ["open"],
    "doc.save": ["save", "qsave"],
    "doc.saveToFile": ["saveas"],
    "file.import": ["imp", "import", "insert"],
    "file.export": ["exp", "export"],
    "edit.undo": ["u", "undo"],
    "edit.redo": ["red", "redo"],
    "view.pan": ["p", "pan"],
    "units.setup": ["un", "units", "ddunits"],
    "mv.setup": ["mvs", "mvsetup"],
    "layer.moveToCurrent": ["laymcur", "movetolayer"],
    "layer.setup": ["la", "layer", "ddlmodes"],
    "convert.toWire": ["towire"],
    "convert.toFace": ["toface"],
    "modify.checkShape": ["checkshape"],
    "modify.repairShape": ["repair"],
    "modify.simplifyShape": ["simplify"],
};

export interface CommandAliasMatch {
    command: CommandKeys;
    /** The alias that matched, or the command key when nothing shorter did. */
    alias: string;
}

const normalize = (text: string) => text.trim().toLowerCase();

let exactLookup: Map<string, CommandKeys> | undefined;

/** alias -> command, built once. Earlier entries win, so no alias is ever ambiguous. */
function lookup(): Map<string, CommandKeys> {
    if (exactLookup) return exactLookup;

    exactLookup = new Map<string, CommandKeys>();
    for (const [command, aliases] of Object.entries(CommandAliases)) {
        exactLookup.set(command.toLowerCase(), command as CommandKeys);
        for (const alias of aliases as string[]) {
            if (!exactLookup.has(alias)) exactLookup.set(alias, command as CommandKeys);
        }
    }
    return exactLookup;
}

/** The command an exactly-typed alias or command key runs, if any. */
export function findCommandByAlias(text: string): CommandKeys | undefined {
    const key = normalize(text);
    if (!key) return undefined;
    return lookup().get(key);
}

/**
 * Aliases starting with what has been typed so far, for the suggestion list. Sorted
 * shortest-first so `l` offers LINE before LAYMCUR, and an exact match always leads.
 */
export function findCommandSuggestions(text: string, limit = 8): CommandAliasMatch[] {
    const prefix = normalize(text);
    if (!prefix) return [];

    const seen = new Set<CommandKeys>();
    const matches: CommandAliasMatch[] = [];
    for (const [alias, command] of lookup()) {
        if (!alias.startsWith(prefix) || seen.has(command)) continue;
        seen.add(command);
        matches.push({ command, alias });
    }

    matches.sort((a, b) => {
        if (a.alias === prefix) return -1;
        if (b.alias === prefix) return 1;
        return a.alias.length - b.alias.length || a.alias.localeCompare(b.alias);
    });
    return matches.slice(0, limit);
}
