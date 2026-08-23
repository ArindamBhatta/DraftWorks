import type { CommandData } from "./commandData";
import { type CommandConstructor, CommandStore } from "./commandStore";

export function command<T extends CommandConstructor>(metadata: CommandData) {
    return (ctor: T) => {
        CommandStore.registerCommand(ctor, metadata);
    };
}
