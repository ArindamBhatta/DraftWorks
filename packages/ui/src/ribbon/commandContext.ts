// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    Binding,
    CancelableCommand,
    type Combobox,
    CommandStore,
    I18n,
    type I18nKeys,
    type ICancelableCommand,
    type ICommand,
    type IDisposable,
    isCancelableCommand,
    Localize,
    Observable,
    PathBinding,
    type Property,
    PropertyUtils,
    PubSub,
} from "@chili3d/core";
import {
    button,
    ColorConverter,
    createIcon,
    div,
    input,
    label,
    option,
    select,
    span,
    svg,
    UrlStringConverter,
} from "@chili3d/element";
import style from "./commandContext.module.css";

export class CommandContext extends HTMLElement implements IDisposable {
    private readonly propMap: Map<string | number | symbol, [Property, HTMLElement][]> = new Map();
    /**
     * The `<select>` behind each combobox property, so a change made anywhere else -
     * typed at the prompt, clicked in the status bar's `[Diameter]` - is reflected
     * here too. Without this the panel would keep showing the value it was built
     * with while the command had already moved on: two views, two answers.
     */
    private readonly comboboxes = new Map<string | number | symbol, [Combobox<any>, HTMLSelectElement]>();
    /**
     * The settings currently on show. A property can come and go while the command
     * runs - see setVisible and its dependencies - so this is kept rather than counted
     * once, and it is what decides whether the panel appears at all.
     */
    private readonly visibleProperties = new Set<string | number | symbol>();
    private readonly container = div({ className: style.container });
    private selectionControlContainer?: HTMLDivElement;
    private closeIcon?: HTMLElement;
    private selectionCountCleanups: Array<() => void> = [];

    constructor(readonly command: ICommand) {
        super();
        this.className = style.panel;
        this.append(this.container);
        this.render();
    }

    private render() {
        const data = CommandStore.getComandData(this.command);
        const icon = createIcon(data!.icon);
        icon.classList.add(style.icon);
        this.container.append(
            div(
                { className: style.command },
                icon,
                label({ className: style.title, textContent: new Localize(`command.${data!.key}`) }),
            ),
        );
        this.initContext();
        if (isCancelableCommand(this.command)) {
            this.closeIcon = div(
                { className: style.cancelButton },
                div(
                    {
                        className: style.selectionButton,
                        onclick: () => (this.command as CancelableCommand).cancel(),
                    },
                    svg({ icon: "icon-cancel" }),
                ),
            );
            this.container.append(this.closeIcon);
        }
        this.updateVisibility();
    }

    /**
     * Shows the panel only when it has something to offer, and takes it away again
     * when it does not.
     *
     * The command's own name and its cancel button do not count as content. A panel
     * carrying nothing else is a box floating over the drawing to tell the user the
     * name of the command they just typed - which the status bar and the command line
     * are already saying, in the two places they are looking. MOVE and PAN are exactly
     * that: they take picks, not settings, and both already exit on Escape. So they get
     * the drawing back, and the panel appears for the commands that genuinely have a
     * setting to offer - or, for any command, while it is waiting on a selection and
     * the panel is showing the count and the confirm button.
     */
    private updateVisibility() {
        const hasContent = this.visibleProperties.size > 0 || this.selectionControlContainer !== undefined;
        this.style.display = hasContent ? "" : "none";
    }

    private readonly showSelectionControl = (controller: AsyncController) => {
        if (this.selectionControlContainer) return;
        if (this.closeIcon) this.closeIcon.style.display = "none";

        this.selectionControlContainer = div(
            { className: style.selectionControl },
            div(
                { className: style.selectionInfo },
                this.countDom(),
                span({
                    className: style.selectionCountLabel,
                    textContent: new Localize("prompt.selectedCount"),
                }),
            ),
            div(
                { className: style.selectionButton, onclick: () => controller.success() },
                svg({ icon: "icon-confirm" }),
            ),
            div(
                { className: style.selectionButton, onclick: () => controller.cancel() },
                svg({ icon: "icon-cancel" }),
            ),
        );
        this.container.append(this.selectionControlContainer);
        this.updateVisibility();
    };

