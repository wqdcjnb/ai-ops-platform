// Re-export layer: keeps './platform-db.js' working after the monolith was split.
// Prefer importing from './db/*.js' in new code.
export * from './db/types.js'
export * from './db/schema.js'
export * from './db/crypto.js'
export { PlatformDatabase, createPlatformDatabase } from './db/database.js'
