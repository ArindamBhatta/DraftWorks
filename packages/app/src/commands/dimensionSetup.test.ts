// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The preview's whole value is that it is not a drawing of a dimension - it is a real
// dimension, laid out by the same builder the DIM commands use, with the unconfirmed
// settings passed in. These tests pin that down: that the override actually reaches the
// geometry, that every control moves the picture, and that a half-typed number does not
// blank it out.

import { type DialogButton, DimensionSetup, type I18nKeys, PubSub, UnitSetup } from "@chili3d/core";
import { expect, test } from "@rstest/core";
import { PREVIEW_FIGURE, renderDimensionPreview } from "./dimensionPreview";
import { promptDimensionSetup } from "./dimensionSetupCommand";

interface OpenDialog {
    content: HTMLElement;
    buttons: DialogButton[];
    closed: Promise<void>;
    boxes: HTMLInputElement[];
    precision: HTMLSelectElement;
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
        boxes: Array.from(dialog.content.querySelectorAll("input")),
        precision: dialog.content.querySelector("select") as HTMLSelectElement,
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

test("the preview draws one dimension of each kind on the sample figure", () => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });

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
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });
    DimensionSetup.configure({ precision: 2 });

    const svg = renderDimensionPreview({ ...settings, precision: 4 });

    expect(labels(svg)).toContain(PREVIEW_FIGURE.width.toFixed(4));
    // The pending value was previewed without being applied to the drawing.
    expect(DimensionSetup.settings.precision).toBe(2);
});

test("arrow size changes the arrowheads without rescaling the figure", () => {
    const small = renderDimensionPreview({ ...settings, arrowSize: 2 });
    const large = renderDimensionPreview({ ...settings, arrowSize: 6 });

    const area = (svg: SVGSVGElement) => svg.querySelectorAll("path[fill='currentColor']").length;
    // Same number of arrowheads, but a different viewBox would mean the figure rescaled.
    expect(area(small)).toBe(area(large));
    expect(small.getAttribute("viewBox")).toBe(large.getAttribute("viewBox"));
    expect(small.outerHTML).not.toBe(large.outerHTML);
});

test("text height drives the label size", () => {
    const svg = renderDimensionPreview({ ...settings, textHeight: 7 });

    expect(svg.querySelector("text")?.getAttribute("font-size")).toBe("7");
});

test("the dialog redraws the preview as the boxes are typed into", async () => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });
    DimensionSetup.configure({ textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, precision: 2 });
    const dialog = openDialog();

    const before = dialog.preview;
    type(dialog.boxes[1], "8");

    expect(dialog.preview).not.toBe(before);

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("a half-typed number keeps the preview drawn", async () => {
    const dialog = openDialog();

    // What the box holds mid-keystroke on the way to "2.5".
    type(dialog.boxes[0], "");

    expect(dialog.preview).toContain("<text");

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("Confirm applies every box", async () => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });
    DimensionSetup.configure({ textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, precision: 2 });
    const dialog = openDialog();

    type(dialog.boxes[0], "4");
    type(dialog.boxes[1], "3");
    type(dialog.boxes[2], "1.5");
    dialog.precision.value = "3";
    click(dialog, "common.confirm");
    await dialog.closed;

    expect(DimensionSetup.settings).toEqual({
        textHeight: 4,
        arrowSize: 3,
        extensionOffset: 1.5,
        precision: 3,
    });
});

test("Cancel leaves the drawing's dimension style alone", async () => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });
    DimensionSetup.configure({ textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, precision: 2 });
    const dialog = openDialog();

    type(dialog.boxes[0], "9");
    click(dialog, "common.cancel");
    await dialog.closed;

    expect(DimensionSetup.settings.textHeight).toBe(2.5);
});
