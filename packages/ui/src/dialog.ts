// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type DialogButton, I18n, type I18nKeys } from "@draftworks/core";
import { button, div } from "@draftworks/element";
import style from "./dialog.module.css";

const DefaultButtons: DialogButton[] = [
    {
        content: "common.confirm",
    },
    {
        content: "common.cancel",
    },
];

/** A handle on an open dialog, for the rare case that owns closing it itself. */
export interface DialogHandle {
    /**
     * Closes the dialog as a button would, without invoking any of them.
     *
     * Wanted where the dialog has to step out of the way of the drawing and come back -
     * PLOT's "pick a window on screen", which needs the viewport the modal is covering.
     */
    close(): void;
}

export function showDialog(
    title: I18nKeys,
    content: HTMLElement,
    buttons?: DialogButton[] | (() => void),
    titleArgs?: unknown[],
): DialogHandle {
    const dialog = document.createElement("dialog");
    const host = app.mainWindow ?? document.body;
    host.appendChild(dialog);
    const close = renderDialog(dialog, title, content, combineButtons(buttons), titleArgs);
    dialog.showModal();
    return { close };
}

function renderDialog(
    dialog: HTMLDialogElement,
    title: I18nKeys,
    content: HTMLElement,
    combinedButtons: DialogButton[],
    titleArgs?: unknown[],
): () => void {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            const confirmBtn = combinedButtons.find(
                (btn) => btn.onclick && btn.shouldClose?.() !== false && btn.content !== "common.cancel",
            );
            if (confirmBtn) {
                confirmBtn.onclick?.();
                closeDialog();
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            const cancelBtn = combinedButtons.find((btn) => btn.content === "common.cancel");
            if (cancelBtn) {
                cancelBtn.onclick?.();
                closeDialog();
            }
        }
    };
    const closeDialog = () => {
        dialog.removeEventListener("keydown", handleKeyDown);
        dialog.remove();
    };
    dialog.addEventListener("keydown", handleKeyDown);
    dialog.append(
        div(
            { className: style.root },
            div({ className: style.title }, I18n.translate(title, ...(titleArgs ?? [])) ?? "chili3d"),
            div({ className: style.content }, content),
            div(
                { className: style.buttons },
                ...combinedButtons.map((btn) =>
                    button({
                        textContent: I18n.translate(btn.content),
                        onclick: async () => {
                            if (btn.shouldClose?.() !== false) {
                                closeDialog();
                            }

                            if (btn.onclick) {
                                await btn?.onclick();
                            }
                        },
                    }),
                ),
            ),
        ),
    );

    return closeDialog;
}

function combineButtons(buttons?: DialogButton[] | (() => void)): DialogButton[] {
    if (buttons === undefined) {
        return DefaultButtons;
    }

    if (Array.isArray(buttons)) {
        return buttons;
    }

    return [
        {
            content: "common.confirm",
            onclick: buttons,
        },
        {
            content: "common.cancel",
        },
    ];
}