    private countDom() {
        const countSpan = span({ className: style.selectionCount, textContent: "0" });
        if (this.command instanceof CancelableCommand) {
            const sel = this.command.document.selection;
            const updateCount = () => {
                const count = sel.getSelectedShapes().length || sel.getSelectedNodeLength();
                countSpan.textContent = String(count);
            };
            updateCount();
            sel.onShapeChanged.sub(updateCount);
            sel.onNodeChanged.sub(updateCount);
            this.selectionCountCleanups.push(() => {
                sel.onShapeChanged.remove(updateCount);
                sel.onNodeChanged.remove(updateCount);
            });
        }
        return countSpan;
    }

    private readonly clearSelectionControl = () => {
        this.selectionControlContainer?.remove();
        this.selectionControlContainer = undefined;
        if (this.closeIcon) this.closeIcon.style.display = "";
        this.selectionCountCleanups.forEach((fn) => fn());
        this.selectionCountCleanups = [];
        this.updateVisibility();
    };

    connectedCallback(): void {
        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
        if (this.command instanceof Observable) {
            this.command.onPropertyChanged(this.onPropertyChanged);
        }
    }

    disconnectedCallback(): void {
        this.clearSelectionControl();
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        if (this.command instanceof Observable) {
            this.command.removePropertyChanged(this.onPropertyChanged);
        }
    }

    dispose() {
        this.propMap.clear();
        this.comboboxes.clear();
        this.visibleProperties.clear();
        this.disconnectedCallback();
    }

    private readonly onPropertyChanged = (property: string | number | symbol) => {
        if (this.propMap.has(property)) {
            const items = this.propMap.get(property)!;
            for (const [prop, control] of items) {
                this.setVisible(control, prop);
            }
            // A dependency may have just hidden the last setting on show, or revealed
            // the first one, so the panel itself has to be reconsidered.
            this.updateVisibility();
        }
        this.syncCombobox(property);
    };

    /** Point the dropdown at whatever the command's property now says. */
    private syncCombobox(property: string | number | symbol) {
        const entry = this.comboboxes.get(property);
        if (!entry) return;

        const [combobox, select] = entry;
        const index = combobox.items.indexOf((this.command as any)[property]);
        if (index < 0 || index === select.selectedIndex) return;

        combobox.selectedIndex = index;
        select.selectedIndex = index;
    }

    private initContext() {
        const groupMap = new Map<I18nKeys, HTMLDivElement>();
        const isCancelable = isCancelableCommand(this.command);
        const cancleProp: keyof ICancelableCommand = "cancel";

        PropertyUtils.getProperties(this.command).forEach((property) => {
            if (isCancelable && property.name === cancleProp) return;

            const group = this.findGroup(groupMap, property);
            const item = this.createItem(this.command, property);
            this.setVisible(item, property);
            this.cacheDependencies(item, property);
            group.append(item);
        });
    }

    private cacheDependencies(item: HTMLElement, g: Property) {
        if (g.dependencies) {
            for (const d of g.dependencies) {
                const items = this.propMap.get(d.property);
                this.propMap.set(d.property, [...(items ?? []), [g, item]]);
            }
        }
    }

    private setVisible(control: HTMLElement, property: Property) {
        let visible = !PropertyUtils.isHiddenProperty(this.command, property.name);
        if (visible && property.dependencies) {
            for (const d of property.dependencies) {
                if ((this.command as any)[d.property] !== d.value) {
                    visible = false;
                    break;
                }
            }
        }
        control.style.display = visible ? "inherit" : "none";
        if (visible) {
            this.visibleProperties.add(property.name);
        } else {
            this.visibleProperties.delete(property.name);
        }
    }

