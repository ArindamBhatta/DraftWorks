import {
    command,
    I18n,
    type IApplication,
    type ICommand,
    PubSub,
    readFileAsync,
    type Serialized,
} from "@draftworks/core";

@command({
    key: "doc.open",
    icon: "icon-open",
    isApplicationCommand: true,
})
export class OpenDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        PubSub.default.pub(
            "showPermanent",
            async () => {
                const files = await readFileAsync(".cd", false);
                if (files.isOk) {
                    const json: Serialized = JSON.parse(files.value[0].data);
                    const document = await app.loadDocument(json);
                    document?.application.activeView?.cameraController.fitContent();
                }
            },
            "toast.excuting{0}",
            I18n.translate("command.doc.open"),
        );
    }
}
