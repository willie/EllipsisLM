        const StateManager = {
            data: {
                library: { active_story_id: null, active_narrative_id: null, stories: [], tag_cache: [] },
                globalSettings: {},
                activeNarrativeState: {},
            },

            CONSTANTS: {
                GLOBAL_SETTINGS_KEY: 'aiStorytellerGlobalSettings',
                ACTIVE_STORY_ID_KEY: 'active_story_id',
                ACTIVE_NARRATIVE_ID_KEY: 'active_narrative_id',
            },

            /**
             * Loads global settings from localStorage.
             */
            loadGlobalSettings() {
                let parsedSettings = {};
                const defaults = UTILITY.getDefaultApiSettings();
                try {
                    const savedSettingsJSON = localStorage.getItem(this.CONSTANTS.GLOBAL_SETTINGS_KEY);
                    if (savedSettingsJSON) parsedSettings = JSON.parse(savedSettingsJSON);
                } catch (error) { parsedSettings = {}; }
                this.data.globalSettings = { ...defaults, ...parsedSettings };
            },

            /**
             * Saves global settings to localStorage.
             */
            saveGlobalSettings() {
                localStorage.setItem(this.CONSTANTS.GLOBAL_SETTINGS_KEY, JSON.stringify(this.data.globalSettings));
            },

            /**
             * Returns the active narrative state.
             * @returns {Object}
             */
            getState() { return this.data.activeNarrativeState; },
            /**
             * Returns the library data.
             * @returns {Object}
             */
            getLibrary() { return this.data.library; },

            /**
             * Loads the library and hydrates the active narrative state.
             * @returns {Promise<void>}
             */
            async loadLibrary() {
                this.loadGlobalSettings();
                try {
                    const { storyStubs, activeStory, activeNarrative } = await StoryService.loadApplicationData();
                    this.data.library.stories = storyStubs || [];
                    this.data.library.active_story_id = activeStory ? activeStory.id : null;
                    this.data.library.active_narrative_id = activeNarrative ? activeNarrative.id : null;

                    if (activeStory && activeNarrative) {
                        const idList = activeNarrative.active_character_ids;
                        const activeIDs = (idList === null || idList === undefined)
                            ? new Set((activeStory.characters || []).map(c => c.id))
                            : new Set(idList);

                        const hydratedCharacters = (activeStory.characters || []).map(char => ({
                            ...char,
                            is_active: char.is_user || activeIDs.has(char.id)
                        }));
                        this.data.activeNarrativeState = {
                            ...activeStory,
                            ...this.data.globalSettings,
                            ...activeNarrative.state,
                            characters: hydratedCharacters,
                            narrativeId: activeNarrative.id,
                            narrativeName: activeNarrative.name
                        };

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
                    this.data.library = { stories: [], tag_cache: [] };
                    this.data.activeNarrativeState = {};
                }
                this.updateTagCache();
            },

            /**
             * Persists the current active story and narrative IDs to localStorage.
             */
            saveLibrary() {
                try {
                    // Persistence: Only save if we have valid IDs, otherwise remove the keys to prevent stale state
                    if (this.data.library.active_story_id) {
                        localStorage.setItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY, this.data.library.active_story_id);
                    } else {
                        localStorage.removeItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY);
                    }

                    if (this.data.library.active_narrative_id) {
                        localStorage.setItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY, this.data.library.active_narrative_id);
                    } else {
                        localStorage.removeItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY);
                    }
                } catch (e) {
                    console.warn("LocalStorage save failed:", e);
                }
            },

            /**
             * Updates localStorage with the currently active story and narrative IDs.
             */
            loadActiveNarrative() {
                const { active_story_id, active_narrative_id } = this.data.library;
                if (!active_story_id || !active_narrative_id) {
                    this.data.activeNarrativeState = {};
                    return;
                }
                localStorage.setItem(this.CONSTANTS.ACTIVE_STORY_ID_KEY, active_story_id);
                localStorage.setItem(this.CONSTANTS.ACTIVE_NARRATIVE_ID_KEY, active_narrative_id);
            },

            /**
             * Saves the full application state to the database.
             * @returns {Promise<void>}
             */
            async saveState() {
                // Destructure active_narrative_id to identify the correct stub to update.
                const { active_story_id, active_narrative_id, stories } = this.data.library;
                const currentState = this.data.activeNarrativeState;

                if (!active_story_id || !currentState) return;

                try {
                    const storyInLibrary = stories.find(s => s.id === active_story_id);
                    const storyStubs = (storyInLibrary || {}).narratives || [];

                    // Find the specific narrative stub and update its timestamp.
                    if (active_narrative_id) {
                        const currentStub = storyStubs.find(n => n.id === active_narrative_id);
                        if (currentStub) {
                            currentStub.last_modified = new Date().toISOString();
                        }
                    }

                    // Now save the story (with the updated narrative list) and the narrative itself
                    await StoryService.saveActiveState(currentState, storyStubs);

                    if (storyInLibrary) {
                        storyInLibrary.last_modified = new Date().toISOString();
                    }
                } catch (e) { console.error("Failed to save state:", e); }
            },

            /**
             * Updates the cache of all unique tags used in the library.
             */
            updateTagCache() {
                const allTags = new Set();
                this.data.library.stories.forEach(story => {
                    if (story.tags) story.tags.forEach(tag => allTags.add(tag.toLowerCase()));
                    if (story.characters) {
                        story.characters.forEach(char => {
                            if (char.tags) char.tags.forEach(tag => allTags.add(tag.toLowerCase()));
                        });
                    }
                });
                this.data.library.tag_cache = Array.from(allTags).sort();
            },
        };

        const ReactiveStore = {
            state: null,
            _target: null,
            _listeners: new Map(),
            _proxyCache: new WeakMap(),
            _saveTimeout: null,
            _isSaving: false,
            _blockAutoSave: false, // New flag to prevent race conditions on reload

            /**
             * Initializes the reactive store with the given initial state.
             * Sets up auto-save triggers on visibility change and page unload.
             * @param {Object} initialState - The initial state object.
             */
            init(initialState) {
                this._target = initialState;
                this._listeners.clear();
                this._proxyCache = new WeakMap();
                this.state = this._createProxy(initialState);

                const saveNow = () => {
                    // Check if auto-save is blocked (e.g., during critical DB migrations or reloads)
                    if (this._blockAutoSave) return;

                    // If we are closing, trigger an immediate save without debounce
                    this.forceSave();
                };

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') saveNow();
                });
                window.addEventListener('pagehide', saveNow);
                window.addEventListener('beforeunload', saveNow);

                console.log("ReactiveStore: Initialized with Safety Nets.");
            },

            // New method to explicitly stop the auto-save mechanism
            blockAutoSave() {
                this._blockAutoSave = true;
                if (this._saveTimeout) {
                    clearTimeout(this._saveTimeout);
                    this._saveTimeout = null;
                }
            },

            /**
             * Subscribes a callback to changes in a specific state property.
             * @param {string} key - The state property key to observe.
             * @param {Function} callback - The callback function to execute on change.
             */
            subscribe(key, callback) {
                if (!this._listeners.has(key)) {
                    this._listeners.set(key, new Set());
                }
                this._listeners.get(key).add(callback);
            },

            /**
             * Creates a recursive proxy for the given target object.
             * @param {Object} target - The target object to proxy.
             * @param {string|null} [rootKey=null] - The root key for nested properties.
             * @returns {Proxy} - The reactive proxy.
             * @private
             */
            _createProxy(target, rootKey = null) {
                if (typeof target !== 'object' || target === null) return target;
                if (this._proxyCache.has(target)) return this._proxyCache.get(target);

                const handler = {
                    get: (obj, prop) => {
                        const value = obj[prop];
                        const nextRootKey = rootKey || (typeof prop === 'string' ? prop : null);
                        if (typeof value === 'object' && value !== null) {
                            return this._createProxy(value, nextRootKey);
                        }
                        return value;
                    },
                    set: (obj, prop, value) => {
                        if (obj[prop] === value) return true;
                        obj[prop] = value;
                        const notificationKey = rootKey || prop;
                        this._notify(notificationKey);
                        this._scheduleSave();
                        return true;
                    },
                    deleteProperty: (obj, prop) => {
                        delete obj[prop];
                        const notificationKey = rootKey || prop;
                        this._notify(notificationKey);
                        this._scheduleSave();
                        return true;
                    }
                };

                const proxy = new Proxy(target, handler);
                this._proxyCache.set(target, proxy);
                return proxy;
            },

            /**
             * Notifies listeners of a change in a state property.
             * @param {string} key - The key of the changed property.
             * @private
             */
            _notify(key) {
                if (this._listeners.has(key)) {
                    this._listeners.get(key).forEach(cb => cb(this.state[key]));
                }
            },

            /**
             * Pauses the auto-save mechanism (e.g., during streaming).
             */
            pauseSaving() {
                this._isSavingPaused = true;
                if (this._saveTimeout) {
                    clearTimeout(this._saveTimeout);
                    this._saveTimeout = null;
                }
            },

            /**
             * Resumes the auto-save mechanism and triggers an immediate save.
             */
            resumeSaving() {
                this._isSavingPaused = false;
                // Trigger one final save to catch up
                this.forceSave();
            },

            /**
             * Schedules a debounced save operation.
             * @private
             */
            _scheduleSave() {
                // If paused (streaming), DO NOT schedule a DB write
                if (this._isSavingPaused) return;
                if (this._blockAutoSave) return; // Respect block

                if (this._saveTimeout) clearTimeout(this._saveTimeout);
                this._saveTimeout = setTimeout(() => {
                    this.forceSave();
                }, 2000);
            },

            /**
             * Forces an immediate save of the current state to the database.
             * Resets any pending save timers.
             * @returns {Promise<void>}
             */
            async forceSave() {
                if (this._saveTimeout) {
                    clearTimeout(this._saveTimeout);
                    this._saveTimeout = null;
                }

                if (this._isSaving) return;
                // Even forceSave should respect the explicit block during critical transitions
                if (this._blockAutoSave) return;

                this._isSaving = true;

                try {
                    await StateManager.saveState();
                    console.log("ReactiveStore: State saved successfully.");
                } catch (err) {
                    console.error("ReactiveStore: Save failed", err);
                } finally {
                    this._isSaving = false;
                }
            },

            // Legacy compatibility
            persist() {
                this.forceSave();
            }
        };