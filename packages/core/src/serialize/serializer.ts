import type { IDocument } from "../document";
import { Observable } from "../foundation/observer";

/**
 * This file is the save/load (persistence) engine for the CAD document.
 *
 * Every "live" object in the app — a shape's placement (`Matrix4`), a point (`XYZ`), a sketch,
 * a parameter, a material — is a normal TypeScript class instance in memory. But a CAD document
 * needs to be written to disk as plain JSON (and read back), and the exact same round-trip is also
 * reused for undo/redo history snapshots and for copy/paste (clone an object graph by serializing
 * it and immediately deserializing the copy).
 *
 * Rather than hand-writing a `toJSON`/`fromJSON` for every single class, this uses a small
 * reflection-based registry driven by two decorators:
 *   - `@serializable()` on a CLASS registers its constructor (so deserializing can call `new ctor(...)`).
 *   - `@serialize()` on a PROPERTY registers "this field's value must be included when saving".
 * (You've already seen these in action: `Matrix4` is decorated with `@serializable()` and its
 * `array` getter with `@serialize()`, so a shape's placement matrix survives a save/reload.)
 *
 * Every serialized object is stamped with a special `__cla$$__` key naming its class, so loading
 * knows which constructor to reconstruct it with — this is what makes the format self-describing.
 */

// prototype -> which of its own properties are marked @serialize() (i.e. "include me when saving").
const propertiesMap = new Map<new (...args: any[]) => any, Array<PropertyInfo>>();
// class name -> how to construct/serialize/deserialize that class (the "reflection" registry).
const reflectMap = new Map<string, RefelectData>();

export type PropertyInfo = {
    name: string;
    readonly?: boolean;
};

/** The JSON key used to record which registered class produced a serialized object, so it can be reconstructed on load. */
export const InternalClassName = "__cla$$__";

export type SerializedData = { [x: string]: any };

export type Serialized = { [InternalClassName]: string } & SerializedData;

export interface RefelectData {
    ctor: new (...args: any[]) => any;
    /** Custom "object -> plain data" logic, for classes that can't just be auto-serialized property-by-property (e.g. typed arrays). */
    serialize?: (target: any) => SerializedData;
    /** Custom "plain data -> object" logic, for classes needing special construction (e.g. typed arrays). */
    deserialize?: (...args: any[]) => any;
}

/**
 * Registers a class in the reflection registry so the (de)serializer knows about it.
 * Called by `@serializable()` below, and directly by `registerTypeArray` for typed arrays.
 * Warns (rather than throws) and skips if the same name is registered twice, since re-registration
 * usually means a module got imported/evaluated more than once — better to keep the first
 * registration than silently overwrite it.
 */
export function registerReflect(
    data: RefelectData,
    name?: string,
    props?: {
        type: any;
        props: PropertyInfo[];
    },
) {
    const actualName = name ?? data.ctor.name;
    if (reflectMap.has(actualName)) {
        console.warn(`Class ${actualName} already registered, skip.`);
        return;
    }
    reflectMap.set(actualName, data);
    if (props !== undefined) {
        const ps = propertiesMap.get(props.type);
        if (ps === undefined) {
            propertiesMap.set(props.type, props.props);
        } else {
            ps.push(...props.props);
        }
    }
}

/**
 * Registers a typed-array constructor (e.g. `Float32Array`, used internally by `Matrix4` and mesh
 * vertex buffers) as serializable. Typed arrays aren't plain objects with named `@serialize()`
 * properties, so they need explicit conversion: to a plain number array for JSON on the way out,
 * and back into the typed array (re-applying the original binary layout) on the way in.
 */
