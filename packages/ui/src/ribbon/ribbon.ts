// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Binding,
    type IApplication,
    type IConverter,
    Result,
    type Ribbon,
    type RibbonGroup,
    type RibbonTab,
    type RibbonTabKeys,
} from "@draftworks/core";
import { collection } from "@draftworks/element";
import style from "./ribbon.module.css";
import { RibbonGroupElement } from "./ribbonGroup";

class DisplayConverter<T> implements IConverter<T> {
    constructor(readonly predicate: (value: T) => boolean) {}

    convert(value: T): Result<string> {
        return Result.ok(this.predicate(value) ? "" : "none");
    }
}

/**
 * The ribbon is the command groups and nothing else. The title bar that used to sit above
 * them - app name and version, the save/export/undo/redo quick buttons, the language and
 * theme pickers, the drawing tabs - is gone: saving is automatic, the app is
 * English-only and dark-only, and the commands behind those buttons are all still one
 * typed word away on the command line (`save`, `saveas`, `new`, `open`, `u`, `redo`).
 */
export class RibbonUI extends HTMLElement {
    constructor(
        readonly app: IApplication,
        readonly dataContent: Ribbon,
    ) {
        super();
        this.className = style.root;
        this.append(this.ribbonTabs());
        app.mainWindow?.ribbon.onPropertyChanged(this.handleRibbonChanged);
    }

    private readonly handleRibbonChanged = (key: keyof Ribbon) => {
        if (key === "editableTabs") {
            if (this.dataContent.editableTabs.length > 0) {
                const groups = this.querySelectorAll(`.${style.groupPanel}`);
                for (const group of groups) {
                    const tab = (group as HTMLElement).dataset["tab"] as RibbonTabKeys;
                    if (this.dataContent.editableTabs.includes(tab)) {
                        group.classList.remove(style.disabled);
                    } else {
                        group.classList.add(style.disabled);
                    }
                }
            } else {
                const groups = this.querySelectorAll(`.${style.disabled}`);
                for (const group of groups) {
                    group.classList.remove(style.disabled);
                }
            }
        }
    };

    private ribbonTabs() {
        return collection({
            className: style.tabContentPanel,
            sources: this.dataContent.tabs,
            template: (tab: RibbonTab) => this.ribbonTab(tab),
        });
    }

    private ribbonTab(tab: RibbonTab) {
        return collection({
            className: style.groupPanel,
            dataset: { tab: tab.tabName },
            sources: tab.groups,
            style: {
                display: new Binding(
                    this.dataContent,
                    "activeTab",
                    new DisplayConverter((tb: RibbonTab) => tab === tb),
                ),
            },
            template: (group: RibbonGroup) => new RibbonGroupElement(group),
        });
    }
}

customElements.define("chili-ribbon", RibbonUI);
