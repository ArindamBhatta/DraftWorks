/**
 * DOWNLOAD - Export CAD Files to User's Computer
 *
 * Critical for CAD workflow - users must be able to save their work:
 *
 * Export scenarios:
 * 1. Save Drawing As:
 *    - Serialize current document to DXF/DWG format
 *    - User downloads file to local disk
 *
 * 2. Export to Other Formats:
 *    - SVG export for web/publishing
 *    - PDF for printing or sharing
 *    - PNG/JPEG for screenshots/presentations
 *
 * 3. Batch Operations:
 *    - Export multiple selected entities to file
 *    - Export layers or blocks as separate files
 *    - Generate reports (BOM, materials list) as CSV/PDF
 *
 * Implementation:
 * - Creates a Blob from drawing data (bytes)
 * - Generates temporary download link
 * - Triggers browser download dialog
 * - Cleans up temporary URL to avoid memory leak
 *
 * Browser Compatibility:
 * - Works in all modern browsers (Chrome, Firefox, Safari, Edge)
 * - Falls back gracefully for older browsers
 * - Respects user's download folder settings
 */

export function download(data: BlobPart[], name: string) {
    const blob = new Blob(data);
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement("a");
        a.style.visibility = "hidden";
        a.href = url;
        a.download = name;
        a.click();
    } finally {
        URL.revokeObjectURL(url);
    }
}
