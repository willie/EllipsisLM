import { v4 as uuidv4 } from 'uuid';
import getDatabase from '../db/index.js';
import type { CharacterImage } from '../types/index.js';

export class ImageService {
  static getCharacterImage(characterId: string, emotion?: string): CharacterImage | undefined {
    const db = getDatabase();
    if (emotion) {
      return db.prepare('SELECT * FROM character_images WHERE character_id = ? AND emotion = ?').get(characterId, emotion) as CharacterImage | undefined;
    }
    return db.prepare('SELECT * FROM character_images WHERE character_id = ? AND emotion IS NULL').get(characterId) as CharacterImage | undefined;
  }

  static getCharacterImages(characterId: string): CharacterImage[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM character_images WHERE character_id = ?').all(characterId) as CharacterImage[];
  }

  static saveCharacterImage(characterId: string, data: Buffer, mimeType: string, emotion?: string): CharacterImage {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Check if exists and update, or insert new
    const existing = this.getCharacterImage(characterId, emotion);

    if (existing) {
      db.prepare('UPDATE character_images SET data = ?, mime_type = ?, created_at = ? WHERE id = ?').run(data, mimeType, now, existing.id);
      return this.getCharacterImage(characterId, emotion)!;
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO character_images (id, character_id, emotion, data, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, characterId, emotion || null, data, mimeType, now);

    return db.prepare('SELECT * FROM character_images WHERE id = ?').get(id) as CharacterImage;
  }

  static deleteCharacterImage(characterId: string, emotion?: string): boolean {
    const db = getDatabase();
    let result;
    if (emotion) {
      result = db.prepare('DELETE FROM character_images WHERE character_id = ? AND emotion = ?').run(characterId, emotion);
    } else {
      result = db.prepare('DELETE FROM character_images WHERE character_id = ? AND emotion IS NULL').run(characterId);
    }
    return result.changes > 0;
  }

  static deleteAllCharacterImages(characterId: string): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM character_images WHERE character_id = ?').run(characterId);
    return result.changes;
  }
}

export default ImageService;
