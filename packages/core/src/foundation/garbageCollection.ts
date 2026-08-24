/**
 * GARBAGE COLLECTION - Resource Management and Memory Cleanup
 *
 * Critical for managing temporary resources in 2D CAD operations:
 * - Graphics contexts (WebGL/Canvas state during rendering)
 * - Temporary geometric objects (construction lines, temporary selections)
 * - File handles during import/export operations
 * - Event listeners and subscriptions during command execution
 *
 * Usage pattern:
 * ```
 * gc(collect => {
 *   const tempGeom = collect(new Circle(...));  // Auto-cleanup
 *   const canvas = collect(createContext());    // Auto-cleanup
 *   // use tempGeom and canvas
 * }); // Everything cleaned up automatically
 * ```
 *
 * Benefits for CAD:
 * 1. Prevents memory leaks from temporary objects created during operations
 * 2. Ensures graphics resources are freed after rendering passes
 * 3. Simplifies cleanup code - guaranteed execution even if errors occur
 * 4. Essential for long-running CAD sessions with many draw/modify operations
 */

import { type IDisposable, isDisposable } from "./disposable";

export interface Deletable {
    delete(): void;
}

export function isDeletable(value: unknown): value is Deletable {
    return typeof (value as any)?.delete === "function" && (value as any).delete.length === 0;
}

export const gc = <R>(action: (collect: <T extends Deletable | IDisposable>(resource: T) => T) => R): R => {
    const resources = new Set<Deletable | IDisposable>();

    const collectResource = <T extends Deletable | IDisposable>(resource: T) => {
        resources.add(resource);
        return resource;
    };

    try {
        return action(collectResource);
    } finally {
        for (const resource of resources) {
            if (isDeletable(resource)) {
                resource.delete();
            } else if (isDisposable(resource)) {
                resource.dispose();
            }
        }
        resources.clear();
    }
};
