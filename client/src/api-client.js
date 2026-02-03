/**
 * API Client - Drop-in replacement for DBService and APIService
 * Maintains the same interface so frontend code changes are minimal
 */

const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  // Handle binary responses (images)
  const contentType = response.headers.get('Content-Type');
  if (contentType && contentType.startsWith('image/')) {
    return response.blob();
  }

  return response.json();
}

/**
 * DBService replacement - same interface as IndexedDB version
 */
export const DBService = {
  db: true, // Fake db reference to satisfy ensure() checks

  async init() {
    // No-op - server handles initialization
    return true;
  },

  async ensure() {
    return true;
  },

  // --- Stories ---

  async getStory(storyId) {
    try {
      return await request(`/stories/${storyId}`);
    } catch (e) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  },

  async getAllStories() {
    return await request('/stories');
  },

  async saveStory(story) {
    await request('/stories', {
      method: 'POST',
      body: JSON.stringify(story),
    });
    return true;
  },

  async deleteStory(storyId) {
    await request(`/stories/${storyId}`, { method: 'DELETE' });
    return true;
  },

  // --- Narratives ---

  async getNarrative(narrativeId) {
    try {
      return await request(`/narratives/${narrativeId}`);
    } catch (e) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  },

  async getAllNarratives() {
    return await request('/narratives');
  },

  async saveNarrative(narrative) {
    await request('/narratives', {
      method: 'POST',
      body: JSON.stringify(narrative),
    });
    return true;
  },

  async deleteNarrative(narrativeId) {
    await request(`/narratives/${narrativeId}`, { method: 'DELETE' });
    return true;
  },

  // --- Images ---

  async getImage(id) {
    try {
      const blob = await fetch(`${API_BASE}/images/${encodeURIComponent(id)}`).then(res => {
        if (!res.ok) return null;
        return res.blob();
      });
      return blob;
    } catch (e) {
      return null;
    }
  },

  async getAllKeys(storeName) {
    if (storeName === 'characterImages') {
      return await request('/images/keys');
    }
    return [];
  },

  async saveImage(id, blob) {
    const response = await fetch(`${API_BASE}/images/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'image/png',
      },
      body: blob,
    });
    return response.ok;
  },

  async deleteImage(id) {
    await fetch(`${API_BASE}/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  },

  async clear() {
    await request('/images', { method: 'DELETE' });
    return true;
  },

  // --- Store operations ---

  async clearStore(storeName) {
    await request('/backup/clear', {
      method: 'POST',
      body: JSON.stringify({ stores: [storeName] }),
    });
    return true;
  },

  async iterateStore(storeName, callback) {
    if (storeName === 'characterImages') {
      const keys = await this.getAllKeys(storeName);
      let processedCount = 0;
      const errors = [];

      for (const key of keys) {
        try {
          const blob = await this.getImage(key);
          if (blob) {
            await callback(key, blob);
            processedCount++;
          }
        } catch (err) {
          errors.push({ key, error: err.message });
        }
      }

      return { success: true, processedCount, errors };
    }
    return { success: true, processedCount: 0, errors: [] };
  },

  async getAllEntries(storeName) {
    if (storeName === 'characterImages') {
      const keys = await this.getAllKeys(storeName);
      const entries = [];
      for (const key of keys) {
        const blob = await this.getImage(key);
        entries.push([key, blob]);
      }
      return entries;
    }
    return [];
  },
};

/**
 * APIService replacement - proxies through server
 */
export const APIService = {
  async callAI(prompt, isJson = false, signal = null) {
    const state = window.StateManager?.getState() || {};
    const globalSettings = window.StateManager?.data?.globalSettings || {};

    const provider = state.apiProvider || globalSettings.apiProvider || 'gemini';
    const model = state[`${provider}Model`] || globalSettings[`${provider}Model`] ||
                  (provider === 'gemini' ? 'gemini-1.5-flash' : 'google/gemini-flash-1.5');

    // Build options for local backends
    const options = {};
    if (provider === 'koboldcpp') {
      options.koboldcpp_url = state.koboldcpp_url || globalSettings.koboldcpp_url || 'http://localhost:5001';
      options.koboldcpp_min_p = state.koboldcpp_min_p ?? globalSettings.koboldcpp_min_p ?? 0.1;
      options.koboldcpp_dry = state.koboldcpp_dry ?? globalSettings.koboldcpp_dry ?? 0.25;
    } else if (provider === 'lmstudio') {
      options.lmstudio_url = state.lmstudio_url || globalSettings.lmstudio_url || 'http://localhost:1234';
    }

    try {
      const response = await fetch(`${API_BASE}/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, prompt, model, options }),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      let text = data.text || '';

      if (isJson) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch && jsonMatch[0]) return jsonMatch[0];
        throw new Error('AI response was not in the expected JSON format.');
      }
      return text.trim();
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      console.error(`AI call failed:`, error);
      throw error;
    }
  },

  async getGeminiModels() {
    try {
      return await request('/ai/models/gemini');
    } catch (e) {
      console.error('Failed to fetch Gemini models:', e);
      return [];
    }
  },

  async fetchOpenRouterModels() {
    try {
      return await request('/ai/models/openrouter');
    } catch (e) {
      console.error('Failed to fetch OpenRouter models:', e);
      return [];
    }
  },

  // These are no longer used directly (proxied through callAI)
  // but keeping stubs for compatibility
  async callGemini(prompt, signal) {
    return this.callAI(prompt, false, signal);
  },

  async callOpenRouter(prompt, signal) {
    return this.callAI(prompt, false, signal);
  },

  async callKoboldCPP(prompt, signal) {
    return this.callAI(prompt, false, signal);
  },

  async callLMStudio(prompt, signal) {
    return this.callAI(prompt, false, signal);
  },
};

/**
 * ImageGenerationService replacement
 */
export const ImageGenerationService = {
  async generateImage(prompt, negativePrompt = '', options = {}) {
    const globalSettings = window.StateManager?.data?.globalSettings || {};
    const backend = globalSettings.imageGenBackend || 'koboldcpp';

    if (backend === 'disabled') {
      console.log('Image generation is disabled.');
      return null;
    }

    const requestOptions = {
      width: options.width || globalSettings.imageGenWidth || 512,
      height: options.height || globalSettings.imageGenHeight || 512,
      steps: parseInt(globalSettings.koboldImageGenSteps || 20),
      cfg_scale: parseFloat(globalSettings.koboldImageGenCfg || 7),
      koboldImageGenUrl: globalSettings.koboldImageGenUrl || 'http://localhost:5001',
      model: globalSettings.imageGenOpenRouterModel,
    };

    try {
      const response = await fetch(`${API_BASE}/ai/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: backend,
          prompt,
          negativePrompt,
          options: requestOptions,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.image) {
        // Convert base64 to blob
        const byteCharacters = atob(data.image);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: 'image/png' });
      }
      return null;
    } catch (error) {
      console.error('Image generation error:', error);
      throw error;
    }
  },

  async testConnection() {
    const globalSettings = window.StateManager?.data?.globalSettings || {};
    const backend = globalSettings.imageGenBackend || 'koboldcpp';

    try {
      const providers = await request('/ai/providers');
      if (backend === 'koboldcpp') {
        // For local backends, we can't easily test from server
        // Return true and let it fail on actual generation
        return true;
      } else if (backend === 'openrouter') {
        return providers.imageGen;
      }
    } catch (e) {
      return false;
    }
    return false;
  },
};

