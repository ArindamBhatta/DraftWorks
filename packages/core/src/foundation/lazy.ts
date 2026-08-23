/**
 * LAZY INITIALIZATION - Deferred Object Creation
 *
 * Critical performance optimization for 2D CAD applications:
 * - Defer expensive computations until actually needed
 * - Examples in CAD: viewport camera setup, rendering engines, spatial indexes
 * - Many drawing features may never be used in a session (reduce memory footprint)
 * - Lazy properties on entities (bounding boxes calculated on first access)
 *
 * Benefits:
 * 1. Faster application startup (don't initialize unused features)
 * 2. Reduced memory usage for large drawings with many objects
 * 3. Only pay the cost when a feature is actually used
 * 4. Common pattern: "Just-in-time compilation" for geometry calculations
 */

export class Lazy<T> {
    #value?: T;
    readonly #factory: () => T;

    constructor(factory: () => T) {
        this.#factory = factory;
    }

    get value(): T {
        if (this.#value === undefined) {
            this.#value = this.#factory();
        }
        return this.#value;
    }
}
