import type { RibbonTabProfile } from "@draftworks/core";

export const DefaultRibbon: RibbonTabProfile[] = [
    {
        tabName: "ribbon.tab.model",
        groups: [
            {
                groupName: "ribbon.group.draw",
                // Laid out like AutoCAD 2013's Draw panel: four large buttons across the
                // top, then a column of small split buttons beside them.
                items: [
                    "create.line",
                    // Polyline is create.polygon; see commandAliases.ts, where it is
                    // already aliased "pl"/"pline"/"polyline".
                    "create.polygon",
                    // Circle's flyout holds Construction Line, the other "click through
                    // points" tool that has no panel square of its own.
                    { type: "split", items: ["create.circle", "create.constructionLine"] },

                    // Arc's flyout holds its 2-point and 3-point variants.
                    { type: "split", items: ["create.arc", "create.arc2point", "create.arc3point"] },
                    // The stacked column - each row keeps its own arrow, so Rectangle can
                    // reach Regular Polygon without the user going near the panel's
                    // overflow. Ellipse and Hatch have no variant to offer yet; they keep
                    // an arrow of their own so the column stays one shape as they grow.
                    [
                        { type: "split", items: ["create.rect", "create.regularPolygon"] },
                        { type: "split", items: ["create.ellipse"] },
                        { type: "split", items: ["create.hatch"] },
                    ],
                ],
                // Point and Bezier are the only tools with no natural parent flyout, so
                // they are what the group's overflow arrow is for.
                collapsedItems: ["create.point", "create.bezier"],
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

            //import/Export
            {
                groupName: "ribbon.group.importExport",
                // The Autosave readout rides along here because this is the file group
                // and there is no Save button any more - saving is automatic, and this is
                // where a user goes looking for it before they believe that.
                items: ["file.import", "file.export", { type: "widget", widget: "autosaveStatus" }],
            },

            //AI
            {
                groupName: "ribbon.group.ai",
                // Draft opens the prompt palette; Setup is where the API key goes, and it
                // sits beside Draft rather than in Tools because a key is the first thing
                // Draft asks for and the only thing that can stop it working.
                items: ["ai.draft", "ai.setup"],
            },
        ],
    },
];
