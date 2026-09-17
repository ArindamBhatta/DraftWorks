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
                    // Circle's flyout lists its drawing methods the way AutoCAD's does -
                    // one command, CIRCLE, started on different settings. Picking one
                    // answers `mode`/`sizeMode` up front, so the panel shows them locked
                    // while the prompt still offers `[3P/2P]`. Tan-Tan-* are listed and
                    // greyed: the tangent solve is not implemented (see circle.ts).
                    {
                        type: "split",
                        // The face is the generic Circle: no preset, so every setting in
                        // the command panel stays editable - the user asked for a circle
                        // and has not said which kind. The menu below is where they do.
                        primary: {
                            type: "method",
                            command: "create.circle",
                            display: "command.create.circle",
                            icon: "icon-circle",
                        },
                        items: [
                            {
                                type: "method",
                                command: "create.circle",
                                display: "method.circle.centerRadius",
                                icon: "icon-circle",
                                preset: {
                                    mode: "option.command.circleMode.center",
                                    sizeMode: "option.command.circleSizeMode.radius",
                                },
                            },
                            {
                                type: "method",
                                command: "create.circle",
                                display: "method.circle.centerDiameter",
                                icon: "icon-circle",
                                preset: {
                                    mode: "option.command.circleMode.center",
                                    sizeMode: "option.command.circleSizeMode.diameter",
                                },
                            },
                            {
                                type: "method",
                                command: "create.circle",
                                display: "method.circle.twoPoint",
                                icon: "icon-circle",
                                preset: { mode: "option.command.circleMode.twoPoint" },
                            },
                            {
                                type: "method",
                                command: "create.circle",
                                display: "method.circle.threePoint",
                                icon: "icon-circle",
                                preset: { mode: "option.command.circleMode.threePoint" },
                            },
                            {
                                type: "method",
                                command: "create.circle",
                                display: "method.circle.tanTanRadius",
                                icon: "icon-circle",
                                disabled: true,
                            },
                            {
                                type: "method",
                                command: "create.circle",
                                display: "method.circle.tanTanTan",
                                icon: "icon-circle",
                                disabled: true,
                            },
                        ],
                    },
                    // Arc's flyout holds its 2-point and 3-point variants.
                    { type: "split", items: ["create.arc", "create.arc2point", "create.arc3point"] },
                    // The stacked column - each row keeps its own arrow, so Rectangle can
                    // reach Regular Polygon without the user going near the panel's
                    // overflow. Ellipse has no variant to offer yet; it keeps an arrow of
                    // its own so the column stays one shape as it grows.
                    // Three rows is the column's limit: .content is a fixed 72px with
                    // overflow hidden, so a fourth row would be clipped rather than
                    // wrapped - a second column is how the panel grows from here.
                    [
                        { type: "split", items: ["create.rect", "create.regularPolygon"] },
                        {
                            type: "split",
                            // Like Circle's, the face is the generic tool and the menu
                            // names ways of drawing it. Elliptical Arc is missing because
                            // the kernel draws only whole ellipses - see ellipse.ts.
                            primary: {
                                type: "method",
                                command: "create.ellipse",
                                display: "command.create.ellipse",
                                icon: "icon-ellipse",
                            },
                            items: [
                                {
                                    type: "method",
                                    command: "create.ellipse",
                                    display: "option.ellipse.mode.axisEnd",
                                    icon: "icon-ellipse",
                                    preset: { mode: "option.ellipse.mode.axisEnd" },
                                },
                                {
                                    type: "method",
                                    command: "create.ellipse",
                                    display: "option.ellipse.mode.center",
                                    icon: "icon-ellipse",
                                    preset: { mode: "option.ellipse.mode.center" },
                                },
                            ],
                        },
                        // AutoCAD's Hatch row, with the two commands that share its
                        // boundary question behind the same arrow: Gradient fills the
                        // region with a colour ramp instead of a pattern, and Boundary
                        // draws the region itself as an object.
                        {
                            type: "split",
                            items: ["create.hatch", "create.gradient", "create.boundary"],
                        },
                    ],
                ],
                // Point and Bezier are the only tools with no natural parent flyout, so
                // they are what the group's overflow arrow is for.
                collapsedItems: [
                    "create.point",
                    "create.bezier",
                    "create.constructionLine",
                    "create.revisionCloud",
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
                ],
            },

            //import/Export
            {
                groupName: "ribbon.group.importExport",
                // The Autosave readout rides along here because this is the file group
                // and there is no Save button any more - saving is automatic, and this is
                // where a user goes looking for it before they believe that.
                items: [
                    "file.import",
                    "file.export",
                    "file.plot",
                    { type: "widget", widget: "autosaveStatus" },
                ],
            },

            //AI
            {
                groupName: "ribbon.group.ai",
                // Draft opens the prompt palette; Elevation works from the drawing
                // instead, so it sits beside Draft rather than in a view group. Setup is
                // where the API key goes, and it is last because it is the only one of
                // the three that draws nothing.
                items: ["ai.draft", "ai.elevation", "ai.setup"],
            },
        ],
    },
];
