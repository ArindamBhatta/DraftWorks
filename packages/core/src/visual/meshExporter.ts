import type { Result } from "../foundation";
import type { VisualNode } from "../model";

export interface IMeshExporter {
    exportToStl(node: VisualNode[], asciiMode: boolean): Result<BlobPart>;
    exportToPly(node: VisualNode[], asciiMode: boolean): Result<BlobPart>;
    exportToObj(node: VisualNode[]): Result<BlobPart>;
}
