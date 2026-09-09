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
            //Modify
            {
                groupName: "ribbon.group.modify",
                items: [
                    ["modify.move", "modify.copy", "modify.stretch"],
                    ["modify.rotate", "modify.mirror", "modify.scale"],
                    ["modify.trim", "modify.extend", "modify.fillet"],
                    ["modify.array", "modify.explode", "modify.chamfer"],
                    ["modify.join", "create.offset", "modify.matchProp"],
                ],
            },
            //Layer
            {
                groupName: "ribbon.group.layer",
                // AutoCAD's Layers panel, as one widget rather than a row of buttons:
                // Layer Properties on the left, and beside it the current-layer combo
                // over the two rows of LAY* quick actions. See LayersRibbonPanel.
                items: [{ type: "widget", widget: "layersPanel" }],
                // Move To Layer has no square in AutoCAD's grid, so it lives behind the
                // group's overflow arrow rather than being squeezed in as an eleventh.
                collapsedItems: ["layer.moveToCurrent"],
            },

            //Tools
            {
                groupName: "ribbon.group.tools",
                items: ["units.setup", "dimension.setup"],
            },

            //Annotation
            {
                groupName: "ribbon.group.annotation",
                items: [{ type: "split", items: ["create.text", "create.mtext"] }],
            },

            //Dimension
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
