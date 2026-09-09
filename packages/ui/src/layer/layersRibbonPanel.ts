import { type CommandKeys, I18n, type I18nKeys, Localize, PubSub } from "@chili3d/core";
import { div, label, svg } from "@chili3d/element";
import { LayerControl } from "./layerControl";
import style from "./layersRibbonPanel.module.css";

interface QuickAction {
    command: CommandKeys;
    /** The state icon worn on the corner of the layer stack - see the module CSS. */
    badge: string;
}

/**
 * The 5 x 2 grid, in AutoCAD's own order: each column pairs an action with its undo, so
 * Turn Off sits directly above Turn On and the pair is found by muscle memory rather
 * than by reading ten tooltips.
 */
const QUICK_ACTIONS: QuickAction[][] = [
    [
        { command: "layer.off", badge: "icon-eye-slash" },
        { command: "layer.isolate", badge: "icon-filter" },
        { command: "layer.freeze", badge: "icon-freeze" },
        { command: "layer.lock", badge: "icon-lock" },
        { command: "modify.matchProp", badge: "icon-matchProp" },
    ],
    [
        { command: "layer.on", badge: "icon-eye" },
        // A restore arrow rather than a "show everything" glyph: at 12px the grid icon
        // that would say "all layers" collapses into a smudge.
        { command: "layer.unisolate", badge: "icon-undo" },
        { command: "layer.thaw", badge: "icon-thaw" },
        { command: "layer.unlock", badge: "icon-unlock" },
        { command: "layer.copyToNew", badge: "icon-clone" },
    ],
];

/** The layer stack wearing a badge - the shape every tool in this panel is drawn as. */
function layerGlyph(badge: string, className: string) {
    return div(
        { className },
        svg({ icon: "icon-layer-group", className: style.glyphBase }),
        svg({ icon: badge, className: style.glyphBadge }),
    );
}

/**
 * Runs through PubSub rather than calling the command directly so it goes past
 * CommandService, which owns cancelling whatever command is already running. Half of
 * these prompt for a pick, and two picks competing for the mouse is not recoverable.
 */
function run(command: CommandKeys) {
    PubSub.default.pub("executeCommand", command);
}

/** Icon-only, as in AutoCAD - the name arrives on hover. */
function actionButton(action: QuickAction) {
    const button = div(
        { className: style.action, onclick: () => run(action.command) },
        layerGlyph(action.badge, style.glyph),
    );
    // I18n.set rather than a plain title, so the tooltip re-translates in place when the
    // language changes - the same call RibbonPushButton makes.
    I18n.set(button, "title", `command.${action.command}` as I18nKeys);
    return button;
}

/**
 * AutoCAD's Layers ribbon panel.
 *
 * Three things stacked the way the real one stacks them: Layer Properties standing alone
 * on the left as the way into the full manager, the current-layer combo top right (which
 * is where the current layer is actually read and set - see LayerControl), and the two
 * rows of quick actions beneath it.
 *
 * Holds no layer state of its own. The combo follows the active document by itself, and
 * the ten buttons are shortcuts to registered commands, so this class is layout only.
 */
export class LayersRibbonPanel extends HTMLElement {
    constructor() {
        super();
        this.className = style.root;
        this.append(this.propertiesButton(), this.actionStack());
    }

    private propertiesButton() {
        return div(
            {
                className: style.properties,
                title: I18n.translate("command.layer.setup"),
                onclick: () => run("layer.setup"),
            },
            layerGlyph("icon-cog", style.glyphLarge),
            label({
                className: style.propertiesLabel,
                textContent: new Localize("command.layer.setup"),
            }),
        );
    }

    private actionStack() {
        return div(
            { className: style.stack },
            new LayerControl(),
            div(
                { className: style.grid },
                // Column-major in the markup would match how the pairs read, but the grid
                // is row-major, so the rows are laid out in order and CSS does the rest.
                ...QUICK_ACTIONS.flatMap((row) => row.map(actionButton)),
            ),
        );
    }
}

customElements.define("chili-layers-ribbon-panel", LayersRibbonPanel);