export function registerTypeArray(
    typeArray: new (array: number[]) => Float16Array | Float32Array | Uint32Array,
) {
    const data = {
        ctor: typeArray,
        serialize: (target: Float16Array | Float32Array | Uint32Array) => {
            return {
                buffer: Array.from(target),
            };
        },
        deserialize: (data: any) => {
            return new typeArray(data.buffer);
        },
    };

    registerReflect(data, typeArray.name, {
        type: typeArray.prototype,
        props: [
            {
                name: "buffer",
                readonly: true,
            },
        ],
    });
}
// Float16Array is ES2024 and is absent in some runtimes (older Node, happy-dom).
// Guard it so importing this module never throws where the global is missing;
// half-float arrays are simply not registered there. Browsers register it as before.
if (typeof Float16Array !== "undefined") {
    registerTypeArray(Float16Array);
}
registerTypeArray(Float32Array);
registerTypeArray(Uint32Array);

/**
 * Class decorator: marks a class as serializable and registers it (by name) in the reflection
 * registry, e.g. `@serializable()` above `class Matrix4 { ... }`. Optionally accepts custom
 * `serialize`/`deserialize` functions for classes that need more than plain property copying.
 */
export function serializable<T>(options?: {
    deserialize?: (...args: any[]) => T;
    serialize?: (target: T) => SerializedData;
}) {
    return (target: new (options: any) => T) => {
        registerReflect({
            ctor: target,
            ...options,
        });
    };
}

/**
 * Property decorator: marks a single field/getter as "include this when saving", e.g.
 * `@serialize()` above `get array()` on `Matrix4`. `target` here is the class prototype, so all
 * `@serialize()`-decorated properties for a class accumulate under that one prototype key.
 */
export function serialize() {
    return (target: any, property: string) => {
        let props = propertiesMap.get(target);
        if (props === undefined) {
            props = [];
            propertiesMap.set(target, props);
        }
        props.push({
            name: property,
        });
    };
}

/**
 * The actual (de)serialization engine — turns live class instances into plain JSON-safe data and
 * back, driven entirely by the `@serializable()`/`@serialize()` registrations above.
 */
export class Serializer {
    /**
     * Entry point for loading: given saved JSON for one object (carrying `__cla$$__`) and the
     * owning `document` (many CAD objects need a back-reference to their document, e.g. to look up
     * shared resources), reconstructs the live instance.
     */
    public static deserializeObject(document: IDocument, data: Serialized) {
        const props: Record<string, any> = { document };
        // Recursively resolve every saved field first (nested serialized objects/arrays get
        // reconstructed too), so the constructor below receives fully "live" values, not raw JSON.
        for (const key of Object.keys(data)) {
            props[key] = Serializer.deserialValue(document, data[key]);
        }

        const instance = Serializer.deserializeInstance(props);
        // The constructor may not consume every property (e.g. it only reads what it needs from
        // the options object) — this fills in anything left over directly onto the instance.
        Serializer.deserializeProperties(document, instance, props);
        return instance;
    }

    /** Looks up the target class by its saved `__cla$$__` name and constructs it — via a custom `deserialize` if one was registered, otherwise a plain `new ctor(data)`. */
    static deserializeInstance(data: Record<string, any>) {
        const className = data[InternalClassName];
        if (!className) {
            console.warn(`${data} cannot be deserialize.`);
            return data;
        }

        if (!reflectMap.has(data[InternalClassName])) {
            throw new Error(
                `${data[InternalClassName]} cannot be deserialize. Did you forget to add the decorator @Serializer.register?`,
            );
        }

        const { ctor, deserialize } = reflectMap.get(className)!;
        if (deserialize) {
            return deserialize(data);
        }
        return new ctor(data);
    }

    /**
     * Resolves one raw JSON value into its live form: `null`/`undefined` pass through as
     * `undefined`, arrays are resolved element-by-element, a plain object carrying `__cla$$__` is
     * recursively deserialized into a real instance, and anything else (numbers, strings, plain
     * objects without a class marker) is returned as-is.
     */
    static deserialValue(document: IDocument, value: any) {
        if (value === null || value === undefined) {
            return undefined;
        }
        if (Array.isArray(value)) {
            return value.map((v) => {
                if (v === null || v === undefined) {
                    return undefined;
                }
                return typeof v === "object" ? Serializer.deserializeObject(document, v) : v;
            });
        }
        return (value as Serialized)[InternalClassName]
            ? Serializer.deserializeObject(document, value)
            : value;
    }

