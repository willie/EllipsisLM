import { v4 as uuidv4 } from 'uuid';
import getDatabase from '../db/index.js';
import type {
  Narrative,
  ChatMessage,
  StaticEntry,
  WorldMap,
  WorldLocation,
  NarrativeDynamicEntry,
  CreateNarrativeRequest,
  CreateMessageRequest,
  UpdateMessageRequest,
  CreateStaticEntryRequest,
  UpdateStaticEntryRequest,
  UpdateWorldMapRequest,
  UpdateWorldLocationRequest,
  FullNarrativeExport
} from '../types/index.js';

export class NarrativeService {
  // Narratives
  static getNarrativesByStoryId(storyId: string): Narrative[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM narratives WHERE story_id = ? ORDER BY last_modified DESC').all(storyId) as Narrative[];
  }

  static getNarrativeById(id: string): Narrative | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM narratives WHERE id = ?').get(id) as Narrative | undefined;
  }

  static createNarrative(userId: string, data: CreateNarrativeRequest): Narrative {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO narratives (id, story_id, user_id, name, active_character_ids, message_counter, last_modified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.story_id,
      userId,
      data.name,
      JSON.stringify(data.active_character_ids || []),
      0,
      now,
      now
    );

    // Create world map for the narrative
    this.createWorldMap(id);

    // If scenario_id is provided, initialize with scenario data
    if (data.scenario_id) {
      const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(data.scenario_id) as { message: string; dynamic_entries: string; static_entries: string } | undefined;
      if (scenario) {
        // Add opening message
        if (scenario.message) {
          // Get the narrator or first character
          const characters = db.prepare('SELECT id FROM characters WHERE story_id = ? AND is_narrator = 1').all(data.story_id) as Array<{ id: string }>;
          const characterId = characters[0]?.id || 'narrator';

          this.createMessage(id, {
            character_id: characterId,
            content: scenario.message,
            type: 'chat'
          });
        }

        // Add static entries from scenario
        const staticEntries = JSON.parse(scenario.static_entries || '[]') as Array<{ title: string; content: string }>;
        for (const entry of staticEntries) {
          this.createStaticEntry(id, entry);
        }
      }
    }

    return this.getNarrativeById(id)!;
  }

  static updateNarrative(id: string, data: Partial<{ name: string; active_character_ids: string[] }>): Narrative | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.active_character_ids !== undefined) {
      updates.push('active_character_ids = ?');
      values.push(JSON.stringify(data.active_character_ids));
    }

    if (updates.length > 0) {
      updates.push('last_modified = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE narratives SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getNarrativeById(id);
  }

  static deleteNarrative(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM narratives WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static duplicateNarrative(id: string, userId: string): Narrative | undefined {
    const narrative = this.getNarrativeById(id);
    if (!narrative) return undefined;

    const newId = uuidv4();
    const now = new Date().toISOString();
    const db = getDatabase();

    // Copy narrative
    db.prepare(`
      INSERT INTO narratives (id, story_id, user_id, name, active_character_ids, message_counter, last_modified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId,
      narrative.story_id,
      userId,
      narrative.name + ' (Copy)',
      narrative.active_character_ids,
      narrative.message_counter,
      now,
      now
    );

    // Copy messages
    const messages = this.getMessagesByNarrativeId(id);
    for (const msg of messages) {
      const newMsgId = uuidv4();
      db.prepare(`
        INSERT INTO chat_messages (id, narrative_id, character_id, content, type, emotion, timestamp, is_new, is_hidden, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newMsgId, newId, msg.character_id, msg.content, msg.type, msg.emotion, msg.timestamp, 0, msg.is_hidden ? 1 : 0, msg.sort_order);
    }

    // Copy static entries
    const staticEntries = this.getStaticEntriesByNarrativeId(id);
    for (const entry of staticEntries) {
      const newEntryId = uuidv4();
      db.prepare(`
        INSERT INTO static_entries (id, narrative_id, title, content, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newEntryId, newId, entry.title, entry.content, entry.sort_order, now, now);
    }

    // Copy world map
    const worldMap = this.getWorldMapByNarrativeId(id);
    if (worldMap) {
      const newMapId = uuidv4();
      db.prepare(`
        INSERT INTO world_maps (id, narrative_id, current_x, current_y, destination_x, destination_y, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newMapId, newId, worldMap.current_x, worldMap.current_y, worldMap.destination_x, worldMap.destination_y, worldMap.path, now, now);

      // Copy world locations
      const locations = this.getWorldLocationsByMapId(worldMap.id);
      for (const loc of locations) {
        const newLocId = uuidv4();
        db.prepare(`
          INSERT INTO world_locations (id, world_map_id, x, y, name, description, prompt, image_url, local_static_entries)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newLocId, newMapId, loc.x, loc.y, loc.name, loc.description, loc.prompt, loc.image_url, loc.local_static_entries);
      }
    }

    return this.getNarrativeById(newId);
  }

  // Chat Messages
  static getMessagesByNarrativeId(narrativeId: string): ChatMessage[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM chat_messages WHERE narrative_id = ? ORDER BY sort_order').all(narrativeId) as ChatMessage[];
  }

  static getMessageById(id: string): ChatMessage | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as ChatMessage | undefined;
  }

  static createMessage(narrativeId: string, data: CreateMessageRequest): ChatMessage {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    // Get max sort order
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM chat_messages WHERE narrative_id = ?').get(narrativeId) as { max: number | null };
    const sortOrder = (maxOrder.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO chat_messages (id, narrative_id, character_id, content, type, emotion, timestamp, is_new, is_hidden, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      narrativeId,
      data.character_id,
      data.content,
      data.type || 'chat',
      data.emotion || null,
      now,
      1,
      data.is_hidden ? 1 : 0,
      sortOrder
    );

    // Update narrative's message counter and last_modified
    db.prepare('UPDATE narratives SET message_counter = message_counter + 1, last_modified = ? WHERE id = ?').run(now, narrativeId);

    return this.getMessageById(id)!;
  }

  static updateMessage(id: string, data: UpdateMessageRequest): ChatMessage | undefined {
    const db = getDatabase();

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.content !== undefined) {
      updates.push('content = ?');
      values.push(data.content);
    }
    if (data.emotion !== undefined) {
      updates.push('emotion = ?');
      values.push(data.emotion);
    }
    if (data.is_hidden !== undefined) {
      updates.push('is_hidden = ?');
      values.push(data.is_hidden ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE chat_messages SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getMessageById(id);
  }

  static deleteMessage(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static deleteMessagesAfter(narrativeId: string, sortOrder: number): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM chat_messages WHERE narrative_id = ? AND sort_order > ?').run(narrativeId, sortOrder);
    return result.changes;
  }

  static markMessagesAsRead(narrativeId: string): void {
    const db = getDatabase();
    db.prepare('UPDATE chat_messages SET is_new = 0 WHERE narrative_id = ?').run(narrativeId);
  }

  // Static Entries
  static getStaticEntriesByNarrativeId(narrativeId: string): StaticEntry[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM static_entries WHERE narrative_id = ? ORDER BY sort_order').all(narrativeId) as StaticEntry[];
  }

  static getStaticEntryById(id: string): StaticEntry | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM static_entries WHERE id = ?').get(id) as StaticEntry | undefined;
  }

  static createStaticEntry(narrativeId: string, data: CreateStaticEntryRequest): StaticEntry {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM static_entries WHERE narrative_id = ?').get(narrativeId) as { max: number | null };
    const sortOrder = (maxOrder.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO static_entries (id, narrative_id, title, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, narrativeId, data.title, data.content, sortOrder, now, now);

    return this.getStaticEntryById(id)!;
  }

  static updateStaticEntry(id: string, data: UpdateStaticEntryRequest): StaticEntry | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (data.title !== undefined) {
      updates.push('title = ?');
      values.push(data.title);
    }
    if (data.content !== undefined) {
      updates.push('content = ?');
      values.push(data.content);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE static_entries SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getStaticEntryById(id);
  }

  static deleteStaticEntry(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM static_entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Narrative Dynamic Entry State
  static getNarrativeDynamicEntries(narrativeId: string): NarrativeDynamicEntry[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM narrative_dynamic_entries WHERE narrative_id = ?').all(narrativeId) as NarrativeDynamicEntry[];
  }

  static triggerDynamicEntry(narrativeId: string, dynamicEntryId: string, turn: number): NarrativeDynamicEntry {
    const db = getDatabase();
    const id = uuidv4();

    // Check if already exists
    const existing = db.prepare('SELECT * FROM narrative_dynamic_entries WHERE narrative_id = ? AND dynamic_entry_id = ?').get(narrativeId, dynamicEntryId) as NarrativeDynamicEntry | undefined;

    if (existing) {
      db.prepare('UPDATE narrative_dynamic_entries SET triggered_at_turn = ?, current_index = current_index + 1 WHERE id = ?').run(turn, existing.id);
      return db.prepare('SELECT * FROM narrative_dynamic_entries WHERE id = ?').get(existing.id) as NarrativeDynamicEntry;
    }

    db.prepare(`
      INSERT INTO narrative_dynamic_entries (id, narrative_id, dynamic_entry_id, triggered_at_turn, current_index)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, narrativeId, dynamicEntryId, turn, 0);

    return db.prepare('SELECT * FROM narrative_dynamic_entries WHERE id = ?').get(id) as NarrativeDynamicEntry;
  }

  // World Map
  static getWorldMapByNarrativeId(narrativeId: string): WorldMap | undefined {
    const db = getDatabase();
    return db.prepare('SELECT * FROM world_maps WHERE narrative_id = ?').get(narrativeId) as WorldMap | undefined;
  }

  static createWorldMap(narrativeId: string): WorldMap {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO world_maps (id, narrative_id, current_x, current_y, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, narrativeId, 3, 3, '[]', now, now);

    // Create 64 empty locations (8x8 grid)
    const insertLoc = db.prepare(`
      INSERT INTO world_locations (id, world_map_id, x, y, local_static_entries)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        insertLoc.run(uuidv4(), id, x, y, '[]');
      }
    }

    return db.prepare('SELECT * FROM world_maps WHERE id = ?').get(id) as WorldMap;
  }

  static updateWorldMap(narrativeId: string, data: UpdateWorldMapRequest): WorldMap | undefined {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.current_x !== undefined) {
      updates.push('current_x = ?');
      values.push(data.current_x);
    }
    if (data.current_y !== undefined) {
      updates.push('current_y = ?');
      values.push(data.current_y);
    }
    if (data.destination_x !== undefined) {
      updates.push('destination_x = ?');
      values.push(data.destination_x);
    }
    if (data.destination_y !== undefined) {
      updates.push('destination_y = ?');
      values.push(data.destination_y);
    }
    if (data.path !== undefined) {
      updates.push('path = ?');
      values.push(JSON.stringify(data.path));
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(narrativeId);

      db.prepare(`UPDATE world_maps SET ${updates.join(', ')} WHERE narrative_id = ?`).run(...values);
    }

    return this.getWorldMapByNarrativeId(narrativeId);
  }

  // World Locations
  static getWorldLocationsByMapId(worldMapId: string): WorldLocation[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM world_locations WHERE world_map_id = ? ORDER BY y, x').all(worldMapId) as WorldLocation[];
  }

  static getWorldLocation(narrativeId: string, x: number, y: number): WorldLocation | undefined {
    const db = getDatabase();
    const worldMap = this.getWorldMapByNarrativeId(narrativeId);
    if (!worldMap) return undefined;

    return db.prepare('SELECT * FROM world_locations WHERE world_map_id = ? AND x = ? AND y = ?').get(worldMap.id, x, y) as WorldLocation | undefined;
  }

  static updateWorldLocation(narrativeId: string, x: number, y: number, data: UpdateWorldLocationRequest): WorldLocation | undefined {
    const db = getDatabase();
    const worldMap = this.getWorldMapByNarrativeId(narrativeId);
    if (!worldMap) return undefined;

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
    if (data.prompt !== undefined) {
      updates.push('prompt = ?');
      values.push(data.prompt);
    }
    if (data.image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(data.image_url);
    }
    if (data.local_static_entries !== undefined) {
      updates.push('local_static_entries = ?');
      values.push(JSON.stringify(data.local_static_entries));
    }

    if (updates.length > 0) {
      values.push(worldMap.id);
      values.push(String(x));
      values.push(String(y));

      db.prepare(`UPDATE world_locations SET ${updates.join(', ')} WHERE world_map_id = ? AND x = ? AND y = ?`).run(...values);
    }

    return this.getWorldLocation(narrativeId, x, y);
  }

  // Full Narrative Export (for compatibility with existing import/export)
  static getFullNarrative(id: string): FullNarrativeExport | undefined {
    const narrative = this.getNarrativeById(id);
    if (!narrative) return undefined;

    const messages = this.getMessagesByNarrativeId(id);
    const staticEntries = this.getStaticEntriesByNarrativeId(id);
    const worldMap = this.getWorldMapByNarrativeId(id);

    let worldMapExport: FullNarrativeExport['state']['worldMap'] = {
      grid: [],
      currentLocation: { x: 3, y: 3 }
    };

    if (worldMap) {
      const locations = this.getWorldLocationsByMapId(worldMap.id);
      worldMapExport = {
        grid: locations.map(loc => ({
          coords: { x: loc.x, y: loc.y },
          name: loc.name || undefined,
          description: loc.description || undefined,
          prompt: loc.prompt || undefined,
          imageUrl: loc.image_url || undefined,
          local_static_entries: JSON.parse(loc.local_static_entries || '[]')
        })),
        currentLocation: { x: worldMap.current_x, y: worldMap.current_y },
        destination: worldMap.destination_x != null ? { x: worldMap.destination_x, y: worldMap.destination_y ?? null } : undefined,
        path: JSON.parse(worldMap.path || '[]')
      };
    }

    return {
      id: narrative.id,
      name: narrative.name,
      last_modified: narrative.last_modified,
      active_character_ids: JSON.parse(narrative.active_character_ids || '[]'),
      state: {
        chat_history: messages.map(msg => ({
          character_id: msg.character_id,
          content: msg.content,
          type: msg.type,
          emotion: msg.emotion || undefined,
          timestamp: msg.timestamp,
          isNew: Boolean(msg.is_new),
          isHidden: Boolean(msg.is_hidden)
        })),
        messageCounter: narrative.message_counter,
        static_entries: staticEntries.map(entry => ({
          id: entry.id,
          title: entry.title,
          content: entry.content
        })),
        worldMap: worldMapExport
      }
    };
  }
}

export default NarrativeService;
