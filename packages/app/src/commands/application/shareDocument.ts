import {
    command,
    I18n,
    type I18nKeys,
    type IApplication,
    type ICommand,
    Logger,
    PubSub,
} from "@draftworks/core";
import { button, div, input, p, span, svg } from "@draftworks/element";
import style from "./shareDocument.module.css";

interface Perk {
    icon: string;
    title: I18nKeys;
    body: I18nKeys;
}

/** What version 2 brings, in the order the invitation lists it. */
const PERKS: readonly Perk[] = [
    { icon: "icon-folder-open", title: "share.promo.storageTitle", body: "share.promo.storageBody" },
    { icon: "icon-share", title: "share.promo.liveTitle", body: "share.promo.liveBody" },
    { icon: "icon-macro", title: "share.promo.aiTitle", body: "share.promo.aiBody" },
];

/**
 * The Share button, as far as version 1 goes.
 *
 * Real sharing - hosted drawings, live links, roles - needs a server, and that arrives in
 * version 2 (it is parked on the `feature/sharing-v2` branch). Until then the button
 * invites the user to spread DraftWorks itself: it hands out a link to the app, not to
 * the drawing, and says what reaching 100 people unlocks.
 *
 * Nothing here counts shares. Knowing how many people actually arrived through a link
 * takes a server to record it, so the dialog states the goal without pretending to track
 * progress towards it.
 */
@command({
    key: "doc.share",
    icon: "icon-share",
    isApplicationCommand: true,
})
export class ShareDocument implements ICommand {
    async execute(_app: IApplication): Promise<void> {
        PubSub.default.pub("showDialog", "share.promo.title", buildContent(), [
            { content: "share.promo.done" },
        ]);
    }
}

/** The address of the app itself, minus any query - a startup `?url=` is not the user's to hand out. */
function appLink(): string {
    const { origin, pathname } = window.location;
    return `${origin}${pathname}`;
}

function buildContent(): HTMLElement {
    const link = appLink();

    return div(
        { className: style.root },
        p({ className: style.headline, textContent: I18n.translate("share.promo.headline") }),
        p({ className: style.intro, textContent: I18n.translate("share.promo.intro") }),
        div({ className: style.perks }, ...PERKS.map(buildPerk)),
        buildLinkRow(link),
        p({ className: style.footnote, textContent: I18n.translate("share.promo.footnote") }),
    );
}

function buildPerk(perk: Perk): HTMLElement {
    return div(
        { className: style.perk },
        span({ className: style.perkIcon }, svg({ icon: perk.icon })),
        div(
            p({ className: style.perkTitle, textContent: I18n.translate(perk.title) }),
            p({ className: style.perkBody, textContent: I18n.translate(perk.body) }),
        ),
        span({ className: style.soon, textContent: I18n.translate("share.promo.soon") }),
    );
}

function buildLinkRow(link: string): HTMLElement {
    const field = input({
        className: style.link,
        value: link,
        readOnly: true,
        onfocus: () => field.select(),
        // The dialog sits inside the main window, which routes keystrokes to command
        // hotkeys - without this, pressing keys in the box fires commands.
        onkeydown: (e) => e.stopPropagation(),
    });

    const copy = button({
        className: `${style.button} ${style.primary}`,
        textContent: I18n.translate("share.promo.copy"),
    });
    let revert: ReturnType<typeof setTimeout> | undefined;
    copy.onclick = async () => {
        try {
            await navigator.clipboard.writeText(link);
        } catch (error) {
            // Clipboard refused (no permission, insecure origin). Select the text instead
            // so a Ctrl+C still gets it.
            Logger.warn("could not copy the DraftWorks link", error);
            field.focus();
            field.select();
            return;
        }
        copy.textContent = I18n.translate("share.promo.copied");
        clearTimeout(revert);
        revert = setTimeout(() => {
            copy.textContent = I18n.translate("share.promo.copy");
        }, 2000);
    };

    const row = div({ className: style.linkRow }, field, copy);

    // The system share sheet, where there is one (mobile, and some desktop browsers):
    // it reaches WhatsApp, Mail and the rest directly instead of via the clipboard.
    if (typeof navigator.share === "function") {
        const share = button({
            className: style.button,
            textContent: I18n.translate("share.promo.share"),
            onclick: () => {
                navigator
                    .share({ title: "DraftWorks", text: I18n.translate("share.promo.headline"), url: link })
                    .catch((error: unknown) => {
                        // Dismissing the sheet rejects with AbortError - not a failure.
                        if (!(error instanceof DOMException && error.name === "AbortError")) {
                            Logger.warn("could not open the share sheet", error);
                        }
                    });
            },
        });
        row.append(share);
    }

    return row;
}
