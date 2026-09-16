// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * PLOT: AutoCAD's plot dialog, producing a PDF.
 *
 * The device list is the one difference from AutoCAD worth stating up front. AutoCAD picks
 * a plotter; this writes a PDF and hands it to the user, because that is the artefact a
 * drawing is actually exchanged as - it goes to a client, a consultant or a print shop far
 * more often than it goes straight to paper - and because a PDF can then be printed at
 * exact scale by anything. Everything else is where a drafter expects it: the plot area,
 * the scale, the offset and the pen behaviour, beside a preview of the sheet.
 *
 * The preview matters more here than in the other setup dialogs. A plot is the one
 * operation whose result cannot be undone once it has been printed, and "fit to paper" and
 * offsets are judged far better by eye than by reading numbers back.
 */

import {
    AsyncController,
    command,
    Dimensions,
    download,
    type EdgeMeshData,
    type IApplication,
    type ICommand,
    type IDocument,
    NodeUtils,
    PAPER_SIZES,
    type PaperSizeName,
    type PointSnapData,
    PointStep,
    PubSub,
    VisualConfig,
    VisualNode,
    type XYZ,
} from "@draftworks/core";
import { button, div, fieldset, input, label, legend, option, select, span } from "@draftworks/element";
import { type DialogHandle, showDialog } from "@draftworks/ui";
import { nodesToDxf } from "../io/dxf";
import {
    buildPlotSheet,
    configurePlot,
    DEFAULT_PLOT_SETTINGS,
    PLOT_SCALES,
    type PlotArea,
    type PlotOrientation,
    type PlotSettings,
    type PlotStyle,
    plotToPdf,
    plotToSvg,
    scaleLabel,
} from "../io/plot";
import style from "./plot.module.css";

/**
 * The settings the last plot used, for the rest of the session.
 *
 * Plotting the same drawing twice - once to check, once for real - is the normal way to
 * use this, and re-entering the paper size and scale each time would make the second plot
 * as much work as the first. Not persisted to storage: a plot setup belongs to a drawing
 * rather than to the application, and restoring one drawing's scale onto another is how a
 * plan quietly comes out at the wrong size.
 */
let lastUsed: PlotSettings = DEFAULT_PLOT_SETTINGS;

const PAPER_OPTIONS: { label: string; value: PaperSizeName }[] = [
    ...Object.entries(PAPER_SIZES).map(([name, size]) => ({
        label: `${name} (${size.width} x ${size.height} mm)`,
        value: name as PaperSizeName,
    })),
];

const AREA_OPTIONS: { label: string; value: PlotArea }[] = [
    { label: "Extents", value: "extents" },
    { label: "Display", value: "display" },
    { label: "Window", value: "window" },
];

const STYLE_OPTIONS: { label: string; value: PlotStyle }[] = [
    { label: "Monochrome", value: "monochrome" },
    { label: "Grayscale", value: "grayscale" },
    { label: "Use drawing colours", value: "color" },
];

