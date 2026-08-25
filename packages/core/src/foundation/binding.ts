/** Acts as the bridge connecting the data model to the UI/DOM elements so you don't have to write manual event listeners everywhere. */

import type { IConverter } from "./converter";
import type { IPropertyChanged } from "./observer";

// Uses WeakRef and FinalizationRegistry to track DOM elements. When a bound UI element is removed and garbage-collected, the binding automatically cleans up its event listeners from the model.

const registry = new FinalizationRegistry((binding: PathBinding<IPropertyChanged>) => {
    binding.removeBinding();
});

// Subscribe to an IPropertyChanged source and automatically update a target DOM/UI property (e.g., an <input> field, button label, or panel property) whenever the model changes.

export class PathBinding<T extends IPropertyChanged = IPropertyChanged> {
    private _target?: { element: WeakRef<object>; property: PropertyKey };
    private _oldPathObjects?: { source: IPropertyChanged; property: string }[];
    private _actualSource?: { source: IPropertyChanged; property: string };

    constructor(
        readonly source: T,
        readonly path: string,
        public converter?: IConverter,
    ) {}

    //setBinding sets the target element and property for the binding, and registers the binding with the FinalizationRegistry to ensure proper cleanup when the target element is garbage collected.
    setBinding<U extends object>(element: U, property: keyof U) {
        if (this._target) throw new Error("Binding already set");
        this._target = { element: new WeakRef(element), property };
        registry.register(element, this);
        this.addPropertyChangedHandler();
    }
    //removeBinding removes the binding by unregistering the target element from the FinalizationRegistry, clearing the target reference, and removing any property changed handlers associated with the binding.
    removeBinding() {
        const element = this._target?.element.deref();
        if (element) registry.unregister(element);
        this._target = undefined;
        this.removePropertyChangedHandler();
    }

    //handleAllPathPropertyChanged is a private method that handles property changes for all properties in the binding path. It checks if the property change should trigger an update to the binding and, if so, removes and re-adds the property changed handlers to ensure the binding reflects the latest state.
    private readonly handleAllPathPropertyChanged = (property: string, source: any) => {
        if (this.shouldUpdateHandler(property, source)) {
            this.removePropertyChangedHandler();
            this.addPropertyChangedHandler();
        }
    };

    //handlePropertyChanged is a private method that handles property changes for the final property in the binding path. It updates the target element's property value when the observed property changes.
    private readonly handlePropertyChanged = (property: string, source: any) => {
        if (this.path.endsWith(property) && this._target) {
            this.setValue(source, property);
        }
    };

    //shouldUpdateHandler determines whether the property change should trigger an update to the binding.
    private shouldUpdateHandler(property: string, source: any) {
        if (this._oldPathObjects === undefined) {
            return true;
        }

        if (
            this._oldPathObjects.some((element) => element.property === property && element.source === source)
        ) {
            return true;
        }

        if (!this._actualSource) {
            return this.path.includes(property);
        }

        return false;
    }

    private addPropertyChangedHandler() {
        const props = this.path.split(".");
        let source: any = this.source;
        this._oldPathObjects = [];
        for (let i = 0; i < props.length; i++) {
            if (!source || !(props[i] in source)) break;

            const sourceProperty = { source, property: props[i] };
            if (i === props.length - 1) {
                this.setValue(source, props[i]);
                this._actualSource = sourceProperty;
                source.onPropertyChanged(this.handlePropertyChanged);
                break;
            }

            source.onPropertyChanged(this.handleAllPathPropertyChanged);
            this._oldPathObjects.push(sourceProperty);
            source = source[props[i]];
        }
    }

    private removePropertyChangedHandler() {
        if (!this._oldPathObjects) return;
        this._oldPathObjects.forEach((element) =>
            element.source.removePropertyChanged(this.handleAllPathPropertyChanged),
        );
        this._actualSource?.source.removePropertyChanged(this.handlePropertyChanged);
        this._actualSource = undefined;
        this._oldPathObjects = undefined;
    }

    private setValue(source: any, property: string) {
        if (!this._target) return;
        const element = this._target.element.deref();
        if (!element) return;

        const value = source[property];
        if (this.converter) {
            const converted = this.converter.convert(value);
            if (converted.isOk) (element as any)[this._target.property] = converted.value;
        } else {
            (element as any)[this._target.property] = value;
        }
    }

    getPropertyValue() {
        return this._actualSource
            ? (this._actualSource.source as any)[this._actualSource.property]
            : undefined;
    }
}

export class Binding<T extends IPropertyChanged = IPropertyChanged> extends PathBinding<T> {
    constructor(source: T, path: keyof T, converter?: IConverter) {
        super(source, path.toString(), converter);
    }
}
