// What a command waits on. Everything interactive - a pick, a typed prompt - is a
// promise that only this object's listeners can resolve, so a controller that is put
// down without finishing takes the whole command with it: the canvas keeps the
// crosshair and answers nothing, not even Escape.

import { expect, test } from "@rstest/core";
import { AsyncController } from "./asyncController";

test("the first ending wins - a cancel after a success is not a second result", () => {
    const controller = new AsyncController();
    controller.success();
    controller.cancel();

    expect(controller.result?.status).toBe("success");
});

test("disposing an unfinished controller ends what was waiting on it", () => {
    const controller = new AsyncController();
    let resolved = false;
    controller.onCancelled(() => {
        resolved = true;
    });

    controller.dispose();

    expect(resolved).toBe(true);
    expect(controller.result?.status).toBe("cancel");
});

test("disposing a finished controller leaves its result alone", () => {
    const controller = new AsyncController();
    controller.success();

    controller.dispose();

    expect(controller.result?.status).toBe("success");
});

test("a disposed controller notifies nobody afterwards", () => {
    const controller = new AsyncController();
    let calls = 0;
    controller.onCancelled(() => calls++);

    controller.dispose();
    controller.cancel();

    expect(calls).toBe(1);
});
