// The preview's whole value is that it is not a drawing of a dimension - it is a real
// dimension, laid out by the same builder the DIM commands use, with the unconfirmed
// settings passed in. These tests pin that down: that the override actually reaches the
// geometry, that every control moves the picture, and that a half-typed number does not
// blank it out.
//
// The dialog's own tests address controls by the setting they edit rather than by
// position, because the seven tabs are built lazily and reordering a group box should not
// break a test about what Confirm does.

import {
    DEFAULT_DIMENSION_SETTINGS,
    type DialogButton,
    DimensionSetup,
    type I18nKeys,
    PubSub,
    UnitSetup,
} from "@draftworks/core";
import { expect, test } from "@rstest/core";
import {
    PREVIEW_FIGURE,
    PREVIEW_SAMPLES,
    renderDimensionPreview,
    suggestedOverallScale,
} from "./dimensionPreview";
import { promptDimensionSetup } from "./dimensionSetupCommand";

interface OpenDialog {
    content: HTMLElement;
    buttons: DialogButton[];
    closed: Promise<void>;
    /** Opens a tab by its caption, so the controls on it are built and reachable. */
    tab: (caption: I18nKeys) => void;
    /** The control editing one setting, on whichever tab is currently open. */
    field: <T extends HTMLElement = HTMLInputElement>(name: string) => T;
    preview: string;
}

function openDialog(): OpenDialog {
    let captured: { content: HTMLElement; buttons: DialogButton[] } | undefined;
    const capture = (_title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) => {
        captured = { content, buttons: buttons as DialogButton[] };
    };

    PubSub.default.sub("showDialog", capture);
    const closed = promptDimensionSetup();
    PubSub.default.remove("showDialog", capture);

    if (!captured) throw new Error("the dimension dialog did not open");
    const dialog = captured;

    return {
        content: dialog.content,
        buttons: dialog.buttons,
        closed,
        tab: (caption) => {
            const button = dialog.content.querySelector<HTMLButtonElement>(`button[name="${caption}"]`);
            if (!button) throw new Error(`no such tab: ${caption}`);
            button.click();
        },
        field: <T extends HTMLElement = HTMLInputElement>(name: string) => {
            const control = dialog.content.querySelector(`[name="${name}"]`);
            if (!control) throw new Error(`no control for "${name}" on the open tab`);
            return control as T;
        },
        get preview() {
            return dialog.content.querySelector("svg")?.outerHTML ?? "";
        },
    };
}

function type(box: HTMLInputElement, value: string) {
    box.value = value;
    box.dispatchEvent(new Event("input"));
}

function click(dialog: OpenDialog, content: string) {
    dialog.buttons.find((button) => button.content === content)?.onclick?.();
}

const labels = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll("text"), (t) => t.textContent);

const settings = { textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, precision: 2 };

/** A clean decimal-millimetre drawing in the default style - the base every test starts from. */
function reset() {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });
    DimensionSetup.configure({ ...DEFAULT_DIMENSION_SETTINGS, precision: 2 });
}

test("the preview draws one dimension of each kind on the sample figure", () => {
    reset();

    const svg = renderDimensionPreview(settings);
    const text = labels(svg);

    // Two linear dimensions, one angular, one radial - the plate's width and height,
    // the chamfer angle, and the hole.
    expect(text).toHaveLength(4);
    expect(text).toContain(PREVIEW_FIGURE.width.toFixed(2));
    expect(text).toContain(PREVIEW_FIGURE.height.toFixed(2));
    expect(text.some((value) => value?.endsWith("°"))).toBe(true);
    expect(text.some((value) => value?.startsWith("R"))).toBe(true);
});

test("the preview honours the precision it is handed, not the drawing's", () => {
    reset();

    const svg = renderDimensionPreview({ ...settings, precision: 4 });

    expect(labels(svg)).toContain(PREVIEW_FIGURE.width.toFixed(4));
    // The pending value was previewed without being applied to the drawing.
    expect(DimensionSetup.settings.precision).toBe(2);
});

test("arrow size changes the arrowheads without rescaling the figure", () => {
    reset();
    const small = renderDimensionPreview({ ...settings, arrowSize: 2 });
    const large = renderDimensionPreview({ ...settings, arrowSize: 6 });

    const area = (svg: SVGSVGElement) => svg.querySelectorAll("path[fill='currentColor']").length;
    // Same number of arrowheads, but a different viewBox would mean the figure rescaled.
    expect(area(small)).toBe(area(large));
    expect(small.getAttribute("viewBox")).toBe(large.getAttribute("viewBox"));
    expect(small.outerHTML).not.toBe(large.outerHTML);
});

test("text height drives the label size", () => {
    reset();
    const svg = renderDimensionPreview({ ...settings, textHeight: 7 });

    expect(svg.querySelector("text")?.getAttribute("font-size")).toBe("7");
});

