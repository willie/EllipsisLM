// SQLite Database Schema for EllipsisLM

export const schema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Global settings per user
CREATE TABLE IF NOT EXISTS global_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  gemini_api_key TEXT,
  open_router_key TEXT,
  koboldcpp_url TEXT,
  lmstudio_url TEXT,
  active_story_id TEXT,
  active_narrative_id TEXT,
  ui_preferences TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User personas (reusable character templates for user characters)
CREATE TABLE IF NOT EXISTS user_personas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  short_description TEXT,
  model_instructions TEXT,
  image_url TEXT,
  tags TEXT DEFAULT '[]',
  color_base TEXT,
  color_bold TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Stories
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_date TEXT NOT NULL DEFAULT (datetime('now')),
  last_modified TEXT NOT NULL DEFAULT (datetime('now')),
  search_index TEXT,

  -- API Configuration
  api_provider TEXT NOT NULL DEFAULT 'gemini',
  gemini_model TEXT,
  open_router_model TEXT,
  koboldcpp_template TEXT,

  -- UI Configuration
  font TEXT,
  background_image_url TEXT,
  bubble_opacity REAL DEFAULT 0.85,
  chat_text_color TEXT,
  character_image_mode TEXT DEFAULT 'default',
  background_blur REAL DEFAULT 0,
  text_size REAL DEFAULT 1,
  bubble_image_size REAL DEFAULT 60,

  -- Markdown Colors
  md_h1_color TEXT,
  md_h2_color TEXT,
  md_h3_color TEXT,
  md_bold_color TEXT,
  md_italic_color TEXT,
  md_quote_color TEXT,
  md_h1_font TEXT,
  md_h2_font TEXT,
  md_h3_font TEXT,
  md_bold_font TEXT,
  md_italic_font TEXT,
  md_quote_font TEXT,

  -- System Prompts
  system_prompt TEXT,
  event_master_base_prompt TEXT,
  event_master_probability REAL DEFAULT 0,
  prompt_persona_gen TEXT,
  prompt_world_map_gen TEXT,
  prompt_location_gen TEXT,
  prompt_entry_gen TEXT,
  prompt_location_memory_gen TEXT,
  prompt_story_notes_gen TEXT,
  prompt_story_tags_gen TEXT,
  visual_master_base_prompt TEXT,

  -- Story Metadata
  tags TEXT DEFAULT '[]',
  creator_notes TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Characters
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  model_instructions TEXT,
  is_user INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_narrator INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  extra_portraits TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  color_base TEXT,
  color_bold TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

-- Scenarios (starting points for narratives)
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  dynamic_entries TEXT DEFAULT '[]',
  static_entries TEXT DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

-- Dynamic entries (triggered lore)
CREATE TABLE IF NOT EXISTS dynamic_entries (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  title TEXT NOT NULL,
  triggers TEXT NOT NULL,
  content_fields TEXT DEFAULT '[]',
  current_index INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

-- Narratives (playthroughs)
CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  last_modified TEXT NOT NULL DEFAULT (datetime('now')),
  active_character_ids TEXT DEFAULT '[]',
  message_counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  narrative_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'chat',
  emotion TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  is_new INTEGER NOT NULL DEFAULT 1,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (narrative_id) REFERENCES narratives(id) ON DELETE CASCADE
);

-- Static entries (always-in-context knowledge per narrative)
CREATE TABLE IF NOT EXISTS static_entries (
  id TEXT PRIMARY KEY,
  narrative_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (narrative_id) REFERENCES narratives(id) ON DELETE CASCADE
);

-- Narrative-specific dynamic entry state
CREATE TABLE IF NOT EXISTS narrative_dynamic_entries (
  id TEXT PRIMARY KEY,
  narrative_id TEXT NOT NULL,
  dynamic_entry_id TEXT NOT NULL,
  triggered_at_turn INTEGER,
  current_index INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (narrative_id) REFERENCES narratives(id) ON DELETE CASCADE,
  FOREIGN KEY (dynamic_entry_id) REFERENCES dynamic_entries(id) ON DELETE CASCADE,
  UNIQUE(narrative_id, dynamic_entry_id)
);

-- World maps (one per narrative)
CREATE TABLE IF NOT EXISTS world_maps (
  id TEXT PRIMARY KEY,
  narrative_id TEXT NOT NULL UNIQUE,
  current_x INTEGER NOT NULL DEFAULT 3,
  current_y INTEGER NOT NULL DEFAULT 3,
  destination_x INTEGER,
  destination_y INTEGER,
  path TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (narrative_id) REFERENCES narratives(id) ON DELETE CASCADE
);

-- World locations (64 per world map, 8x8 grid)
CREATE TABLE IF NOT EXISTS world_locations (
  id TEXT PRIMARY KEY,
  world_map_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  name TEXT,
  description TEXT,
  prompt TEXT,
  image_url TEXT,
  local_static_entries TEXT DEFAULT '[]',
  FOREIGN KEY (world_map_id) REFERENCES world_maps(id) ON DELETE CASCADE,
  UNIQUE(world_map_id, x, y)
);

-- Character images (binary storage)
CREATE TABLE IF NOT EXISTS character_images (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  emotion TEXT,
  data BLOB NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE(character_id, emotion)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stories_user_id ON stories(user_id);
CREATE INDEX IF NOT EXISTS idx_stories_search ON stories(search_index);
CREATE INDEX IF NOT EXISTS idx_characters_story_id ON characters(story_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_story_id ON scenarios(story_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_entries_story_id ON dynamic_entries(story_id);
CREATE INDEX IF NOT EXISTS idx_narratives_story_id ON narratives(story_id);
CREATE INDEX IF NOT EXISTS idx_narratives_user_id ON narratives(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_narrative_id ON chat_messages(narrative_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sort ON chat_messages(narrative_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_static_entries_narrative_id ON static_entries(narrative_id);
CREATE INDEX IF NOT EXISTS idx_world_locations_map_id ON world_locations(world_map_id);
CREATE INDEX IF NOT EXISTS idx_character_images_char_id ON character_images(character_id);
`;

export default schema;
