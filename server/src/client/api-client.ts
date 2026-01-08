/**
 * EllipsisLM API Client
 * This client can be used in the frontend to communicate with the server.
 * It provides a drop-in replacement for the local storage/IndexedDB operations.
 */

const API_BASE = typeof window !== 'undefined'
  ? (window as { ELLIPSIS_API_URL?: string }).ELLIPSIS_API_URL || '/api'
  : '/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { headers?: Record<string, string> }
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    ...options?.headers,
  };

  if (body && !(body instanceof FormData) && !(body instanceof ArrayBuffer)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body instanceof ArrayBuffer
      ? body
      : body instanceof FormData
        ? body
        : body
          ? JSON.stringify(body)
          : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(response.status, error.error || error.message || 'Request failed');
  }

  // Handle binary responses
  const contentType = response.headers.get('Content-Type');
  if (contentType?.startsWith('image/')) {
    return response.blob() as unknown as T;
  }

  return response.json();
}

// Story Types
interface Story {
  id: string;
  name: string;
  created_date: string;
  last_modified: string;
  api_provider: string;
  [key: string]: unknown;
}

interface Character {
  id: string;
  story_id: string;
  name: string;
  description?: string;
  is_user: boolean;
  is_active: boolean;
  is_narrator: boolean;
  [key: string]: unknown;
}

interface Narrative {
  id: string;
  story_id: string;
  name: string;
  last_modified: string;
  active_character_ids: string;
  message_counter: number;
  [key: string]: unknown;
}

