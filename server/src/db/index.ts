import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import schema from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path - store in server directory
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/ellipsislm.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Enable WAL mode for better concurrent performance
    db.pragma('journal_mode = WAL');

    // Initialize schema
    db.exec(schema);

    console.log(`Database initialized at ${DB_PATH}`);
  }

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('Database connection closed');
  }
}

// Utility function to run migrations
export function runMigrations(): void {
  const database = getDatabase();
  database.exec(schema);
  console.log('Migrations completed');
}

export default getDatabase;
