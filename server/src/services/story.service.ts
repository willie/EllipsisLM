import { v4 as uuidv4 } from 'uuid';
import getDatabase from '../db/index.js';
import type {
  Story,
  Character,
  Scenario,
  DynamicEntry,
  CreateStoryRequest,
  UpdateStoryRequest,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  CreateScenarioRequest,
  CreateDynamicEntryRequest,
  UpdateDynamicEntryRequest,
  FullStoryExport
} from '../types/index.js';

export class StoryService {
  // Stories
  static getAllStories(userId: string): Story[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM stories WHERE user_id = ? ORDER BY last_modified DESC').all(userId) as Story[];
  }

  static getStoryById(id: string): Story | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as Story | undefined;
  }

  static createStory(userId: string, data: CreateStoryRequest): Story {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();
    const searchIndex = data.name.toLowerCase();

    db.prepare(`
      INSERT INTO stories (id, user_id, name, search_index, api_provider, system_prompt, created_date, last_modified, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      data.name,
      searchIndex,
      data.api_provider || 'gemini',
      data.system_prompt || null,
      now,
      now,
      '[]'
    );

    return this.getStoryById(id)!;
  }

  static updateStory(id: string, data: UpdateStoryRequest): Story | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    // Build dynamic update query
    const fields: (keyof UpdateStoryRequest)[] = [
      'name', 'api_provider', 'gemini_model', 'open_router_model', 'koboldcpp_template',
      'font', 'background_image_url', 'bubble_opacity', 'chat_text_color', 'character_image_mode',
      'background_blur', 'text_size', 'bubble_image_size',
      'md_h1_color', 'md_h2_color', 'md_h3_color', 'md_bold_color', 'md_italic_color', 'md_quote_color',
      'md_h1_font', 'md_h2_font', 'md_h3_font', 'md_bold_font', 'md_italic_font', 'md_quote_font',
      'system_prompt', 'event_master_base_prompt', 'event_master_probability',
      'prompt_persona_gen', 'prompt_world_map_gen', 'prompt_location_gen', 'prompt_entry_gen',
      'prompt_location_memory_gen', 'prompt_story_notes_gen', 'prompt_story_tags_gen',
      'visual_master_base_prompt', 'creator_notes'
    ];

    for (const field of fields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(data[field] as string | number | null);
      }
    }

    if (data.tags !== undefined) {
      updates.push('tags = ?');
      values.push(data.tags);
    }

    if (data.name !== undefined) {
      updates.push('search_index = ?');
      values.push(data.name.toLowerCase());
    }

    if (updates.length > 0) {
      updates.push('last_modified = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getStoryById(id);
  }

  static deleteStory(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM stories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static duplicateStory(id: string, userId: string): Story | undefined {
    const story = this.getStoryById(id);
    if (!story) return undefined;

    const newId = uuidv4();
    const now = new Date().toISOString();
    const db = getDatabase();

    // Copy story with new id
    db.prepare(`
      INSERT INTO stories (
        id, user_id, name, search_index, api_provider, gemini_model, open_router_model, koboldcpp_template,
        font, background_image_url, bubble_opacity, chat_text_color, character_image_mode,
        background_blur, text_size, bubble_image_size,
        md_h1_color, md_h2_color, md_h3_color, md_bold_color, md_italic_color, md_quote_color,
        md_h1_font, md_h2_font, md_h3_font, md_bold_font, md_italic_font, md_quote_font,
        system_prompt, event_master_base_prompt, event_master_probability,
        prompt_persona_gen, prompt_world_map_gen, prompt_location_gen, prompt_entry_gen,
        prompt_location_memory_gen, prompt_story_notes_gen, prompt_story_tags_gen,
        visual_master_base_prompt, tags, creator_notes, created_date, last_modified
      )
      SELECT
        ?, ?, ? || ' (Copy)', LOWER(? || ' (Copy)'), api_provider, gemini_model, open_router_model, koboldcpp_template,
        font, background_image_url, bubble_opacity, chat_text_color, character_image_mode,
        background_blur, text_size, bubble_image_size,
        md_h1_color, md_h2_color, md_h3_color, md_bold_color, md_italic_color, md_quote_color,
        md_h1_font, md_h2_font, md_h3_font, md_bold_font, md_italic_font, md_quote_font,
        system_prompt, event_master_base_prompt, event_master_probability,
        prompt_persona_gen, prompt_world_map_gen, prompt_location_gen, prompt_entry_gen,
        prompt_location_memory_gen, prompt_story_notes_gen, prompt_story_tags_gen,
        visual_master_base_prompt, tags, creator_notes, ?, ?
      FROM stories WHERE id = ?
    `).run(newId, userId, story.name, story.name, now, now, id);

    // Copy characters
    const characters = this.getCharactersByStoryId(id);
    for (const char of characters) {
      const newCharId = uuidv4();
      db.prepare(`
        INSERT INTO characters (id, story_id, name, description, short_description, model_instructions,
          is_user, is_active, is_narrator, image_url, extra_portraits, tags, color_base, color_bold, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newCharId, newId, char.name, char.description, char.short_description, char.model_instructions,
        char.is_user ? 1 : 0, char.is_active ? 1 : 0, char.is_narrator ? 1 : 0,
        char.image_url, char.extra_portraits, char.tags, char.color_base, char.color_bold,
        char.sort_order, now, now
      );
    }

    // Copy scenarios
    const scenarios = this.getScenariosByStoryId(id);
    for (const scenario of scenarios) {
      const newScenarioId = uuidv4();
      db.prepare(`
        INSERT INTO scenarios (id, story_id, name, message, dynamic_entries, static_entries, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newScenarioId, newId, scenario.name, scenario.message, scenario.dynamic_entries, scenario.static_entries, scenario.sort_order, now, now);
    }

    // Copy dynamic entries
    const dynamicEntries = this.getDynamicEntriesByStoryId(id);
    for (const entry of dynamicEntries) {
      const newEntryId = uuidv4();
      db.prepare(`
        INSERT INTO dynamic_entries (id, story_id, title, triggers, content_fields, current_index, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newEntryId, newId, entry.title, entry.triggers, entry.content_fields, entry.current_index, entry.sort_order, now, now);
    }

    return this.getStoryById(newId);
  }

  static searchStories(userId: string, query: string): Story[] {
    const db = getDatabase();
    const searchTerm = `%${query.toLowerCase()}%`;
    return db.prepare('SELECT * FROM stories WHERE user_id = ? AND search_index LIKE ? ORDER BY last_modified DESC').all(userId, searchTerm) as Story[];
  }

  // Characters
  static getCharactersByStoryId(storyId: string): Character[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM characters WHERE story_id = ? ORDER BY sort_order').all(storyId) as Character[];
  }

  static getCharacterById(id: string): Character | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Character | undefined;
  }

  static createCharacter(storyId: string, data: CreateCharacterRequest): Character {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    // Get max sort order
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM characters WHERE story_id = ?').get(storyId) as { max: number | null };
    const sortOrder = (maxOrder.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO characters (id, story_id, name, description, short_description, model_instructions,
        is_user, is_active, is_narrator, image_url, extra_portraits, tags, color_base, color_bold, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      storyId,
      data.name,
      data.description || null,
      data.short_description || null,
      data.model_instructions || null,
      data.is_user ? 1 : 0,
      data.is_active !== false ? 1 : 0,
      data.is_narrator ? 1 : 0,
      data.image_url || null,
      JSON.stringify(data.extra_portraits || []),
      JSON.stringify(data.tags || []),
      data.color_base || null,
      data.color_bold || null,
      sortOrder,
      now,
      now
    );

    // Update story's last_modified
    db.prepare('UPDATE stories SET last_modified = ? WHERE id = ?').run(now, storyId);

    return this.getCharacterById(id)!;
  }

  static updateCharacter(id: string, data: UpdateCharacterRequest): Character | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

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
    if (data.is_user !== undefined) {
      updates.push('is_user = ?');
      values.push(data.is_user ? 1 : 0);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(data.is_active ? 1 : 0);
    }
    if (data.is_narrator !== undefined) {
      updates.push('is_narrator = ?');
      values.push(data.is_narrator ? 1 : 0);
    }
    if (data.image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(data.image_url);
    }
    if (data.extra_portraits !== undefined) {
      updates.push('extra_portraits = ?');
      values.push(JSON.stringify(data.extra_portraits));
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

      db.prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      // Update story's last_modified
      const char = this.getCharacterById(id);
      if (char) {
        db.prepare('UPDATE stories SET last_modified = ? WHERE id = ?').run(now, char.story_id);
      }
    }

    return this.getCharacterById(id);
  }

  static deleteCharacter(id: string): boolean {
    const db = getDatabase();
    const char = this.getCharacterById(id);
    const result = db.prepare('DELETE FROM characters WHERE id = ?').run(id);

    if (result.changes > 0 && char) {
      const now = new Date().toISOString();
      db.prepare('UPDATE stories SET last_modified = ? WHERE id = ?').run(now, char.story_id);
    }

    return result.changes > 0;
  }

  // Scenarios
  static getScenariosByStoryId(storyId: string): Scenario[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM scenarios WHERE story_id = ? ORDER BY sort_order').all(storyId) as Scenario[];
  }

  static getScenarioById(id: string): Scenario | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as Scenario | undefined;
  }

  static createScenario(storyId: string, data: CreateScenarioRequest): Scenario {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM scenarios WHERE story_id = ?').get(storyId) as { max: number | null };
    const sortOrder = (maxOrder.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO scenarios (id, story_id, name, message, dynamic_entries, static_entries, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      storyId,
      data.name,
      data.message,
      JSON.stringify(data.dynamic_entries || []),
      JSON.stringify(data.static_entries || []),
      sortOrder,
      now,
      now
    );

    return this.getScenarioById(id)!;
  }

  static updateScenario(id: string, data: Partial<CreateScenarioRequest>): Scenario | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.message !== undefined) {
      updates.push('message = ?');
      values.push(data.message);
    }
    if (data.dynamic_entries !== undefined) {
      updates.push('dynamic_entries = ?');
      values.push(JSON.stringify(data.dynamic_entries));
    }
    if (data.static_entries !== undefined) {
      updates.push('static_entries = ?');
      values.push(JSON.stringify(data.static_entries));
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE scenarios SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getScenarioById(id);
  }

  static deleteScenario(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Dynamic Entries
  static getDynamicEntriesByStoryId(storyId: string): DynamicEntry[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM dynamic_entries WHERE story_id = ? ORDER BY sort_order').all(storyId) as DynamicEntry[];
  }

  static getDynamicEntryById(id: string): DynamicEntry | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM dynamic_entries WHERE id = ?').get(id) as DynamicEntry | undefined;
  }

  static createDynamicEntry(storyId: string, data: CreateDynamicEntryRequest): DynamicEntry {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM dynamic_entries WHERE story_id = ?').get(storyId) as { max: number | null };
    const sortOrder = (maxOrder.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO dynamic_entries (id, story_id, title, triggers, content_fields, current_index, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      storyId,
      data.title,
      data.triggers,
      JSON.stringify(data.content_fields),
      0,
      sortOrder,
      now,
      now
    );

    return this.getDynamicEntryById(id)!;
  }

  static updateDynamicEntry(id: string, data: UpdateDynamicEntryRequest): DynamicEntry | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.title !== undefined) {
      updates.push('title = ?');
      values.push(data.title);
    }
    if (data.triggers !== undefined) {
      updates.push('triggers = ?');
      values.push(data.triggers);
    }
    if (data.content_fields !== undefined) {
      updates.push('content_fields = ?');
      values.push(JSON.stringify(data.content_fields));
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE dynamic_entries SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getDynamicEntryById(id);
  }

  static deleteDynamicEntry(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM dynamic_entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Full Story Export (for compatibility with existing import/export)
  static getFullStory(id: string): FullStoryExport | undefined {
    const story = this.getStoryById(id);
    if (!story) return undefined;

    const characters = this.getCharactersByStoryId(id);
    const scenarios = this.getScenariosByStoryId(id);
    const dynamicEntries = this.getDynamicEntriesByStoryId(id);
    const db = getDatabase();
    const narratives = db.prepare('SELECT id, name FROM narratives WHERE story_id = ?').all(id) as Array<{ id: string; name: string }>;

    return {
      id: story.id,
      name: story.name,
      created_date: story.created_date,
      last_modified: story.last_modified,
      apiProvider: story.api_provider,
      geminiModel: story.gemini_model || undefined,
      openRouterModel: story.open_router_model || undefined,
      koboldcpp_template: story.koboldcpp_template || undefined,
      font: story.font || undefined,
      backgroundImageURL: story.background_image_url || undefined,
      bubbleOpacity: story.bubble_opacity || undefined,
      chatTextColor: story.chat_text_color || undefined,
      characterImageMode: story.character_image_mode || undefined,
      backgroundBlur: story.background_blur || undefined,
      textSize: story.text_size || undefined,
      bubbleImageSize: story.bubble_image_size || undefined,
      md_h1_color: story.md_h1_color || undefined,
      md_h2_color: story.md_h2_color || undefined,
      md_h3_color: story.md_h3_color || undefined,
      md_bold_color: story.md_bold_color || undefined,
      md_italic_color: story.md_italic_color || undefined,
      md_quote_color: story.md_quote_color || undefined,
      md_h1_font: story.md_h1_font || undefined,
      md_h2_font: story.md_h2_font || undefined,
      md_h3_font: story.md_h3_font || undefined,
      md_bold_font: story.md_bold_font || undefined,
      md_italic_font: story.md_italic_font || undefined,
      md_quote_font: story.md_quote_font || undefined,
      system_prompt: story.system_prompt || undefined,
      event_master_base_prompt: story.event_master_base_prompt || undefined,
      event_master_probability: story.event_master_probability || undefined,
      prompt_persona_gen: story.prompt_persona_gen || undefined,
      prompt_world_map_gen: story.prompt_world_map_gen || undefined,
      prompt_location_gen: story.prompt_location_gen || undefined,
      prompt_entry_gen: story.prompt_entry_gen || undefined,
      prompt_location_memory_gen: story.prompt_location_memory_gen || undefined,
      prompt_story_notes_gen: story.prompt_story_notes_gen || undefined,
      prompt_story_tags_gen: story.prompt_story_tags_gen || undefined,
      visual_master_base_prompt: story.visual_master_base_prompt || undefined,
      tags: JSON.parse(story.tags || '[]'),
      creator_notes: story.creator_notes || undefined,
      characters: characters.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description || undefined,
        short_description: c.short_description || undefined,
        model_instructions: c.model_instructions || undefined,
        is_user: Boolean(c.is_user),
        is_active: Boolean(c.is_active),
        is_narrator: Boolean(c.is_narrator),
        image_url: c.image_url || undefined,
        extra_portraits: JSON.parse(c.extra_portraits || '[]'),
        tags: JSON.parse(c.tags || '[]'),
        color: (c.color_base || c.color_bold) ? {
          base: c.color_base || undefined,
          bold: c.color_bold || undefined
        } : undefined
      })),
      scenarios: scenarios.map(s => ({
        id: s.id,
        name: s.name,
        message: s.message,
        dynamic_entries: JSON.parse(s.dynamic_entries || '[]'),
        static_entries: JSON.parse(s.static_entries || '[]')
      })),
      dynamic_entries: dynamicEntries.map(d => ({
        id: d.id,
        title: d.title,
        triggers: d.triggers,
        content_fields: JSON.parse(d.content_fields || '[]'),
        current_index: d.current_index
      })),
      narratives
    };
  }
}

export default StoryService;
