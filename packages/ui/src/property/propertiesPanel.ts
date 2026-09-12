// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode } from "@draftworks/core";
import { type FloatPanel, showFloatPanel } from "../floatPanel";
import { PropertyView } from "./propertyView";

/**
 * Where the palette sits the first time it is opened: down the left, clear of the
 * ribbon, which is where AutoCAD docks it and where the sidebar used to be.
 */
const DEFAULT_GEOMETRY = { x: 16, y: 120, width: 320, height: 440 };

let geometry = { ...DEFAULT_GEOMETRY };
let panel: FloatPanel | undefined;
let view: PropertyView | undefined;

/**
 * Opens the properties palette, or refreshes the one already open - typing PR twice
 * should not stack two palettes. Where the user dragged and sized it is remembered for
 * the next time it is opened, as a palette should.
 */
export function showPropertiesPanel(document: IDocument, nodes: INode[]) {
    if (!panel?.isConnected) {
        view = new PropertyView();
        panel = showFloatPanel({
            title: "properties.header",
            content: view,
            ...geometry,
            minWidth: 240,
            minHeight: 160,
            onClose: rememberGeometry,
        });
    }

    view?.showProperties(document, nodes);
}

function rememberGeometry() {
    if (panel) {
        const rect = panel.getBoundingClientRect();
        geometry = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }
    panel = undefined;
    view = undefined;
}
