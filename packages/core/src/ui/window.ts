import type { IApplication } from "../application";
import type { Ribbon } from "./ribbon";

export interface IWindow extends HTMLElement {
    readonly ribbon: Ribbon;
    init(app: IApplication): Promise<void>;
}
