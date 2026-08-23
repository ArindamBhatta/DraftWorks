/**
 * STORAGE INTERFACE - Persistent Data Management
 *
 * Defines the contract for storing CAD drawing data:
 * - Persist CAD documents, projects, and design history
 * - Store drawing entities and their properties
 * - Cache layer and block definitions
 * - Support multi-document editing with isolated storage per document
 * - Enable undo/redo history storage
 * - Pagination support for large drawings with thousands of entities
 *
 * In 2D CAD, this abstracts the storage layer allowing:
 * 1. IndexedDB for browser-based storage (complex queries, large datasets)
 * 2. SQLite or PostgreSQL for server-based implementations
 * 3. Different storage strategies without changing CAD core logic
 * 4. Efficient loading/unloading of drawing sections (only what's visible)
 *
 * Typical workflow:
 * - Create database with tables for entities, layers, blocks, materials
 * - CRUD operations on drawing objects
 * - Retrieve paginated results for large drawings (viewport culling)
 */

export interface IStorage {
    createDBIfNeeded(database: string, tables: string[]): Promise<void>;
    get(database: string, table: string, id: string): Promise<any>;
    put(database: string, table: string, id: string, value: any): Promise<boolean>;
    delete(database: string, table: string, id: string): Promise<boolean>;
    page(database: string, table: string, page: number): Promise<any[]>;
}
