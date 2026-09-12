// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@draftworks/core";
import { type FloatPanel, showFloatPanel } from "../floatPanel";
import { LayerPanel } from "./layerPanel";

/** Where the palette sits the first time it is opened. */
const DEFAULT_GEOMETRY = { x: 16, y: 120, width: 340, height: 420 };

let geometry = { ...DEFAULT_GEOMETRY };
let panel: FloatPanel | undefined;

/**
 * Opens the Layer Properties Manager, or leaves the one already open alone - typing LA
 * twice should not stack two palettes. After that first call LayerPanel tracks the
 * active document itself (see its activeViewChanged subscription).
 */
export function showLayerPanel(document: IDocument) {
    if (panel?.isConnected) return;

    panel = showFloatPanel({
        title: "layer.header",
        content: new LayerPanel(document),
        ...geometry,
        minWidth: 260,
        minHeight: 200,
        onClose: rememberGeometry,
    });
}

function rememberGeometry() {
    if (panel) {
        const rect = panel.getBoundingClientRect();
        geometry = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }
    panel = undefined;
}
