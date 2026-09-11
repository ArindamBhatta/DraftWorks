/**
 * The four kinds of drawing the panel offers, one per tab.
 *
 * A mode is a posture, not a filter over one catalogue. The three technical modes produce
 * drawings somebody builds from, so they ask what is missing before anything reaches the
 * canvas and their geometry is expected to survive the trip out to DXF. The freehand mode
 * is the deliberate opposite: drawn on the first turn, never dimensioned, never asked
 * about - recognisable is the whole ask.
 */
export const DRAWING_MODES = ["architectural", "structural", "mechanical", "random"] as const;

export type DrawingMode = (typeof DRAWING_MODES)[number];

export interface DrawingModeInfo {
    /** Shown on the tab, and named to the model so it knows which mode it is answering in. */
    title: string;
    /** For the model: what belongs in this mode. */
    brief: string;
    /** Example phrasings, shown in the panel and when a request is declined. */
    examples: string[];
    /**
     * Whether this produces a drawing someone builds from. Technical modes ask before they
     * draw and say so when geometry came from the model rather than a generator; the
     * freehand mode does neither, because neither would be worth the turn.
     */
    technical: boolean;
}

export const DRAWING_MODE_INFO: Record<DrawingMode, DrawingModeInfo> = {
    architectural: {
        title: "Architectural",
        brief:
            "Civil and architectural drawings: floor plans, layouts, elevations, sections and site " +
            "plans, for buildings and the spaces inside them. Residential or not - a gym, a shop, " +
            "an office and a clinic are all architectural layouts.",
        examples: [
            "I have a 30x40 plot, give me a 2BHK plan",
            "3BHK flat on a 40 by 60 site, entry from the south",
            "layout for a women's gym, 12m x 18m",
        ],
        technical: true,
    },
    structural: {
        title: "Structural",
        brief:
            "Structural drawings and details: piles, pile caps, footings, columns, beams, slabs, " +
            "reinforcement and stirrup layouts, bar bending and section details.",
        examples: [
            "400 dia 12 m pile with helical stirrups",
            "3-pile pile cap, plan and section",
            "isolated footing detail, 1.5 m square",
        ],
        technical: true,
    },
    mechanical: {
        title: "Mechanical",
        brief:
            "Mechanical drawings: machined parts, brackets, plates, shafts, flanges, gaskets and " +
            "assemblies, drawn as orthographic views.",
        examples: [
            "flange, 150 NB, 8 bolt holes",
            "L-bracket, 100x80x8, two 12 dia holes",
            "shaft with keyway, 40 dia, 250 long",
        ],
        technical: true,
    },
    random: {
        title: "Freehand",
        brief:
            "Anything that is not a technical drawing: figures, objects, sketches, diagrams, icons. " +
            "Nothing here is built from and nothing here is dimensioned, so a recognisable line " +
            "drawing is a complete answer.",
        examples: ["a woman lifting weights in a gym", "a coffee cup, side on", "a simple house icon"],
        technical: false,
    },
};

/** Technical modes ask before they draw; the freehand mode draws. */
export function isTechnicalMode(mode: DrawingMode): boolean {
    return DRAWING_MODE_INFO[mode].technical;
}
