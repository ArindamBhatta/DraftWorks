/**
 * ASYNCCONTROLLER - Async State Management
 *
 * Essential in a 2D CAD application for managing long-running operations:
 * - Loading/importing DXF, DWG, or other CAD file formats
 * - Complex geometric calculations (intersections, offsets, transformations)
 * - Batch operations on multiple drawing entities
 * - Multi-step commands (draw polyline, constraint solving, etc.)
 *
 * Benefits in CAD workflow:
 * 1. Track operation state (success/fail/cancel) without blocking UI
 * 2. Allow ESC key to cancel active drawing commands
 * 3. Show progress feedback during heavy computations
 * 4. Enable/disable UI buttons based on operation state
 * 5. Handle errors gracefully with user-facing messages
 */

import type { IDisposable } from "./disposable";

export interface AsyncResult {
    status: "success" | "fail" | "cancel";
    message?: string;
}

export class AsyncController implements IDisposable {
    private readonly _failListeners = new Set<(state: AsyncResult) => void>();
    private readonly _cancelListeners = new Set<(state: AsyncResult) => void>();
    private readonly _successListeners = new Set<(state: AsyncResult) => void>();
    private _result: AsyncResult | undefined;

    get result() {
        return this._result;
    }

    readonly fail = (message?: string) => {
        this.notifyListeners(this._failListeners, "fail", message);
    };

    readonly cancel = (message?: string) => {
        this.notifyListeners(this._cancelListeners, "cancel", message);
    };

    readonly success = (message?: string) => {
        this.notifyListeners(this._successListeners, "success", message);
    };

    private notifyListeners(
        listeners: Set<(result: AsyncResult) => void>,
        status: AsyncResult["status"],
        message?: string,
    ) {
        if (this._result === undefined) {
            this._result = { status, message };
            listeners.forEach((listener) => listener(this._result!));
        }
    }

    onCancelled(listener: (result: AsyncResult) => void): void {
        this._cancelListeners.add(listener);
    }

    onCompleted(listener: (result: AsyncResult) => void): void {
        this._successListeners.add(listener);
    }

    onFailed(listener: (result: AsyncResult) => void): void {
        this._failListeners.add(listener);
    }

    /**
     * Ends the operation if it has not ended already, then drops the listeners.
     *
     * The cancel first is what stops a disposed controller taking someone's wait to the
     * grave with it. Everything that awaits one of these - a pick, a typed prompt - is
     * blocked on a promise only these listeners can resolve, so clearing them without a
     * result leaves that promise pending for good: the command never returns, and the
     * drawing keeps an event handler that answers nothing. A controller that has already
     * finished is unaffected, which is the ordinary case - see notifyListeners.
     */
    dispose() {
        this.cancel();
        this._cancelListeners.clear();
        this._failListeners.clear();
        this._successListeners.clear();
    }
}