/**
 * Settings helpers - store in server instead of localStorage
 */
export const SettingsService = {
  async getGlobalSettings() {
    try {
      return await request('/settings');
    } catch (e) {
      return {};
    }
  },

  async saveGlobalSettings(settings) {
    await request('/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  },

  async getActiveIds() {
    try {
      return await request('/settings/active');
    } catch (e) {
      return { activeStoryId: null, activeNarrativeId: null };
    }
  },

  async saveActiveIds(activeStoryId, activeNarrativeId) {
    await request('/settings/active', {
      method: 'POST',
      body: JSON.stringify({ activeStoryId, activeNarrativeId }),
    });
  },
};

/**
 * Sync service - syncs localStorage with server for cross-device support
 */
export const SyncService = {
  /**
   * Pull settings from server and update localStorage
   * Called on app startup before StateManager.loadLibrary()
   */
  async pullFromServer() {
    try {
      // Fetch global settings from server
      const serverSettings = await SettingsService.getGlobalSettings();
      if (serverSettings && Object.keys(serverSettings).length > 0) {
        // Merge with existing localStorage (server takes precedence)
        const localSettingsJSON = localStorage.getItem('aiStorytellerGlobalSettings');
        const localSettings = localSettingsJSON ? JSON.parse(localSettingsJSON) : {};
        const merged = { ...localSettings, ...serverSettings };
        localStorage.setItem('aiStorytellerGlobalSettings', JSON.stringify(merged));
        console.log('[Sync] Pulled global settings from server');
      }

      // Fetch active IDs from server
      const { activeStoryId, activeNarrativeId } = await SettingsService.getActiveIds();
      if (activeStoryId) {
        localStorage.setItem('active_story_id', activeStoryId);
        console.log('[Sync] Pulled active_story_id from server:', activeStoryId);
      }
      if (activeNarrativeId) {
        localStorage.setItem('active_narrative_id', activeNarrativeId);
        console.log('[Sync] Pulled active_narrative_id from server:', activeNarrativeId);
      }
    } catch (e) {
      console.warn('[Sync] Failed to pull from server:', e);
    }
  },

  /**
   * Push current localStorage settings to server
   * Called after saves
   */
  async pushToServer() {
    try {
      // Push global settings
      const settingsJSON = localStorage.getItem('aiStorytellerGlobalSettings');
      if (settingsJSON) {
        const settings = JSON.parse(settingsJSON);
        await SettingsService.saveGlobalSettings(settings);
      }

      // Push active IDs
      const activeStoryId = localStorage.getItem('active_story_id');
      const activeNarrativeId = localStorage.getItem('active_narrative_id');
      await SettingsService.saveActiveIds(activeStoryId, activeNarrativeId);
    } catch (e) {
      console.warn('[Sync] Failed to push to server:', e);
    }
  },

  /**
   * Hook into StateManager to sync after saves
   */
  hookStateManager() {
    // Wait for StateManager to be defined
    const checkAndHook = () => {
      if (typeof window.StateManager !== 'undefined') {
        const originalSaveGlobalSettings = window.StateManager.saveGlobalSettings.bind(window.StateManager);
        window.StateManager.saveGlobalSettings = function() {
          originalSaveGlobalSettings();
          // Sync to server in background
          SyncService.pushToServer().catch(e => console.warn('[Sync] Background push failed:', e));
        };

        const originalSaveLibrary = window.StateManager.saveLibrary.bind(window.StateManager);
        window.StateManager.saveLibrary = function() {
          originalSaveLibrary();
          // Sync active IDs to server in background
          const activeStoryId = localStorage.getItem('active_story_id');
          const activeNarrativeId = localStorage.getItem('active_narrative_id');
          SettingsService.saveActiveIds(activeStoryId, activeNarrativeId)
            .catch(e => console.warn('[Sync] Active IDs sync failed:', e));
        };

        console.log('[Sync] Hooked into StateManager');
      } else {
        setTimeout(checkAndHook, 100);
      }
    };
    checkAndHook();
  }
};

// Export for global access (to match existing code pattern)
if (typeof window !== 'undefined') {
  window.DBService = DBService;
  window.APIService = APIService;
  window.ImageGenerationService = ImageGenerationService;
  window.SettingsService = SettingsService;
  window.SyncService = SyncService;

  // Auto-sync on load and hook StateManager
  SyncService.pullFromServer().then(() => {
    SyncService.hookStateManager();
  });
}
