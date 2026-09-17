/**
 * ELEVATION: draws the elevation of a plan already on the canvas.
 *
 * The one command in the AI group that starts from the drawing rather than from a
 * sentence. Two corners say which part of the plan to look at, a dropdown says which side
 * to stand on, and the extractor reads the wall off the geometry - so the openings in the
 * elevation are the plan's own openings, at the plan's own spacing, rather than a model's
 * recollection of them.
 *
 * What it asks about is exactly what a plan cannot answer. A plan holds no heights at all,
 * so the floor, the sill, the lintel and the roof are put to the draftsman with ordinary
 * defaults filled in, and the summary above the boxes says what was read off the canvas so
 * the two halves can be checked against each other before anything is drawn.
 */

import {
    AsyncController,
    CancelableCommand,
    command,
    Dimensions,
    type EdgeMeshData,
    I18n,
    type IDocument,
    NodeUtils,
    type PointSnapData,
    PointStep,
    PubSub,
    UnitSetup,
    VisualConfig,
    VisualNode,
    type XYZ,
} from "@draftworks/core";
import { div, input, option, p, select, span } from "@draftworks/element";
import {
    type Bounds,
    buildElevation,
    coerceElevation,
    type DrawItem,
    ELEVATION_LAYERS,
    ELEVATION_PARAMS,
    type ElevationSpec,
    extractFacade,
    FACADE_SIDES,
    type Facade,
    type FacadeSide,
    MM_PER_DRAWING_UNIT,
    type ParamDef,
    placementBelow,
    summarizeElevation,
    translateItems,
} from "@draftworks/generators";
import style from "../setupDialog.module.css";
import { generatorContext } from "./aiContext";
import { insertDrawing } from "./aiRenderer";
import { readPlan } from "./planReader";

/** How far below the plan the elevation lands, unless the plan is large enough to want more. */
const GAP_MM = 2000;

/**
 * A CancelableCommand rather than a bare ICommand, which every command in this file's
 * neighbourhood that picks a point also is.
 *
 * It is what makes Escape work. The base class owns `controller`, and its `cancel()`
 * cancels whichever pick is live - so without it the picks cannot be escaped out of, and
 * because CommandService.checking() refuses to start anything while a non-cancelable
 * command is executing, no other command can be run either until the picks are finished.
 * PLOT gets away with a bare ICommand because its picks happen from inside a modal dialog
 * that is already holding the user; this one starts straight off the ribbon.
 */
@command({ key: "ai.elevation", icon: "icon-rect" })
export class AiElevationCommand extends CancelableCommand {
    protected async executeAsync(): Promise<void> {
        const view = this.application.activeView;
        const document = view?.document;
        if (!view || !document) return;

        const nodes = NodeUtils.findNodes(
            document.modelManager.rootNode,
            (node) => node instanceof VisualNode && node.visible,
        ) as VisualNode[];

        if (nodes.length === 0) {
            PubSub.default.pub("showToast", "error.elevation.nothing");
            return;
        }

        const picked = await this.pickWindow(document);
        if (!picked) return;

        // Everything from here down is millimetres. The pick is in drawing units because
        // that is what the canvas counts in, and this is the one place the two meet -
        // planReader converts the geometry and insertDrawing converts it back.
        const mmPerUnit = MM_PER_DRAWING_UNIT[UnitSetup.settings.baseUnit];
        const window: Bounds = {
            min: { x: picked.minX * mmPerUnit, y: picked.minY * mmPerUnit },
            max: { x: picked.maxX * mmPerUnit, y: picked.maxY * mmPerUnit },
        };

        const { items } = readPlan(nodes, [...document.modelManager.layers]);
        if (items.length === 0) {
            PubSub.default.pub("showToast", "error.elevation.nothing");
            return;
        }

        const answer = await promptElevation(items, window);
        if (!answer) return;

        const ctx = generatorContext();
        const drawn = buildElevation(answer.facade, answer.spec, ctx);
        const gap = Math.max(GAP_MM, (window.max.y - window.min.y) * 0.15);
        const placed = translateItems(drawn, placementBelow(drawn, window, gap));

        insertDrawing(
            document,
            { title: summarizeElevation(answer.facade, answer.spec, ctx), layers: ELEVATION_LAYERS },
            placed,
            view.workplane,
        );
        PubSub.default.pub("showToast", "toast.ai.elevationDrawn");
    }

    /**
     * Picks the part of the plan to elevate, the way PLOT picks its window.
     *
     * Two ordinary point picks rather than a bare drag, so the corners get object snaps,
     * polar tracking and typed coordinates - a facade is very often wanted on the
     * building's own corner rather than wherever the cursor happened to be.
     *
     * A fresh controller per pick, assigned to the base class's `controller` rather than
     * held locally: that is the handle `cancel()` reaches for, so assigning it is what
     * makes Escape end the command instead of stranding it between the two corners.
     */
    private async pickWindow(document: IDocument): Promise<Window | undefined> {
        this.controller = new AsyncController();
        const first = await new PointStep("prompt.elevation.pickFirstCorner").execute(
            document,
            this.controller,
        );
        if (!first?.point || this.checkCanceled()) return undefined;

        const start = first.point;
        const opposite = (): PointSnapData => ({
            dimension: Dimensions.D1D2D3,
            refPoint: () => start,
            disableAxisLocks: true,
            // The rubber band. Without it the second corner is picked blind, and the whole
            // point of picking on screen rather than typing coordinates is to see the box.
            preview: (point) => (point ? [windowOutline(start, point)] : []),
        });

        this.controller = new AsyncController();
        const second = await new PointStep("prompt.elevation.pickOppositeCorner", opposite).execute(
            document,
            this.controller,
        );
        if (!second?.point || this.checkCanceled()) return undefined;

        return {
            minX: Math.min(start.x, second.point.x),
            minY: Math.min(start.y, second.point.y),
            maxX: Math.max(start.x, second.point.x),
            maxY: Math.max(start.y, second.point.y),
        };
    }
}

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

