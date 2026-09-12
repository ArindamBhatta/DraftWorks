// * Starting Point of 2D Cad */
import { promptDrawingSetupIfFirstRun } from "@chili3d/app";
import { AppBuilder } from "@chili3d/builder";
import { type IApplication, Logger } from "@chili3d/core";
import { Loading } from "./loading";
import { parseStartupParams } from "./startupParams";

const loading = new Loading();
document.body.appendChild(loading);

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

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useThree()
    .useUI()
    .build()
    .then(handleApplicationBuilt)
    .catch((err) => {
        alert(err.message);
    });