    private findGroup(groupMap: Map<I18nKeys, HTMLDivElement>, prop: Property) {
        let group = groupMap.get(prop.group!);
        if (group === undefined) {
            group = div({ className: style.group });
            groupMap.set(prop.group!, group);
            this.container.append(group);
        }
        return group;
    }

    private createItem(command: ICommand, g: Property) {
        const noType = command as any;
        const type = typeof noType[g.name];

        if (g.type === "materialId") {
            return this.materialEditor(g, noType);
        } else if (g.combobox) {
            return this.newCombobox(g, g.combobox);
        }

        switch (type) {
            case "function":
                return this.newButton(g, noType);
            case "boolean":
                return this.newCheckbox(g, noType);
            case "number":
                return this.newInput(g, noType, parseFloat);
            case "string":
                return this.newInput(g, noType);
            default:
                throw new Error("Unsupported property type");
        }
    }

    private newCombobox(g: Property, combobox: Combobox<any>) {
        // The command's own property is the source of truth, not the combobox: the
        // command may already hold a value remembered from its last run, and the
        // prompt can change it from under us while the panel is open.
        const current = combobox.items.indexOf((this.command as any)[g.name]);
        if (current >= 0) combobox.selectedIndex = current;

        const options = combobox.items.map((item, index) => {
            return option({
                selected: index === combobox.selectedIndex,
                textContent: I18n.isI18nKey(item)
                    ? new Localize(item)
                    : (combobox.converter?.convert(item).unchecked() ?? String(item)),
            });
        });

        const selectEl = select(
            {
                className: style.select,
                onchange: (e) => {
                    combobox.selectedIndex = (e.target as HTMLSelectElement).selectedIndex;
                    (this.command as any)[g.name] = combobox.selectedItem;
                },
            },
            ...options,
        );
        this.comboboxes.set(g.name, [combobox, selectEl]);

        return div(label({ textContent: new Localize(g.display) }), selectEl);
    }

    private newInput(g: Property, noType: any, converter?: (v: string) => any) {
        return div(
            label({ textContent: new Localize(g.display) }),
            input({
                type: "text",
                className: style.input,
                value: new Binding(noType, g.name),
                onblur: (e) => {
                    const input = e.target as HTMLInputElement;
                    noType[g.name] = converter ? converter(input.value) : input.value;
                },
                onkeydown: (e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        const input = e.target as HTMLInputElement;
                        input.blur();
                    }
                },
            }),
        );
    }

    private newCheckbox(g: Property, noType: any) {
        return div(
            label({ textContent: new Localize(g.display) }),
            input({
                type: "checkbox",
                checked: new Binding(noType, g.name),
                onclick: () => {
                    noType[g.name] = !noType[g.name];
                },
            }),
        );
    }

    private newButton(g: Property, noType: any) {
        return button({
            className: style.button,
            textContent: new Localize(g.display),
            onclick: () => noType[g.name](),
        });
    }

    private materialEditor(g: Property, noType: any) {
        if (!(this.command instanceof CancelableCommand)) {
            throw new Error("MaterialEditor only support CancelableCommand");
        }

        const document = this.command.document;
        const material = document.modelManager.materials.find((x) => x.id === noType[g.name])!;
        const display = material.clone();

        return button({
            className: style.materialButton,
            style: {
                backgroundColor: new Binding(display, "color", new ColorConverter()),
                backgroundImage: new PathBinding(display, "map.image", new UrlStringConverter()),
                backgroundBlendMode: "multiply",
                backgroundSize: "cover",
                cursor: "pointer",
            },
            textContent: new Localize(g.display),
            onclick: () => {
                PubSub.default.pub("editMaterial", document, material, (newMaterial) => {
                    noType[g.name] = newMaterial.id;
                    display.color = newMaterial.color;
                    display.map = newMaterial.map;
                });
            },
        });
    }
}

customElements.define("command-context", CommandContext);
