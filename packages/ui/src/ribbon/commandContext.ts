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
    type StepOption,
} from "@draftworks/core";
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
} from "@draftworks/element";
import { stepOptionLabel } from "../stepOptionLabel";
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
    /**
     * The alternatives the live prompt is offering, as buttons - see showStepOptions.
     * Its own strip rather than part of the settings above, because these come and go
     * with the prompt while the settings stay for the whole command.
     */
    private readonly stepOptionsContainer = div({ className: style.stepOptions });
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
        this.container.append(this.stepOptionsContainer);
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
     * setting to offer - or, for any command, while its prompt is offering options, or
     * while it is waiting on a selection and the panel is showing the count and the
     * confirm button.
     */
    private updateVisibility() {
        const hasContent =
            this.visibleProperties.size > 0 ||
            this.stepOptionsContainer.childElementCount > 0 ||
            this.selectionControlContainer !== undefined;
        this.style.display = hasContent ? "" : "none";
    }

    /**
     * The prompt's bracketed alternatives, as buttons - `[Chamfer/Fillet]` while
     * RECTANG is waiting for its first corner, `[Close/Undo]` part-way through a run
     * of lines.
     *
     * They are the same options the command line is offering at that moment, running
     * the same StepOption.onSelect, so the two surfaces cannot disagree about what is
     * on offer - and they change as the command moves from one prompt to the next,
     * because that is what the prompt itself is doing. Each button carries the letter
     * it would have been typed as, picked out of its word, so using the panel teaches
     * the keystroke rather than replacing it.
     */
    private readonly showStepOptions = (options: StepOption[]) => {
        this.stepOptionsContainer.replaceChildren(
            ...options.map((option) =>
                button(
                    {
                        className: style.optionButton,
                        title: I18n.translate(option.display),
                        // The pick is still live behind this click. Focus would go to
                        // the button and take the keyboard away from the view, which is
                        // what carries Escape and the option keys to the command.
                        onmousedown: (e: MouseEvent) => e.preventDefault(),
                        onclick: (e: MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            option.onSelect();
                        },
                    },
                    ...stepOptionLabel(option, style.optionKey),
                ),
            ),
        );
        this.updateVisibility();
    };

    private readonly clearStepOptions = () => {
        if (this.stepOptionsContainer.childElementCount === 0) return;
        this.stepOptionsContainer.replaceChildren();
        this.updateVisibility();
    };

    private readonly showSelectionControl = (controller: AsyncController) => {
        if (this.selectionControlContainer) return;
        if (this.closeIcon) this.closeIcon.style.display = "none";

        this.selectionControlContainer = div(
            { className: style.selectionControl },
            div(
                { className: style.selectionInfo, title: I18n.translate("prompt.selectedCount.tip") },
                span({
                    className: style.selectionCountLabel,
                    textContent: new Localize("prompt.selectedCount"),
                }),
                this.countDom(),
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
        PubSub.default.sub("showStepOptions", this.showStepOptions);
        PubSub.default.sub("clearStepOptions", this.clearStepOptions);
        if (this.command instanceof Observable) {
            this.command.onPropertyChanged(this.onPropertyChanged);
        }
    }

    disconnectedCallback(): void {
        this.clearSelectionControl();
        this.clearStepOptions();
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.remove("showStepOptions", this.showStepOptions);
        PubSub.default.remove("clearStepOptions", this.clearStepOptions);
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
                this.setDisabled(control, prop);
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
            this.setDisabled(item, property);
            this.cacheDependencies(item, property);
            group.append(item);
        });
    }

    private cacheDependencies(item: HTMLElement, g: Property) {
        // Both kinds of condition are watched the same way: whichever property they name
        // is what has to change for the control to be reconsidered.
        for (const d of [...(g.dependencies ?? []), ...(g.disabledWhen ?? [])]) {
            const items = this.propMap.get(d.property);
            this.propMap.set(d.property, [...(items ?? []), [g, item]]);
        }
    }

    /**
     * Greys out a setting the command has stopped accepting answers to.
     *
     * The control stays where it was and keeps showing its value - see Property's
     * `disabledWhen` for why that is the point - so this only has to take away the ways
     * in: pointer events for the mouse, and the form control's own `disabled` for the
     * keyboard and for screen readers.
     */
    private setDisabled(control: HTMLElement, property: Property) {
        // A setting the command was started on - picked from a ribbon flyout entry such
        // as "Circle - Center, Diameter" - is locked for the whole run, so it is checked
        // before (and independently of) disabledWhen's value-dependent condition.
        const locked = isCancelableCommand(this.command)
            ? (this.command as CancelableCommand).lockedProperties.has(property.name)
            : false;
        if (!locked && !property.disabledWhen) return;

        const disabled =
            locked ||
            (property.disabledWhen?.every((d) => (this.command as any)[d.property] === d.value) ?? false);
        control.classList.toggle(style.disabled, disabled);
        control.querySelectorAll("select, input, button").forEach((element) => {
            (element as HTMLSelectElement | HTMLInputElement | HTMLButtonElement).disabled = disabled;
        });
    }

    private setVisible(control: HTMLElement, property: Property) {
        let visible = !PropertyUtils.isHiddenProperty(this.command, property.name);
        if (visible && property.dependencies) {
            for (const d of property.dependencies) {
                // A list of values is OR within the one condition - see Property.dependencies.
                const current = (this.command as any)[d.property];
                const matches = Array.isArray(d.value) ? d.value.includes(current) : current === d.value;
                if (!matches) {
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
        } else if (g.type === "color") {
            return this.newColorInput(g, noType);
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
            const optionEl = option({
                selected: index === combobox.selectedIndex,
                textContent: I18n.isI18nKey(item)
                    ? new Localize(item)
                    : (combobox.converter?.convert(item).unchecked() ?? String(item)),
            });
            // The prompt's key for this same choice, so the panel names the thing the
            // user could have typed - see Property.comboboxKeys. Appended after the
            // label rather than built into it so that the translated word stays the
            // exact substring changeLanguage swaps out.
            const key = g.comboboxKeys?.[index];
            if (key) optionEl.textContent += ` (${key})`;
            return optionEl;
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

    /**
     * A colour setting, as the swatch the platform already knows how to pick one with.
     * The hex the input hands back is what a command stores if it was holding a string
     * (GRADIENT's ends, which go straight into a canvas fill); a command holding a
     * number - the form every material and layer colour takes - gets a number back.
     */
    private newColorInput(g: Property, noType: any) {
        const converter = new ColorConverter();
        return div(
            label({ textContent: new Localize(g.display) }),
            input({
                type: "color",
                className: style.color,
                value: new Binding(noType, g.name, converter),
                onchange: (e) => {
                    const value = (e.target as HTMLInputElement).value;
                    if (typeof noType[g.name] !== "number") {
                        noType[g.name] = value;
                        return;
                    }
                    const parsed = converter.convertBack(value);
                    if (parsed.isOk) noType[g.name] = parsed.value;
                },
            }),
        );
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
