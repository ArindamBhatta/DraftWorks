// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandIcon,
    type CommandKeys,
    CommandStore,
    type I18nKeys,
    Localize,
    type MenuItem,
    PubSub,
} from "@draftworks/core";
import { createIcon, div, label } from "@draftworks/element";

export interface DropdownItemData {
    command: CommandKeys;
    icon: CommandIcon;
    display: I18nKeys;
    onClick: () => void;
    disabled?: boolean;
}

export function getItemData(item: MenuItem): DropdownItemData {
    if (typeof item === "string") {
        const data = CommandStore.getComandData(item);
        return {
            command: item,
            icon: data?.icon ?? ("icon-command" as CommandIcon),
            display: (data ? `command.${data.key}` : item) as I18nKeys,
            onClick: () => PubSub.default.pub("executeCommand", item),
        };
    }
    if (item.type === "method") {
        return {
            command: item.command,
            icon: item.icon as CommandIcon,
            display: item.display,
            disabled: item.disabled,
            onClick: () => PubSub.default.pub("executeCommand", item.command, item.preset),
        };
    }
    return {
        command: item.command,
        icon: item.icon as CommandIcon,
        display: item.display ?? (`command.${item.command}` as I18nKeys),
        onClick: item.onClick,
    };
}

export interface DropdownItemClasses {
    item: string;
    icon: string;
    text: string;
}

export function createDropdownItem(
    item: MenuItem,
    onSelect: () => void,
    classes: DropdownItemClasses,
    disabledClass?: string,
): HTMLElement {
    const data = getItemData(item);
    const icon = data.icon ? createIcon(data.icon) : div();
    icon.classList.add(classes.icon);

    if (data.disabled) {
        const row = div(
            { className: classes.item },
            icon,
            label({ className: classes.text, textContent: new Localize(data.display) }),
        );
        if (disabledClass) row.classList.add(disabledClass);
        return row;
    }

    return div(
        {
            className: classes.item,
            onclick: (e) => {
                e.stopPropagation();
                // The item's own onClick, not a bare executeCommand on its command key:
                // a flyout entry may carry a preset ("Circle - Center, Diameter") or be
                // something other than a plain command run, and publishing the key here
                // would silently throw all of that away.
                data.onClick();
                onSelect();
            },
        },
        icon,
        label({
            className: classes.text,
            textContent: new Localize(data.display),
        }),
    );
}

export class DropdownController {
    static readonly openedDropdowns = new Set<DropdownController>();

    static closeAll(): void {
        for (const controller of DropdownController.openedDropdowns) {
            controller.close();
        }
    }

    #dropdown?: HTMLElement;
    #isOpened = false;
    readonly #containerClass: string;

    constructor(containerClass: string) {
        this.#containerClass = containerClass;
    }

    get isOpened(): boolean {
        return this.#isOpened;
    }

    open(anchor: HTMLElement, buildItems: (dropdown: HTMLElement) => void): void {
        if (this.#isOpened) return;

        DropdownController.closeAll();
        const dropdown = div({ className: this.#containerClass });
        buildItems(dropdown);

        document.body.appendChild(dropdown);
        this.#position(dropdown, anchor);
        this.#dropdown = dropdown;
        this.#isOpened = true;
        DropdownController.openedDropdowns.add(this);

        document.addEventListener("click", this.#onOutsideClick);
        document.addEventListener("keydown", this.#onKeyDown);
    }

    close(): void {
        if (!this.#isOpened) return;

        this.#dropdown?.remove();
        this.#dropdown = undefined;
        this.#isOpened = false;
        DropdownController.openedDropdowns.delete(this);

        document.removeEventListener("click", this.#onOutsideClick);
        document.removeEventListener("keydown", this.#onKeyDown);
    }

    dispose(): void {
        this.close();
    }

    #position(dropdown: HTMLElement, anchor: HTMLElement): void {
        const rect = anchor.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.left = `${rect.left}px`;
        // A minimum, not a fixed width: the menu lines up with the button it hangs from,
        // but an entry naming a drawing method ("Center, Diameter") is far wider than the
        // button, and pinning the width here would clip it.
        dropdown.style.minWidth = `${rect.width}px`;

        // Keep it on screen once it is allowed to be wider than its anchor.
        const overflow = dropdown.getBoundingClientRect().right - document.documentElement.clientWidth;
        if (overflow > 0) {
            dropdown.style.left = `${Math.max(0, rect.left - overflow - 4)}px`;
        }
    }

    readonly #onOutsideClick = (e: Event) => {
        if (this.#dropdown && !this.#dropdown.contains(e.target as Node)) {
            this.close();
        }
    };

    readonly #onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            this.close();
        }
    };
}