test("the dialog redraws the preview as the boxes are typed into", async () => {
    reset();
    const dialog = openDialog();

    const before = dialog.preview;
    dialog.tab("dimstyle.tab.text");
    type(dialog.field("textHeight"), "8");

    expect(dialog.preview).not.toBe(before);

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("a half-typed number keeps the preview drawn", async () => {
    reset();
    const dialog = openDialog();

    // What the box holds mid-keystroke on the way to "2.5".
    dialog.tab("dimstyle.tab.text");
    type(dialog.field("textHeight"), "");

    expect(dialog.preview).toContain("<text");

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("Confirm applies edits made across several tabs", async () => {
    reset();
    const dialog = openDialog();

    dialog.tab("dimstyle.tab.text");
    type(dialog.field("textHeight"), "4");
    dialog.tab("dimstyle.tab.symbols");
    type(dialog.field("arrowSize"), "3");
    dialog.tab("dimstyle.tab.lines");
    type(dialog.field("extensionOffset"), "1.5");
    dialog.tab("dimstyle.tab.fit");
    type(dialog.field("overallScale"), "2");

    click(dialog, "common.confirm");
    await dialog.closed;

    // Only what was typed changed; the rest of the style came through untouched.
    expect(DimensionSetup.settings).toEqual({
        ...DEFAULT_DIMENSION_SETTINGS,
        precision: 2,
        textHeight: 4,
        arrowSize: 3,
        extensionOffset: 1.5,
        overallScale: 2,
    });
});

test("Cancel leaves the drawing's dimension style alone", async () => {
    reset();
    const dialog = openDialog();

    dialog.tab("dimstyle.tab.text");
    type(dialog.field("textHeight"), "9");
    click(dialog, "common.cancel");
    await dialog.closed;

    expect(DimensionSetup.settings.textHeight).toBe(DEFAULT_DIMENSION_SETTINGS.textHeight);
});

test("a setting with nothing to act on is greyed out until it has", async () => {
    reset();
    const dialog = openDialog();

    dialog.tab("dimstyle.tab.alternateUnits");
    const multiplier = dialog.field("alternateMultiplier");
    expect(multiplier.hasAttribute("disabled")).toBe(true);

    const enable = dialog.field("alternateEnabled");
    enable.checked = true;
    enable.dispatchEvent(new Event("change"));

    expect(dialog.field("alternateMultiplier").hasAttribute("disabled")).toBe(false);

    click(dialog, "common.cancel");
    await dialog.closed;
});

// The second sample exists to show what a style written for a 28-unit part does to an
// 11,400-unit building - so what is worth pinning down is that the two really are at
// different scales, that the line work survives the jump, and that the dialog says so.

test("each sample is drawn at its own fixed scale", () => {
    reset();

    expect(PREVIEW_SAMPLES).toHaveLength(2);
    const [part, plan] = PREVIEW_SAMPLES;
    // Two orders of magnitude apart, which is the whole point of having both.
    expect(plan.view.width / part.view.width).toBeGreaterThan(100);
    // Proportioned alike, so paging between them does not resize the pane's contents.
    const aspect = (s: (typeof PREVIEW_SAMPLES)[number]) => s.view.width / s.view.height;
    expect(aspect(plan)).toBeCloseTo(aspect(part), 1);
});

test("the building plan measures the plot it is drawn at", () => {
    reset();
    DimensionSetup.configure({ precision: 0 });

    const text = labels(renderDimensionPreview({}, 1));

    expect(text).toContain("11400");
    expect(text).toContain("5600");
    expect(text).toContain("4600");
});

test("line work stays a hairline on both samples, whatever their scale", () => {
    reset();

    const hairline = (index: number) => {
        const sample = PREVIEW_SAMPLES[index];
        const svg = renderDimensionPreview({}, index);
        const widths = Array.from(svg.querySelectorAll("path[stroke-width]"), (p) =>
            Number(p.getAttribute("stroke-width")),
        );
        // As a fraction of the view, which is what decides the width on screen. A stroke
        // fixed in drawing units would vanish on the larger sample.
        return Math.max(...widths) / sample.view.width;
    };

    expect(hairline(1)).toBeCloseTo(hairline(0), 4);
});

test("a style too small to see on a sample suggests the scale that fixes it", () => {
    reset();

    // The default style reads properly on the machined part and not at all on the plan.
    expect(suggestedOverallScale({}, 0)).toBeUndefined();
    const suggested = suggestedOverallScale({}, 1);
    expect(suggested).toBeGreaterThan(100);

    // Taking the advice clears the warning.
    expect(suggestedOverallScale({ overallScale: suggested }, 1)).toBeUndefined();
});

test("the arrow pages the preview to the next sample and back round", async () => {
    reset();
    DimensionSetup.configure({ precision: 0 });
    const dialog = openDialog();

    const next = dialog.content.querySelector<HTMLButtonElement>(`button[name="dimstyle.sample.next"]`);
    if (!next) throw new Error("no next-sample arrow");

    const part = dialog.preview;
    next.click();
    const plan = dialog.preview;
    expect(plan).not.toBe(part);
    expect(plan).toContain("11400");

    // Two samples, so one more press comes back to where it started.
    next.click();
    expect(dialog.preview).toBe(part);

    click(dialog, "common.cancel");
    await dialog.closed;
});
