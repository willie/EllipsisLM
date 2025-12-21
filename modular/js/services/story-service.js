        const StoryService = {
            /**
             * Loads the initial application data (stories, active story/narrative).
             * @returns {Promise<{storyStubs: Array, activeStory: Object|null, activeNarrative: Object|null}>}
             */
            async loadApplicationData() {
                const storyStubs = await DBService.getAllStories();

                // Robust local storage retrieval
                let activeStoryId = localStorage.getItem('active_story_id');
                let activeNarrativeId = localStorage.getItem('active_narrative_id');

                // Clean "null" strings
                if (activeStoryId === 'null') activeStoryId = null;
                if (activeNarrativeId === 'null') activeNarrativeId = null;

                let activeStory = null;
                let activeNarrative = null;

                if (activeStoryId && activeNarrativeId) {
                    try {
                        const [story, narrative] = await Promise.all([
                            DBService.getStory(activeStoryId),
                            DBService.getNarrative(activeNarrativeId)
                        ]);

                        if (story && narrative) {
                            activeStory = story;
                            activeNarrative = narrative;
                        } else {
                            // Silent Fail-Safe: Data is missing, clear IDs but don't error out
                            console.warn("StoryService: Session data not found in DB. Resetting.");
                            localStorage.removeItem('active_story_id');
                            localStorage.removeItem('active_narrative_id');
                        }
                    } catch (e) {
                        console.error("StoryService: DB Load Error", e);
                        localStorage.removeItem('active_story_id');
                        localStorage.removeItem('active_narrative_id');
                    }
                }
                return { storyStubs, activeStory, activeNarrative };
            },

            /**
             * Saves the current active state (narrative and story) to the database.
             * @param {Object} currentState - The current state object.
             * @param {Array} narrativeStubs - The list of narrative stubs.
             * @returns {Promise<void>}
             */
            async saveActiveState(currentState, narrativeStubs) {
                if (!currentState || !currentState.id || !currentState.narrativeId) return;

                // 1. Prepare Data
                // Clone objects to break references (Sanitization)
                const rawCharacters = JSON.parse(JSON.stringify(currentState.characters || []));
                const safeChatHistory = JSON.parse(JSON.stringify(currentState.chat_history || []));
                const safeStaticEntries = JSON.parse(JSON.stringify(currentState.static_entries || []));
                const safeWorldMap = JSON.parse(JSON.stringify(currentState.worldMap || {}));
                const safeDynamicEntries = JSON.parse(JSON.stringify(currentState.dynamic_entries || []));

                // Image Sanitization
                const sanitizedCharacters = rawCharacters.map(c => {
                    let safeImage = c.image_url;
                    if (safeImage && safeImage.length > 500 && !safeImage.startsWith('http') && !safeImage.startsWith('local_')) {
                        safeImage = '';
                    }
                    c.image_url = safeImage;
                    return c;
                });

                const narrativeData = {
                    id: currentState.narrativeId,
                    name: currentState.narrativeName,
                    last_modified: new Date().toISOString(),
                    active_character_ids: sanitizedCharacters.filter(c => c.is_active).map(c => c.id),
                    state: {
                        chat_history: safeChatHistory,
                        messageCounter: currentState.messageCounter,
                        static_entries: safeStaticEntries,
                        worldMap: safeWorldMap
                    }
                };

                // 2. Perform Transactional Story Update
                const storyId = currentState.id;
                const currentNarrativeId = currentState.narrativeId;

                try {
                    // A. Save Narrative
                    await DBService.saveNarrative(narrativeData);

                    // B. Sync Story
                    const freshStory = await DBService.getStory(storyId);

                    if (freshStory) {
                        freshStory.last_modified = new Date().toISOString();

                        // Sync Structures
                        freshStory.characters = sanitizedCharacters;
                        freshStory.dynamic_entries = safeDynamicEntries;
                        if (currentState.tags) freshStory.tags = currentState.tags;
                        if (currentState.creator_notes) freshStory.creator_notes = currentState.creator_notes;

                        // Sync all relevant settings keys to ensure the story stub matches the active state.
                        const settingsKeys = [
                            // Appearance
                            'font', 'backgroundImageURL', 'bubbleOpacity', 'chatTextColor',
                            'backgroundBlur', 'textSize', 'bubbleImageSize', 'characterImageMode',

                            // Markdown Colors
                            'md_h1_color', 'md_h2_color', 'md_h3_color',
                            'md_bold_color', 'md_italic_color', 'md_quote_color',

                            // Markdown Fonts
                            'md_h1_font', 'md_h2_font', 'md_h3_font',
                            'md_bold_font', 'md_italic_font', 'md_quote_font',

                            // Core Prompts
                            'system_prompt',

                            // Event Master
                            'event_master_base_prompt', 'event_master_prompt', 'event_master_probability',

                            // Generation Prompts
                            'prompt_persona_gen', 'prompt_world_map_gen', 'prompt_location_gen',
                            'prompt_entry_gen', 'prompt_location_memory_gen', 'prompt_story_notes_gen', 'prompt_story_tags_gen'
                        ];

                        settingsKeys.forEach(key => {
                            // Only overwrite if the current state actually has a value (even if it's an empty string)
                            if (currentState[key] !== undefined) {
                                freshStory[key] = currentState[key];
                            }
                        });

                        // C. Update Stub
                        if (!freshStory.narratives) freshStory.narratives = [];
                        const stubIndex = freshStory.narratives.findIndex(n => n.id === currentNarrativeId);
                        if (stubIndex !== -1) {
                            freshStory.narratives[stubIndex].name = currentState.narrativeName;
                            freshStory.narratives[stubIndex].last_modified = narrativeData.last_modified;
                        } else {
                            freshStory.narratives.push({
                                id: narrativeData.id,
                                name: narrativeData.name,
                                last_modified: narrativeData.last_modified
                            });
                        }

                        // D. Commit
                        await DBService.saveStory(freshStory);
                        console.log("Story saved successfully with settings.");
                    }
                } catch (err) {
                    console.error("StoryService: Save Transaction Failed", err);
                }
            },

            /**
             * Creates a default story and narrative for a fresh start.
             * @returns {Promise<{newStory: Object, newNarrative: Object}>}
             */
            async createDefaultStoryAndNarrative() {
                const newStory = {
                    id: UTILITY.uuid(), name: "My First Story", last_modified: new Date().toISOString(), created_date: new Date().toISOString(),
                    ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(), ...UTILITY.getDefaultSystemPrompts(), ...UTILITY.getDefaultStorySettings(),
                    characters: [
                        { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "The main character.", model_instructions: "Write a response for {character} in a creative and descriptive style.", is_user: true, is_active: true, image_url: '', extra_portraits: [], tags: [], is_narrator: false },
                        { id: UTILITY.uuid(), name: "Narrator", description: "Describes the world.", short_description: "The storyteller.", model_instructions: "Act as a world-class storyteller.", is_user: false, is_active: true, image_url: '', extra_portraits: [], tags: [], color: { base: '#334155', bold: '#94a3b8' }, is_narrator: true }
                    ],
                    dynamic_entries: [{ id: UTILITY.uuid(), title: "Example Lorebook Entry", triggers: "example, .01%", content_fields: ["This is a sample dynamic lore entry."], current_index: 0, triggered_at_turn: null }],
                    scenarios: [{ id: UTILITY.uuid(), name: "Default Start", message: "The story begins..." }],
                    narratives: []
                };

                const defaultScenario = newStory.scenarios[0];
                const newNarrative = {
                    id: UTILITY.uuid(), name: `${defaultScenario.name} - Chat`, last_modified: new Date().toISOString(),
                    state: {
                        chat_history: [], messageCounter: 0,
                        static_entries: [{ id: UTILITY.uuid(), title: "World Overview", content: "A high-fantasy world." }],
                        worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] }
                    }
                };

                const firstSpeaker = newStory.characters.find(c => !c.is_user);
                newNarrative.state.chat_history.push({
                    character_id: firstSpeaker.id, content: defaultScenario.message, type: 'chat', emotion: 'neutral', timestamp: new Date().toISOString(),
                });
                newNarrative.state.messageCounter = 1;

                newStory.narratives.push({ id: newNarrative.id, name: newNarrative.name });

                await DBService.saveStory(newStory);
                await DBService.saveNarrative(newNarrative);

                return { newStory, newNarrative };
            },

            /**
             * Creates a new empty story.
             * @returns {Promise<Object>} - The new story object.
             */
            async createNewStory() {
                const newStory = {
                    id: UTILITY.uuid(), name: "New Story", last_modified: new Date().toISOString(), created_date: new Date().toISOString(),
                    ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(), ...UTILITY.getDefaultSystemPrompts(), ...UTILITY.getDefaultStorySettings(),
                    search_index: "new story",
                    characters: [
                        { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "The main character.", model_instructions: "Write a response for {character} in a creative and descriptive style.", is_user: true, is_active: true, image_url: '', extra_portraits: [], tags: [], is_narrator: false },
                        { id: UTILITY.uuid(), name: "Narrator", description: "Describes the world.", short_description: "The storyteller.", model_instructions: "Act as a world-class storyteller.", is_user: false, is_active: true, image_url: '', extra_portraits: [], tags: [], color: { base: '#334155', bold: '#94a3b8' }, is_narrator: true }
                    ],
                    dynamic_entries: [{ id: UTILITY.uuid(), title: "Example Lorebook Entry", triggers: "example, 100%", content_fields: ["This is a sample dynamic lore entry."], current_index: 0, triggered_at_turn: null }],
                    scenarios: [{ id: UTILITY.uuid(), name: "Default Start", message: "The story begins..." }],
                    narratives: []
                };

                await DBService.saveStory(newStory);
                return newStory;
            },

            /**
             * Deletes a story and all its associated data (narratives, images).
             * @param {string} storyId - The ID of the story to delete.
             * @returns {Promise<void>}
             */
            async deleteStory(storyId) {
                const story = await DBService.getStory(storyId);
                if (!story) return;

                const deleteNarrativePromises = (story.narratives || []).map(n_stub =>
                    DBService.deleteNarrative(n_stub.id)
                );

                const deleteImagePromises = (story.characters || []).map(c => {
                    const baseDelete = DBService.deleteImage(c.id);
                    const emotionDeletes = (c.extra_portraits || []).map(p => {
                        const emoKey = `${c.id}::emotion::${p.emotion}`;
                        return DBService.deleteImage(emoKey);
                    });
                    return Promise.all([baseDelete, ...emotionDeletes]);
                });

                await Promise.all([...deleteNarrativePromises, ...deleteImagePromises]);
                await DBService.deleteStory(storyId);
            },

            /**
             * Deletes a specific narrative from a story.
             * @param {string} storyId - The ID of the parent story.
             * @param {string} narrativeId - The ID of the narrative to delete.
             * @returns {Promise<Object>} - The updated story object.
             */
            async deleteNarrative(storyId, narrativeId) {
                const story = await DBService.getStory(storyId);
                if (!story) throw new Error("Parent story not found.");

                await DBService.deleteNarrative(narrativeId);
                story.narratives = story.narratives.filter(n => n.id !== narrativeId);
                await DBService.saveStory(story);
                return story;
            },

            /**
             * Creates a new narrative based on a scenario.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             * @returns {Promise<Object>} - The new narrative object.
             */
            async createNarrativeFromScenario(storyId, scenarioId) {
                const story = await DBService.getStory(storyId);
                if (!story) throw new Error("Story not found");

                const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                if (!scenario) throw new Error("Scenario not found");

                if (scenario.dynamic_entries) story.dynamic_entries = JSON.parse(JSON.stringify(scenario.dynamic_entries));
                if (scenario.prompts) Object.assign(story, scenario.prompts);

                const activeIDs = scenario.active_character_ids || story.characters.map(c => c.id);

                const newNarrative = {
                    id: UTILITY.uuid(),
                    name: `${scenario.name} - Chat`,
                    last_modified: new Date().toISOString(),
                    active_character_ids: activeIDs,
                    state: {
                        chat_history: [],
                        messageCounter: 0,
                        static_entries: scenario.static_entries ? JSON.parse(JSON.stringify(scenario.static_entries)) : [{ id: UTILITY.uuid(), title: "World Overview", content: "A high-fantasy world." }],
                        worldMap: scenario.worldMap ? JSON.parse(JSON.stringify(scenario.worldMap)) : { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] }
                    }
                };

                if (scenario.example_dialogue && Array.isArray(scenario.example_dialogue)) {
                    newNarrative.state.chat_history.push(...JSON.parse(JSON.stringify(scenario.example_dialogue)));
                }

                const firstMessage = scenario.message;
                if (firstMessage) {
                    const firstSpeaker = story.characters.find(c => !c.is_user && c.is_active);
                    if (firstSpeaker) {
                        newNarrative.state.chat_history.push({
                            character_id: firstSpeaker.id, content: firstMessage, type: 'chat',
                            emotion: 'neutral', timestamp: new Date().toISOString(), isNew: true
                        });
                        newNarrative.state.messageCounter = 1;
                    }
                }

                // 1. Save the Narrative
                await DBService.saveNarrative(newNarrative);

                // 2. Update the Story with the new Narrative Stub
                // Explicitly include last_modified to ensure DB consistency
                story.narratives.push({
                    id: newNarrative.id,
                    name: newNarrative.name,
                    last_modified: newNarrative.last_modified
                });

                // 3. Save the Story
                await DBService.saveStory(story);

                return newNarrative;
            },

            /**
             * Updates a specific field of a story.
             * @param {string} storyId - The ID of the story.
             * @param {string} field - The field name to update.
             * @param {*} value - The new value.
             * @returns {Promise<Object>} - The updated story object.
             */
            async updateStoryField(storyId, field, value) {
                const story = await DBService.getStory(storyId);
                if (!story) throw new Error("Story not found.");

                story[field] = value;
                story.last_modified = new Date().toISOString();
                await DBService.saveStory(story);
                return story;
            },

            /**
             * Exports the entire library as a ZIP file.
             * @returns {Promise<Blob>} - The ZIP file blob.
             */
            async exportLibraryAsZip() {
                console.log("StoryService: Starting library export...");

                // 1. Force a save of the current state before exporting
                if (typeof ReactiveStore !== 'undefined') {
                    await ReactiveStore.forceSave();
                }

                const zip = new JSZip();
                const dataFolder = zip.folder("data");
                const imageFolder = zip.folder("images");

                // 2. Export Stories
                const stories = await DBService.getAllStories();
                dataFolder.file("stories.json", JSON.stringify(stories, null, 2));

                // 3. Export Narratives
                const narratives = await DBService.getAllNarratives();
                dataFolder.file("narratives.json", JSON.stringify(narratives, null, 2));

                // 4. Export Images Iteratively (Memory Safe)
                // Capture the report from iterateStore
                const report = await DBService.iterateStore("characterImages", (key, blob) => {
                    if (blob) {
                        imageFolder.file(key, blob);
                    } else {
                        throw new Error("Blob was null in DB");
                    }
                });

                const blob = await zip.generateAsync({
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 }
                });

                return { blob, report };
            },

            /**
             * Imports a library from a ZIP file, replacing existing data.
             * @param {File} file - The ZIP file to import.
             * @returns {Promise<void>}
             */
            async importLibraryFromZip(file) {
                console.log("StoryService: Starting library import...");
                const zip = await JSZip.loadAsync(file);

                // 0. Pre-Flight Validation (Memory-Safe)
                let stories = [];
                let narratives = [];

                const storiesFile = zip.file("data/stories.json");
                if (storiesFile) {
                    try {
                        const str = await storiesFile.async("string");
                        stories = JSON.parse(str);
                    } catch (e) { throw new Error("Invalid 'stories.json' in backup file."); }
                }

                const narrativesFile = zip.file("data/narratives.json");
                if (narrativesFile) {
                    try {
                        const str = await narrativesFile.async("string");
                        narratives = JSON.parse(str);
                    } catch (e) { throw new Error("Invalid 'narratives.json' in backup file."); }
                }

                // 1. Clear existing data (Only after validation passes)
                await Promise.all([
                    DBService.clearStore("stories"),
                    DBService.clearStore("narratives"),
                    DBService.clearStore("characterImages")
                ]);

                // 2. Import Stories
                for (const story of stories) {
                    const success = await DBService.saveStory(story);
                    if (!success) throw new Error(`Failed to save story "${story.name || 'Unknown'}". Storage may be full.`);
                }

                // 3. Import Narratives
                for (const narrative of narratives) {
                    const success = await DBService.saveNarrative(narrative);
                    if (!success) throw new Error(`Failed to save narrative "${narrative.name || 'Unknown'}". Storage may be full.`);
                }

                // 4. Import Images
                const imageFolder = zip.folder("images");
                if (imageFolder) {
                    const imageFiles = [];
                    imageFolder.forEach((relativePath, file) => {
                        imageFiles.push({ key: relativePath, file: file });
                    });

                    // Process images sequentially
                    for (const img of imageFiles) {
                        const blob = await img.file.async("blob");
                        const success = await DBService.saveImage(img.key, blob);
                        if (!success) throw new Error(`Failed to save image "${img.key}". Storage Quota Exceeded?`);
                    }
                }
            },

            /**
             * Builds a context string for a story, including characters and lore.
             * @param {string} storyId - The ID of the story.
             * @returns {Promise<string>} - The context string.
             */
            async buildStoryContext(storyId) {
                const story = await DBService.getStory(storyId);
                if (!story) return "No story found.";

                let context = `Story Name: ${story.name}\n`;
                context += `Creator's Note: ${story.creator_notes || 'N/A'}\n`;
                context += "Characters:\n";
                (story.characters || []).forEach(c => {
                    context += `- ${c.name}: ${c.short_description}\n`;
                });

                if (story.narratives && story.narratives.length > 0) {
                    const firstNarrative = await DBService.getNarrative(story.narratives[0].id);
                    if (firstNarrative && firstNarrative.state) {
                        context += "\nWorld Lore (Sample):\n";
                        (firstNarrative.state.static_entries || []).slice(0, 5).forEach(e => {
                            context += `- ${e.title}: ${e.content.substring(0, 100)}...\n`;
                        });
                    }
                }

                if (story.dynamic_entries && story.dynamic_entries.length > 0) {
                    context += "\nDynamic Lore (Sample):\n";
                    story.dynamic_entries.slice(0, 5).forEach(e => {
                        context += `- ${e.title} (Triggers: ${e.triggers})\n`;
                    });
                }
                return context;
            },
        };