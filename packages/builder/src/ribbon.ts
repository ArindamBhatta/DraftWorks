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
                    "create.line",
                    {
                        type: "split",
                        items: ["create.rect", "create.circle", "create.ellipse", "create.regularPolygon"],
                    },
                    {
                        type: "split",
                        items: ["create.arc", "create.arc2point", "create.arc3point"],
                    },
                ],
                collapsedItems: ["create.point", "create.polygon", "create.bezier", "create.hatch"],
            },
            {
                groupName: "ribbon.group.modify",
                items: [
                    "modify.move",
                    ["modify.rotate", "modify.mirror", "modify.array"],
                    ["modify.trim", "modify.split", "modify.break"],
                    ["modify.fillet", "modify.chamfer"],
                    "modify.deleteNode",
                ],
            },
            {
                groupName: "ribbon.group.converter",
                items: ["convert.toWire", ["convert.toFace"]],
            },
            {
                groupName: "ribbon.group.view",
                items: ["view.pan"],
            },
            {
                groupName: "ribbon.group.tools",
                items: [
                    "units.setup",
                    ["dimension.setup", "mv.setup"],
                    "create.group",
                    ["create.offset", "create.copyShape"],
                ],
            },
            {
                groupName: "ribbon.group.layer",
                items: ["layer.setup", "layer.moveToCurrent"],
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
                groupName: "ribbon.group.measure",
                items: [["measure.length", "measure.angle", "measure.select"]],
            },
            {
                groupName: "ribbon.group.importExport",
                items: ["file.import", "file.export"],
            },
        ],
    },
];
