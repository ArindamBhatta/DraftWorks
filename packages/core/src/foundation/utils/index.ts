/**
 * UTILS - Practical Utilities for CAD Application
 *
 * Collection of everyday helper functions used throughout the CAD system:
 *
 * 1. debounce.ts:
 *    - Rate-limit high-frequency events (viewport interactions, user input)
 *    - Essential for smooth performance during pan/zoom/rotate
 *
 * 2. download.ts:
 *    - Export/save drawings to user's computer
 *    - Save DXF, SVG, PDF, and other formats
 *    - Batch export of multiple files
 *
 * 3. readFileAsync.ts:
 *    - Import drawings and assets from user's files
 *    - Support multiple file formats (DXF, DWG, images, etc.)
 *    - Asynchronous file reading for UI responsiveness
 *
 * These utilities bridge the gap between CAD core logic and browser APIs,
 * abstracting common patterns and providing type-safe interfaces.
 */

export * from "./debounce";
export * from "./download";
export * from "./readFileAsync";
