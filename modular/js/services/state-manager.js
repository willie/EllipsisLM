/**
 * StateManager Module
 * This module is the single source of truth for all application data.
 * It handles loading from and saving to localStorage, and provides controlled access
 * to the library and the active narrative state. All data mutations should happen
 * through this manager's methods to ensure consistency.
 */
const StateManager = {
    // Private data store. Should not be accessed directly from outside this module.
    data: {
        library: {
            active_story_id: null,
            active_narrative_id: null,
            stories: [],
            tag_cache: []
        },
        globalSettings: {},
        // This holds the state of the *currently active* narrative.
        // It's a combination of story-level settings and narrative-specific data.
        activeNarrativeState: {},
    },

    CONSTANTS: {
        GLOBAL_SETTINGS_KEY: 'aiStorytellerGlobalSettings',
        ACTIVE_STORY_ID_KEY: 'active_story_id',
        ACTIVE_NARRATIVE_ID_KEY: 'active_narrative_id',
    },

    /**
     * Loads the global app settings (like API keys) from localStorage.
     */
    loadGlobalSettings() {
        let parsedSettings = {};
        const defaults = UTILITY.getDefaultApiSettings();
        try {
            const savedSettingsJSON = localStorage.getItem(this.CONSTANTS.GLOBAL_SETTINGS_KEY);
            if (savedSettingsJSON) {
                parsedSettings = JSON.parse(savedSettingsJSON);
            }
        } catch (error) {
            console.error("Failed to parse global settings, using defaults.", error);
            parsedSettings = {};
        }

        // Merge defaults to ensure all keys exist
        this.data.globalSettings = { ...defaults, ...parsedSettings };
    },

    /**
     * Persists the global app settings to localStorage.
     */
    saveGlobalSettings() {
        localStorage.setItem(this.CONSTANTS.GLOBAL_SETTINGS_KEY, JSON.stringify(this.data.globalSettings));
    },

    // --- Public Getters ---
    // Provide read-only access to the state from other parts of the application.

    /** @returns {object} The active narrative state object. */
    getState() {
        return this.data.activeNarrativeState;
    },

    /** @returns {object} The entire story library object. */
    getLibrary() {
        return this.data.library;
    },

    // --- State Initialization and Persistence ---

    /**
     * Loads the entire story library from localStorage into the state manager.
     * Performs data migration for older story formats to ensure compatibility.
     * This is the first step in the application's data lifecycle.
     */
    async loadLibrary() {
        // 1. Load non-story global settings (e.g., API keys)
        this.loadGlobalSettings();

        try {
            // 2. Call the StoryService to get all data
            const { storyStubs, activeStory, activeNarrative } = await StoryService.loadApplicationData();

            // 3. Populate the in-memory library with story stubs
            this.data.library.stories = storyStubs || [];
            this.data.library.active_story_id = activeStory ? activeStory.id : null;
            this.data.library.active_narrative_id = activeNarrative ? activeNarrative.id : null;

            // 4. Populate the activeNarrativeState if data was returned
            if (activeStory && activeNarrative) {
                // hydrate Character Active State

                // 1. Get the list of active IDs.
                // If the list is undefined/null (old narrative), we'll use a fallback.
                const idList = activeNarrative.active_character_ids;

                // 2. Create the Set of active IDs.
                // IF idList is null/undefined (old narrative): default to ALL characters in the story being active.
                // ELSE (new narrative): use the specific list from the narrative.
                const activeIDs = (idList === null || idList === undefined)
                    ? new Set((activeStory.characters || []).map(c => c.id)) // MIGRATION FIX: Default to all active
                    : new Set(idList);                                        // STANDARD: Use saved list

                // 2. Map over story characters and set is_active flag
                const hydratedCharacters = (activeStory.characters || []).map(char => ({
                    ...char,
                    // It is active IF it's in the narrative's list
                    // Exception: The User character is ALWAYS active
                    is_active: char.is_user || activeIDs.has(char.id)
                }));

                this.data.activeNarrativeState = {
                    ...activeStory,                // Story settings
                    ...this.data.globalSettings,   // Global settings
                    ...activeNarrative.state,      // Narrative state (chat history, etc)
                    characters: hydratedCharacters,
                    narrativeId: activeNarrative.id, // Store the narrative ID
                    narrativeName: activeNarrative.name
                };

                // [MIGRATION] Keep your existing migration check
                // any loaded narrative has a valid world map.
                if (!this.data.activeNarrativeState.worldMap || !this.data.activeNarrativeState.worldMap.grid || this.data.activeNarrativeState.worldMap.grid.length === 0) {
                     this.data.activeNarrativeState.worldMap = {
                        grid: UTILITY.createDefaultMapGrid(),
                        currentLocation: { x: 4, y: 4 },
                        destination: { x: null, y: null },
                        path: []
                    };
                }
            } else {
                this.data.activeNarrativeState = {};
            }
        } catch (error) {
            console.error("Failed to load application data.", error);
            this.data.library = { stories: [], tag_cache: [] };
            this.data.activeNarrativeState = {};
        }

        // 5. Rebuild tag cache (this logic is fine, just remove save)
        this.updateTagCache();
    },

    /**
     * Persists the *active session IDs* to localStorage.
     * The full state is saved via saveState().
     */
    saveLibrary() {
        try {
            // This function now ONLY saves the active session IDs
            localStorage.setItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY, this.data.library.active_story_id);
            localStorage.setItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY, this.data.library.active_narrative_id);
        } catch (e) {
            console.error("Failed to save active session IDs to localStorage.", e);
        }
    },

    /**
     * Loads the active narrative. This is now just a helper
     * to set the active IDs and reload the page.
     */
    loadActiveNarrative() {
        // The *actual* loading happens in loadLibrary() on page init.
        // This function's job is to set the IDs and trigger that reload.
        const { active_story_id, active_narrative_id } = this.data.library;

        if (!active_story_id || !active_narrative_id) {
            this.data.activeNarrativeState = {};
            return;
        }

        // This is the only part that's still relevant
        localStorage.setItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY, active_story_id);
        localStorage.setItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY, active_narrative_id);
    },

    /**
     * Saves the `activeNarrativeState` back into IndexedDB via the StoryService.
     */
    async saveState() {
        const { active_story_id, active_narrative_id, stories } = this.data.library;
        const currentState = this.data.activeNarrativeState;

        if (!active_story_id || !active_narrative_id || !currentState) {
            console.warn("Attempted to save state without an active story/narrative.");
            return;
        }

        try {
            // Find the narrative stubs for the current story
            const storyStubs = (stories.find(s => s.id === active_story_id) || {}).narratives || [];

            // Pass the full state and the stubs to the service
            await StoryService.saveActiveState(currentState, storyStubs);

            // Update the in-memory library list's last_modified date
            const storyInLibrary = this.data.library.stories.find(s => s.id === active_story_id);
            if (storyInLibrary) {
                storyInLibrary.last_modified = new Date().toISOString();
            }

        } catch (e) {
            console.error("Failed to save state via StoryService:", e);
        }
    },

    /**
     * Scans all stories and characters to build a unique, sorted list of all tags.
     * Normalizes to lowercase to combine duplicates.
     */
    updateTagCache() {
        const allTags = new Set();
        this.data.library.stories.forEach(story => {
            if (story.tags) story.tags.forEach(tag => allTags.add(tag.toLowerCase()));
            // We can still scan characters, as they are part of the story stub
            if (story.characters) {
                story.characters.forEach(char => {
                    if (char.tags) char.tags.forEach(tag => allTags.add(tag.toLowerCase()));
                });
            }
        });
        this.data.library.tag_cache = Array.from(allTags).sort();
    },
};
