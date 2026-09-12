import type { IPropertyChanged, Localize, PathBinding } from "@draftworks/core";

export type HTMLProps<T> = {
    [P in keyof T]?: T[P] extends object
        ? HTMLProps<T[P]>
        : (T[P] | PathBinding<IPropertyChanged>) | (P extends "textContent" | "title" ? Localize : never);
};