interface ChatMessage {
  id: string;
  narrative_id: string;
  character_id: string;
  content: string;
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

interface StaticEntry {
  id: string;
  narrative_id: string;
  title: string;
  content: string;
  [key: string]: unknown;
}

interface DynamicEntry {
  id: string;
  story_id: string;
  title: string;
  triggers: string;
  content_fields: string;
  [key: string]: unknown;
}

interface Scenario {
  id: string;
  story_id: string;
  name: string;
  message: string;
  [key: string]: unknown;
}

interface WorldMap {
  id: string;
  narrative_id: string;
  current_x: number;
  current_y: number;
  destination_x?: number;
  destination_y?: number;
  path: string;
  locations: WorldLocation[];
}

interface WorldLocation {
  id: string;
  world_map_id: string;
  x: number;
  y: number;
  name?: string;
  description?: string;
  prompt?: string;
  image_url?: string;
  local_static_entries: string;
}

interface Settings {
  gemini_api_key?: string;
  open_router_key?: string;
  koboldcpp_url?: string;
  lmstudio_url?: string;
  active_story_id?: string;
  active_narrative_id?: string;
  ui_preferences: Record<string, unknown>;
}

interface UserPersona {
  id: string;
  name: string;
  description: string;
  [key: string]: unknown;
}

// API Client
export const EllipsisAPI = {
  // Stories
  stories: {
    getAll: (query?: string) =>
      request<Story[]>('GET', query ? `/stories?q=${encodeURIComponent(query)}` : '/stories'),

    get: (id: string) =>
      request<Story>('GET', `/stories/${id}`),

    getFull: (id: string) =>
      request<unknown>('GET', `/stories/${id}/full`),

    create: (data: { name: string; api_provider?: string; system_prompt?: string }) =>
      request<Story>('POST', '/stories', data),

    update: (id: string, data: Partial<Story>) =>
      request<Story>('PUT', `/stories/${id}`, data),

    delete: (id: string) =>
      request<{ success: boolean }>('DELETE', `/stories/${id}`),

    duplicate: (id: string) =>
      request<Story>('POST', `/stories/${id}/duplicate`),
  },

  // Characters
  characters: {
    getByStory: (storyId: string) =>
      request<Character[]>('GET', `/stories/${storyId}/characters`),

    get: (storyId: string, charId: string) =>
      request<Character>('GET', `/stories/${storyId}/characters/${charId}`),

    create: (storyId: string, data: Partial<Character>) =>
      request<Character>('POST', `/stories/${storyId}/characters`, data),

    update: (storyId: string, charId: string, data: Partial<Character>) =>
      request<Character>('PUT', `/stories/${storyId}/characters/${charId}`, data),

    delete: (storyId: string, charId: string) =>
      request<{ success: boolean }>('DELETE', `/stories/${storyId}/characters/${charId}`),
  },

  // Scenarios
  scenarios: {
    getByStory: (storyId: string) =>
      request<Scenario[]>('GET', `/stories/${storyId}/scenarios`),

    create: (storyId: string, data: { name: string; message: string; dynamic_entries?: unknown[]; static_entries?: unknown[] }) =>
      request<Scenario>('POST', `/stories/${storyId}/scenarios`, data),

    update: (storyId: string, scenarioId: string, data: Partial<Scenario>) =>
      request<Scenario>('PUT', `/stories/${storyId}/scenarios/${scenarioId}`, data),

    delete: (storyId: string, scenarioId: string) =>
      request<{ success: boolean }>('DELETE', `/stories/${storyId}/scenarios/${scenarioId}`),
  },

  // Dynamic Entries
  dynamicEntries: {
    getByStory: (storyId: string) =>
      request<DynamicEntry[]>('GET', `/stories/${storyId}/dynamic-entries`),

    create: (storyId: string, data: { title: string; triggers: string; content_fields: string[] }) =>
      request<DynamicEntry>('POST', `/stories/${storyId}/dynamic-entries`, data),

    update: (storyId: string, entryId: string, data: Partial<DynamicEntry>) =>
      request<DynamicEntry>('PUT', `/stories/${storyId}/dynamic-entries/${entryId}`, data),

    delete: (storyId: string, entryId: string) =>
      request<{ success: boolean }>('DELETE', `/stories/${storyId}/dynamic-entries/${entryId}`),
  },

  // Narratives
  narratives: {
    getByStory: (storyId: string) =>
      request<Narrative[]>('GET', `/stories/${storyId}/narratives`),

    get: (id: string) =>
      request<Narrative>('GET', `/narratives/${id}`),

    getFull: (id: string) =>
      request<unknown>('GET', `/narratives/${id}/full`),

    create: (data: { name: string; story_id: string; active_character_ids?: string[]; scenario_id?: string }) =>
      request<Narrative>('POST', '/narratives', data),

    update: (id: string, data: { name?: string; active_character_ids?: string[] }) =>
      request<Narrative>('PUT', `/narratives/${id}`, data),

    delete: (id: string) =>
      request<{ success: boolean }>('DELETE', `/narratives/${id}`),

    duplicate: (id: string) =>
      request<Narrative>('POST', `/narratives/${id}/duplicate`),
  },

  // Messages
  messages: {
    getByNarrative: (narrativeId: string) =>
      request<ChatMessage[]>('GET', `/narratives/${narrativeId}/messages`),

    create: (narrativeId: string, data: { character_id: string; content: string; type?: string; emotion?: string; is_hidden?: boolean }) =>
      request<ChatMessage>('POST', `/narratives/${narrativeId}/messages`, data),

    update: (narrativeId: string, msgId: string, data: { content?: string; emotion?: string; is_hidden?: boolean }) =>
      request<ChatMessage>('PUT', `/narratives/${narrativeId}/messages/${msgId}`, data),

    delete: (narrativeId: string, msgId: string) =>
      request<{ success: boolean }>('DELETE', `/narratives/${narrativeId}/messages/${msgId}`),

    undo: (narrativeId: string, sortOrder: number) =>
      request<{ deleted: number }>('POST', `/narratives/${narrativeId}/messages/undo/${sortOrder}`),

    markRead: (narrativeId: string) =>
      request<{ success: boolean }>('POST', `/narratives/${narrativeId}/messages/mark-read`),
  },

  // Static Entries (per narrative)
  staticEntries: {
    getByNarrative: (narrativeId: string) =>
      request<StaticEntry[]>('GET', `/narratives/${narrativeId}/static-entries`),

    create: (narrativeId: string, data: { title: string; content: string }) =>
      request<StaticEntry>('POST', `/narratives/${narrativeId}/static-entries`, data),

    update: (narrativeId: string, entryId: string, data: { title?: string; content?: string }) =>
      request<StaticEntry>('PUT', `/narratives/${narrativeId}/static-entries/${entryId}`, data),

    delete: (narrativeId: string, entryId: string) =>
      request<{ success: boolean }>('DELETE', `/narratives/${narrativeId}/static-entries/${entryId}`),
  },

  // World Map
  worldMap: {
    get: (narrativeId: string) =>
      request<WorldMap>('GET', `/narratives/${narrativeId}/world-map`),

    update: (narrativeId: string, data: { current_x?: number; current_y?: number; destination_x?: number | null; destination_y?: number | null; path?: { x: number; y: number }[] }) =>
      request<WorldMap>('PUT', `/narratives/${narrativeId}/world-map`, data),

    getLocation: (narrativeId: string, x: number, y: number) =>
      request<WorldLocation>('GET', `/narratives/${narrativeId}/world-map/locations/${x}/${y}`),

    updateLocation: (narrativeId: string, x: number, y: number, data: { name?: string; description?: string; prompt?: string; image_url?: string; local_static_entries?: unknown[] }) =>
      request<WorldLocation>('PUT', `/narratives/${narrativeId}/world-map/locations/${x}/${y}`, data),
  },

  // Images
  images: {
    getCharacterImage: (charId: string) =>
      request<Blob>('GET', `/images/characters/${charId}/image`),

    uploadCharacterImage: (charId: string, data: ArrayBuffer, mimeType: string) =>
      request<{ id: string; character_id: string }>('POST', `/images/characters/${charId}/image`, data, {
        headers: { 'Content-Type': mimeType }
      }),

    deleteCharacterImage: (charId: string) =>
      request<{ success: boolean }>('DELETE', `/images/characters/${charId}/image`),

    getPortrait: (charId: string, emotion: string) =>
      request<Blob>('GET', `/images/characters/${charId}/portraits/${emotion}`),

    uploadPortrait: (charId: string, emotion: string, data: ArrayBuffer, mimeType: string) =>
      request<{ id: string; character_id: string; emotion: string }>('POST', `/images/characters/${charId}/portraits/${emotion}`, data, {
        headers: { 'Content-Type': mimeType }
      }),

    deletePortrait: (charId: string, emotion: string) =>
      request<{ success: boolean }>('DELETE', `/images/characters/${charId}/portraits/${emotion}`),

    getAllForCharacter: (charId: string) =>
      request<Array<{ id: string; character_id: string; emotion?: string; mime_type: string; created_at: string }>>('GET', `/images/characters/${charId}/all`),
  },

  // Settings
  settings: {
    get: () =>
      request<Settings>('GET', '/settings'),

    update: (data: Partial<Settings>) =>
      request<Settings>('PUT', '/settings', data),

    getApiKeys: () =>
      request<{ gemini_api_key?: string; open_router_key?: string; koboldcpp_url?: string; lmstudio_url?: string }>('GET', '/settings/api-keys'),

    getActive: () =>
      request<{ active_story_id?: string; active_narrative_id?: string }>('GET', '/settings/active'),

    setActive: (data: { active_story_id?: string; active_narrative_id?: string }) =>
      request<{ active_story_id?: string; active_narrative_id?: string }>('PUT', '/settings/active', data),
  },

  // User Personas
  personas: {
    getAll: () =>
      request<UserPersona[]>('GET', '/settings/personas'),

    get: (id: string) =>
      request<UserPersona>('GET', `/settings/personas/${id}`),

    create: (data: { name: string; description: string; [key: string]: unknown }) =>
      request<UserPersona>('POST', '/settings/personas', data),

    update: (id: string, data: Partial<UserPersona>) =>
      request<UserPersona>('PUT', `/settings/personas/${id}`, data),

    delete: (id: string) =>
      request<{ success: boolean }>('DELETE', `/settings/personas/${id}`),
  },
};

export default EllipsisAPI;
