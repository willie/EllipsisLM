/**
 * StoryService Module (The Data Abstraction Layer)
 * This module is the single source of truth for all complex data orchestration.
 * The Controller calls this service, and this service calls DBService.
 * This keeps all database logic in one place and out of the Controller.
 */
const StoryService = {

    /**
     * Loads the full data needed to start the application.
     * Fetches all story stubs for the library AND the full data for the active session.
     * @returns {Promise<object>} An object containing { storyStubs, activeStory, activeNarrative }
     */
    async loadApplicationData() {
        console.log("StoryService: Loading application data...");
        // 1. Get the list of story stubs for the library view
        const storyStubs = await DBService.getAllStories();

        // 2. Get the active session IDs from localStorage
        const activeStoryId = localStorage.getItem('active_story_id');
        const activeNarrativeId = localStorage.getItem('active_narrative_id');

        let activeStory = null;
        let activeNarrative = null;

        // 3. If there is an active session, fetch the FULL data for it
        if (activeStoryId && activeNarrativeId) {
            console.log(`StoryService: Found active session. Story: ${activeStoryId}, Narrative: ${activeNarrativeId}`);
            // We get these in parallel for speed
            const storyPromise = DBService.getStory(activeStoryId);
            const narrativePromise = DBService.getNarrative(activeNarrativeId);

            const [story, narrative] = await Promise.all([storyPromise, narrativePromise]);

            if (story && narrative) {
                activeStory = story;
                activeNarrative = narrative;
            } else {
                // Data mismatch (e.g., story exists but narrative was deleted)
                // Clear the bad IDs to prevent a broken state
                console.warn("StoryService: Active session data mismatch. Clearing active IDs.");
                localStorage.removeItem('active_story_id');
                localStorage.removeItem('active_narrative_id');
            }
        } else {
            console.log("StoryService: No active session found.");
        }

        return { storyStubs, activeStory, activeNarrative };
    },

    /**
     * Saves the entire active state by splitting it into Story (Metadata + Characters)
     * and Narrative (Chat + Active Status).
     */
    async saveActiveState(currentState, narrativeStubs) {
        if (!currentState || !currentState.id || !currentState.narrativeId) {
            console.warn("StoryService: saveActiveState skipped (invalid state).");
            return;
        }

        // 1. Extract Active Character IDs for the Narrative
        // The narrative only cares *who* is here, not *what* they look like.
        const activeCharacterIds = (currentState.characters || [])
            .filter(c => c.is_active)
            .map(c => c.id);

        // 2. Create the 'story' object
        // This holds the MASTER LIST of character definitions.
        const storyData = {
            id: currentState.id,
            name: currentState.name,
            last_modified: new Date().toISOString(),
            created_date: currentState.created_date,
            creator_notes: currentState.creator_notes,
            tags: currentState.tags,
            // UI settings & Prompts
            font: currentState.font,
            backgroundImageURL: currentState.backgroundImageURL,
            bubbleOpacity: currentState.bubbleOpacity,
            chatTextColor: currentState.chatTextColor,
            characterImageMode: currentState.characterImageMode,
            backgroundBlur: currentState.backgroundBlur,
            textSize: currentState.textSize,
            bubbleImageSize: currentState.bubbleImageSize,
            system_prompt: currentState.system_prompt,
            event_master_base_prompt: currentState.event_master_base_prompt,
            event_master_prompt: currentState.event_master_prompt,
            prompt_persona_gen: currentState.prompt_persona_gen,
            prompt_world_map_gen: currentState.prompt_world_map_gen,
            prompt_location_gen: currentState.prompt_location_gen,
            prompt_entry_gen: currentState.prompt_entry_gen,
            prompt_location_memory_gen: currentState.prompt_location_memory_gen,
            // Data
            characters: currentState.characters, // Save full definitions here
            dynamic_entries: currentState.dynamic_entries,
            scenarios: currentState.scenarios,
            narratives: narrativeStubs || []
        };

        // 3. Create the 'narrative' object
        const narrativeData = {
            id: currentState.narrativeId,
            name: currentState.narrativeName,
            last_modified: new Date().toISOString(),
            // Store the list of IDs that are active in this specific narrative
            active_character_ids: activeCharacterIds,
            state: {
                chat_history: currentState.chat_history,
                messageCounter: currentState.messageCounter,
                static_entries: currentState.static_entries,
                worldMap: currentState.worldMap
            }
        };

        // 4. Save both
        await Promise.all([
            DBService.saveStory(storyData),
            DBService.saveNarrative(narrativeData)
        ]);
    },

    /**
     * Creates the very first story and narrative for a new user.
     * @returns {Promise<object>} { newStory, newNarrative }
     */
    async createDefaultStoryAndNarrative() {
        // 1. Create the Story object (metadata)
        const newStory = {
            id: UTILITY.uuid(), name: "My First Story", last_modified: new Date().toISOString(), created_date: new Date().toISOString(),
            ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(), ...UTILITY.getDefaultSystemPrompts(), ...UTILITY.getDefaultStorySettings(),
            characters: [
                { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "The main character.", model_instructions: "Write a response for {character} in a creative and descriptive style.", is_user: true, is_active: true, image_url: '', extra_portraits: [], tags:[], is_narrator: false },
                { id: UTILITY.uuid(), name: "Narrator", description: "Describes the world.", short_description: "The storyteller.", model_instructions: "Act as a world-class storyteller.", is_user: false, is_active: true, image_url: '', extra_portraits: [], tags:[], color: { base: '#334155', bold: '#94a3b8' }, is_narrator: true }
            ],
            dynamic_entries: [{id: UTILITY.uuid(), title: "Example Lorebook Entry", triggers: "example, .01%", content_fields: ["This is a sample dynamic lore entry."], current_index: 0, triggered_at_turn: null }],
            scenarios: [{ id: UTILITY.uuid(), name: "Default Start", message: "The story begins..." }],
            narratives: [] // This will be populated with a stub
        };

        // 2. Create the Narrative object (heavy data)
        const defaultScenario = newStory.scenarios[0];
        const newNarrative = {
            id: UTILITY.uuid(), name: `${defaultScenario.name} - Chat`, last_modified: new Date().toISOString(),
            state: {
                chat_history: [], messageCounter: 0,
                static_entries: [{ id: UTILITY.uuid(), title: "World Overview", content: "A high-fantasy world." }],
                worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] }
            }
        };

        // 3. Add first message to narrative
        const firstSpeaker = newStory.characters.find(c => !c.is_user);
        newNarrative.state.chat_history.push({
            character_id: firstSpeaker.id, content: defaultScenario.message, type: 'chat', emotion: 'neutral', timestamp: new Date().toISOString(),
        });
        newNarrative.state.messageCounter = 1;

        // 4. Add the narrative stub to the story's list
        newStory.narratives.push({ id: newNarrative.id, name: newNarrative.name });

        // 5. Save both to IndexedDB
        await DBService.saveStory(newStory);
        await DBService.saveNarrative(newNarrative);

        // 6. Return the new objects
        return { newStory, newNarrative };
    },

    /**
     * Creates a new, blank story and saves it to the database.
     * @returns {Promise<object>} The new story object (stub).
     */
    async createNewStory() {
        const newStory = {
            id: UTILITY.uuid(), name: "New Story", last_modified: new Date().toISOString(), created_date: new Date().toISOString(),
            ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(), ...UTILITY.getDefaultSystemPrompts(), ...UTILITY.getDefaultStorySettings(),
            search_index: "new story",
            characters: [
                { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "The main character.", model_instructions: "Write a response for {character} in a creative and descriptive style.", is_user: true, is_active: true, image_url: '', extra_portraits: [], tags:[], is_narrator: false },
                { id: UTILITY.uuid(), name: "Narrator", description: "Describes the world.", short_description: "The storyteller.", model_instructions: "Act as a world-class storyteller.", is_user: false, is_active: true, image_url: '', extra_portraits: [], tags:[], color: { base: '#334155', bold: '#94a3b8' }, is_narrator: true }
            ],
            dynamic_entries: [{id: UTILITY.uuid(), title: "Example Lorebook Entry", triggers: "example, 100%", content_fields: ["This is a sample dynamic lore entry."], current_index: 0, triggered_at_turn: null }],
            scenarios: [{ id: UTILITY.uuid(), name: "Default Start", message: "The story begins..." }],
            narratives: [] // No narratives created by default
        };

        await DBService.saveStory(newStory);
        return newStory;
    },

    /**
     * Deletes a story and ALL its associated data (narratives, images).
     * This is the orchestration logic.
     * @param {string} storyId - The ID of the story to delete.
     */
    async deleteStory(storyId) {
        // 1. Get the story object to find its children
        const story = await DBService.getStory(storyId);
        if (!story) return; // Story already deleted

        // 2. Delete all associated Narratives
        const deleteNarrativePromises = (story.narratives || []).map(n_stub =>
            DBService.deleteNarrative(n_stub.id)
        );

        // 3. Delete all associated Images
        const deleteImagePromises = (story.characters || []).map(c => {
            // Delete base image
            const baseDelete = DBService.deleteImage(c.id);
            // Delete all emotion images
            const emotionDeletes = (c.extra_portraits || []).map(p => {
                const emoKey = `${c.id}::emotion::${p.emotion}`;
                return DBService.deleteImage(emoKey);
            });
            return Promise.all([baseDelete, ...emotionDeletes]);
        });

        // 4. Wait for all children to be deleted
        await Promise.all([...deleteNarrativePromises, ...deleteImagePromises]);

        // 5. Delete the Story itself
        await DBService.deleteStory(storyId);
    },

    /**
     * Deletes just one narrative from the database and updates its parent story.
     * @param {string} storyId - The parent story ID.
     * @param {string} narrativeId - The narrative to delete.
     * @returns {Promise<object>} The updated story object.
     */
    async deleteNarrative(storyId, narrativeId) {
        // 1. Get the parent story
        const story = await DBService.getStory(storyId);
        if (!story) throw new Error("Parent story not found.");

        // 2. Delete the narrative itself from its store
        await DBService.deleteNarrative(narrativeId);

        // 3. Update the parent story's list of narrative stubs
        story.narratives = story.narratives.filter(n => n.id !== narrativeId);

        // 4. Save the updated story
        await DBService.saveStory(story);
        return story; // Return the updated story
    },

    /**
     * Creates a new narrative and RESTORES the Story State from a scenario snapshot.
     */
    async createNarrativeFromScenario(storyId, scenarioId) {
        // 1. Get the full story
        const story = await DBService.getStory(storyId);
        if (!story) throw new Error("Story not found");

        // 2. Find the scenario to use as a template
        const scenario = story.scenarios.find(sc => sc.id === scenarioId);
        if (!scenario) throw new Error("Scenario not found");

        // --- RESTORE STORY-LEVEL DATA ---
        // If the scenario has snapshot data, we overwrite the current Story settings
        // with the data preserved in the scenario.
        if (scenario.dynamic_entries) story.dynamic_entries = JSON.parse(JSON.stringify(scenario.dynamic_entries));
        if (scenario.prompts) Object.assign(story, scenario.prompts);

        // Determine Active IDs from Scenario
        // If the scenario has a specific list, use it. Otherwise, default to all.
        const activeIDs = scenario.active_character_ids || story.characters.map(c => c.id);

        // 3. Create the new full narrative object
        const newNarrative = {
            id: UTILITY.uuid(),
            name: `${scenario.name} - Chat`,
            last_modified: new Date().toISOString(),
            // --- Save the active IDs ---
            active_character_ids: activeIDs,
            state: {
                chat_history: [],
                messageCounter: 0,
                static_entries: scenario.static_entries ? JSON.parse(JSON.stringify(scenario.static_entries)) : [{ id: UTILITY.uuid(), title: "World Overview", content: "A high-fantasy world." }],
                worldMap: scenario.worldMap ? JSON.parse(JSON.stringify(scenario.worldMap)) : { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] }
            }
        };

        // 4. Inject Example Dialogue
        if (scenario.example_dialogue && Array.isArray(scenario.example_dialogue)) {
            newNarrative.state.chat_history.push(...JSON.parse(JSON.stringify(scenario.example_dialogue)));
        }

        // 5. Add the first visible message
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

        // 6. Save the new narrative
        await DBService.saveNarrative(newNarrative);

        // 7. Add the stub AND Save the UPDATED Story (with restored settings)
        story.narratives.push({ id: newNarrative.id, name: newNarrative.name });
        await DBService.saveStory(story);

        return newNarrative;
    },

    /**
     * Updates a single field on a story object (e.g., name, tags).
     * @param {string} storyId
     * @param {string} field - The key to update (e.g., 'name', 'creator_notes')
     * @param {*} value - The new value.
     * @returns {Promise<object>} The updated story object.
     */
    async updateStoryField(storyId, field, value) {
        // 1. Get the full story object
        const story = await DBService.getStory(storyId);
        if (!story) throw new Error("Story not found.");

        // 2. Update the field
        story[field] = value;
        story.last_modified = new Date().toISOString();

        // 3. Save the updated story back to the DB
        await DBService.saveStory(story);
        return story;
    },

    /**
     * Exports the entire library (all stories, narratives, and images)
     * from IndexedDB into a single ZIP file.
     * @returns {Promise<Blob>} A promise that resolves with the ZIP blob.
     */
    async exportLibraryAsZip() {
        console.log("StoryService: Starting library export...");
        const zip = new JSZip();

        // 1. Create folders in the zip
        const dataFolder = zip.folder("data");
        const imageFolder = zip.folder("images");

        // 2. Get all data from IndexedDB
        const stories = await DBService.getAllStories();
        const narratives = await DBService.getAllNarratives();
        const images = await DBService.getAllEntries("characterImages");

        // 3. Add JSON data to the zip
        dataFolder.file("stories.json", JSON.stringify(stories, null, 2));
        dataFolder.file("narratives.json", JSON.stringify(narratives, null, 2));

        // 4. Add all images to the zip
        if (images.length > 0) {
          images.forEach(([key, blob]) => {
            // The key (e.g., character ID) becomes the filename
            imageFolder.file(key, blob);
          });
        }

        console.log(`StoryService: Exporting ${stories.length} stories, ${narratives.length} narratives, and ${images.length} images.`);

        // 5. Generate the final ZIP blob
        return zip.generateAsync({
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: {
            level: 6 // A good balance of speed and size
          }
        });
    },

    /**
     * Imports a library from a ZIP file, completely replacing the
     * existing library in IndexedDB.
     * @param {File} file - The .zip file to import.
     * @returns {Promise<void>}
     */
    async importLibraryFromZip(file) {
        console.log("StoryService: Starting library import from ZIP...");

        // 1. Load the ZIP file
        const zip = await JSZip.loadAsync(file);

        // 2. Clear all existing data from the database
        // We run these in parallel for speed
        await Promise.all([
          DBService.clearStore("stories"),
          DBService.clearStore("narratives"),
          DBService.clearStore("characterImages")
        ]);
        console.log("StoryService: Existing database cleared.");

        // 3. Import JSON data
        // --- Import Stories ---
        const storiesFile = zip.file("data/stories.json");
        if (storiesFile) {
          const stories = JSON.parse(await storiesFile.async("string"));
          // Save each story one by one. Promise.all is fastest.
          await Promise.all(stories.map(story => DBService.saveStory(story)));
          console.log(`StoryService: Imported ${stories.length} stories.`);
        }

        // --- Import Narratives ---
        const narrativesFile = zip.file("data/narratives.json");
        if (narrativesFile) {
          const narratives = JSON.parse(await narrativesFile.async("string"));
          await Promise.all(narratives.map(narrative => DBService.saveNarrative(narrative)));
          console.log(`StoryService: Imported ${narratives.length} narratives.`);
        }

        // 4. Import Images
        const imageFolder = zip.folder("images");
        if (imageFolder) {
          const imageFiles = [];
          imageFolder.forEach((relativePath, file) => {
            // relativePath is the filename (e.g., character ID)
            imageFiles.push({ key: relativePath, file: file });
          });

          // Process them all in parallel
          await Promise.all(imageFiles.map(async (img) => {
            const blob = await img.file.async("blob");
            // The key is the filename, which is our ID
            await DBService.saveImage(img.key, blob);
          }));
          console.log(`StoryService: Imported ${imageFiles.length} images.`);
        }

        console.log("StoryService: Library import complete.");
    },

    /**
     * Builds a context string for a story, fetching data as needed.
     * This is used by AI generation functions.
     * @param {string} storyId
     * @returns {Promise<string>} The context string.
     */
    async buildStoryContext(storyId) {
        // 1. Get the full story object
        const story = await DBService.getStory(storyId);
        if (!story) return "No story found.";

        let context = `Story Name: ${story.name}\n`;
        context += `Creator's Note: ${story.creator_notes || 'N/A'}\n`;

        // 2. Add character data
        context += "Characters:\n";
        (story.characters || []).forEach(c => {
            context += `- ${c.name}: ${c.short_description}\n`;
        });

        // 3. Get sample lore from the *first narrative*
        if (story.narratives && story.narratives.length > 0) {
            // Fetch the full narrative object from its store
            const firstNarrative = await DBService.getNarrative(story.narratives[0].id);
            if (firstNarrative && firstNarrative.state) {
                context += "\nWorld Lore (Sample):\n";
                (firstNarrative.state.static_entries || []).slice(0, 5).forEach(e => {
                    context += `- ${e.title}: ${e.content.substring(0, 100)}...\n`;
                });
            }
        }

        // 4. Add dynamic lore
        if (story.dynamic_entries && story.dynamic_entries.length > 0) {
            context += "\nDynamic Lore (Sample):\n";
            story.dynamic_entries.slice(0, 5).forEach(e => {
                context += `- ${e.title} (Triggers: ${e.triggers})\n`;
            });
        }
        return context;
    },

    /**
     * Runs the silent static update agent.
     * @param {string} narrativeId - The active narrative to scan.
     * @param {Array<object>} existingStaticEntries - The current list of static entries.
     * @param {Array<object>} characters - The list of characters.
     * @returns {Promise<number>} The number of new entries added.
     */
    async runSilentStaticUpdate(narrativeId, existingStaticEntries, characters) {
        // 1. Get the full narrative data
        const narrative = await DBService.getNarrative(narrativeId);
        if (!narrative || !narrative.state) {
            console.warn("Silent update skipped: No active narrative data.");
            return 0;
        }

        // 2. Get last 20 messages (approx 10 user turns)
        const recentChat = (narrative.state.chat_history || [])
            .filter(m => m.type === 'chat')
            .slice(-20);

        if (recentChat.length < 1) {
            console.log("Silent update skipped: No recent chat.");
            return 0;
        }

        // 3. Build the transcript
        let chatTranscript = "";
        recentChat.forEach(msg => {
            const c = (characters || []).find(i => i.id === msg.character_id);
            if (c) chatTranscript += `${c.name}: ${msg.content}\n`;
        });

        // 4. Build the prompt
        const prompt = `
You are an AI Archivist. Your job is to read a chat transcript and identify NEW facts, character developments, or world-building details that are NOT already covered in the existing static knowledge.
Respond with a valid JSON object: { "new_entries": [{"title": "A concise title", "content": "A detailed paragraph summarizing the new fact."}] } or { "new_entries": [] } if nothing new was established.

EXISTING STATIC KNOWLEDGE (Do NOT repeat info from here):
${JSON.stringify(existingStaticEntries.map(e => e.title))}

CHAT TRANSCRIPT:
${chatTranscript}

Respond with JSON:
`;
        // 5. Call the AI
        const updatesJson = await APIService.callAI(prompt, true);
        const updates = JSON.parse(updatesJson);

        // 6. Process the results
        if (updates.new_entries && updates.new_entries.length > 0) {
            let addedCount = 0;
            updates.new_entries.forEach(item => {
                // Check for duplicates
                if (item.title && !existingStaticEntries.some(e => e.title.toLowerCase() === item.title.toLowerCase())) {
                    existingStaticEntries.push({ id: UTILITY.uuid(), ...item });
                    addedCount++;
                }
            });
            // The calling function (Controller) is responsible for saving the state
            return addedCount;
        }
        return 0; // No new entries
    },

};