    /**
     * After construction, assigns any remaining saved fields onto the instance — skipping the
     * class-name marker, the `document` back-reference itself, and any value that already matches
     * (avoids pointless writes, and avoids clobbering something the constructor already set up
     * correctly). Reactive (`Observable`) objects get their value set through `setPrivateValue` so
     * restoring saved state doesn't spuriously fire change notifications/commands; everything else
     * is assigned directly, but only if `isWritable` confirms the property isn't read-only.
     */
    static deserializeProperties(document: IDocument, instance: any, data: Record<string, any>) {
        const keys = Object.keys(data);
        for (const key of keys) {
            if (key !== InternalClassName && document !== data[key] && instance[key] !== data[key]) {
                if (instance instanceof Observable) {
                    instance.setPrivateValue(key as any, data[key]);
                } else if (Serializer.isWritable(instance, key)) {
                    instance[key] = Serializer.deserialValue(document, data[key]);
                }
            }
        }
    }

    /** Walks up the prototype chain to check whether `prop` can be assigned (has a setter, or is a plain writable field) — protects against crashing on read-only/getter-only properties (like `Matrix4.array`). */
    static isWritable(obj: any, prop: string) {
        while (obj !== null) {
            const desc = Object.getOwnPropertyDescriptor(obj, prop);
            if (desc) {
                if (desc.set) return true;
                return desc.writable === true;
            }
            obj = Object.getPrototypeOf(obj);
        }
        return false;
    }

    /**
     * Entry point for saving: turns one live object into a plain JSON-safe structure, stamped with
     * its `__cla$$__` class name so it can be matched back to a constructor on load. Uses a
     * registered custom `serialize` if the class provided one, otherwise falls back to automatic
     * property-based serialization.
     */
    static serializeObject(target: object): Serialized {
        const className = target.constructor.name;
        if (!reflectMap.has(className)) {
            console.log(target);

            throw new Error(
                `Type ${target.constructor.name} is not registered, please add the @Serializer.register decorator.`,
            );
        }
        const data = reflectMap.get(className)!;
        const properties = data.serialize?.(target) ?? Serializer.serializeProperties(target);
        return {
            ...properties,
            [InternalClassName]: className,
        };
    }

    /** Gathers every `@serialize()`-decorated property across the object's whole class hierarchy (so subclasses inherit their parent's serializable fields too), reads each one's current value off the live object, and serializes it — recursing into nested objects/arrays. */
    static serializeProperties(target: object) {
        const data: Record<string, any> = {};

        const props = Serializer.getAllKeysOfPrototypeChain(target, propertiesMap);
        for (const prop of props) {
            const value = (target as any)[prop.name];
            if (Array.isArray(value)) {
                data[prop.name] = value.map((v) => Serializer.serializePropertyValue(v));
            } else {
                data[prop.name] = Serializer.serializePropertyValue(value);
            }
        }
        return data;
    }

    /** Serializes one property's value: objects recurse into `serializeObject`, primitives (number/string/boolean/etc.) pass through unchanged, and functions/symbols are rejected since they can't round-trip through JSON. */
    private static serializePropertyValue(value: any) {
        const type = typeof value;
        if (type === "object") {
            return Serializer.serializeObject(value);
        }
        if (type !== "function" && type !== "symbol") {
            return value;
        }
        throw new Error(`Unsupported serialized object: ${value}`);
    }

    /** Collects the `@serialize()`-registered property list from every level of the prototype chain (base class up through subclasses), deduplicated. */
    private static getAllKeysOfPrototypeChain(
        target: object,
        map: Map<new (...args: any[]) => any, Array<PropertyInfo>>,
    ) {
        const keys: PropertyInfo[] = [];
        let prototype = Object.getPrototypeOf(target);
        while (prototype !== null) {
            const k = map.get(prototype);
            if (k) keys.push(...k.values());
            prototype = Object.getPrototypeOf(prototype); // prototype chain
        }
        return new Set(keys);
    }
}
