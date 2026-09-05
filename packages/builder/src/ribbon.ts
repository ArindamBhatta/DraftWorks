// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { RibbonTabProfile } from "@chili3d/core";

export const DefaultRibbon: RibbonTabProfile[] = [
    {
        tabName: "ribbon.tab.model",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: [
                    // Line's flyout holds AutoCAD's other "click through points" draw
                    // tools - Polyline (create.polygon; see commandAliases.ts, it's
                    // already aliased "pl"/"pline"/"polyline") and Ray.
                    { type: "split", items: ["create.line", "create.polygon", "create.ray"] },
                    // Rectangle's flyout holds Regular Polygon only.
                    { type: "split", items: ["create.rect", "create.regularPolygon"] },
                    "create.circle",
                ],
                // Only Line, Rectangle and Circle sit directly in the group; everything
                // else is one tap away behind the group's overflow arrow.
                collapsedItems: [
                    "create.ellipse",
                    "create.arc",
                    "create.arc2point",
                    "create.arc3point",
                    "create.point",
                    "create.bezier",
                    "create.hatch",
                ],
            },
            {
                groupName: "ribbon.group.modify",
                items: [
                    ["modify.move", "modify.copy", "modify.stretch"],
                    ["modify.rotate", "modify.mirror", "modify.scale"],
                    ["modify.trim", "modify.fillet", "modify.array"],
                    ["modify.explode", "modify.chamfer", "modify.join"],
                    ["modify.matchProp"],
                ],
            },
            //Layer
            {
                groupName: "ribbon.group.layer",
                // AutoCAD's Layers panel: the layer tools on top, the layer combo
                // underneath, which is where the current layer is actually read and set.
                items: [["layer.setup", "layer.moveToCurrent"], { type: "widget", widget: "layerControl" }],
            },
            //Tools
            {
                groupName: "ribbon.group.tools",
                items: [
                    "units.setup",
                    "dimension.setup",
                    "create.group",
                    ["create.offset", "create.copyShape"],
                ],
            },

            {
                groupName: "ribbon.group.annotation",
                items: [{ type: "split", items: ["create.text", "create.mtext"] }],
            },
            {
                groupName: "ribbon.group.dimension",
                items: [
                    "dimension.object",
                    { type: "split", items: ["dimension.linear", "dimension.aligned"] },
                    { type: "split", items: ["dimension.radius", "dimension.diameter"] },
                    { type: "split", items: ["dimension.angular"] },
                ],
            },
            {
                groupName: "ribbon.group.importExport",
                // The Autosave readout rides along here because this is the file group
                // and there is no Save button any more - saving is automatic, and this is
                // where a user goes looking for it before they believe that.
                items: ["file.import", "file.export", { type: "widget", widget: "autosaveStatus" }],
            },
        ],
    },
];
