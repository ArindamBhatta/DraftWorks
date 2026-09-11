import { DimensionSetup, type GeometryFact, I18n, Localize, UnitSetup, type VisualNode } from "@chili3d/core";
import { div, input, label } from "@chili3d/element";
import commonStyle from "./common.module.css";
import style from "./input.module.css";
import baseStyle from "./propertyBase.module.css";

/**
 * The measured rows at the foot of the Geometry section - Delta X/Y/Z, Length and Angle
 * on a line, Diameter and Area on a circle. See VisualNode.geometryFacts for why these
 * are reported rather than edited.
 *
 * They are grouped in one element rather than one per row because every one of them is
 * recomputed by the same events: any change to any selected node can move all of them
 * at once, and a line dragged with grips should not leave a stale Length behind.
 */
export class GeometryFactsView extends HTMLElement {
    constructor(readonly objects: VisualNode[]) {
        super();
        this.refresh();
    }

    connectedCallback() {
        this.objects.forEach((x) => x.onPropertyChanged(this.refresh));
    }

    disconnectedCallback() {
        this.objects.forEach((x) => x.removePropertyChanged(this.refresh));
    }

    /** True when nothing in the selection has anything to measure. */
    get isEmpty(): boolean {
        return this.objects.every((x) => x.geometryFacts().length === 0);
    }

    private readonly refresh = () => {
        const columns = this.objects.map((x) => x.geometryFacts());
        this.replaceChildren(...this.rows(columns).map(([display, text]) => this.row(display, text)));
    };

    /**
     * Pairs up each node's facts by position, keeping only the rows every selected node
     * reports under the same name. A mixed selection has no shared measurement to show,
     * and a row that means Length for one object and Diameter for the next would be
     * worse than no row at all.
     */
    private rows(columns: GeometryFact[][]): [GeometryFact, string][] {
        const first = columns[0] ?? [];
        const result: [GeometryFact, string][] = [];

        for (let i = 0; i < first.length; i++) {
            const facts = columns.map((x) => x[i]);
            if (facts.some((fact) => fact?.display !== first[i].display)) continue;

            const texts = new Set(facts.map(formatFact));
            result.push([first[i], texts.size === 1 ? texts.values().next().value! : varies()]);
        }
        return result;
    }

    private row(fact: GeometryFact, text: string) {
        return div(
            { className: baseStyle.panel },
            div(
                { className: commonStyle.panel },
                label({ className: commonStyle.propertyName, textContent: new Localize(fact.display) }),
                input({ className: style.box, readOnly: true, value: text }),
            ),
        );
    }
}

customElements.define("chili-geometry-facts", GeometryFactsView);

function varies() {
    return I18n.translate("properties.multivalue");
}

/**
 * Lengths get the drawing's own unit format, so a measurement in the palette reads the
 * same as the one on a dimension. Angles and areas have no feet-and-inches form, so they
 * fall back to plain decimals at a matching number of places.
 */
function formatFact(fact: GeometryFact): string {
    if (fact.kind === "length") return UnitSetup.formatLength(fact.value);
    return fact.value.toFixed(DimensionSetup.decimalPlaces(UnitSetup.settings.precision));
}
