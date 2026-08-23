/**
 * OBJECT STORAGE - User Preferences and App State Persistence
 *
 * Stores non-drawing data using browser localStorage:
 * - User interface preferences (toolbar positions, panel layouts, theme)
 * - Recent files list and project history
 * - Snap settings, grid configuration, unit preferences (mm vs inches)
 * - Keyboard shortcuts and tool customization
 * - Draft/unsaved work state for crash recovery
 * - Viewport state (zoom, pan position, active layers)
 *
 * Benefits for 2D CAD:
 * 1. Persistent UI state across sessions (user doesn't reconfigure every time)
 * 2. Fast startup with familiar layout and tool settings
 * 3. Project-specific preferences can be loaded for different workflows
 * 4. Lightweight key-value storage perfect for app configuration
 * 5. Automatic JSON serialization/deserialization
 *
 * Example usage:
 * - Save grid size when user changes it → restore on next session
 * - Save active layers → continue working on same layers
 * - Save viewport zoom → user returns to same view
 */

export class ObjectStorage {
    static readonly default = new ObjectStorage("chili3d", "app");

    private readonly prefix: string;

    constructor(organization: string, application: string) {
        this.prefix = `${organization}.${application}.`;
    }

    setValue(key: string, value: object): void {
        const storageKey = this.prefix + key;
        try {
            const stringValue = JSON.stringify(value);
            localStorage.setItem(storageKey, stringValue);
        } catch (error) {
            console.error(`Failed to set setting ${key}:`, error);
        }
    }

    value<T>(key: string, defaultValue?: T): T | undefined {
        const storageKey = this.prefix + key;
        const item = localStorage.getItem(storageKey);
        if (!item) {
            return defaultValue;
        }

        try {
            return JSON.parse(item) as T;
        } catch (error) {
            console.error(`Failed to get setting ${key}:`, error);
            return defaultValue;
        }
    }

    remove(key: string): void {
        const storageKey = this.prefix + key;
        localStorage.removeItem(storageKey);
    }

    clear(): void {
        Object.keys(localStorage).forEach((key) => {
            if (key.startsWith(this.prefix)) {
                localStorage.removeItem(key);
            }
        });
    }
}
