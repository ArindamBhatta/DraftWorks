/** Data Layer Change tracking. */

import type { IDocument } from "../document";
// 1. IDisposable: Manages resource cleanup (prevents memory leaks by unregistering handlers & freeing memory).
import type { IDisposable } from "./disposable";
// 2. IEqualityComparer: Custom comparison logic (e.g. comparing 3D Vectors/Colors without relying solely).
import type { IEqualityComparer } from "./equalityComparer";

import { PropertyHistoryRecord } from "./history";

import { Logger } from "./logger";

import { Transaction } from "./transaction";

export type PropertyChangedHandler<T, K extends keyof T> = (property: K, source: T, oldValue: T[K]) => void;

/**
 * 3. IPropertyChanged Interface:
 * Represents an observable object that notifies subscribers whenever one of its properties changes.
 *
 * Why it is used:
 * - Reactive Data Binding: Allows UI, 3D viewport, and dependent components to react to data mutations.
 * - Undo/Redo (History): Works with HistoryObservable to record before/after state snapshots.
 * - Extends IDisposable: Ensures event listeners are cleanly unbound when the object is destroyed.
 */
export interface IPropertyChanged extends IDisposable {
    /** Register a callback invoked when a property value changes. */
    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
    /** Unregister a previously added property change callback. */
    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
    /** Remove all registered property change listeners. */
    clearPropertyChanged(): void;
}

export function isPropertyChanged(obj: object): obj is IPropertyChanged {
    return (
        obj &&
        typeof (obj as IPropertyChanged).onPropertyChanged === "function" &&
        typeof (obj as IPropertyChanged).removePropertyChanged === "function"
    );
}

/**
 * 4. Observable Class:
 * Implements IPropertyChanged, providing a base for objects that need to notify subscribers of property changes.
 *
 * Key Features:
 * - Property Change Notification: Emits events when properties are updated.
 * - Private Property Management: Uses a naming convention to manage private backing fields for public properties.
 * - Equality Comparison: Supports custom equality checks to avoid unnecessary notifications.
 * - Resource Cleanup: Implements IDisposable to clear event handlers and prevent memory leaks.
 */
export class Observable implements IPropertyChanged {
    protected readonly propertyChangedHandlers = new Set<PropertyChangedHandler<any, any>>();
    protected _isDisposed = false;

    private getPrivateKey<K extends keyof this>(pubKey: K) {
        return `_${String(pubKey)}`;
    }

    /**
     * The backing field, or the default this property was declared with.
     *
     * The default is taken as *passed*, not as "anything but undefined" - hence the
     * rest tuple rather than an optional parameter. `undefined` is a real default for
     * a property that may genuinely hold nothing (the command currently running, the
     * active view), and reading one of those before it is first set is the ordinary
     * case, not a mistake to warn about. What the warning is for is a property with no
     * default at all, which really has been read before anyone gave it a value.
     */
    protected getPrivateValue<K extends keyof this>(pubKey: K, ...defaultValue: [] | [this[K]]): this[K] {
        const privateKey = this.getPrivateKey(pubKey) as keyof this;
        return privateKey in this
            ? (this[privateKey] as this[K])
            : this.initializeDefaultValue(pubKey, defaultValue);
    }

    private initializeDefaultValue<K extends keyof this>(pubKey: K, defaultValue: [] | [this[K]]): this[K] {
        if (defaultValue.length === 0) {
            Logger.warn(
                `${this.constructor.name}: The property "${String(pubKey)}" is not initialized, and no default value is provided`,
            );
            return undefined as this[K];
        }

        this.setPrivateValue(pubKey, defaultValue[0]);
        return defaultValue[0];
    }

    setPrivateValue<K extends keyof this>(pubKey: K, newValue: this[K]): void {
        (this as any)[this.getPrivateKey(pubKey)] = newValue;
    }

    //Provides the observer/event-emitter pattern on objects. Whenever a property changes via setProperty(), it compares the old and new values and emits a property changed notification.
    protected setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        const oldValue = this[property];
        if (this.isEuqals(oldValue, newValue, equals)) return false;

        this.setPrivateValue(property, newValue);
        onPropertyChanged?.(property, oldValue);
        this.emitPropertyChanged(property, oldValue);
        return true;
    }

    private isEuqals<K extends keyof this>(
        oldValue: this[K],
        newValue: this[K],
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        return equals ? equals.equals(oldValue, newValue) : oldValue === newValue;
    }

    protected emitPropertyChanged<K extends keyof this>(property: K, oldValue: this[K]) {
        Array.from(this.propertyChangedHandlers).forEach((cb) => cb(property, this, oldValue));
    }

    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.propertyChangedHandlers.add(handler);
    }

    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.propertyChangedHandlers.delete(handler);
    }

    clearPropertyChanged(): void {
        this.propertyChangedHandlers.clear();
    }

    readonly dispose = () => {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.disposeInternal();
    };

    protected disposeInternal() {
        this.propertyChangedHandlers.clear();
    }
}

//Extends Observable to automatically push property diffs (PropertyHistoryRecord) into the document's Transaction manager for Undo & Redo support.
export abstract class HistoryObservable extends Observable {
    private _document: IDocument;

    get document(): IDocument {
        return this._document;
    }

    constructor(document: IDocument) {
        super();
        this._document = document;
    }

    protected override setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        return super.setProperty(
            property,
            newValue,
            (property, oldValue) => {
                onPropertyChanged?.(property, oldValue);
                Transaction.add(this.document, new PropertyHistoryRecord(this, property, oldValue, newValue));
            },
            equals,
        );
    }

    override disposeInternal() {
        super.disposeInternal();
        this._document = null as any;
    }
}
