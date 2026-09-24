import type { IDocument } from "@draftworks/core";
import { type FloatPanel, showFloatPanel } from "../floatPanel";
import { LayerPanel } from "./layerPanel";

/**
 * Where the palette sits the first time it is opened. The width is set by the table
 * inside it: the columns are sized to fit their header words and come to ~565px with
 * the name column at its minimum, so opening narrower would show a cramped grid as the
 * default first impression. AutoCAD's own dialog is wide for the same reason.
 */
const DEFAULT_GEOMETRY = { x: 16, y: 120, width: 620, height: 420 };

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
        // Below this the grid's fixed columns no longer fit and the name column would be
        // squeezed out of usefulness; the table is the panel, so it sets the floor.
        minWidth: 570,
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