@command({
    key: "file.plot",
    icon: "icon-plot",
})
export class Plot implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;

        const nodes = NodeUtils.findNodes(
            document.modelManager.rootNode,
            (node) => node instanceof VisualNode && node.visible,
        ) as VisualNode[];

        if (nodes.length === 0) {
            PubSub.default.pub("showToast", "error.plot.nothingToPlot");
            return;
        }

        // Built once and reused for every preview redraw. This is the same conversion DXF
        // and DWG export run, so the sheet cannot show something an export would not
        // contain; it is also the expensive half, and the dialog re-renders on every
        // keystroke.
        const { drawing } = nodesToDxf(nodes, [...document.modelManager.layers]);

        // The viewport's own corners, which is the only thing that knows what "Display"
        // means. Captured now rather than read live, so panning behind the modal cannot
        // change what the preview is showing.
        const view = application.activeView;
        const displayWindow = view
            ? (() => {
                  const a = view.screenToWorld(0, 0);
                  const b = view.screenToWorld(view.width, view.height);
                  return {
                      minX: Math.min(a.x, b.x),
                      minY: Math.min(a.y, b.y),
                      maxX: Math.max(a.x, b.x),
                      maxY: Math.max(a.y, b.y),
                  };
              })()
            : undefined;

        const name = document.name || "drawing";

        // Opened through a loop rather than once, because picking a window has to take the
        // modal off the screen - the viewport it covers is the thing being picked in - and
        // then bring it back with the answer filled in.
        const open = (settings: PlotSettings) => {
            // Cannot be const: the callback below closes the very dialog this call is still
            // constructing. It only ever fires from a click, which cannot happen until the
            // dialog is on screen and the binding is set.
            let handle: DialogHandle | undefined;

            handle = showPlotDialog({
                drawing,
                displayWindow,
                name,
                initial: settings,
                onPickWindow: async (current) => {
                    handle?.close();
                    const picked = await pickWindow(document);
                    // A cancelled pick leaves the previous window in place and simply
                    // reopens, which is what AutoCAD does: escaping out of the pick is not
                    // a decision to plot something else.
                    open(picked ? configurePlot(current, { area: "window", window: picked }) : current);
                },
            });
        };

        open(configurePlot(lastUsed, { window: displayWindow }));
    }
}

/**
 * Picks the plot window in the drawing, as AutoCAD's "Window <" does.
 *
 * Two ordinary point picks, so the window gets object snaps, polar tracking and typed
 * coordinates for free - a plot window is very often wanted on a known corner rather than
 * wherever the cursor happened to be, and re-implementing a bare drag would have thrown all
 * of that away.
 */
async function pickWindow(document: IDocument): Promise<Window | undefined> {
    const first = await new PointStep("prompt.plot.pickFirstCorner").execute(document, new AsyncController());
    if (!first?.point) return undefined;

    const start = first.point;
    const opposite = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        refPoint: () => start,
        disableAxisLocks: true,
        // The rubber band. Without it the second corner is picked blind, and the whole
        // point of picking on screen rather than typing coordinates is to see the box.
        preview: (point) => (point ? [windowOutline(start, point)] : []),
    });

    const second = await new PointStep("prompt.plot.pickOppositeCorner", opposite).execute(
        document,
        new AsyncController(),
    );
    if (!second?.point) return undefined;

    return {
        minX: Math.min(start.x, second.point.x),
        minY: Math.min(start.y, second.point.y),
        maxX: Math.max(start.x, second.point.x),
        maxY: Math.max(start.y, second.point.y),
    };
}

/** The rubber-banded rectangle, as the four edges of the box the two corners span. */
function windowOutline(start: XYZ, end: XYZ): EdgeMeshData {
    const z = start.z;
    const corners: [number, number][] = [
        [start.x, start.y],
        [end.x, start.y],
        [end.x, end.y],
        [start.x, end.y],
    ];

    const position: number[] = [];
    for (let i = 0; i < 4; i++) {
        const [x1, y1] = corners[i];
        const [x2, y2] = corners[(i + 1) % 4];
        position.push(x1, y1, z, x2, y2, z);
    }

    return {
        position: new Float32Array(position),
        // Explicit, and theme-aware. ShapeMeshData.color is optional and
        // ThreeGeometryFactory.setColor simply skips a mesh that has none - leaving the
        // LineMaterial on its own default, which is white. On a light drawing background
        // that is a rubber band nobody can see.
        color: VisualConfig.defaultEdgeColor,
        lineType: "solid",
        range: [],
    };
}

type Drawing = ReturnType<typeof nodesToDxf>["drawing"];
type Window = { minX: number; minY: number; maxX: number; maxY: number };

interface PlotDialogOptions {
    drawing: Drawing;
    displayWindow: Window | undefined;
    name: string;
    initial: PlotSettings;
    /** Takes the dialog off screen, picks a window in the drawing, and reopens. */
    onPickWindow: (current: PlotSettings) => void;
}