interface Answer {
    facade: Facade;
    spec: ElevationSpec;
}

/**
 * The questions, with what was read off the plan standing above them.
 *
 * The side is first and re-reads the drawing as it changes, because that is the answer
 * that decides whether there is a drawing at all - a facade the extractor cannot find is
 * worth saying immediately rather than after ten boxes have been filled in.
 */
function promptElevation(items: DrawItem[], window: Bounds): Promise<Answer | undefined> {
    return new Promise((resolve) => {
        const ctx = generatorContext();
        let side: FacadeSide = "south";
        let facade: Facade | undefined;

        const summary = p({ className: style.sample, textContent: "" });
        const warning = p({ className: style.sample, textContent: "" });

        const sideSelect = select(
            {
                className: style.select,
                onchange: () => {
                    side = sideSelect.value as FacadeSide;
                    reread();
                },
            },
            ...FACADE_SIDES.map((value) => option({ value, textContent: value })),
        );
        sideSelect.value = side;

        const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
        const fields = div({ className: style.group });
        for (const param of ELEVATION_PARAMS) {
            const control = controlFor(param);
            controls.set(param.name, control);
            fields.append(row(labelFor(param), control).root);
        }

        const reread = () => {
            const read = extractFacade(items, { side, window });
            facade = read.isOk ? read.value : undefined;
            // The extractor's own words when it refuses, not a translated stand-in. It
            // knows which of its three tests the geometry failed and quotes the numbers
            // that failed them, and that is the whole of what is useful here - "no wall
            // was found" on its own leaves the draftsman with nothing to act on.
            summary.textContent = read.isOk ? summarizeElevation(read.value, defaults(), ctx) : read.error;
            // Said rather than hidden. A facade the extractor only half understood still
            // draws, and the draftsman is the one who can look at the plan and tell
            // whether the thing it could not pair matters.
            warning.textContent =
                read.isOk && read.value.unpairedJambs > 0
                    ? I18n.translate("elevation.unpaired:{0}", String(read.value.unpairedJambs))
                    : "";
        };
        reread();

        const content = div(
            { className: style.root },
            div(
                { className: style.group },
                row(I18n.translate("dialog.title.elevationSide"), sideSelect).root,
            ),
            summary,
            warning,
            fields,
        );

        PubSub.default.pub("showDialog", "dialog.title.aiElevation", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    if (!facade) {
                        PubSub.default.pub("showToast", "error.elevation.noWall");
                        resolve(undefined);
                        return;
                    }

                    const raw: Record<string, unknown> = {};
                    for (const [name, control] of controls) {
                        if (control.value.trim()) raw[name] = control.value.trim();
                    }

                    const spec = coerceElevation(raw, ctx);
                    if (!spec.isOk) {
                        // The generator's own words. It knows why it refused - a lintel
                        // under a sill, a lintel over the floor above - and restating that
                        // here in worse terms would only lose the reason.
                        PubSub.default.pub("showToast", "toast.ai.elevationRefused:{0}", spec.error.message);
                        resolve(undefined);
                        return;
                    }

                    resolve({ facade, spec: spec.value });
                },
            },
            { content: "common.cancel", onclick: () => resolve(undefined) },
        ]);
    });
}

/** The declared defaults, for the summary line before anything has been typed. */
function defaults(): ElevationSpec {
    const raw: Record<string, unknown> = {};
    for (const param of ELEVATION_PARAMS) {
        if (param.default !== undefined) raw[param.name] = param.default;
    }
    return coerceElevation(raw, generatorContext()).value;
}

function row(caption: string, control: HTMLElement) {
    return {
        root: div(
            { className: style.field },
            span({ className: style.fieldLabel, textContent: `${caption}:` }),
            control,
        ),
    };
}

function controlFor(param: ParamDef): HTMLInputElement | HTMLSelectElement {
    // The dialog sits inside the main window, which routes keystrokes to command hotkeys -
    // without this, typing a height fires commands.
    const stop = (e: KeyboardEvent) => e.stopPropagation();

    if (param.type === "enum" && param.values) {
        const control = select(
            { className: style.select, onkeydown: stop },
            ...param.values.map((value) => option({ value, textContent: value })),
        );
        control.value = String(param.default ?? param.values[0]);
        return control;
    }

    return input({
        type: "text",
        className: style.numberBox,
        value: String(param.default ?? ""),
        onkeydown: stop,
    });
}

/** Parameter names are written for the model; the form wants them readable. */
function labelFor(param: ParamDef): string {
    return param.name
        .replace(/Mm$/, "")
        .replace(/Deg$/, "")
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
}

type Window = { minX: number; minY: number; maxX: number; maxY: number };
