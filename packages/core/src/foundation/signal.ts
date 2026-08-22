export class Signal<T extends (...args: any[]) => void> {
    private _listeners = new Set<T>();

    sub(listener: T): void {
        this._listeners.add(listener);
    }

    remove(listener: T): void {
        this._listeners.delete(listener);
    }

    emit(...args: Parameters<T>): void {
        for (const listener of this._listeners) {
            listener(...args);
        }
    }

    dispose(): void {
        this._listeners.clear();
    }
}
