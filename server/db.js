import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, 'ellipsis.db'));

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS narratives (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    mime_type TEXT DEFAULT 'image/png',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Prepared statements for better performance
const stmts = {
  // Stories
  getStory: db.prepare('SELECT data FROM stories WHERE id = ?'),
  getAllStories: db.prepare('SELECT data FROM stories ORDER BY updated_at DESC'),
  saveStory: db.prepare(`
    INSERT INTO stories (id, data, updated_at) VALUES (@id, @data, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET data = @data, updated_at = datetime('now')
  `),
  deleteStory: db.prepare('DELETE FROM stories WHERE id = ?'),

  // Narratives
  getNarrative: db.prepare('SELECT data FROM narratives WHERE id = ?'),
  getAllNarratives: db.prepare('SELECT data FROM narratives ORDER BY updated_at DESC'),
  saveNarrative: db.prepare(`
    INSERT INTO narratives (id, data, updated_at) VALUES (@id, @data, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET data = @data, updated_at = datetime('now')
  `),
  deleteNarrative: db.prepare('DELETE FROM narratives WHERE id = ?'),

  // Images
  getImage: db.prepare('SELECT data, mime_type FROM images WHERE id = ?'),
  getAllImageKeys: db.prepare('SELECT id FROM images'),
  saveImage: db.prepare(`
    INSERT INTO images (id, data, mime_type) VALUES (@id, @data, @mimeType)
    ON CONFLICT(id) DO UPDATE SET data = @data, mime_type = @mimeType
  `),
  deleteImage: db.prepare('DELETE FROM images WHERE id = ?'),
  clearImages: db.prepare('DELETE FROM images'),

  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  saveSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = @value
  `),

  // Clear stores
  clearStories: db.prepare('DELETE FROM stories'),
  clearNarratives: db.prepare('DELETE FROM narratives'),
};

export const DBService = {
  // Stories
  getStory(id) {
    const row = stmts.getStory.get(id);
    return row ? JSON.parse(row.data) : null;
  },

  getAllStories() {
    return stmts.getAllStories.all().map(row => JSON.parse(row.data));
  },

  saveStory(story) {
    stmts.saveStory.run({ id: story.id, data: JSON.stringify(story) });
    return true;
  },

  deleteStory(id) {
    stmts.deleteStory.run(id);
    return true;
  },

  // Narratives
  getNarrative(id) {
    const row = stmts.getNarrative.get(id);
    return row ? JSON.parse(row.data) : null;
  },

  getAllNarratives() {
    return stmts.getAllNarratives.all().map(row => JSON.parse(row.data));
  },

  saveNarrative(narrative) {
    stmts.saveNarrative.run({ id: narrative.id, data: JSON.stringify(narrative) });
    return true;
  },

  deleteNarrative(id) {
    stmts.deleteNarrative.run(id);
    return true;
  },

  // Images
  getImage(id) {
    const row = stmts.getImage.get(id);
    return row ? { data: row.data, mimeType: row.mime_type } : null;
  },

  getAllImageKeys() {
    return stmts.getAllImageKeys.all().map(row => row.id);
  },

  saveImage(id, buffer, mimeType = 'image/png') {
    stmts.saveImage.run({ id, data: buffer, mimeType });
    return true;
  },

  deleteImage(id) {
    stmts.deleteImage.run(id);
    return true;
  },

  clearImages() {
    stmts.clearImages.run();
    return true;
  },

  // Settings
  getSetting(key) {
    const row = stmts.getSetting.get(key);
    return row ? JSON.parse(row.value) : null;
  },

  saveSetting(key, value) {
    stmts.saveSetting.run({ key, value: JSON.stringify(value) });
    return true;
  },

  // Clear stores
  clearStore(storeName) {
    if (storeName === 'stories') stmts.clearStories.run();
    else if (storeName === 'narratives') stmts.clearNarratives.run();
    else if (storeName === 'characterImages') stmts.clearImages.run();
    return true;
  },

  // Iterate store (for backup/export)
  iterateStore(storeName, callback) {
    if (storeName === 'characterImages') {
      const keys = this.getAllImageKeys();
      for (const key of keys) {
        const img = this.getImage(key);
        if (img) callback(key, img.data);
      }
    }
    return { success: true, processedCount: 0, errors: [] };
  },

  // Get all entries (for backup)
  getAllEntries(storeName) {
    if (storeName === 'characterImages') {
      const keys = this.getAllImageKeys();
      return keys.map(key => {
        const img = this.getImage(key);
        return [key, img?.data];
      });
    }
    return [];
  }
};

export default db;
