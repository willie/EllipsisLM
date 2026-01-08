// Core Types for EllipsisLM Server

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface GlobalSettings {
  id: string;
  user_id: string;
  gemini_api_key?: string;
  open_router_key?: string;
  koboldcpp_url?: string;
  lmstudio_url?: string;
  active_story_id?: string;
  active_narrative_id?: string;
  ui_preferences: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface UserPersona {
  id: string;
  user_id: string;
  name: string;
  description: string;
  short_description?: string;
  model_instructions?: string;
  image_url?: string;
  tags: string; // JSON array string
  color_base?: string;
  color_bold?: string;
  created_at: string;
  updated_at: string;
}

export interface Story {
  id: string;
  user_id: string;
  name: string;
  created_date: string;
  last_modified: string;
  search_index?: string;

  // API Configuration
  api_provider: 'gemini' | 'openrouter' | 'koboldcpp' | 'lmstudio';
  gemini_model?: string;
  open_router_model?: string;
  koboldcpp_template?: string;

  // UI Configuration
  font?: string;
  background_image_url?: string;
  bubble_opacity?: number;
  chat_text_color?: string;
  character_image_mode?: 'none' | 'default' | 'cinematic' | 'bubble';
  background_blur?: number;
  text_size?: number;
  bubble_image_size?: number;

  // Markdown Colors
  md_h1_color?: string;
  md_h2_color?: string;
  md_h3_color?: string;
  md_bold_color?: string;
  md_italic_color?: string;
  md_quote_color?: string;
  md_h1_font?: string;
  md_h2_font?: string;
  md_h3_font?: string;
  md_bold_font?: string;
  md_italic_font?: string;
  md_quote_font?: string;

  // System Prompts
  system_prompt?: string;
  event_master_base_prompt?: string;
  event_master_probability?: number;
  prompt_persona_gen?: string;
  prompt_world_map_gen?: string;
  prompt_location_gen?: string;
  prompt_entry_gen?: string;
  prompt_location_memory_gen?: string;
  prompt_story_notes_gen?: string;
  prompt_story_tags_gen?: string;
  visual_master_base_prompt?: string;

  // Story Metadata
  tags: string; // JSON array string
  creator_notes?: string;
}

export interface Character {
  id: string;
  story_id: string;
  name: string;
  description?: string;
  short_description?: string;
  model_instructions?: string;
  is_user: boolean;
  is_active: boolean;
  is_narrator: boolean;
  image_url?: string;
  extra_portraits: string; // JSON array string
  tags: string; // JSON array string
  color_base?: string;
  color_bold?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Scenario {
  id: string;
  story_id: string;
  name: string;
  message: string;
  dynamic_entries: string; // JSON array string
  static_entries: string; // JSON array string
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DynamicEntry {
  id: string;
  story_id: string;
  title: string;
  triggers: string;
  content_fields: string; // JSON array string
  current_index: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Narrative {
  id: string;
  story_id: string;
  user_id: string;
  name: string;
  last_modified: string;
  active_character_ids: string; // JSON array string
  message_counter: number;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  narrative_id: string;
  character_id: string;
  content: string;
  type: 'chat' | 'lore_reveal' | 'system_event';
  emotion?: string;
  timestamp: string;
  is_new: boolean;
  is_hidden: boolean;
  sort_order: number;
}

export interface StaticEntry {
  id: string;
  narrative_id: string;
  title: string;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NarrativeDynamicEntry {
  id: string;
  narrative_id: string;
  dynamic_entry_id: string;
  triggered_at_turn?: number;
  current_index: number;
}

export interface WorldMap {
  id: string;
  narrative_id: string;
  current_x: number;
  current_y: number;
  destination_x?: number;
  destination_y?: number;
  path: string; // JSON array string
  created_at: string;
  updated_at: string;
}

export interface WorldLocation {
  id: string;
  world_map_id: string;
  x: number;
  y: number;
  name?: string;
  description?: string;
  prompt?: string;
  image_url?: string;
  local_static_entries: string; // JSON array string
}

export interface CharacterImage {
  id: string;
  character_id: string;
  emotion?: string;
  data: Buffer;
  mime_type: string;
  created_at: string;
}

// API Request/Response Types

export interface CreateStoryRequest {
  name: string;
  api_provider?: 'gemini' | 'openrouter' | 'koboldcpp' | 'lmstudio';
  system_prompt?: string;
}

export interface UpdateStoryRequest extends Partial<Omit<Story, 'id' | 'user_id' | 'created_date'>> {}

export interface CreateCharacterRequest {
  name: string;
  description?: string;
  short_description?: string;
  model_instructions?: string;
  is_user?: boolean;
  is_active?: boolean;
  is_narrator?: boolean;
  image_url?: string;
  extra_portraits?: Array<{ emotion: string; image_url: string; key: string }>;
  tags?: string[];
  color_base?: string;
  color_bold?: string;
}

export interface UpdateCharacterRequest extends Partial<Omit<CreateCharacterRequest, 'story_id'>> {}

export interface CreateNarrativeRequest {
  name: string;
  story_id: string;
  active_character_ids?: string[];
  scenario_id?: string;
}

export interface CreateMessageRequest {
  character_id: string;
  content: string;
  type?: 'chat' | 'lore_reveal' | 'system_event';
  emotion?: string;
  is_hidden?: boolean;
}

export interface UpdateMessageRequest {
  content?: string;
  emotion?: string;
  is_hidden?: boolean;
}

export interface CreateStaticEntryRequest {
  title: string;
  content: string;
}

export interface UpdateStaticEntryRequest extends Partial<CreateStaticEntryRequest> {}

export interface CreateDynamicEntryRequest {
  title: string;
  triggers: string;
  content_fields: string[];
}

export interface UpdateDynamicEntryRequest extends Partial<CreateDynamicEntryRequest> {}

export interface UpdateWorldLocationRequest {
  name?: string;
  description?: string;
  prompt?: string;
  image_url?: string;
  local_static_entries?: Array<{ id: string; title: string; content: string }>;
}

export interface UpdateWorldMapRequest {
  current_x?: number;
  current_y?: number;
  destination_x?: number | null;
  destination_y?: number | null;
  path?: Array<{ x: number; y: number }>;
}

export interface CreateScenarioRequest {
  name: string;
  message: string;
  dynamic_entries?: Array<{ id: string; title: string; triggers: string; content_fields: string[] }>;
  static_entries?: Array<{ id: string; title: string; content: string }>;
}

export interface UpdateSettingsRequest {
  gemini_api_key?: string;
  open_router_key?: string;
  koboldcpp_url?: string;
  lmstudio_url?: string;
  active_story_id?: string;
  active_narrative_id?: string;
  ui_preferences?: Record<string, unknown>;
}

export interface CreateUserPersonaRequest {
  name: string;
  description: string;
  short_description?: string;
  model_instructions?: string;
  image_url?: string;
  tags?: string[];
  color_base?: string;
  color_bold?: string;
}

// Full Story Export Type (for import/export compatibility)
export interface FullStoryExport {
  id: string;
  name: string;
  created_date: string;
  last_modified: string;
  apiProvider: string;
  geminiModel?: string;
  openRouterModel?: string;
  koboldcpp_template?: string;
  font?: string;
  backgroundImageURL?: string;
  bubbleOpacity?: number;
  chatTextColor?: string;
  characterImageMode?: string;
  backgroundBlur?: number;
  textSize?: number;
  bubbleImageSize?: number;
  md_h1_color?: string;
  md_h2_color?: string;
  md_h3_color?: string;
  md_bold_color?: string;
  md_italic_color?: string;
  md_quote_color?: string;
  md_h1_font?: string;
  md_h2_font?: string;
  md_h3_font?: string;
  md_bold_font?: string;
  md_italic_font?: string;
  md_quote_font?: string;
  system_prompt?: string;
  event_master_base_prompt?: string;
  event_master_probability?: number;
  prompt_persona_gen?: string;
  prompt_world_map_gen?: string;
  prompt_location_gen?: string;
  prompt_entry_gen?: string;
  prompt_location_memory_gen?: string;
  prompt_story_notes_gen?: string;
  prompt_story_tags_gen?: string;
  visual_master_base_prompt?: string;
  tags?: string[];
  creator_notes?: string;
  characters: Array<{
    id: string;
    name: string;
    description?: string;
    short_description?: string;
    model_instructions?: string;
    is_user: boolean;
    is_active: boolean;
    is_narrator: boolean;
    image_url?: string;
    extra_portraits?: Array<{ emotion: string; image_url: string; key: string }>;
    tags?: string[];
    color?: { base?: string; bold?: string };
  }>;
  scenarios: Array<{
    id: string;
    name: string;
    message: string;
    dynamic_entries?: Array<{ id: string; title: string; triggers: string; content_fields: string[] }>;
    static_entries?: Array<{ id: string; title: string; content: string }>;
  }>;
  dynamic_entries: Array<{
    id: string;
    title: string;
    triggers: string;
    content_fields: string[];
    current_index: number;
  }>;
  narratives: Array<{
    id: string;
    name: string;
  }>;
}

// Full Narrative Export Type
export interface FullNarrativeExport {
  id: string;
  name: string;
  last_modified: string;
  active_character_ids: string[];
  state: {
    chat_history: Array<{
      character_id: string;
      content: string;
      type: string;
      emotion?: string;
      timestamp: string;
      isNew: boolean;
      isHidden: boolean;
    }>;
    messageCounter: number;
    static_entries: Array<{
      id: string;
      title: string;
      content: string;
    }>;
    worldMap: {
      grid: Array<{
        coords: { x: number; y: number };
        name?: string;
        description?: string;
        prompt?: string;
        imageUrl?: string;
        local_static_entries?: Array<{ id: string; title: string; content: string }>;
      }>;
      currentLocation: { x: number; y: number };
      destination?: { x: number | null; y: number | null };
      path?: Array<{ x: number; y: number }>;
    };
  };
}
