// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The Drawing Units dialog's job is that the three dropdowns and the Sample Output panel
// never disagree. Precision is the trap: its options mean a fraction denominator under
// Architectural and decimal places under Decimal, so a type change has to rebuild the
// list rather than carry a number across into a format where it is nonsense.

import { type DialogButton, type I18nKeys, PubSub, UnitSetup } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { promptUnitSetup } from "./unitSetupCommand";

interface OpenDialog {
    content: HTMLElement;
    buttons: DialogButton[];
    closed: Promise<void>;
    typeSelect: HTMLSelectElement;
    precisionSelect: HTMLSelectElement;
    insertionSelect: HTMLSelectElement;
    sampleLines: string[];
}

/** Opens the dialog and hands back its live controls, the way a user would meet them. */
function openDialog(): OpenDialog {
    let captured: { content: HTMLElement; buttons: DialogButton[] } | undefined;
    const capture = (_title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) => {
        captured = { content, buttons: buttons as DialogButton[] };
    };

    PubSub.default.sub("showDialog", capture);
    const closed = promptUnitSetup();
    PubSub.default.remove("showDialog", capture);

    if (!captured) throw new Error("the units dialog did not open");
    const selects = Array.from(captured.content.querySelectorAll("select"));
    const dialog = captured;

    return {
        content: dialog.content,
        buttons: dialog.buttons,
        closed,
        typeSelect: selects[0],
        precisionSelect: selects[1],
        insertionSelect: selects[2],
        get sampleLines() {
            const panel = dialog.content.querySelectorAll("fieldset")[2];
            return Array.from(panel.querySelectorAll("div > div"), (line) => line.textContent ?? "");
        },
    };
}

function choose(control: HTMLSelectElement, label: string) {
    control.value = label;
    control.dispatchEvent(new Event("change"));
}

function click(dialog: OpenDialog, content: string) {
    dialog.buttons.find((button) => button.content === content)?.onclick?.();
}

function optionLabels(control: HTMLSelectElement) {
    return Array.from(control.options, (item) => item.textContent);
}

test("the dialog opens on the settings the drawing is actually using", async () => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });

    const dialog = openDialog();

    expect(dialog.typeSelect.value).toBe("Decimal");
    expect(dialog.precisionSelect.value).toBe("0.00");
    expect(dialog.insertionSelect.value).toBe("Millimeters");

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("the type list reads as plain names, with the worked example left to Sample Output", async () => {
    const dialog = openDialog();

    expect(optionLabels(dialog.typeSelect)).toEqual([
        "Architectural",
        "Decimal",
        "Engineering",
        "Fractional",
        "Scientific",
    ]);

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("changing the type rebuilds the precision list in that format's own terms", async () => {
    UnitSetup.configure({ type: "decimal", precision: 4, baseUnit: "in" });
    const dialog = openDialog();

    expect(optionLabels(dialog.precisionSelect)).toContain("0.0000");

    choose(dialog.typeSelect, "Architectural");

    // Fraction denominators now, not decimal places - and defaulted to AutoCAD's 1/16.
    expect(optionLabels(dialog.precisionSelect)).toContain(`0'-0 1/16"`);
    expect(dialog.precisionSelect.value).toBe(`0'-0 1/16"`);

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("Sample Output tracks the type", async () => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "in" });
    const dialog = openDialog();

    expect(dialog.sampleLines[0]).toBe("68.50");

    choose(dialog.typeSelect, "Architectural");
    expect(dialog.sampleLines[0]).toBe(`5'-8 1/2"`);

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("Sample Output tracks the precision", async () => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "in" });
    const dialog = openDialog();

    choose(dialog.precisionSelect, "0");

    expect(dialog.sampleLines[0]).toBe("69");

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("Sample Output tracks the insertion units", async () => {
    UnitSetup.configure({ type: "architectural", precision: 16, baseUnit: "in" });
    const dialog = openDialog();

    expect(dialog.sampleLines[0]).toBe(`5'-8 1/2"`);

    // One drawing unit is a foot now, so the same 68.5 units is twelve times the length.
    choose(dialog.insertionSelect, "Feet");
    expect(dialog.sampleLines[0]).toBe(`68'-6"`);

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("the coordinate sample formats both ordinates", async () => {
    UnitSetup.configure({ type: "architectural", precision: 16, baseUnit: "in" });
    const dialog = openDialog();

    expect(dialog.sampleLines[1]).toBe(`1'-6", 2'-3 1/4"`);

    click(dialog, "common.cancel");
    await dialog.closed;
});

test("Confirm applies every panel, not just the type", async () => {
    UnitSetup.configure({ type: "architectural", precision: 16, baseUnit: "in" });
    const dialog = openDialog();

    choose(dialog.typeSelect, "Fractional");
    choose(dialog.precisionSelect, "0 1/8");
    choose(dialog.insertionSelect, "Meters");
    click(dialog, "common.confirm");
    await dialog.closed;

    expect(UnitSetup.settings).toEqual({ type: "fractional", precision: 8, baseUnit: "m" });
});

test("Cancel leaves the drawing on its current settings", async () => {
    UnitSetup.configure({ type: "decimal", precision: 3, baseUnit: "cm" });
    const dialog = openDialog();

    choose(dialog.typeSelect, "Scientific");
    choose(dialog.insertionSelect, "Feet");
    click(dialog, "common.cancel");
    await dialog.closed;

    expect(UnitSetup.settings).toEqual({ type: "decimal", precision: 3, baseUnit: "cm" });
});