function showPlotDialog(options: PlotDialogOptions): DialogHandle {
    const { drawing, displayWindow, name, initial, onPickWindow } = options;

    // The dialog edits one draft and re-renders the preview from it. Nothing is read back
    // out of the controls, so a field cannot be in a state the preview is not showing.
    let draft: PlotSettings = initial;

    const preview = div({ className: style.preview });
    const readout = div({ className: style.readout });
    const controls = div({ className: style.controls });

    const render = () => {
        const sheet = buildPlotSheet(drawing, draft, { displayWindow });

        // Laid out by the sheet's own aspect ratio, so a portrait plot is a portrait
        // preview and the paper choice is visible before anything is printed.
        preview.style.aspectRatio = `${sheet.widthMm} / ${sheet.heightMm}`;
        preview.innerHTML = plotToSvg(sheet, { showSheet: true });

        readout.replaceChildren(
            span({ textContent: `Scale ${scaleLabel(sheet.scale)}` }),
            span({
                textContent: `${sheet.widthMm} x ${sheet.heightMm} mm`,
            }),
            ...(sheet.primitives.length === 0
                ? [span({ className: style.warning, textContent: "Nothing in the plot area" })]
                : []),
            ...(sheet.clipped
                ? [span({ className: style.warning, textContent: "Does not fit - will be cut off" })]
                : []),
        );
    };

    /** Applies a change to the draft and redraws, which every control below goes through. */
    const update = (change: Partial<PlotSettings>) => {
        const next = configurePlot(draft, change);

        // Choosing "Window" in AutoCAD does not just select a mode, it asks for the
        // rectangle there and then. Only on the change into it: re-rendering for some other
        // reason while Window is already chosen must not drag the user back onto the
        // crosshair.
        if (next.area === "window" && draft.area !== "window") {
            draft = next;
            onPickWindow(next);
            return;
        }

        draft = next;
        build();
        render();
    };

    const build = () => controls.replaceChildren(...buildControls(draft, update, () => onPickWindow(draft)));

    build();
    render();

    return showDialog(
        "command.file.plot",
        div(
            { className: style.root },
            div(
                { className: style.columns },
                controls,
                div({ className: style.previewPane }, preview, readout),
            ),
        ),
        [
            {
                content: "common.confirm",
                onclick: () => {
                    lastUsed = draft;
                    emit(drawing, draft, displayWindow, name);
                },
            },
            { content: "common.cancel" },
        ],
    );
}

/** Builds the PDF and hands it to the browser. */
function emit(drawing: Drawing, settings: PlotSettings, displayWindow: Window | undefined, name: string) {
    const sheet = buildPlotSheet(drawing, settings, { displayWindow });
    if (sheet.primitives.length === 0) {
        PubSub.default.pub("showToast", "error.plot.nothingToPlot");
        return;
    }

    const { bytes, unsupportedCharacters } = plotToPdf(sheet, name);

    if (unsupportedCharacters.length > 0) {
        // Said plainly rather than left to be discovered on the sheet: the PDF is otherwise
        // perfectly good, and the user needs to know which characters are missing from it.
        PubSub.default.pub("showToast", "error.plot.unsupportedText:{0}", unsupportedCharacters.join(" "));
    }

    PubSub.default.pub("showToast", "toast.downloading");
    download([bytes], `${name}.pdf`);
}

// ---------------------------------------------------------------------------------------
// Controls. Each is a captioned row; the group boxes follow AutoCAD's own grouping so a
// drafter can find a setting without reading the whole dialog.
// ---------------------------------------------------------------------------------------

