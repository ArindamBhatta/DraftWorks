import {
    Binding,
    type IConverter,
    Localize,
    ObservableCollection,
    Result,
    type RibbonCommand,
    type RibbonGroup,
    type RibbonWidgetKind,
} from "@draftworks/core";
import { collection, div, label } from "@draftworks/element";
import { LayerControl } from "../layer/layerControl";
import { LayersRibbonPanel } from "../layer/layersRibbonPanel";
import { AutosaveControl } from "./autosaveControl";
import { createDropdownItem, DropdownController } from "./dropdownController";
import { RibbonPushButton } from "./ribbonButton";
import style from "./ribbonGroup.module.css";
import { RibbonPulldownButton } from "./ribbonPulldownButton";
import { RibbonSplitButton } from "./ribbonSplitButton";
import { RibbonStack } from "./ribbonStack";

export function createRibbonButton(item: RibbonCommand): HTMLElement {
    if (typeof item === "string") {
        return RibbonPushButton.fromCommandName(item, "large")!;
    } else if (item instanceof ObservableCollection) {
        const stack = new RibbonStack();
        item.forEach((b) => {
            // A stacked row is usually a plain command, but it can be a split button
            // when that row carries its own flyout - see RibbonStackItem.
            const button =
                typeof b === "string"
                    ? RibbonPushButton.fromCommandName(b, "small")
                    : new RibbonSplitButton(b, "small");
            if (button) stack.append(button);
        });
        return stack;
    } else if (item.type === "push") {
        return new RibbonPushButton(item.command, item.icon, "large", item.onClick, item.display);
    } else if (item.type === "pulldown") {
        return new RibbonPulldownButton(item, "large");
    } else if (item.type === "split") {
        return new RibbonSplitButton(item, "large");
    } else if (item.type === "widget") {
        return createRibbonWidget(item.widget);
    } else {
        throw new Error("unknown ribbon button type");
    }
}

/** The live controls a ribbon group can hold, by name - see RibbonWidget. */
function createRibbonWidget(widget: RibbonWidgetKind): HTMLElement {
    if (widget === "layerControl") return new LayerControl();
    if (widget === "layersPanel") return new LayersRibbonPanel();
    if (widget === "autosaveStatus") return new AutosaveControl();
    throw new Error(`unknown ribbon widget: ${widget}`);
}

class DisplayConverter implements IConverter<number> {
    constructor(readonly predicate: (value: number) => boolean) {}

    convert(value: number): Result<string> {
        return Result.ok(this.predicate(value) ? "" : "none");
    }
}

export class RibbonGroupElement extends HTMLElement {
    #dropdown = new DropdownController(style.collapsedDropdown);

    constructor(readonly group: RibbonGroup) {
        super();
        this.className = style.ribbonGroup;
        this.initHTML();
    }

    dispose(): void {
        this.#dropdown.dispose();
    }

    private initHTML() {
        this.append(
            collection({
                className: style.content,
                sources: this.group.items,
                template: (item) => createRibbonButton(item),
            }),
            div(
                { className: style.headerContainer },
                label({ className: style.header, textContent: new Localize(this.group.groupName) }),
                div({
                    className: style.arrow,
                    style: {
                        display: new Binding(
                            this.group.collapsedItems,
                            "length",
                            new DisplayConverter((l: number) => l > 0),
                        ),
                    },
                    onclick: (e) => {
                        e.stopPropagation();
                        if (this.#dropdown.isOpened) {
                            this.#dropdown.close();
                        } else {
                            this.openDropdown((e.currentTarget as HTMLElement).parentElement as HTMLElement);
                        }
                    },
                }),
            ),
        );
    }

    private openDropdown(anchorEl: HTMLElement) {
        if (this.#dropdown.isOpened || this.group.collapsedItems.length === 0) return;

        this.#dropdown.open(anchorEl, (dropdown) => {
            for (const cmdKey of this.group.collapsedItems) {
                dropdown.append(
                    createDropdownItem(cmdKey, () => this.#dropdown.close(), {
                        item: style.collapsedDropdownItem,
                        icon: style.collapsedDropdownIcon,
                        text: style.collapsedDropdownText,
                    }),
                );
            }
        });
    }
}

customElements.define("ribbon-group", RibbonGroupElement);
