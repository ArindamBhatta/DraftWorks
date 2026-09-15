// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type StepOption } from "@draftworks/core";
import { span } from "@draftworks/element";

/**
 * The option as AutoCAD writes it: the word, with the letter you type picked out of it
 * wherever in the word it falls - `Close`, `Undo`, `mOde`.
 *
 * An option with no word of its own shows as its bare key, which is all there is to show;
 * one whose word does not contain its key carries the key after it in brackets, so the
 * thing to type is never left to be guessed at.
 *
 * Every surface that offers the options draws them this way - the command line's bracket
 * list and the panel's buttons - so that whichever one a user is looking at, it is the
 * same word with the same letter picked out. `hotClass` is how each styles that letter in
 * its own stylesheet.
 */
export function stepOptionLabel(option: StepOption, hotClass: string): (HTMLElement | Text)[] {
    if (!option.name) {
        return [span({ className: hotClass, textContent: option.key })];
    }

    const name = I18n.translate(option.name);
    const at = name.toLowerCase().indexOf(option.key.toLowerCase());
    if (at < 0) {
        return [
            document.createTextNode(name),
            span({ className: hotClass, textContent: ` (${option.key})` }),
        ];
    }

    const parts: (HTMLElement | Text)[] = [];
    if (at > 0) parts.push(document.createTextNode(name.slice(0, at)));
    parts.push(span({ className: hotClass, textContent: name.slice(at, at + option.key.length) }));
    const rest = name.slice(at + option.key.length);
    if (rest !== "") parts.push(document.createTextNode(rest));
    return parts;
}