function buildControls(
    draft: PlotSettings,
    update: (change: Partial<PlotSettings>) => void,
    pickWindow: () => void,
) {
    return [
        group("Paper", [
            dropdown("Size", PAPER_OPTIONS, draft.paperSize, (value) => update({ paperSize: value })),
            dropdown(
                "Orientation",
                [
                    { label: "Landscape", value: "landscape" as PlotOrientation },
                    { label: "Portrait", value: "portrait" as PlotOrientation },
                ],
                draft.orientation,
                (value) => update({ orientation: value }),
            ),
            number("Margin (mm)", draft.margin, (value) => update({ margin: value })),
        ]),

        group("Plot area", [
            dropdown("What to plot", AREA_OPTIONS, draft.area, (value) => update({ area: value })),
            // AutoCAD's "Window <": picking the rectangle on screen is the normal way to set
            // it, and the boxes below hold whatever was picked. They stay editable because a
            // window is often wanted on round numbers, which is easier typed than picked.
            ...(draft.area === "window"
                ? [pickButton("Window <", pickWindow), ...windowFields(draft, update)]
                : []),
        ]),

        group("Plot scale", [
            checkbox("Fit to paper", draft.fitToPaper, (value) => update({ fitToPaper: value })),
            ...(draft.fitToPaper
                ? []
                : [
                      dropdown(
                          "Scale",
                          [
                              ...PLOT_SCALES.map((entry) => ({ label: entry.label, value: entry.scale })),
                              ...(PLOT_SCALES.some((e) => e.scale === draft.scale)
                                  ? []
                                  : [{ label: scaleLabel(draft.scale), value: draft.scale }]),
                          ],
                          draft.scale,
                          (value) => update({ scale: value }),
                      ),
                      number("Custom (units per mm)", draft.scale, (value) => update({ scale: value })),
                  ]),
            checkbox("Scale lineweights", draft.scaleLineweights, (value) =>
                update({ scaleLineweights: value }),
            ),
        ]),

        group("Plot offset", [
            checkbox("Centre the plot", draft.centered, (value) => update({ centered: value })),
            ...(draft.centered
                ? []
                : [
                      number("X (mm)", draft.offsetX, (value) => update({ offsetX: value })),
                      number("Y (mm)", draft.offsetY, (value) => update({ offsetY: value })),
                  ]),
        ]),

        group("Pens", [
            dropdown("Plot style", STYLE_OPTIONS, draft.style, (value) => update({ style: value })),
            checkbox("Plot object lineweights", draft.plotLineweights, (value) =>
                update({ plotLineweights: value }),
            ),
        ]),
    ];
}

function windowFields(draft: PlotSettings, update: (change: Partial<PlotSettings>) => void) {
    const window = draft.window ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const set = (change: Partial<Window>) => update({ window: { ...window, ...change } });

    return [
        number("From X", window.minX, (value) => set({ minX: value })),
        number("From Y", window.minY, (value) => set({ minY: value })),
        number("To X", window.maxX, (value) => set({ maxX: value })),
        number("To Y", window.maxY, (value) => set({ maxY: value })),
    ];
}

/** The button that takes the dialog off screen to pick a rectangle in the drawing. */
function pickButton(caption: string, onclick: () => void) {
    return div({ className: style.field }, button({ className: style.pick, textContent: caption, onclick }));
}

function group(caption: string, children: HTMLElement[]) {
    return fieldset(
        { className: style.group },
        legend({ className: style.groupTitle, textContent: caption }),
        ...children,
    );
}

function dropdown<T extends string | number>(
    caption: string,
    options: { label: string; value: T }[],
    selected: T,
    onchange: (value: T) => void,
) {
    const control = select({
        className: style.select,
        onchange: (e: Event) => {
            const index = (e.target as HTMLSelectElement).selectedIndex;
            onchange(options[index].value);
        },
    });
    control.append(
        ...options.map((entry) => option({ textContent: entry.label, selected: entry.value === selected })),
    );
    return row(caption, control);
}

function number(caption: string, value: number, onchange: (value: number) => void) {
    const control = input({
        className: style.input,
        type: "number",
        step: "any",
        value: String(round(value)),
        // On change rather than on input: re-rendering the preview on every keystroke would
        // also rebuild the field and take the caret with it.
        onchange: (e: Event) => {
            const parsed = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(parsed)) onchange(parsed);
        },
    });
    return row(caption, control);
}

function checkbox(caption: string, checked: boolean, onchange: (value: boolean) => void) {
    const control = input({
        type: "checkbox",
        checked,
        onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked),
    });
    return label({ className: style.check }, control, span({ textContent: caption }));
}

function row(caption: string, control: HTMLElement) {
    return div(
        { className: style.field },
        span({ className: style.fieldLabel, textContent: `${caption}:` }),
        control,
    );
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;
