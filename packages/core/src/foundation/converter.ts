/**
 * CONVERTER INTERFACE - Data Format and Unit Transformations
 *
 * Essential for multiple conversion scenarios in 2D CAD:
 *
 * 1. Unit Conversions:
 *    - Millimeters ↔ Inches ↔ Centimeters (CAD typically stores in mm internally)
 *    - User inputs in different units based on workflow
 *    - DXF/DWG files may be in different units
 *
 * 2. File Format Conversions:
 *    - DXF (AutoCAD exchange format) ↔ internal representation
 *    - DWG, SVG, PDF import/export
 *    - JSON serialization for storage/transmission
 *
 * 3. Type Conversions:
 *    - String → Point, Vector, Angle (parsing user input)
 *    - Decimal → Fractional notation (1.5" = 1-1/2")
 *    - RGB → HSL color space conversions
 *
 * Benefits for CAD:
 * 1. Abstraction: converters can be swapped without affecting core
 * 2. Bidirectional: convert() and convertBack() for round-trip conversion
 * 3. Error handling: Result<T> captures conversion failures
 * 4. Extensible: add new converters for new file formats or units
 * 5. Testable: converters are pure functions
 */

import type { Result } from "./result";

export interface IConverter<TFrom = unknown, TTo = string> {
    convert(value: TFrom): Result<TTo>;
    convertBack?(value: TTo): Result<TFrom>;
}
