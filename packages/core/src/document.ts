// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "./application";
import type { History, IDisposable, IPropertyChanged } from "./foundation";
import type { ModelManager } from "./modelManager";
import type { IPicker, ISelection } from "./selection";
import type { Serialized } from "./serialize";
import type { IVisual } from "./visual";

export const DOCUMENT_FILE_EXTENSION = ".cd";
// The DOCUMENT_FILE_EXTENSION constant defines the file extension used for saving and loading documents in the Chili3d application. This extension is used to identify files that contain serialized document data, allowing users to easily recognize and manage their project files.
export const PLUGIN_FILE_EXTENSION = ".chiliplugin";

export interface IDocument extends IPropertyChanged, IDisposable {
    readonly selection: ISelection;
    readonly picker: IPicker;
    readonly id: string;
    readonly history: History;
    readonly visual: IVisual;
    readonly application: IApplication;
    readonly modelManager: ModelManager;
    name: string;
    userData?: Record<string, unknown>;
    save(): Promise<void>;
    close(): Promise<void>;
    serialize(): Serialized;
}
