import { v4 as uuidv4 } from 'uuid';
import getDatabase from '../db/index.js';
import type { User, GlobalSettings, UserPersona, UpdateSettingsRequest, CreateUserPersonaRequest } from '../types/index.js';

export class UserService {
  // Get or create default user (for single-user mode)
  static getOrCreateDefaultUser(): User {
    const db = getDatabase();

    let user = db.prepare('SELECT * FROM users WHERE username = ?').get('default') as User | undefined;

    if (!user) {
      const id = uuidv4();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO users (id, username, email, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, 'default', 'default@local', '', now, now);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;

      // Create default settings for user
      this.getOrCreateSettings(id);
    }

    return user;
  }

  static getUserById(id: string): User | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  }

  // Settings
  static getOrCreateSettings(userId: string): GlobalSettings {
    const db = getDatabase();

    let settings = db.prepare('SELECT * FROM global_settings WHERE user_id = ?').get(userId) as GlobalSettings | undefined;

    if (!settings) {
      const id = uuidv4();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO global_settings (id, user_id, ui_preferences, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, userId, '{}', now, now);

      settings = db.prepare('SELECT * FROM global_settings WHERE id = ?').get(id) as GlobalSettings;
    }

    return settings;
  }

  static getSettings(userId: string): GlobalSettings | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM global_settings WHERE user_id = ?').get(userId) as GlobalSettings | undefined;
  }

  static updateSettings(userId: string, data: UpdateSettingsRequest): GlobalSettings {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Ensure settings exist
    this.getOrCreateSettings(userId);

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.gemini_api_key !== undefined) {
      updates.push('gemini_api_key = ?');
      values.push(data.gemini_api_key);
    }
    if (data.open_router_key !== undefined) {
      updates.push('open_router_key = ?');
      values.push(data.open_router_key);
    }
    if (data.koboldcpp_url !== undefined) {
      updates.push('koboldcpp_url = ?');
      values.push(data.koboldcpp_url);
    }
    if (data.lmstudio_url !== undefined) {
      updates.push('lmstudio_url = ?');
      values.push(data.lmstudio_url);
    }
    if (data.active_story_id !== undefined) {
      updates.push('active_story_id = ?');
      values.push(data.active_story_id);
    }
    if (data.active_narrative_id !== undefined) {
      updates.push('active_narrative_id = ?');
      values.push(data.active_narrative_id);
    }
    if (data.ui_preferences !== undefined) {
      updates.push('ui_preferences = ?');
      values.push(JSON.stringify(data.ui_preferences));
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(userId);

      db.prepare(`
        UPDATE global_settings SET ${updates.join(', ')} WHERE user_id = ?
      `).run(...values);
    }

    return this.getSettings(userId)!;
  }

  // User Personas
  static getPersonas(userId: string): UserPersona[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM user_personas WHERE user_id = ? ORDER BY created_at DESC').all(userId) as UserPersona[];
  }

  static getPersonaById(id: string): UserPersona | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM user_personas WHERE id = ?').get(id) as UserPersona | undefined;
  }

  static createPersona(userId: string, data: CreateUserPersonaRequest): UserPersona {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO user_personas (id, user_id, name, description, short_description, model_instructions, image_url, tags, color_base, color_bold, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      data.name,
      data.description,
      data.short_description || null,
      data.model_instructions || null,
      data.image_url || null,
      JSON.stringify(data.tags || []),
      data.color_base || null,
      data.color_bold || null,
      now,
      now
    );

    return this.getPersonaById(id)!;
  }

  static updatePersona(id: string, data: Partial<CreateUserPersonaRequest>): UserPersona | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.short_description !== undefined) {
      updates.push('short_description = ?');
      values.push(data.short_description);
    }
    if (data.model_instructions !== undefined) {
      updates.push('model_instructions = ?');
      values.push(data.model_instructions);
    }
    if (data.image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(data.image_url);
    }
    if (data.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(data.tags));
    }
    if (data.color_base !== undefined) {
      updates.push('color_base = ?');
      values.push(data.color_base);
    }
    if (data.color_bold !== undefined) {
      updates.push('color_bold = ?');
      values.push(data.color_bold);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE user_personas SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getPersonaById(id);
  }

  static deletePersona(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM user_personas WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

export default UserService;
