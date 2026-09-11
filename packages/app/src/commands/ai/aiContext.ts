import { UnitSetup } from "@chili3d/core";
import { type GeneratorContext, MM_PER_DRAWING_UNIT } from "@chili3d/generators";

/**
 * Bridges the drawing's unit settings to the generators, which speak only millimetres.
 *
 * Both directions go through the same table, so a plot typed as 30' comes back labelled
 * 30'-0" in an architectural drawing and 9144 in a millimetre one, without any generator
 * knowing that units exist.
 */
export function generatorContext(): GeneratorContext {
    const settings = UnitSetup.settings;
    const mmPerUnit = MM_PER_DRAWING_UNIT[settings.baseUnit];
    return {
        format: (mm) => UnitSetup.formatLength(mm / mmPerUnit, settings),
        parseLength: (text) => {
            const units = UnitSetup.tryParseLength(text, settings);
            return units === undefined ? undefined : units * mmPerUnit;
        },
    };
}
