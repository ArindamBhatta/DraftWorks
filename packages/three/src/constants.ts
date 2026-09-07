export class Constants {
    static readonly Layers = Object.freeze({
        Default: 0,
        Wireframe: 1,
        Solid: 2,
        /**
         * Painted faces - hatches. Separate from Solid because "wireframe" in this 2D
         * app means outlines rather than shaded surfaces, so Solid is switched off; a
         * hatch is still part of the drawing and has to survive that.
         */
        Fill: 3,
        Isolation: 30,
    });
}
