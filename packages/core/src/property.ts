import type { IConverter } from "./foundation";
import type { I18nKeys } from "./i18n";
import type { Combobox } from "./ui";

/**
 * `length` marks a number that is a distance in drawing units, so the palette shows and
 * accepts it in the drawing's unit format rather than as a bare number - see
 * LengthConverter. Angles, counts and scales are numbers and stay untagged.
 */
export type PropertyType = "color" | "materialId" | "lineType" | "length";

export interface Property {
    name: string;
    display: I18nKeys;
    converter?: IConverter;
    group?: I18nKeys;
    icon?: string;
    type?: PropertyType;
    dependencies?: {
        property: string | number | symbol;
        value: any;
    }[];
    /**
     * When every one of these matches, the setting stays on the panel but cannot be
     * changed.
     *
     * The difference from `dependencies` is what the user is told. A setting that does
     * not apply right now should go away; a setting that applies and has been decided
     * should stay, greyed, still saying what was decided. TRIM's mode is the second kind:
     * once a run has started cutting there is no changing it halfway, but "which mode am
     * I in" is exactly what the user is still asking - and a control that vanished at the
     * first click would answer it by leaving the question nowhere on screen.
     */
    disabledWhen?: {
        property: string | number | symbol;
        value: any;
    }[];
    combobox?: Combobox<any>;
    /**
     * The letter the prompt accepts for each of `combobox`'s items, in the same order -
     * Circle's mode is `["C", "2P", "3P"]` against centre/2-point/3-point.
     *
     * The panel and the prompt are two views of one setting, and a beginner who only
     * ever looks at the panel has no way to discover that the prompt takes `3P` unless
     * the panel says so. Showing the key beside the choice is what turns the panel from
     * somewhere to stay into somewhere to leave: click it for a month, read `3P` beside
     * it every time, then one day type it. Omitted where a setting has no prompt
     * equivalent, and the panel then shows the choice alone.
     */
    comboboxKeys?: string[];
}

const PropertyKeyMap = new Map<object, Map<string | number | symbol, Property>>();
const hiddenCommandPropertiesMap = new Map<object, Set<string | number | symbol>>();

export function property(display: I18nKeys, parameters?: Omit<Property, "name" | "display">) {
    return (target: object, name: string) => {
        if (!PropertyKeyMap.has(target)) {
            PropertyKeyMap.set(target, new Map());
        }
        PropertyKeyMap.get(target)?.set(name, { display, name, ...parameters });
    };
}

export function hideCommandProperty<T extends object>(target: T, props: (keyof T)[]) {
    if (!hiddenCommandPropertiesMap.has(target)) {
        hiddenCommandPropertiesMap.set(target, new Set(props));
    } else {
        const set = hiddenCommandPropertiesMap.get(target);
        for (const prop of props) {
            set!.add(prop);
        }
    }
}

export class PropertyUtils {
    static getProperties(target: any, until?: object): Property[] {
        const result: Property[] = [];
        PropertyUtils.getAllKeysOfPrototypeChain(target, result, until);
        return result;
    }

    static getOwnProperties(target: any): Property[] {
        const properties = PropertyKeyMap.get(target);
        if (!properties) return [];
        return [...properties.values()];
    }

    private static getAllKeysOfPrototypeChain(target: any, properties: Property[], until?: object) {
        if (!target || target === until) return;
        if (PropertyKeyMap.has(target)) {
            properties.splice(0, 0, ...PropertyKeyMap.get(target)!.values());
        }
        PropertyUtils.getAllKeysOfPrototypeChain(Object.getPrototypeOf(target), properties, until);
    }

    static getProperty<T extends object>(target: T, property: keyof T): Property | undefined {
        if (!target) return undefined;
        const map = PropertyKeyMap.get(target);
        if (map?.has(property)) return map.get(property);
        return PropertyUtils.getProperty(Object.getPrototypeOf(target), property);
    }

    static isHiddenProperty(target: any, property: string | number | symbol): boolean {
        if (!target) return false;
        const set = hiddenCommandPropertiesMap.get(target);
        if (set?.has(property)) return true;
        return PropertyUtils.isHiddenProperty(Object.getPrototypeOf(target), property);
    }
}
