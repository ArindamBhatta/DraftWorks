/**
 * FOUNDATION LAYER - Core Abstractions for 2D CAD System
 *
 * The foundation module provides essential low-level building blocks that the CAD
 * application depends on. Think of it as the "standard library" for the CAD system.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE LAYERS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * UI Layer
 *   ↓ publishes/subscribes events
 * Core CAD Logic (application.ts, document.ts, modelManager.ts)
 *   ↓ uses foundations
 * Foundation Layer (THIS MODULE) ← Async, events, storage, utilities, patterns
 *   ↓
 * Browser APIs & External Systems
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * MODULE BREAKDOWN
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ASYNC & CONTROL FLOW:
 * - asyncController:   Manage long-running operations (file I/O, calculations)
 * - lazy:              Deferred initialization for expensive objects
 * - garbageCollection:   Automatic resource cleanup (memory management)
 * - transaction:       ACID-like operations for undo/redo
 * - history:           State snapshots for undo/redo functionality
 *
 * DATA & STORAGE:
 * - storage:           Interface for persistent data (IIndexedDB, database)
 * - objectStorage:     Browser localStorage for app preferences
 * - dto:               Data Transfer Objects for serialization
 *
 * REACTIVE PROGRAMMING:
 * - pubsub:            Event bus for decoupled component communication
 * - observer:          Observable pattern for reactive updates
 * - deepObserver:      Track changes deep in object hierarchies
 * - signal:            Reactive value bindings (like Vue/Svelte signals)
 * - binding:           Connect UI inputs to model properties
 * - collection:        Observable arrays and collections
 *
 * UTILITIES & HELPERS:
 * - converter:         Unit and format conversions (mm ↔ inches, DXF ↔ internal)
 * - debounce:          Rate-limit high-frequency events (pan/zoom)
 * - download:          Export drawings to files (DXF, SVG, PDF)
 * - readFileAsync:     Import drawings from files
 * - logger:            Structured logging for debugging
 * - result:            Result<T, E> type for error handling
 *
 * INFRASTRUCTURE:
 * - id:                UUID/ID generation for drawing entities
 * - comparers:         Value equality comparisons
 * - equalityComparer:  Custom equality logic
 * - precision:         Floating-point precision utilities
 * - linkedList:        Efficient linked data structure
 * - drawingSetup:      WebGL/Canvas 2D context initialization
 * - unitSetup:         Unit system configuration (mm, inches, etc.)
 * - disposable:        Resource lifecycle management
 * - messageType:       Message severity levels
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THEY WORK TOGETHER IN A TYPICAL CAD OPERATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * User draws a line:
 *   1. UI triggers "Line" command (PubSub: executeCommand)
 *   2. AsyncController manages multi-step input collection
 *   3. LineCommand waits for 2 points (showInput via PubSub)
 *   4. Point transformations use Converter for unit conversions
 *   5. Line entity created, added to document
 *   6. PubSub publishes "modelUpdate" → viewport redraws → properties panel updates
 *   7. History records transaction snapshot for undo
 *   8. Debounce prevents excessive redraws during interaction
 *
 * User saves drawing:
 *   1. AsyncController manages file export operation
 *   2. Drawing serialized to DXF using Converters
 *   3. BlobData passed to download() → file saved to disk
 *   4. ObjectStorage saves "recent files" list
 *
 * User opens existing drawing:
 *   1. readFileAsync() triggers file selection dialog
 *   2. AsyncController manages async file parsing
 *   3. File data passed to DXF converter
 *   4. Drawing entities loaded into Storage/ObjectStorage
 *   5. PubSub notifies viewport → renders drawing
 *   6. Lazy properties defer expensive calculations until visible
 *   7. gc() ensures temporary parsing objects are cleaned up
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export * from "./asyncController";
export * from "./binding";
export * from "./collection";
export * from "./comparers";
export * from "./converter";
export * from "./deepObserver";
export * from "./disposable";
export * from "./dto";
export * from "./equalityComparer";
export * from "./garbageCollection";
export * from "./history";
export * from "./id";
export * from "./lazy";
export * from "./linkedList";
export * from "./logger";
export * from "./messageType";
export * from "./objectStorage";
export * from "./observer";
export * from "./precision";
export * from "./pubsub";
export * from "./result";
export * from "./signal";
export * from "./storage";
export * from "./transaction";
export * from "./unitSetup";
export * from "./utils";
