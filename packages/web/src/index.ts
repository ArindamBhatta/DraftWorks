import { promptDrawingSetupIfFirstRun } from "@draftworks/app";
import { AppBuilder } from "@draftworks/builder";
import { type IApplication, Logger } from "@draftworks/core";
import { Loading } from "./loading";
import { parseStartupParams } from "./startupParams";

//step1: creating an instance of Loading class
const loading = new Loading();

//step2: inserts it into the live page
document.body.appendChild(loading);

//
async function handleApplicationBuilt(app: IApplication) {
    document.body.removeChild(loading);

    const { plugins, fileUrl } = parseStartupParams(window.location.search);
    for (const plugin of plugins) {
        Logger.info(`loading plugin from: ${plugin}`);
        await app.pluginManager.loadFromUrl(plugin);
    }
    if (fileUrl) {
        Logger.info(`loading file from: ${fileUrl}`);
        await app.loadFileFromUrl(fileUrl);
        // Opening someone's drawing is not the moment to ask how a new one should be
        // set up - its units and dimension style came with the file.
        return;
    }

    // AppBuilder has already opened a blank drawing, so the editor is behind these
    // dialogs rather than a spinner. Deliberately not awaited by build(): the loading
    // overlay has to come down first, or it would sit on top of the dialogs.
    await promptDrawingSetupIfFirstRun();
}

try {
    const app = await new AppBuilder()
        .useIndexedDB() // document + recent-file storage
        .useWasmOcc() // OCC geometry kernel, compiled to wasm
        .useThree() // three.js renderer behind the 2D views
        .useUI() // ribbon and main window, mounted on #app
        .build();

    await handleApplicationBuilt(app);
} catch (error) {
    Logger.error(error);
    alert(error instanceof Error ? error.message : String(error));
}
