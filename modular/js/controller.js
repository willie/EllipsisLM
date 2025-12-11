const Controller = {
    // A single place for constants the controller uses.
    CONSTANTS: {
        CHARACTER_COLORS: [
            { base: '#334155', bold: '#94a3b8' }, // Slate (Blue-Grey)
            { base: '#1e3a8a', bold: '#60a5fa' }, // Blue
            { base: '#581c87', bold: '#f472b6' }, // Fuchsia
            { base: '#78350f', bold: '#fbbf24' }, // Amber
            { base: '#365314', bold: '#a3e635' }, // Lime
            { base: '#5b21b6', bold: '#a78bfa' }, // Violet
            { base: '#881337', bold: '#fb7185' }, // Rose
            { base: '#155e75', bold: '#22d3ee' }  // Cyan
        ]
    },

    // Holds temporary, non-persistent properties related to the controller's runtime behavior.
    RUNTIME: {
        activeKnowledgeTab: 'static',
        activeSettingsTab: 'appearance',
        activeWorldMapTab: 'move',
        selectedMapTile: null,
        pendingMove: null,
        turnOfArrival: 0,
        selectedLocalStaticEntryId: null,
        activeRequestAbortController: null, // For aborting AI generation requests
    },

    // --- Story & Narrative Management ---

    /**
     * Creates a new, blank story in the library.
     */
	async createNewStory() {
        UIManager.showLoadingSpinner('Creating new story...');
        try {
            // 1. Call the service to create and save the story in the DB
            // This function already exists in StoryService and works correctly
            const newStory = await StoryService.createNewStory();

            // 2. Add the new story (which is a stub) to the in-memory library
            const library = StateManager.getLibrary();
            library.stories.push(newStory);

            // 3. Clear active session (this was correct)
            library.active_story_id = null;
            library.active_narrative_id = null;
            StateManager.saveLibrary(); // Saves the (cleared) active IDs

            // 4. Refresh the UI and open the details for the new story
            UIManager.renderLibraryInterface();
            UIManager.openStoryDetails(newStory.id);
            
        } catch (e) {
            console.error("Failed to create new story:", e);
            alert("Error: Could not create a new story in the database.");
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

    /**
     * Creates a new narrative (chat session) from a selected scenario template.
     * @param {string} storyId - The ID of the parent story.
     * @param {string} scenarioId - The ID of the scenario to use as a template.
     */
	async createNarrativeFromScenario(storyId, scenarioId) {
        UIManager.showLoadingSpinner('Creating new narrative...');
        try {
            // 1. Call the StoryService to do all the database work
            const newNarrative = await StoryService.createNarrativeFromScenario(storyId, scenarioId);

            // 2. Update the in-memory library stub
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                // Add the new stub to the in-memory list
                storyInLibrary.narratives.push({
                    id: newNarrative.id,
                    name: newNarrative.name,
                    last_modified: newNarrative.last_modified
                });
                storyInLibrary.last_modified = new Date().toISOString(); // Reflect the change
            }
            
            // 3. Load the new narrative
            // This function just sets localStorage and reloads the page
            this.loadNarrative(storyId, newNarrative.id);

        } catch (error) {
            UIManager.hideLoadingSpinner();
            console.error("Failed to create narrative from scenario:", error);
            alert(`Error: ${error.message}`);
        }
    },

    /**
     * Loads a specific narrative, making it the active session, and reloads the application.
     * @param {string} storyId - The ID of the story containing the narrative.
     * @param {string} narrativeId - The ID of the narrative to load.
     */
    loadNarrative(storyId, narrativeId) {
        const library = StateManager.getLibrary();
        library.active_story_id = storyId;
        library.active_narrative_id = narrativeId;
        StateManager.saveLibrary();
        window.location.reload();
    },

    /**
     * Duplicates an existing narrative.
     * @param {string} storyId - The ID of the parent story.
     * @param {string} narrativeId - The ID of the narrative to duplicate.
     */
	async deleteNarrative(storyId, narrativeId) {
        const proceed = await UIManager.showConfirmationPromise('Are you sure you want to permanently delete this narrative and all its chat history?');
        if (!proceed) return;

        UIManager.showLoadingSpinner('Deleting narrative...');
        try {
            // 1. Call the service to delete from DB and update parent story
            const updatedStory = await StoryService.deleteNarrative(storyId, narrativeId);

            // 2. Update the in-memory library
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                // Replace the stub list with the new one from the service
                storyInLibrary.narratives = updatedStory.narratives;
                storyInLibrary.last_modified = updatedStory.last_modified;
            }

            // 3. Clear active ID if it was deleted
            if (library.active_narrative_id === narrativeId) {
                library.active_narrative_id = null;
                library.active_story_id = null;
                StateManager.saveLibrary(); // Saves the cleared IDs
                window.location.reload(); // Reload to "no story"
            } else {
                StateManager.saveLibrary();
                UIManager.openStoryDetails(storyId); // Refresh details view
            }
        } catch (e) {
            console.error("Failed to delete narrative:", e);
            alert(`Error: ${e.message}`);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

    async duplicateNarrative(storyId, narrativeId) {
        UIManager.showLoadingSpinner('Duplicating narrative...');
        try {
            // 1. Get the story and narrative to duplicate
            const story = await DBService.getStory(storyId);
            const narrative = await DBService.getNarrative(narrativeId);
            if (!story || !narrative) throw new Error("Story or Narrative not found in database.");

            // 2. Create the new narrative
            const newNarrative = JSON.parse(JSON.stringify(narrative));
            newNarrative.id = UTILITY.uuid();
            newNarrative.name = `${narrative.name} (Copy)`;
            newNarrative.last_modified = new Date().toISOString();
            
            // 3. Save the new narrative
            await DBService.saveNarrative(newNarrative);

            // 4. Update the parent story's stub list
            story.narratives.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });
            story.last_modified = new Date().toISOString();
            await DBService.saveStory(story);

            // 5. Update the in-memory library stub
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                storyInLibrary.narratives = story.narratives; // Use the updated stub list
                storyInLibrary.last_modified = story.last_modified;
            }
            
            UIManager.openStoryDetails(storyId); // Refresh details
        } catch (e) {
            console.error("Failed to duplicate narrative:", e);
            alert(`Error: ${e.message}`);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

	async deleteScenario(storyId, scenarioId) {
        const story = await DBService.getStory(storyId); // Get full story
        if (!story) return;

        if (story.scenarios.length <= 1) {
            alert("You cannot delete the last scenario.");
            return;
        }

        const proceed = await UIManager.showConfirmationPromise('Are you sure you want to delete this scenario?');
        if (!proceed) return;

        try {
            story.scenarios = story.scenarios.filter(sc => sc.id !== scenarioId);
            story.last_modified = new Date().toISOString();
            await DBService.saveStory(story); // Save updated story

            // Update in-memory stub
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                storyInLibrary.scenarios = story.scenarios;
                storyInLibrary.last_modified = story.last_modified;
            }
            
            UIManager.openStoryDetails(storyId); // Refresh UI
        } catch (e) {
            console.error("Failed to delete scenario:", e);
            alert(`Error: ${e.message}`);
        }
    },

    async duplicateScenario(storyId, scenarioId) {
        UIManager.showLoadingSpinner('Duplicating scenario...');
        try {
            const story = await DBService.getStory(storyId); // Get full story
            const scenario = story.scenarios.find(sc => sc.id === scenarioId);
            if (!story || !scenario) throw new Error("Story or Scenario not found.");
            
            const newScenario = JSON.parse(JSON.stringify(scenario));
            newScenario.id = UTILITY.uuid();
            newScenario.name = `${scenario.name} (Copy)`;
            story.scenarios.push(newScenario);
            story.last_modified = new Date().toISOString();
            
            await DBService.saveStory(story); // Save updated story

            // Update in-memory stub
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                storyInLibrary.scenarios = story.scenarios;
                storyInLibrary.last_modified = story.last_modified;
            }
            
            UIManager.openStoryDetails(storyId); // Refresh UI
        } catch (e) {
            console.error("Failed to duplicate scenario:", e);
            alert(`Error: ${e.message}`);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

	async deleteStory(storyId) {
        const proceed = await UIManager.showConfirmationPromise('Are you sure you want to permanently delete this entire story, including all its narratives and scenarios?');
        if (!proceed) return;

        UIManager.showLoadingSpinner('Deleting story...');
        try {
            // 1. Call the service to delete everything from DB
            await StoryService.deleteStory(storyId);

            // 2. Update the in-memory library
            const library = StateManager.getLibrary();
            library.stories = library.stories.filter(s => s.id !== storyId);
            StateManager.updateTagCache();

            // 3. Handle active session
            if (library.active_story_id === storyId) {
                library.active_story_id = null;
                library.active_narrative_id = null;
                StateManager.saveLibrary(); // Save cleared IDs
                window.location.reload();
            } else {
                StateManager.saveLibrary();
                UIManager.renderLibraryInterface(); // Refresh library list
            }
        } catch (e) {
            console.error("Failed to delete story:", e);
            alert(`Error: ${e.message}`);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

    async renameStoryPrompt(storyId) {
        const library = StateManager.getLibrary();
        const story = library.stories.find(s => s.id === storyId);
        if (story) {
            const currentName = story.name || '';
            const newName = prompt("Enter new name for the story:", currentName);
            if (newName && newName.trim() !== '' && newName.trim() !== currentName) {
                UIManager.showLoadingSpinner('Renaming...');
                try {
                    // 1. Call service to update DB
                    const updatedStory = await StoryService.updateStoryField(storyId, 'name', newName.trim());

                    // 2. Update in-memory stub
                    story.name = updatedStory.name;
                    story.last_modified = updatedStory.last_modified;
                    this.updateSearchIndex(story); // Update search index
                    
                    // 3. Refresh UI
                    UIManager.renderLibraryInterface(); // Refresh list
                    UIManager.openStoryDetails(storyId); // Refresh details

                    // 4. Update active state if it's the current story
                    if (library.active_story_id === storyId) {
                         const activeState = StateManager.getState();
                         if (activeState) activeState.name = updatedStory.name;
                         // Update UI title bars
                         document.getElementById('story-title-input').value = updatedStory.name;
                         document.getElementById('mobile-story-title-overlay').value = updatedStory.name;
                    }

                } catch (e) {
                    console.error("Failed to rename story:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            }
        }
    },

    async duplicateStory(storyId) {
        UIManager.showLoadingSpinner('Duplicating story...');
        try {
            // 1. Get all data for the original story
            const originalStory = await DBService.getStory(storyId);
            if (!originalStory) throw new Error("Original story not found in database.");

            const originalNarrativeStubs = originalStory.narratives || [];
            const originalNarratives = await Promise.all(
                originalNarrativeStubs.map(stub => DBService.getNarrative(stub.id))
            );
            
            // 2. Create new story object with new IDs
            const newStory = JSON.parse(JSON.stringify(originalStory));
            newStory.id = UTILITY.uuid();
            newStory.name = `${originalStory.name || 'Untitled Story'} (Copy)`;
            newStory.last_modified = new Date().toISOString();
            newStory.created_date = new Date().toISOString();
            
            // 3. Create new narratives with new IDs
            const newNarratives = [];
            const newNarrativeStubs = [];
            
            for (const narrative of originalNarratives) {
                if (!narrative) continue; // Skip if a narrative was missing
                const newNarrative = JSON.parse(JSON.stringify(narrative));
                newNarrative.id = UTILITY.uuid();
                // Optionally rename narratives, e.g., newNarrative.name = `${narrative.name} (Copy)`;
                newNarratives.push(newNarrative);
                newNarrativeStubs.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });
            }
            
            // 4. Update new story with new narrative stubs
            newStory.narratives = newNarrativeStubs;
            
            // 5. Create new IDs for scenarios, characters, entries
            (newStory.scenarios || []).forEach(s => s.id = UTILITY.uuid());
            (newStory.characters || []).forEach(c => c.id = UTILITY.uuid());
            (newStory.dynamic_entries || []).forEach(e => e.id = UTILITY.uuid());
            
            // 6. Save all new data to DB
            await DBService.saveStory(newStory);
            await Promise.all(newNarratives.map(n => DBService.saveNarrative(n)));

            // 7. Update in-memory library
            this.updateSearchIndex(newStory);
            const library = StateManager.getLibrary();
            library.stories.push(newStory);
            StateManager.updateTagCache();
            
            UIManager.renderLibraryInterface(); // Refresh list

        } catch (e) {
            console.error("Failed to duplicate story:", e);
            alert(`Error: ${e.message}`);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

    /**
     * Updates the searchable text index for a story.
     * @param {object} story - The story object to index.
     */
    updateSearchIndex(story) {
        if (!story) return;
        let index = [story.name];
        if (story.tags) index.push(...story.tags);
		if (story.creator_notes) index.push(story.creator_notes);
        if (story.characters) {
            story.characters.forEach(char => {
                index.push(char.name);
                index.push(char.description);
                if (char.tags) index.push(...char.tags);
            });
        }
        story.search_index = index.join(' ').toLowerCase();
    },
	
	/**
     * Exports the entire story library (stories, narratives, images) as a single ZIP file.
     * [REVISED] This now calls the StoryService to build a zip from IndexedDB.
     */
    async exportLibrary() {
        UIManager.showLoadingSpinner('Exporting entire library...');
        try {
            // 1. Call the StoryService to get the ZIP blob
            const zipBlob = await StoryService.exportLibraryAsZip();
            
            // 2. Create and download the blob
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ellipsis_library_backup_${new Date().toISOString().split('T')[0]}.zip`;
            document.body.appendChild(a); // Added for Firefox compatibility
            a.click();
            document.body.removeChild(a); // Clean up
            URL.revokeObjectURL(url);

        } catch (e) {
            console.error("Library export failed:", e);
            alert(`Library export failed: ${e.message}`);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

    /**
     * Imports and replaces the entire library from an Ellipsis Library ZIP file.
     * [REVISED] This now calls the StoryService to import from a ZIP to IndexedDB.
     * @param {Event} event - The file input change event.
     */
    async importLibrary(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Reset the file input so the same file can be loaded again
        event.target.value = '';

        try {
            // 1. Get confirmation from the user
            const proceed = await UIManager.showConfirmationPromise('WARNING: This will permanently replace your entire story library with the contents of the ZIP file. This action cannot be undone. Are you sure?');
            
            if (proceed) {
                UIManager.showLoadingSpinner('Importing library... Do not close this tab.');
                
                // 2. Call the StoryService to handle the import
                await StoryService.importLibraryFromZip(file);
                
                // 3. Success!
                UIManager.hideLoadingSpinner();
                alert("Library imported successfully! The application will now reload.");
                
                // 4. Use a short delay to allow UI to update before reload
                setTimeout(() => window.location.reload(), 500);
            }
        } catch (err) { 
            UIManager.hideLoadingSpinner();
            console.error("Error importing library:", err);
            alert(`Error importing library: ${err.message}`); 
        }
    },	

    // --- Modal & UI State Management ---

    /**
     * Handles the opening of all modals, performing necessary setup for each.
     * @param {string} modalId - The ID of the modal to open.
     * @param {*} [contextId=null] - An optional context ID (e.g., character ID, message index).
     */
    openModal(modalId, contextId = null) { 
        const library = StateManager.getLibrary();
        const state = StateManager.getState();
        
        if ((modalId === 'knowledge-modal' || modalId === 'characters-modal' || modalId === 'settings-modal' || modalId === 'example-dialogue-modal' || modalId === 'character-detail-modal' || modalId === 'world-map-modal' || modalId === 'io-hub-modal') && (!library.active_story_id && modalId !== 'io-hub-modal')) {
             alert("Please load a narrative first.");
             return;
        }

        switch(modalId) {
            case 'story-library-modal':
                UIManager.renderLibraryInterface();
                break;
            case 'io-hub-modal':
                UIManager.renderIOHubModal();
                break;
            case 'knowledge-modal':
                this.switchKnowledgeTab('static');
                break;
            case 'world-map-modal':
                this.RUNTIME.selectedMapTile = null;
                this.RUNTIME.pendingMove = null;
                this.RUNTIME.selectedLocalStaticEntryId = null;
                this.switchWorldMapTab('move');
                break;
            case 'settings-modal':
                this.prepareSettingsModal();
                this.switchSettingsTab(this.RUNTIME.activeSettingsTab || 'appearance');
                break;
            case 'example-dialogue-modal':
                UIManager.renderExampleDialogueModal();
                break;
            case 'character-detail-modal':
                UIManager.openCharacterDetailModal(contextId);
                break;
            case 'edit-response-modal':
                this.openEditModal(contextId);
                break;
        }
        ModalManager.open(modalId);
    },
    
    /** Closes a modal. */
	closeModal(modalId) { 
        ModalManager.close(modalId);
        if (modalId === 'character-detail-modal') {
            UIManager.renderCharacters();
        }

        // --- NEW CLEANUP LOGIC ---
        // When the knowledge modal is closed, we clean up any
        // empty content fields from our dynamic entries.
        if (modalId === 'knowledge-modal') {
            const state = StateManager.getState();
            if (state.dynamic_entries) {
                state.dynamic_entries.forEach(entry => {
                    if (entry.content_fields) {
                        // 1. Filter out any fields that are just empty space
                        entry.content_fields = entry.content_fields.filter(field => field.trim() !== "");
                        
                        // 2. (Edge Case) If filtering removed all fields, add one back
                        //    An entry must always have at least one field.
                        if (entry.content_fields.length === 0) {
                            entry.content_fields.push("");
                        }

                        // 3. (Edge Case) Clamp the index
                        //    If we removed fields, the index might be out of bounds.
                        //    We reset it to the last valid index.
                        if (entry.current_index >= entry.content_fields.length) {
                            entry.current_index = entry.content_fields.length - 1;
                        }
                    }
                });
                // Save the cleaned-up state
                StateManager.saveState();
            }
        }
    },

    /** Toggles the mobile navigation menu. */
    toggleMobileMenu() {
        document.getElementById('mobile-menu').classList.toggle('hidden');
    },

    /** Switches between static and dynamic tabs in the Knowledge modal. */
    switchKnowledgeTab(tabName) {
        this.RUNTIME.activeKnowledgeTab = tabName;
        UIManager.renderKnowledgeModalTabs();
    },

    /** Switches between move and world map tabs in the World Map modal. */
    switchWorldMapTab(tabName) {
        this.RUNTIME.activeWorldMapTab = tabName;
        UIManager.renderWorldMapModal();
    },

    /**
     * Switches between tabs in the Settings modal and binds necessary event listeners.
     * @param {string} tabName - The name of the tab to activate ('appearance', 'prompt', 'model').
     */
    switchSettingsTab(tabName) {
        this.RUNTIME.activeSettingsTab = tabName;
        const tabs = ['appearance', 'prompt', 'model'];
        const container = document.getElementById('settings-content-container');
        const template = document.getElementById(`settings-${tabName}-content`);
        container.innerHTML = template.innerHTML;

        tabs.forEach(tab => {
            const tabButton = document.getElementById(`settings-tab-${tab}`);
            if (tab === tabName) {
                tabButton.classList.add('border-indigo-500', 'text-white');
                tabButton.classList.remove('border-transparent', 'text-gray-400');
            } else {
                tabButton.classList.remove('border-indigo-500', 'text-white');
                tabButton.classList.add('border-transparent', 'text-gray-400');
            }
        });
        this.bindSettingsListeners();
    },

    /** Opens the settings modal directly to a specific tab. */
    openSettingsToTab(tabName) {
        this.openModal('settings-modal');
        this.switchSettingsTab(tabName);
    },

    /** Prepares the settings modal content on first open. */
    prepareSettingsModal() {
        const container = document.getElementById('settings-content-container');
        if (container.innerHTML.trim() !== '...') return; // Already populated
        
        const templates = document.getElementById('settings-templates');
        let maxHeight = 0;
        ['appearance', 'prompt', 'model'].forEach(tabName => {
            const content = templates.querySelector(`#settings-${tabName}-content`);
            if(content) {
                 document.body.appendChild(content); // Temporarily append to measure
                 maxHeight = Math.max(maxHeight, content.scrollHeight);
                 templates.appendChild(content); // Move it back
            }
        });
        container.style.minHeight = `${maxHeight}px`;
    },
	
	/** Handles the upload of a local image for the global background. */
    async handleBackgroundImageUpload(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) { // 5MB Limit
            alert("Error: Image file size should not exceed 5MB.");
            event.target.value = '';
            return;
        }

        UIManager.showLoadingSpinner?.('Processing background image...');
        let savedSuccessfully = false; // Flag to track DB save success

        try {
            const blob = await ImageProcessor.processImageAsBlob(file);
            const key = 'global_background_image';

            // --- MODIFICATION: Check saveImage result ---
            savedSuccessfully = await DBService.saveImage(key, blob);

            if (!savedSuccessfully) {
                 // Throw an error if saving failed to stop execution and show alert
                 throw new Error("Failed to save the image to the browser database (IndexedDB). This might happen in private browsing mode or if storage quota is exceeded.");
            }
            // --- END MODIFICATION ---

            console.log("Image saved to IndexedDB successfully."); // Log success

            // Live-cache update
            const oldUrl = UIManager.RUNTIME.globalBackgroundImageCache;
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(blob);

            // Set state to use the new local image and save
            const state = StateManager.getState();
            state.backgroundImageURL = 'local_idb_background'; // Special keyword
            console.log("Saving state with backgroundImageURL =", state.backgroundImageURL);
            StateManager.saveState();

            UIManager.applyStyling(); // Re-apply to show the new background

            // Update the hint text
            const bgHint = document.getElementById('background-image-hint');
            if (bgHint) bgHint.textContent = 'Current: [Local Image]';

        } catch (err) {
            console.error("Error processing or saving background image:", err);
            alert(`Upload failed: ${err.message}`); // Show the specific error

            // --- ROLLBACK LOGIC (No change needed here, handled by throwing error) ---
            // If save failed, the state/cache updates above won't run.
            // We should ensure the hint reflects failure.
             const bgHint = document.getElementById('background-image-hint');
             const currentState = StateManager.getState()?.backgroundImageURL;
             if (bgHint) {
                 if(currentState === 'local_idb_background'){
                     // This case shouldn't happen if error is thrown correctly, but as a safeguard:
                     bgHint.textContent = 'Current: [Save Failed]';
                 } else if (currentState) {
                      bgHint.textContent = 'Current: [Legacy URL]';
                 } else {
                     bgHint.textContent = 'Current: None';
                 }
             }

        } finally {
            UIManager.hideLoadingSpinner?.();
            // Clear the file input ONLY if the save was successful
            if (savedSuccessfully) {
                event.target.value = '';
            }
        }
    },

    /** Clears the locally stored background image. */
	async clearBackgroundImage() {
        UIManager.showLoadingSpinner?.('Clearing background...');
        try {
            await DBService.deleteImage('global_background_image');

            const oldUrl = UIManager.RUNTIME.globalBackgroundImageCache;
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            UIManager.RUNTIME.globalBackgroundImageCache = null;

            const state = StateManager.getState();
            state.backgroundImageURL = ''; // Clear the state
            StateManager.saveState();

            UIManager.applyStyling(); // Re-apply to show the default background

            // [NEW] Update the hint text
            const bgHint = document.getElementById('background-image-hint');
            if (bgHint) bgHint.textContent = 'Current: None';

        } catch (err) {
            console.error("Error clearing background image:", err);
            alert("There was an error clearing the background.");
        } finally {
            UIManager.hideLoadingSpinner?.();
        }
    },

    /** Binds all event listeners for the interactive elements within the settings modal. */
    bindSettingsListeners() {
        const state = StateManager.getState();
		const globalSettings = StateManager.data.globalSettings; // <-- GET GLOBAL SETTINGS
		
		// <-- DEFINE MODEL KEYS -->
        const modelSettingKeys = [
            'geminiApiKey', 'openRouterKey', 'openRouterModel',
            'koboldcpp_url', 'koboldcpp_template', 'koboldcpp_min_p', 'koboldcpp_dry',
            'lmstudio_url'
        ];
		
        const setListener = (id, key, callback) => { 
            const input = document.getElementById(id); 
            if (!input) return;
			
			// <-- READ FROM GLOBAL OR STATE -->
            const isGlobal = modelSettingKeys.includes(key);
            input.value = isGlobal 
                ? (globalSettings[key] !== undefined ? globalSettings[key] : '')
                : (state[key] !== undefined ? state[key] : '');
				
            const debouncedCallback = debounce(function(e) { 
                state[key] = e.target.value; 

				// <-- SAVE TO GLOBAL OR STATE -->
                if (isGlobal) {
                    globalSettings[key] = e.target.value;
                    StateManager.saveGlobalSettings();
                } else {
                    StateManager.saveState();
                }

                if(callback) callback();
            }.bind(this), 500);
            input.addEventListener('input', debouncedCallback);
        };
		
        const setupSlider = (sliderId, valueId, stateKey, callback = null) => {
            const slider = document.getElementById(sliderId);
            const valueDisplay = document.getElementById(valueId);
            if (!slider || !valueDisplay) return;
			
			// <-- READ FROM GLOBAL OR STATE -->
            const isGlobal = modelSettingKeys.includes(stateKey);
            const currentValue = isGlobal ? globalSettings[stateKey] : state[stateKey];
            slider.value = currentValue;
            valueDisplay.textContent = slider.value;
            
            slider.addEventListener('input', (e) => {
                const newValue = parseFloat(e.target.value);
                state[stateKey] = newValue; // Always update live state
                valueDisplay.textContent = e.target.value;
                
                // <-- UPDATE GLOBAL IF NEEDED -->
                if (isGlobal) {
                    globalSettings[stateKey] = newValue;
                }
                if(callback) callback();
            });
            
            // <-- SAVE TO GLOBAL OR STATE -->
            slider.addEventListener('change', () => {
                if (isGlobal) {
                    StateManager.saveGlobalSettings();
                } else {
                    StateManager.saveState();
                }
            });
        };
        
        // Model Tab
		
        if(document.getElementById('gemini-api-key-input')) setListener('gemini-api-key-input', 'geminiApiKey'); 
        if(document.getElementById('openrouter-api-key-input')) setListener('openrouter-api-key-input', 'openRouterKey'); 
        if(document.getElementById('openrouter-model-input')) setListener('openrouter-model-input', 'openRouterModel'); 
        if(document.getElementById('koboldcpp-min-p-slider')) setupSlider('koboldcpp-min-p-slider', 'koboldcpp-min-p-value', 'koboldcpp_min_p');
        if(document.getElementById('koboldcpp-dry-slider')) setupSlider('koboldcpp-dry-slider', 'koboldcpp-dry-value', 'koboldcpp_dry');
		if(document.getElementById('koboldcpp-url-input')) setListener('koboldcpp-url-input', 'koboldcpp_url');
		if(document.getElementById('lmstudio-url-input')) setListener('lmstudio-url-input', 'lmstudio_url');
		
		const bgHint = document.getElementById('background-image-hint');
        if (bgHint) {
            if (state.backgroundImageURL === 'local_idb_background') {
                bgHint.textContent = 'Current: [Local Image]';
            } else if (state.backgroundImageURL) {
                bgHint.textContent = 'Current: [Legacy URL]';
            } else {
                bgHint.textContent = 'Current: None';
            }
        }

        // Appearance Tab
		document.getElementById('background-image-upload')?.addEventListener('change', (e) => Controller.handleBackgroundImageUpload(e));
		document.getElementById('background-image-clear')?.addEventListener('click', () => Controller.clearBackgroundImage());
        if(document.getElementById('chat-text-color')) setListener('chat-text-color', 'chatTextColor', () => UIManager.applyStyling());
        if(document.getElementById('blur-slider')) setupSlider('blur-slider', 'blur-value', 'backgroundBlur', () => UIManager.applyStyling());
        if(document.getElementById('text-size-slider')) setupSlider('text-size-slider', 'text-size-value', 'textSize', () => UIManager.applyStyling());
        if(document.getElementById('bubble-image-size-slider')) setupSlider('bubble-image-size-slider', 'bubble-image-size-value', 'bubbleImageSize', () => UIManager.applyStyling());

        // Prompt Tab
        if(document.getElementById('system-prompt-input')) setListener('system-prompt-input', 'system_prompt');
        if(document.getElementById('event-master-prompt-input')) setListener('event-master-prompt-input', 'event_master_base_prompt');
        if(document.getElementById('prompt-persona-gen-input')) setListener('prompt-persona-gen-input', 'prompt_persona_gen');
        if(document.getElementById('prompt-world-map-gen-input')) setListener('prompt-world-map-gen-input', 'prompt_world_map_gen');
        if(document.getElementById('prompt-location-gen-input')) setListener('prompt-location-gen-input', 'prompt_location_gen');
        if(document.getElementById('prompt-entry-gen-input')) setListener('prompt-entry-gen-input', 'prompt_entry_gen');
        if(document.getElementById('prompt-location-memory-gen-input')) setListener('prompt-location-memory-gen-input', 'prompt_location_memory_gen');

        
        const fontSelector = document.getElementById('font-selector'); 
        if(fontSelector) {
            fontSelector.value = state.font; 
            fontSelector.addEventListener('change', (e) => this.changeFont(e.target.value));
        }

        const templateSelector = document.getElementById('koboldcpp-template-selector');
        if(templateSelector) {
            templateSelector.value = state.koboldcpp_template;
            templateSelector.addEventListener('change', (e) => {
                state.koboldcpp_template = e.target.value;
                StateManager.saveState();
            });
        }
        
        const opacitySlider = document.getElementById('bubble-opacity-slider');
        if(opacitySlider) {
            const opacityValue = document.getElementById('bubble-opacity-value');
            opacitySlider.value = state.bubbleOpacity;
            opacityValue.textContent = `${Math.round(state.bubbleOpacity * 100)}%`;
            opacitySlider.addEventListener('input', (e) => {
                state.bubbleOpacity = parseFloat(e.target.value);
                opacityValue.textContent = `${Math.round(state.bubbleOpacity * 100)}%`;
                UIManager.renderChat();
            });
            opacitySlider.addEventListener('change', () => StateManager.saveState());
        }
        
        document.querySelectorAll('input[name="imageDisplayMode"]').forEach(radio => {
            radio.checked = state.characterImageMode === radio.value;
            radio.addEventListener('change', (e) => this.setCharacterImageMode(e.target.value));
        });
        document.querySelectorAll('input[name="apiProvider"]').forEach(radio => {
            radio.checked = state.apiProvider === radio.value;
            radio.addEventListener('change', (e) => this.setApiProvider(e.target.value));
        });

        const geminiSettings = document.getElementById('gemini-settings');
        const openrouterSettings = document.getElementById('openrouter-settings');
        const koboldcppSettings = document.getElementById('koboldcpp-settings');
        const lmstudioSettings = document.getElementById('lmstudio-settings');
        if (geminiSettings) geminiSettings.style.display = state.apiProvider === 'gemini' ? 'block' : 'none';
        if (openrouterSettings) openrouterSettings.style.display = state.apiProvider === 'openrouter' ? 'block' : 'none';
        if (koboldcppSettings) koboldcppSettings.style.display = state.apiProvider === 'koboldcpp' ? 'block' : 'none';
        if (lmstudioSettings) lmstudioSettings.style.display = state.apiProvider === 'lmstudio' ? 'block' : 'none';
    },
    
    /** Changes the chat font. */
    changeFont(font) { 
        StateManager.getState().font = font; 
        UIManager.applyStyling(); 
        StateManager.saveState(); 
    },
    
    /** Sets the character image display mode. */
    setCharacterImageMode(mode) {
        StateManager.getState().characterImageMode = mode;
        StateManager.saveState();
        UIManager.renderChat();
    },

    /** Sets the active AI provider. */
	setApiProvider(provider) { 
			StateManager.getState().apiProvider = provider; // Updates live state
			StateManager.data.globalSettings.apiProvider = provider; // Updates global state
			this.bindSettingsListeners(); 
			StateManager.saveGlobalSettings(); // <-- SAVE GLOBALLY
	},
	
    // --- Chat & AI Interaction ---
    
    /** Handles the primary user action button, which can be Send, Write for Me, or Stop Generation. */
    handlePrimaryAction() { 
        if (!StateManager.getLibrary().active_story_id) { 
            UIManager.showConfirmationModal("Please load or create a story from the Story Library first.", () => this.openModal('story-library-modal')); 
            return; 
        } 
        document.getElementById('chat-input').value.trim() === '' ? this.writeForMe() : this.sendMessage(); 
    },

    /** Handles the regenerate button click, re-triggering an AI response. */
    async handleRegen() {
        const state = StateManager.getState();
        if(!StateManager.getLibrary().active_narrative_id) { alert("Load a narrative from the Story Library first."); return; }
        if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;
        
        let selectedCharId = document.getElementById('ai-character-selector').value;
        if (selectedCharId === 'any') {
            selectedCharId = this.determineNextSpeaker(false); // isMove = false
        }

        const lastMsg = state.chat_history.filter(m => m.type === 'chat').pop();
        const lastChar = lastMsg ? state.characters.find(c => c.id === lastMsg.character_id) : null;

        if (lastChar && !lastChar.is_user && lastMsg.character_id === selectedCharId) {
            this.undoLastTurn();
            await this.triggerAIResponse(selectedCharId);
        } else {
            await this.triggerAIResponse(selectedCharId);
        }
    },

    /** Sends a user message from the chat input. */
    async sendMessage() {
        // 1. Check if AI is already running
        if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;
        
        // 2. Get state and user input
        const state = StateManager.getState();
        const input = document.getElementById('chat-input');
        const userChar = state.characters.find(c => c.is_user);
		
		if (!userChar) {
            alert("No character is set as the 'User'. Please set a character to 'User' in the Characters modal to send messages.");
            return;
        }
		
        const messageContent = input.value.trim();
        if (!messageContent) return;
        
        // 3. Add user message to history
        this.addMessageToHistory(userChar.id, messageContent);
        input.value = ''; // Clear input
        
        // 4. Check for dynamic triggers
        this.checkDynamicEntryTriggers();
        
        // 5. Trigger the AI's response
        await this.triggerAIResponse(null, messageContent);
        
        // 6. Check for the Event Master
        this.checkEventMaster();

        // 7. --- THIS IS THE NEW, CORRECTLY PLACED TRIGGER ---
        // Check if the counter is a multiple of 10.
        // We get the state again in case it was modified.
        const currentState = StateManager.getState(); 
        if (currentState.messageCounter > 0 && currentState.messageCounter % 10 === 0) {
            console.log(`User turn ${currentState.messageCounter}: Triggering automatic static memory update.`);
            // We call a new, silent function to avoid popups.
            this.triggerSilentStaticUpdate(); 
        }
        // NO stray }, here
    },

    /** Triggers the AI to write a response for the user's character. */
    async writeForMe() {
        if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;
        const state = StateManager.getState();
        const userChar = state.characters.find(c => c.is_user); if (!userChar) return;
        const input = document.getElementById('chat-input');
        
        UIManager.setButtonToStopMode();
        this.RUNTIME.activeRequestAbortController = new AbortController();

        try {
            const prompt = PromptBuilder.buildPrompt(userChar.id, true);
            input.value = await APIService.callAI(prompt, false, this.RUNTIME.activeRequestAbortController.signal);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log("Write For Me generation stopped by user.");
            } else {
                console.error("Write for Me failed:", error);
            }
        } finally {
            UIManager.setButtonToSendMode();
            this.RUNTIME.activeRequestAbortController = null;
        }
    },

	/** Undoes the last message in the chat history, handling hidden lore entries. */
    undoLastTurn() { 
        if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;
        const state = StateManager.getState();
        if (state.chat_history.length === 0) return; 

        // Keep removing items from the end until we find and remove a 'chat' type message
        // This ensures we remove the AI response AND any hidden system/lore events that triggered after it
        let removedChatMessage = false;
        while (state.chat_history.length > 0 && !removedChatMessage) {
            const msg = state.chat_history.pop();
            if (msg.type === 'chat') {
                state.messageCounter--;
                removedChatMessage = true;
            }
        }

        this.saveAndRender(); 
    },

    /**
     * Adds a message to the active narrative's chat history.
     * @param {string} id - The ID of the character sending the message.
     * @param {string} content - The message content.
     * @param {string} [type='chat'] - The type of message ('chat', 'system_event', etc.).
     * @param {string} [emotion='neutral'] - The detected emotion for the message.
     */
    addMessageToHistory(id, content, type = 'chat', emotion = 'neutral') {
        const state = StateManager.getState();
        if (UIManager.RUNTIME.streamingInterval) {
            clearInterval(UIManager.RUNTIME.streamingInterval);
            UIManager.RUNTIME.streamingInterval = null;
            StateManager.saveState();
        }
        state.chat_history.push({ 
            character_id: id, content, type, emotion,
            timestamp: new Date().toISOString(), isNew: true 
        });
        if (type === 'chat') state.messageCounter++;
        UIManager.renderChat();
        StateManager.saveState();
        
        const chatWindow = document.getElementById('chat-window');
        const lastBubble = chatWindow.lastElementChild;
        if(lastBubble) {
            lastBubble.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    /**
     * Adds a system event message (e.g., "You have moved to...") to the chat history.
     * @param {string} content - The content of the system message.
     */
    addSystemMessageToHistory(content) {
        const state = StateManager.getState();
        state.chat_history.push({
            type: 'system_event', content, timestamp: new Date().toISOString(), isNew: true
        });
        UIManager.renderChat();
        StateManager.saveState();
    },

    /** Displays the speaker scores modal for debugging. */
    showSpeakerScores(scoresData) {
        UIManager.renderSpeakerScoresModal(scoresData);
    },

    /**
     * Determines which AI character should speak next based on a weighted scoring algorithm.
     * @param {boolean} [isAfterMove=false] - A flag indicating if the determination is happening after a map move.
     * @returns {string|null} The ID of the character chosen to speak next.
     */
    determineNextSpeaker(isAfterMove = false) {
        const state = StateManager.getState();
        let pool = state.characters.filter(c => !c.is_user && c.is_active);
    
        if (pool.length === 0) {
            return null;
        }
        if (pool.length === 1) {
            return pool[0].id;
        }
    
        if (isAfterMove) {
            const narrators = pool.filter(c => c.is_narrator);
            if (narrators.length > 0) {
                return narrators[Math.floor(Math.random() * narrators.length)].id;
            }
        }
    
        const chatHistory = (state.chat_history || []).filter(m => m.type === 'chat' && !m.isHidden);
        const nonUserHistory = chatHistory.filter(m => state.characters.some(c => c.id === m.character_id && !c.is_user));
    
        if (!isAfterMove && nonUserHistory.length > 0) {
            const lastAiSpeaker = state.characters.find(c => c.id === nonUserHistory[nonUserHistory.length - 1].character_id);
            if (lastAiSpeaker && lastAiSpeaker.is_narrator) {
                const potentialPool = pool.filter(c => c.id !== lastAiSpeaker.id);
                if (potentialPool.length > 0) {
                    pool = potentialPool;
                }
            }
        }
    
        if (pool.length === 1) {
            return pool[0].id;
        }
    

		const scores = {};
		pool.forEach(c => {
			scores[c.id] = c.is_narrator ? 0 : 1;
		}); 
		
		const narratorsInPool = pool.filter(c => c.is_narrator);
        if (narratorsInPool.length > 0) {
            for (let i = chatHistory.length - 1; i >= 0; i--) {
                const message = chatHistory[i];
                const speaker = state.characters.find(c => c.id === message.character_id);
                if (speaker && speaker.is_narrator) {
                    break;
                }
                narratorsInPool.forEach(narrator => {
                    scores[narrator.id] += 0.2;
                });
            }
        }
    
         if (nonUserHistory.length >= 1) {
            const lastSpeakerId = nonUserHistory[nonUserHistory.length - 1].character_id;
            const lastSpeaker = state.characters.find(c => c.id === lastSpeakerId);
            if (scores[lastSpeakerId] !== undefined && lastSpeaker && !lastSpeaker.is_narrator) {
                 scores[lastSpeakerId] += 1;
            }
        }
        if (nonUserHistory.length >= 2) {
            const secondLastSpeakerId = nonUserHistory[nonUserHistory.length - 2].character_id;
            const secondLastSpeaker = state.characters.find(c => c.id === secondLastSpeakerId);
            if (scores[secondLastSpeakerId] !== undefined && secondLastSpeaker && !secondLastSpeaker.is_narrator) {
                scores[secondLastSpeakerId] += 0.5;
            }
        }
    
        const last2Messages = chatHistory.slice(-2);
        const last4Messages = chatHistory.slice(-4);
    
        pool.forEach(char => {
            const charName = char.name.toLowerCase();
            if (last2Messages.some(msg => msg.content.toLowerCase().includes(charName))) {
                scores[char.id] += 0.5;
            }
            if (last4Messages.some(msg => msg.content.toLowerCase().includes(charName))) {
                scores[char.id] += 0.5;
            }
        });
    
        const characters = pool;
        const weights = characters.map(c => scores[c.id]);
        
        const winner = UTILITY.weightedChoice(characters, weights, this);
        return winner ? winner.id : pool[0]?.id || null;
    },

    /**
     * Constructs the prompt, calls the APIService, and handles the AI's response or any errors.
     * @param {string|null} charId - The ID of the character to respond, or null to auto-determine.
     * @param {string} [userMessage=''] - The content of the user's last message for analysis.
     * @param {boolean} [isAfterMove=false] - Flag if this is a response after a map move.
     */
    async triggerAIResponse(charId = null, userMessage = '', isAfterMove = false) {
        const state = StateManager.getState();
        const activeAiChars = state.characters.filter(c => !c.is_user && c.is_active);
        if (activeAiChars.length === 0) {
            this.addMessageToHistory(systemSpeaker.id, "No active character. Ensure at least one character is active in the chat.");
            return;
        }
		
        const isModelConfigured = () => {
            switch (state.apiProvider) {
                case 'gemini': return !!state.geminiApiKey;
                case 'openrouter': return !!state.openRouterKey && !!state.openRouterModel;
                case 'koboldcpp': return !!state.koboldcpp_url;
                case 'lmstudio': return !!state.lmstudio_url;
                default: return false;
            }
        };
        if (!isModelConfigured()) {
            this.addMessageToHistory(activeAiChars[0].id, "The AI model is not configured. Please check your settings.");
            return;
        }
        const selectedCharId = charId || document.getElementById('ai-character-selector').value;
        let aiCharId = selectedCharId === 'any' ? this.determineNextSpeaker(isAfterMove) : selectedCharId;
        if (!aiCharId) {
            console.log("AI response skipped: No eligible speaker determined.");
            return;
        }
        
        UIManager.showTypingIndicator(aiCharId);
        UIManager.setButtonToStopMode();
        this.RUNTIME.activeRequestAbortController = new AbortController();

        try {
            const prompt = PromptBuilder.buildPrompt(aiCharId);
            const responseText = await APIService.callAI(prompt, false, this.RUNTIME.activeRequestAbortController.signal);
            let analysis = { emotion: 'neutral', locationName: null };
            if (userMessage) {
                try { analysis = await this.analyzeTurn(userMessage); } 
                catch (e) { console.error("Turn analysis failed:", e); }
            }
            UIManager.hideTypingIndicator();
            UIManager.startStreamingResponse(aiCharId, responseText, analysis.emotion);
            if (analysis.locationName) {
                const targetLocation = state.worldMap.grid.find(loc => loc.name.toLowerCase() === analysis.locationName.toLowerCase());
                const currentLocationData = state.worldMap.grid.find(loc => loc.coords.x === state.worldMap.currentLocation.x && loc.coords.y === state.worldMap.currentLocation.y);
                if (targetLocation && targetLocation.name !== currentLocationData?.name) {
                    setTimeout(() => { this.moveToLocation(targetLocation.coords.x, targetLocation.coords.y); }, 1500);
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log("Generation stopped by user.");
            } else {
                this.addMessageToHistory(aiCharId, `[Error: ${error.message}]`); 
            }
            UIManager.hideTypingIndicator();
        } finally {
            UIManager.setButtonToSendMode();
            this.RUNTIME.activeRequestAbortController = null;
        }
    },
    
    // --- Agent & Trigger Logic ---

    /**
     * Invokes an AI agent to analyze the recent conversation and suggest updates to the static knowledge base.
     */
    async checkWorldInfoAgent() { 
        const state = StateManager.getState();
        if (!StateManager.getLibrary().active_narrative_id) { alert("Please load a narrative first."); return; }
        UIManager.showTypingIndicator('static-entry-agent', 'Updating static knowledge...'); 
        try { 
            let p = `As Static Knowledge Master, read chat/info, update the info. Output valid JSON: { "add": [{"title": "...", "content": "..."}], "modify": [{"title": "...", "new_content": "..."}] } or {}. INFO:${JSON.stringify(state.static_entries)}CHAT:`; 
            (state.chat_history || []).filter(m=>m.type==='chat').slice(-8).forEach(msg => { const c = state.characters.find(i=>i.id===msg.character_id); if(c) p += `${c.name}: ${msg.content}\n`;});
            const updates = JSON.parse(await APIService.callAI(p, true)); 
            if (updates.add) updates.add.forEach(item => state.static_entries.push({id: UTILITY.uuid(), ...item})); 
            if (updates.modify) updates.modify.forEach(item => { const entry = state.static_entries.find(e => e.title.toLowerCase() === item.title.toLowerCase()); if (entry) entry.content = item.new_content; }); 
            this.saveAndRenderStaticEntries(); 
        } catch (e) { 
            console.error("Static Entry Agent failed:", e); 
            alert("The AI failed to update static entries. It may have returned an invalid format.");
        } finally { 
            UIManager.hideTypingIndicator(); 
        } 
    },
    
    /**
     * Every few turns, invokes an AI agent to generate a secret, surprising event instruction for other AI characters.
     */
    async checkEventMaster() { 
        const state = StateManager.getState();
        if (state.messageCounter > 0 && state.messageCounter % 6 === 0) try { 
            let p = state.event_master_base_prompt + '\n\n--- RECENT CHAT HISTORY ---\n'; 
            (state.chat_history || []).filter(m=>m.type==='chat').slice(-12).forEach(msg => { const c = state.characters.find(i=>i.id===msg.character_id); if(c) p += `${c.name}: ${msg.content}\n`;});
            state.event_master_prompt = await APIService.callAI(p); 
            StateManager.saveState(); 
            console.log("Event Master:", state.event_master_prompt); 
        } catch (e) { 
            console.error("Event Master failed:", e); 
        } 
    },
    
	/**
     * Helper: Converts a user keyword into a RegExp with word boundaries.
     * Handles * as a wildcard.
     */
    _compileTriggerRegex(keyword) {
        // 1. Escape special regex characters (like ?, +, ., etc) to prevent errors
        // We temporarily preserve the * if it exists
        let clean = keyword.replace(/[.+^${}()|[\]\\]/g, '\\$&'); 

        // 2. Check for wildcards
        const hasStartWild = clean.startsWith('*');
        const hasEndWild = clean.endsWith('*');

        // 3. Remove the asterisks for the pattern
        clean = clean.replace(/^\*|\*$/g, '');

        // 4. Build boundaries
        // If NO start wildcard, enforce a word boundary at the start (\b)
        if (!hasStartWild) clean = '\\b' + clean;
        
        // If NO end wildcard, enforce a word boundary at the end (\b)
        if (!hasEndWild) clean = clean + '\\b';

        // 5. Return regex (i = case insensitive)
        return new RegExp(clean, 'i');
    },
	
	/**
     * Checks the last message against all dynamic entry triggers and activates any that match.
     * [UPDATED] Now supports exact matching and * wildcards.
     */
    checkDynamicEntryTriggers() {
        const state = StateManager.getState();
        // Get the last message that wasn't a lore reveal
        const lastMessage = (state.chat_history || []).filter(m => m.type !== 'lore_reveal').pop();
        if (!lastMessage) return;

        const content = lastMessage.content; // We use raw content, regex handles case insensitivity
        let stateChanged = false;

        (state.dynamic_entries || []).forEach(entry => {
            // 1. Check for triggers
            const { groups, chance } = this.parseTriggers(entry.triggers);
            
            const keywordMatch = groups.some(group => {
                // Map keywords to Regex patterns
                const patterns = group.keywords.map(kw => this._compileTriggerRegex(kw));

                switch (group.type) {
                    case 'OR': 
                        return patterns.some(regex => regex.test(content));
                    case 'AND': 
                        return patterns.every(regex => regex.test(content));
                    case 'XOR': 
                        const [f, s] = [patterns[0].test(content), patterns[1].test(content)]; 
                        return (f && !s) || (!f && s);
                    default: 
                        return false;
                }
            });

            // 2. If triggered:
            if (keywordMatch || (Math.random() * 100 < chance)) {
                
                // 3. De-duplicate: Look-behind 20 messages
                const searchWindowStart = Math.max(0, state.chat_history.length - 20);
                let foundIndex = -1;

                for (let i = state.chat_history.length - 1; i >= searchWindowStart; i--) {
                    const msg = state.chat_history[i];
                    if (msg.type === 'lore_reveal' && msg.dynamic_entry_id === entry.id) {
                        foundIndex = i;
                        break;
                    }
                }

                if (foundIndex !== -1) {
                    state.chat_history.splice(foundIndex, 1);
                    stateChanged = true;
                }

                // 4. Sequential Logic
                const contentIndex = entry.current_index || 0;
                const contentToReveal = entry.content_fields[contentIndex];

                let nextIndex = contentIndex + 1;
                if (nextIndex >= entry.content_fields.length) {
                    nextIndex = entry.content_fields.length - 1;
                }
                entry.current_index = nextIndex;
                
                // 5. Add the new entry inline
                state.chat_history.push({ 
                    type: 'lore_reveal', 
                    title: entry.title, 
                    content: contentToReveal,
                    dynamic_entry_id: entry.id,
                    timestamp: new Date().toISOString(),
                    isHidden: true
                });
                console.log(`Dynamic Entry triggered: ${entry.title}`);
                stateChanged = true;

                if (entry.triggered_at_turn !== null) {
                    entry.triggered_at_turn = null;
                }
            }
        });

        if (stateChanged) {
            StateManager.saveState();
            UIManager.renderDynamicEntries(); 
        }
    },

    /**
     * Parses the trigger string from a dynamic entry into a structured format.
     * @param {string} triggersStr - The raw trigger string (e.g., "house, cat AND dog, 25%").
     * @returns {{groups: Array, chance: number}} - A structured object of triggers.
     */
    parseTriggers(triggersStr) {
        if (!triggersStr) return { groups: [], chance: 0 };
        const parts = triggersStr.split(',').map(s => s.trim());
        const chancePart = parts.find(p => p.match(/^\d+\s*\%$/));
        const chance = chancePart ? parseInt(chancePart.replace('%', '')) : 0;
        const keywordParts = parts.filter(p => p && !p.match(/^\d+\s*\%$/));
        const groups = keywordParts.map(part => {
            if (part.includes(' XOR ')) { const keywords = part.split(' XOR ').map(k => k.trim().toLowerCase()).filter(Boolean); if (keywords.length === 2) return { type: 'XOR', keywords }; }
            if (part.includes(' AND ')) { const keywords = part.split(' AND ').map(k => k.trim().toLowerCase()).filter(Boolean); if (keywords.length > 0) return { type: 'AND', keywords }; }
            return { type: 'OR', keywords: [part.toLowerCase()] };
        });
        return { groups, chance };
    },

    // --- CRUD and Edit Functions ---

    /** Opens the modal to edit a specific chat message. */
    openEditModal(index) {
        const state = StateManager.getState();
        const message = state.chat_history[index];
        const input = document.getElementById('edit-modal-input');
        input.value = message.content;
        const autoResize = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
        if (input.autoResizeListener) input.removeEventListener('input', input.autoResizeListener);
        input.autoResizeListener = autoResize;
        input.addEventListener('input', autoResize);
        document.getElementById('edit-modal-save-button').onclick = () => this.saveEditedResponse(index);
        setTimeout(autoResize, 0);
        ModalManager.open('edit-response-modal');
    },

    /** Saves the edited content of a chat message. */
    saveEditedResponse(index) {
        const state = StateManager.getState();
        const newContent = document.getElementById('edit-modal-input').value;
        state.chat_history[index].content = newContent;
        this.saveAndRender();
        this.closeModal('edit-response-modal');
    },

    /** Uses AI to enhance a character's persona description. */
    async enhancePersonaWithAI(event, charId) {
        const state = StateManager.getState();
        const char = state.characters.find(c => c.id === charId);
        if (!char) return;

        UIManager.showConfirmationModal('This will overwrite the current persona with an AI-generated one. Are you sure?', async () => {
            const newDescription = await this._generateContentForField(event, state.prompt_persona_gen, {
                concept: char.description
            });
            
            if (newDescription !== null) {
                this.updateCharacterField(charId, 'description', newDescription);
                const personaTextarea = document.getElementById(`persona-description-${charId}`);
                if (personaTextarea) {
                    personaTextarea.value = newDescription;
                    const autoResize = () => { personaTextarea.style.height = 'auto'; personaTextarea.style.height = `${personaTextarea.scrollHeight}px`; };
                    autoResize();
                }
            }
        });
    },

    /** Uses AI to generate model instructions based on a character's persona. */
    async generateModelInstructions(event, charId) {
        UIManager.showConfirmationModal("This will overwrite the current model instructions. Are you sure?", async () => {
            const state = StateManager.getState();
            const char = state.characters.find(c => c.id === charId);
            if (!char) return;

            const staticKnowledge = (state.static_entries || []).map(e => `### ${e.title}\n${e.content}`).join('\n\n');
            const prompt = `Based on the following character persona and world information, generate a concise set of model instructions for an AI roleplaying as this character. The instructions should guide the AI on how to speak, its personality, and key traits to embody.\n\n### Character Persona:\n${char.description}\n\n### World Static Knowledge:\n${staticKnowledge}\n\n### INSTRUCTIONS:`;
            
            const newInstructions = await this._generateContentForField(event, prompt, {});
            
            if (newInstructions !== null) {
                this.updateCharacterField(charId, 'model_instructions', newInstructions);
                UIManager.openCharacterDetailModal(charId);
            }
        });
    },

    /** Helper function to manage button state and call the AI service for content generation. */
    async _generateContentForField(event, promptTemplate, context, isJson = false) {
        const button = event.target.closest('button');
        if (!button) return null;

        const originalContent = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '...';
        
        try {
            let prompt = promptTemplate;
            for (const key in context) {
                prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), context[key]);
            }
            return await APIService.callAI(prompt, isJson);
        } catch (error) {
            console.error("AI Generation failed:", error);
            alert(`AI generation failed: ${error.message}`);
            return null;
        } finally {
            button.disabled = false;
            button.innerHTML = originalContent;
        }
    },

    /** Uses AI to generate a detailed prompt for a world map location. */
    async generateLocationPromptAI(event) {
        const state = StateManager.getState();
        const location = this.RUNTIME.selectedMapTile;
        if (!location) return;

        const newContent = await this._generateContentForField(event, state.prompt_location_gen, {
            name: location.name,
            description: location.description
        });
        
        if (newContent !== null) {
            this.updateLocationDetail('prompt', newContent);
            UIManager.renderWorldMapModal();
        }
    },

    /** Uses AI to generate content for a static knowledge entry. */
    async generateStaticEntryContentAI(event, entryId) {
        const state = StateManager.getState();
        const entry = state.static_entries.find(e => e.id === entryId);
        if (!entry) return;

        const newContent = await this._generateContentForField(event, state.prompt_entry_gen, {
            title: entry.title,
            triggers: '' // No triggers for static entries
        });

        if (newContent !== null) {
            this.updateStaticEntryField(entryId, 'content', newContent);
            UIManager.renderStaticEntryDetails();
        }
    },

    /** Uses AI to analyze user input for emotion and location keywords. */
    async analyzeTurn(text) {
        const state = StateManager.getState();
        const locationNames = (state.worldMap?.grid || []).map(loc => loc.name);
        const locationList = locationNames.length > 0 ? `Valid locations are: [${locationNames.join(', ')}].` : 'No location data is available.';
        
        try {
            const prompt = `Analyze the text for sentiment and implied location. Respond with a valid JSON object like {"emotion": "...", "locationName": "..."}.
            - 'emotion' must be one of: neutral, happy, sad, angry, surprised.
            - 'locationName' must be one of the provided valid locations, or null if no specific location is mentioned or implied.
            ${locationList}
            TEXT: "${text}"`;
            
            const response = await APIService.callAI(prompt, true);
            const analysis = JSON.parse(response);

            const validEmotions = ['neutral', 'happy', 'sad', 'angry', 'surprised'];
            return {
                emotion: validEmotions.includes(analysis.emotion) ? analysis.emotion : 'neutral',
                locationName: locationNames.includes(analysis.locationName) ? analysis.locationName : null
            };
        } catch (error) {
            console.error("Sentiment/Location analysis failed:", error);
            return { emotion: 'neutral', locationName: null };
        }
    },
    
    /** Adds a new character to the roster. */
    addCharacter() { 
        const state = StateManager.getState();
        const aiCharCount = state.characters.filter(c => !c.is_user).length;
        const newColor = this.CONSTANTS.CHARACTER_COLORS[aiCharCount % this.CONSTANTS.CHARACTER_COLORS.length];
        const newChar = { 
            id: UTILITY.uuid(), name: "New Character", description: "", short_description: "A brief one-line summary.",
            model_instructions: "Act as {character}. Be descriptive and engaging.", image_url: "", extra_portraits: [], 
            tags: [], is_user: false, is_active: true, color: newColor, is_narrator: false
        };
        state.characters.push(newChar); 
        StateManager.saveState(); 
        UIManager.renderCharacters();
        this.openModal('character-detail-modal', newChar.id);
    },

    /** Deletes a character from the roster. */
	deleteCharacter(id) {
		UIManager.showConfirmationModal('Are you sure you want to delete this character?', () => {
			const state = StateManager.getState();
			state.characters = state.characters.filter(c => c.id !== id);
			this.closeModal('character-detail-modal');
			this.saveAndRender();
			
			DBService.deleteImage(id);

			// Also remove any emotion portraits for this character
			try {
				// Scan the cache keys directly since the character is already removed from the state
				Object.keys(UIManager.RUNTIME.characterImageCache || {}).forEach(k => {
					if (k.startsWith(`${id}::emotion::`)) {
						DBService.deleteImage(k).catch(() => {});
						URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[k]);
						delete UIManager.RUNTIME.characterImageCache[k];
					}
				});
			} catch (e) {
				console.warn('Could not clean emotion portraits for deleted character', e);
			}
		});
	},

    /** Updates a specific field of a character object (debounced). */
    updateCharacterField: debounce(function(id, field, value) { 
        const state = StateManager.getState();
        const char = state.characters.find(c => c.id === id); 
        if (char) { 
            char[field] = value; 
            StateManager.saveState(); 
            if (field === 'name') {
                UIManager.updateAICharacterSelector();
                const header = document.querySelector(`#character-detail-modal-content h2[data-char-id="${id}"]`);
                if(header) header.textContent = value;
            }
            if (field === 'name' || field === 'short_description' || field === 'image_url' || field === 'tags') {
                UIManager.renderCharacters();
            }
        } 
    }, 300),
	
	
	/** * Sets the role of a character: 'user', 'narrator', or 'none'.
     * Enforces single-user rule.
     */
    setCharacterRole(charId, role) {
        const state = StateManager.getState();
        
        // 1. Update the target character
        const targetChar = state.characters.find(c => c.id === charId);
        if (!targetChar) return;

        if (role === 'user') {
            targetChar.is_user = true;
            targetChar.is_narrator = false;
            
            // 2. Unset 'is_user' for ALL other characters
            state.characters.forEach(c => {
                if (c.id !== charId) c.is_user = false;
            });
        } else if (role === 'narrator') {
            targetChar.is_user = false;
            targetChar.is_narrator = true;
        } else { // 'none'
            targetChar.is_user = false;
            targetChar.is_narrator = false;
        }

        StateManager.saveState();
        
        // 3. Refresh UI to reflect changes (roster + detail modal)
        UIManager.renderCharacters();
        UIManager.openCharacterDetailModal(charId);
    },
	
	
	/**
     * Updates a specific field of a story object (debounced).
     * REFACTORED: Now calls StoryService.
     */
    updateStoryField: debounce(async function(storyId, field, value) {
        try {
            // 1. Call the service to update the DB
            const updatedStory = await StoryService.updateStoryField(storyId, field, value);

            // 2. Update the in-memory stub
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                storyInLibrary[field] = updatedStory[field];
                storyInLibrary.last_modified = updatedStory.last_modified;
            }

            // 3. Update search index if needed
            if (field === 'creator_notes') {
                this.updateSearchIndex(storyInLibrary);
            }
        } catch (e) {
            console.error(`Failed to update story field ${field}:`, e);
            alert("Error: Could not save story update.");
        }
    }, 300),

	/**
     * Updates a story's tags (debounced).
     * REFACTORED: Now calls StoryService.
     */
    updateStoryTags: debounce(async function(storyId, value) {
        const tags = value.split(',').map(t => t.trim()).filter(Boolean);
        try {
            // 1. Call the service to update the DB
            const updatedStory = await StoryService.updateStoryField(storyId, 'tags', tags);

            // 2. Update the in-memory stub
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                storyInLibrary.tags = updatedStory.tags;
                storyInLibrary.last_modified = updatedStory.last_modified;
            }

            // 3. Update search and tag cache
            this.updateSearchIndex(storyInLibrary);
            StateManager.updateTagCache();

        } catch (e) {
            console.error("Failed to update story tags:", e);
            alert("Error: Could not save story tags.");
        }
    }, 500),

	/**
     * Uses AI to generate a creator's note for a story.
     * REFACTORED: Now calls StoryService for context.
     */
    async generateStoryNotesAI(event, storyId) {
        const state = StateManager.getState();
        const globalPrompts = state.id ? state : UTILITY.getDefaultSystemPrompts();
        const promptTemplate = globalPrompts.prompt_story_notes_gen;

        // 1. Get context from the StoryService
        const context = await StoryService.buildStoryContext(storyId);
        
        // 2. Call the AI
        const newNotes = await this._generateContentForField(event, promptTemplate, { context });
        
        if (newNotes !== null) {
            // 3. Save the update (this function is now refactored and works)
            this.updateStoryField(storyId, 'creator_notes', newNotes);
            
            // Re-render the details view
            UIManager.openStoryDetails(storyId);
        }
    },

	/**
     * Uses AI to generate tags for a story.
     * REFACTORED: Now calls StoryService for context.
     */
    async generateStoryTagsAI(event, storyId) {
        const state = StateManager.getState();
        const globalPrompts = state.id ? state : UTILITY.getDefaultSystemPrompts();
        const promptTemplate = globalPrompts.prompt_story_tags_gen;
        
        // 1. Get context from the StoryService
        const context = await StoryService.buildStoryContext(storyId);

        // 2. Call the AI
        const tagsString = await this._generateContentForField(event, promptTemplate, { context });
        
        if (tagsString !== null) {
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            const newTags = tagsString.split(',').map(t => t.trim().toLowerCase());
            const combinedTags = [...new Set([...(storyInLibrary.tags || []), ...newTags])];
            
            // 3. Save the update (this function is now refactored and works)
            this.updateStoryTags(storyId, combinedTags.join(', '));
            
            // Re-render the details view
            UIManager.openStoryDetails(storyId);
        }
    },


/** Handles the upload of a local image for a world map location. */
    async handleWorldMapLocationImageUpload(event, x, y) {
      const file = event.target.files?.[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) { // 5MB Limit
        alert("Error: Image file size should not exceed 5MB.");
        event.target.value = '';
        return;
      }
      
      // Create a unique key for this specific tile
      const locationKey = `location::${x},${y}`;
      UIManager.showLoadingSpinner?.('Processing location image...');

      try {
        const blob = await ImageProcessor.processImageAsBlob(file);
        const saveSuccess = await DBService.saveImage(locationKey, blob);

        if (!saveSuccess) {
            throw new Error("Failed to save image to IndexedDB. This might be due to private browsing or storage limits.");
        }

        // Add to live cache
        UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
        const oldUrl = UIManager.RUNTIME.worldImageCache[locationKey];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        UIManager.RUNTIME.worldImageCache[locationKey] = URL.createObjectURL(blob);

        // Update the model to use the local key and clear the legacy URL
        const state = StateManager.getState();
        const locationInGrid = state.worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
        if (locationInGrid) {
            // Use a keyword to show it's local, not a real URL
            locationInGrid.imageUrl = `local_idb_location::${x},${y}`;
            StateManager.saveState();
        }

        // Refresh UI
        UIManager.renderWorldMapModal(); // Re-render modal to update hint
        UIManager.applyStyling(); // Apply new background if it's the current location

      } catch (err) {
        console.error("Error processing location image:", err);
        alert(`Upload failed: ${err.message}`);
      } finally {
        UIManager.hideLoadingSpinner?.();
        event.target.value = ''; // Clear file input
      }
    },

    /** Handles the upload of a local image for a character portrait. */
	async handleLocalImageUpload(event, charId) {
	  const file = event.target.files?.[0];
	  if (!file) return;

	  if (file.size > 5 * 1024 * 1024) {
		alert("Error: Image file size should not exceed 5MB.");
		event.target.value = '';
		return;
	  }

	  UIManager.showLoadingSpinner?.('Processing image...');
	  try {
		const blob = await ImageProcessor.processImageAsBlob(file);
		await DBService.saveImage(charId, blob);

		// Live-cache update (no reload)
		UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
		const oldUrl = UIManager.RUNTIME.characterImageCache[charId];
		if (oldUrl) URL.revokeObjectURL(oldUrl);
		UIManager.RUNTIME.characterImageCache[charId] = URL.createObjectURL(blob);

		// Normalize the model to IDB-backed (no external URL)
		this.updateCharacterField(charId, 'image_url', '');

		// Minimal, targeted repaints
		UIManager.renderCharacters?.();           // roster tiles
		const active = StateManager.getState?.();
		if (active?.lastSpeakerId) {
		  UIManager.updateSidePortrait?.();       // side portrait in horizontal mode
		}
		UIManager.refreshRecentMessages?.(10)     // if you have it
		  ?? UIManager.renderChat?.();            // otherwise a small full chat repaint

		// Optional UI text hint near the uploader
		const textInput = event.target.closest('div')?.querySelector('input[type="text"]');
		if (textInput) textInput.value = `[Image stored in browser]`;
	  } catch (err) {
		console.error("Error processing local image:", err);
		alert("There was an error processing the image.");
	  } finally {
		UIManager.hideLoadingSpinner?.();
	  }
	},
	
/** Handles the upload of a local image for an emotional portrait. */
    async handleLocalEmotionImageUpload(event, charId, index) {
      const file = event.target.files?.[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        alert("Error: Image file size should not exceed 5MB.");
        event.target.value = '';
        return;
      }

      const state = StateManager.getState();
      const char = state.characters.find(c => c.id === charId);
      if (!char || !Array.isArray(char.extra_portraits) || !char.extra_portraits[index]) return;

      // Read the emotion from the model (source of truth)
      const emotion = (char.extra_portraits[index].emotion || 'neutral').toLowerCase();
      const emoKey = `${charId}::emotion::${emotion}`;

      UIManager.showLoadingSpinner?.('Processing emotion image...');
      try {
        const blob = await ImageProcessor.processImageAsBlob(file);
        await DBService.saveImage(emoKey, blob);

        // Live-cache update (no reload)
        UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
        const oldUrl = UIManager.RUNTIME.characterImageCache[emoKey];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        UIManager.RUNTIME.characterImageCache[emoKey] = URL.createObjectURL(blob);

        // Clear the URL (so getPortraitSrc prefers the local blob)
        char.extra_portraits[index].url = '';
        StateManager.saveState();

        // Targeted UI refresh so the new image shows up immediately
        const active = StateManager.getState();
        UIManager.renderCharacters?.();
        if (active?.lastSpeakerId) UIManager.updateSidePortrait?.();
        UIManager.refreshRecentMessages?.(10) ?? UIManager.renderChat?.();

        // Optional: hint in the nearby URL input box
        const textInput = event.target.closest('div')?.querySelector('input[type="text"]');
        if (textInput) textInput.value = `[Image stored in browser for "${emotion}"]`;
      } catch (err) {
        console.error("Error processing emotion image:", err);
        alert("There was an error processing the emotion image.");
      } finally {
        UIManager.hideLoadingSpinner?.();
      }
    },


    /** Updates a character's color scheme (debounced). */
    updateCharacterColor: debounce(function(charId, type, value) {
        const state = StateManager.getState();
        const char = state.characters.find(c => c.id === charId);
        if (char) {
            if (!char.color || typeof char.color !== 'object') {
                char.color = { base: '#334155', bold: '#94a3b8' };
            }
            char.color[type] = value;
            StateManager.saveState();
            UIManager.renderChat();
        }
    }, 100),

    /** Updates a character's tags (debounced). */
    updateCharacterTags: debounce(function(id, value) {
        const state = StateManager.getState();
        const char = state.characters.find(c => c.id === id);
        if (char) {
            char.tags = value.split(',').map(t => t.trim()).filter(Boolean);
            StateManager.saveState();
            StateManager.updateTagCache();
        }
    }, 500),

    /** Uses AI to generate tags for a character based on their persona. */
    async generateTagsForCharacter(event, charId) {
        UIManager.showConfirmationModal("This will use AI to add to the current tags. Are you sure?", async () => {
            const state = StateManager.getState();
            const char = state.characters.find(c => c.id === charId);
            if (!char) return;

            const prompt = `Analyze the following character. Generate 3 to 5 relevant, one-word, comma-separated tags.\n\nCHARACTER: ${char.name}\nDESCRIPTION: ${char.description}`;
            const tagsString = await this._generateContentForField(event, prompt, {});
            
            if (tagsString !== null) {
                char.tags = (char.tags || []).concat(tagsString.split(',').map(t => t.trim().toLowerCase()));
                char.tags = [...new Set(char.tags)];
                StateManager.saveState();
                UIManager.openCharacterDetailModal(charId);
                StateManager.updateTagCache();
            }
        });
    },

    addExtraPortrait(charId) { const state = StateManager.getState(); const char = state.characters.find(c => c.id === charId); if(char) { if(!char.extra_portraits) char.extra_portraits = []; char.extra_portraits.push({emotion: 'happy', url: ''}); StateManager.saveState(); UIManager.openCharacterDetailModal(charId); } },
    removeExtraPortrait(charId, index) { const state = StateManager.getState(); const char = state.characters.find(c => c.id === charId); if(char && char.extra_portraits) { char.extra_portraits.splice(index, 1); StateManager.saveState(); UIManager.openCharacterDetailModal(charId); } },
    updateExtraPortrait: debounce(function(charId, index, field, value) { const state = StateManager.getState(); const char = state.characters.find(c => c.id === charId); if(char && char.extra_portraits && char.extra_portraits[index]) { char.extra_portraits[index][field] = value; StateManager.saveState(); } }, 300),
    toggleCharacterActive(event, id) { const state = StateManager.getState(); const char = state.characters.find(c => c.id === id); if (char) char.is_active = event.target.checked; StateManager.saveState(); UIManager.updateAICharacterSelector(); },
    
    addStaticEntry() { const state = StateManager.getState(); const newEntry = { id: UTILITY.uuid(), title: "New Static Entry", content: "" }; state.static_entries.push(newEntry); state.selectedStaticEntryId = newEntry.id; this.saveAndRenderStaticEntries(); },
    deleteStaticEntry(id) { const state = StateManager.getState(); state.static_entries = state.static_entries.filter(e => e.id !== id); if(state.selectedStaticEntryId === id) state.selectedStaticEntryId = null; this.saveAndRenderStaticEntries(); },
    selectStaticEntry(id) { StateManager.getState().selectedStaticEntryId = id; UIManager.renderStaticEntries(); },
    updateStaticEntryField: debounce(function(id, field, value) { 
        const state = StateManager.getState();
        const entry = state.static_entries.find(e => e.id === id); 
        if (entry) { 
            entry[field] = value; 
            StateManager.saveState(); 
        } 
    }, 300),

	addDynamicEntry() { 
        const state = StateManager.getState(); 
        // Create the new entry with the new data structure
        const newEntry = {
            id: UTILITY.uuid(), 
            title: "New Dynamic Entry", 
            triggers: "", 
            content_fields: [""], // Start with one empty content field
            current_index: 0,    // Start at index 0
            triggered_at_turn: null 
        };
        state.dynamic_entries.push(newEntry); 
        state.selectedDynamicEntryId = newEntry.id; 
        this.saveAndRenderDynamicEntries(); 
    },
    deleteDynamicEntry(id) { const state = StateManager.getState(); state.dynamic_entries = state.dynamic_entries.filter(e => e.id !== id); if(state.selectedDynamicEntryId === id) state.selectedDynamicEntryId = null; this.saveAndRenderDynamicEntries(); },
	selectDynamicEntry(id) { StateManager.getState().selectedDynamicEntryId = id; UIManager.renderDynamicEntries(); },
    
    /**
     * Updates top-level fields for a dynamic entry (title, triggers).
     */
    updateDynamicEntryField: debounce(function(id, field, value) { 
        const state = StateManager.getState();
        const entry = state.dynamic_entries.find(e => e.id === id); 
        if (entry && (field === 'title' || field === 'triggers')) { 
            entry[field] = value; 
            StateManager.saveState();
        } 
    }, 300),

    /**
     * [NEW] Adds a new, empty content field to a dynamic entry.
     */
    addDynamicContentField(entryId) {
        const state = StateManager.getState();
        const entry = state.dynamic_entries.find(e => e.id === entryId);
        if (entry) {
            entry.content_fields.push("");
            StateManager.saveState();
            UIManager.renderDynamicEntryDetails(); // Re-render just the details pane
        }
    },

    /**
     * [NEW] Updates a specific content field in the sequence (debounced).
     */
    updateDynamicContentField: debounce(function(entryId, index, value) {
        const state = StateManager.getState();
        const entry = state.dynamic_entries.find(e => e.id === entryId);
        if (entry && entry.content_fields[index] !== undefined) {
            entry.content_fields[index] = value;
            StateManager.saveState();
        }
    }, 300),

    addExampleDialogueTurn() {
        const state = StateManager.getState();
        const firstAiChar = state.characters.find(c => !c.is_user);
        if (!firstAiChar) {
            alert("Cannot add example dialogue without at least one AI character.");
            return;
        }
        state.chat_history.push({ character_id: firstAiChar.id, content: "New example dialogue.", type: 'chat', emotion: 'neutral', timestamp: new Date().toISOString(), isHidden: true });
        StateManager.saveState();
        UIManager.renderExampleDialogueModal();
    },
	
	/** * Uses AI to generate content for a dynamic knowledge entry.
     * [MODIFIED] Now accepts an index to update a specific field.
     */
    async generateDynamicEntryContentAI(event, entryId, index) { // <-- Added index
        const state = StateManager.getState();
        const entry = state.dynamic_entries.find(e => e.id === entryId);
        if (!entry || entry.content_fields[index] === undefined) return;

        const newContent = await this._generateContentForField(event, state.prompt_entry_gen, {
            title: entry.title,
            triggers: entry.triggers
        });

        if (newContent !== null) {
            // Update the specific field in the array
            entry.content_fields[index] = newContent;
            StateManager.saveState();
            // Re-render the details to show the new content
            UIManager.renderDynamicEntryDetails();
        }
    },
	
    deleteExampleDialogueTurn(originalIndex) {
        const state = StateManager.getState();
        state.chat_history.splice(originalIndex, 1);
        StateManager.saveState();
        UIManager.renderExampleDialogueModal();
    },
    updateExampleDialogueTurn: debounce(function(originalIndex, field, value) {
        const state = StateManager.getState();
        if (state.chat_history[originalIndex]) {
            state.chat_history[originalIndex][field] = value;
            StateManager.saveState();
        }
    }, 300),
    moveExampleDialogueTurn(originalIndex, direction) {
        const state = StateManager.getState();
        const history = state.chat_history;
        const itemToMove = history[originalIndex];
        if (!itemToMove) return;

        let swapIndex = -1;
        if (direction === 'up') {
            for (let i = originalIndex - 1; i >= 0; i--) { if (history[i].isHidden) { swapIndex = i; break; } }
        } else {
            for (let i = originalIndex + 1; i < history.length; i++) { if (history[i].isHidden) { swapIndex = i; break; } }
        }

        if (swapIndex !== -1) {
            const temp = history[swapIndex];
            history[swapIndex] = itemToMove;
            history[originalIndex] = temp;
            StateManager.saveState();
            UIManager.renderExampleDialogueModal();
        }
    },

    openViewRawPromptModal() {
        if (!StateManager.getLibrary().active_narrative_id) { 
            alert("Please load a narrative first."); 
            return; 
        }
        
        let charToActId = document.getElementById('ai-character-selector').value;
        
        if (charToActId === 'any' || !charToActId) {
            console.log("View Raw Prompt: 'Any' selected, determining next speaker.");
            charToActId = this.determineNextSpeaker(false);
        }

        if (!charToActId) {
            alert("Could not determine an AI character to generate a prompt for. Please ensure at least one AI character is active.");
            return;
        }

        const prompt = PromptBuilder.buildPrompt(charToActId);
        document.getElementById('raw-prompt-content').textContent = prompt;
        this.openModal('view-raw-prompt-modal');
    },

    copyMessage(index) {
        const state = StateManager.getState();
        const message = state.chat_history[index];
        if (!message) return;
        
        const tempTextarea = document.createElement('textarea');
        tempTextarea.value = message.content;
        document.body.appendChild(tempTextarea);
        tempTextarea.select();
        try {
            document.execCommand('copy');
            const copyBtn = document.querySelector(`[data-message-index='${index}'] .action-btn-group button[title='Copy']`);
            if (copyBtn) {
                const originalIcon = copyBtn.innerHTML;
                copyBtn.innerHTML = `<span class="text-xs text-green-400">Copied!</span>`;
                setTimeout(() => { copyBtn.innerHTML = originalIcon; }, 1500);
            }
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
        document.body.removeChild(tempTextarea);
    },
    
    deleteMessage(index) {
        UIManager.showConfirmationModal('Are you sure you want to permanently delete this message?', () => {
            const state = StateManager.getState();
            const messageToDelete = state.chat_history[index];
            if (messageToDelete && messageToDelete.type === 'chat') {
                state.messageCounter--;
            }
            state.chat_history.splice(index, 1);
            this.saveAndRender();
        });
    },

    stopGeneration() {
        if (this.RUNTIME.activeRequestAbortController) {
            this.RUNTIME.activeRequestAbortController.abort();
            console.log("Request aborted by user.");
        }
        
        const state = StateManager.getState();
        if (state.apiProvider === 'koboldcpp' && state.koboldcpp_url) {
            fetch(`${state.koboldcpp_url}/api/v1/generate/stop`, { method: 'POST' })
                .catch(err => console.error("Failed to send stop request to KoboldCPP:", err));
        }

        UIManager.hideTypingIndicator();
        UIManager.setButtonToSendMode();
        this.RUNTIME.activeRequestAbortController = null;
    },

    // --- World Map Functions ---
    async generateWorldMap(event) {
        UIManager.showConfirmationModal('This will overwrite the existing world map with an AI-generated one and may incur API costs. Are you sure?', async () => {
            const state = StateManager.getState();
            
            const context = {
                characters: state.characters.map(c => `${c.name}: ${c.short_description}`).join('\n'),
                static: (state.static_entries || []).map(e => `* ${e.title}: ${e.content}`).join('\n'),
                recent: (state.chat_history || []).filter(m => m.type === 'chat').slice(-3).map(m => m.content).join('\n---\n'),
            };

            const newGridData = await this._generateContentForField(event, state.prompt_world_map_gen, context, true);
            
            if (newGridData) {
                try {
                    const newWorld = JSON.parse(newGridData);
                    if (newWorld.grid && newWorld.grid.length > 0) {
                        newWorld.grid.forEach(loc => loc.local_static_entries = []);
                        state.worldMap.grid = newWorld.grid;
                        state.worldMap.currentLocation = { x: 4, y: 4 };
                        state.worldMap.destination = { x: null, y: null };
                        state.worldMap.path = [];
                        this.RUNTIME.selectedMapTile = null;
                        StateManager.saveState();
                        UIManager.renderWorldMapModal();
                        UIManager.applyStyling(); 
                    } else {
                        throw new Error("Generated data is not a valid grid.");
                    }
                } catch (e) {
                     console.error("World Map generation failed to parse JSON:", e);
                     alert("Failed to generate world map. The AI returned an invalid format.");
                }
            }
        });
    },

    moveToLocation(x, y) {
        const state = StateManager.getState();
        const targetLocation = state.worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
        if (targetLocation) {
            const previousLocationCoords = { ...state.worldMap.currentLocation };
            const turnOfDeparture = state.messageCounter;

            if (this.RUNTIME.turnOfArrival !== null && turnOfDeparture > this.RUNTIME.turnOfArrival) {
                 this.summarizeActivityForLocation(previousLocationCoords, this.RUNTIME.turnOfArrival);
            }

            state.worldMap.currentLocation = { x, y };
            this.RUNTIME.turnOfArrival = state.messageCounter;

            if (state.worldMap.destination && state.worldMap.destination.x !== null) {
                state.worldMap.path = UTILITY.findPath(state.worldMap.grid, state.worldMap.currentLocation, state.worldMap.destination);
            } else {
                 state.worldMap.path = [];
            }
            
            this.addSystemMessageToHistory(`You have moved to ${targetLocation.name}.`);
            this.RUNTIME.selectedMapTile = null;
            this.RUNTIME.pendingMove = null;
            StateManager.saveState();
            UIManager.applyStyling();
            
            const narrator = state.characters.find(c => c.is_narrator && c.is_active);
            if (narrator) {
                this.triggerAIResponse(narrator.id, '', true);
            } else {
                this.triggerAIResponse(null, '', true);
            }
        }
    },

    async summarizeActivityForLocation(locationCoords, startTurn) {
        try {
            const state = StateManager.getState();
            const endTurn = state.messageCounter;
            
            const relevantHistory = state.chat_history.slice(startTurn, endTurn).filter(msg => msg.type === 'chat' && !msg.isHidden);

            if (relevantHistory.length === 0) {
                console.log("No new chat activity to summarize for location:", locationCoords);
                return;
            }

            const chatTranscript = relevantHistory.map(msg => {
                const char = state.characters.find(c => c.id === msg.character_id);
                return `${char ? char.name : 'Unknown'}: ${msg.content}`;
            }).join('\n');
            
            const prompt = state.prompt_location_memory_gen.replace('{transcript}', chatTranscript);
            const summaryContent = await APIService.callAI(prompt);

            const currentState = StateManager.getState();
            const location = currentState.worldMap.grid.find(loc => loc.coords.x === locationCoords.x && loc.coords.y === locationCoords.y);
            if (location) {
                if (!location.local_static_entries) {
                    location.local_static_entries = [];
                }
                const newEntry = {
                    id: UTILITY.uuid(),
                    title: `Events from turn ${startTurn} to ${endTurn}`,
                    content: summaryContent
                };
                location.local_static_entries.push(newEntry);
                StateManager.saveState();
                console.log("Location memory auto-generated for:", location.name);
            }
        } catch (error) {
            console.error("Failed to auto-generate location memory:", error);
        }
    },
    
    selectMapTile(x, y) {
        const state = StateManager.getState();
        const tile = state.worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
        this.RUNTIME.selectedMapTile = tile || null;
        this.RUNTIME.selectedLocalStaticEntryId = null;
        UIManager.renderWorldMapModal();
    },

    selectPendingMove(x, y) {
        this.RUNTIME.pendingMove = { x, y };
        UIManager.renderWorldMapModal();
    },

    confirmMove() {
        const state = StateManager.getState();
        const { pendingMove } = this.RUNTIME;
        const { currentLocation } = state.worldMap;

        if (pendingMove && (pendingMove.x !== currentLocation.x || pendingMove.y !== currentLocation.y)) {
            this.moveToLocation(pendingMove.x, pendingMove.y);
        }

        this.RUNTIME.pendingMove = null;
        this.closeModal('world-map-modal');
    },

    setDestination() {
        const state = StateManager.getState();
        const selected = this.RUNTIME.selectedMapTile;
        if (!selected) return;

        state.worldMap.destination = selected.coords;
        state.worldMap.path = UTILITY.findPath(state.worldMap.grid, state.worldMap.currentLocation, selected.coords);
        StateManager.saveState();
        UIManager.renderWorldMapModal();
    },

    updateLocationDetail: debounce(function(field, value) {
        const state = StateManager.getState();
        const selected = this.RUNTIME.selectedMapTile;
        if (!selected) return;
        const locationInGrid = state.worldMap.grid.find(loc => loc.coords.x === selected.coords.x && loc.coords.y === selected.coords.y);
        if (locationInGrid) {
            locationInGrid[field] = value;
            StateManager.saveState();
        }
    }, 500),

    addLocalStaticEntry() {
        const location = this.RUNTIME.selectedMapTile;
        if (!location) return;
        if (!location.local_static_entries) location.local_static_entries = [];
        const newEntry = { id: UTILITY.uuid(), title: "New Local Entry", content: "" };
        location.local_static_entries.push(newEntry);
        this.RUNTIME.selectedLocalStaticEntryId = newEntry.id;
        StateManager.saveState();
        UIManager.renderLocalStaticEntriesList();
        UIManager.renderLocalStaticEntryDetails();
    },
    
    deleteLocalStaticEntry(entryId) {
        const location = this.RUNTIME.selectedMapTile;
        if (!location || !location.local_static_entries) return;
        location.local_static_entries = location.local_static_entries.filter(e => e.id !== entryId);
        if (this.RUNTIME.selectedLocalStaticEntryId === entryId) {
            this.RUNTIME.selectedLocalStaticEntryId = null;
        }
        StateManager.saveState();
        UIManager.renderLocalStaticEntriesList();
        UIManager.renderLocalStaticEntryDetails();
    },
    
    selectLocalStaticEntry(entryId) {
        this.RUNTIME.selectedLocalStaticEntryId = entryId;
        UIManager.renderLocalStaticEntriesList();
        UIManager.renderLocalStaticEntryDetails();
    },
    
    updateLocalStaticEntryField: debounce(function(entryId, field, value) {
        const location = this.RUNTIME.selectedMapTile;
        if (!location || !location.local_static_entries) return;
        const entry = location.local_static_entries.find(e => e.id === entryId);
        if (entry) {
            entry[field] = value;
            StateManager.saveState();
            if (field === 'title') {
                UIManager.renderLocalStaticEntriesList();
            }
        }
    }, 300),

	async elevateNarrativeToScenario(storyId, narrativeId) {
        UIManager.showLoadingSpinner('Creating scenario...');
        try {
            const story = await DBService.getStory(storyId);
            const narrative = await DBService.getNarrative(narrativeId);
            if (!story || !narrative) throw new Error("Data not found.");

            const firstMessage = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
            const exampleDialogue = (narrative.state.chat_history || []).filter(m => m.isHidden);

            // --- NEW: Capture Active IDs Only ---
            // We use the list stored in the narrative, or derive it if missing
            let activeIDs = narrative.active_character_ids;
            if (!activeIDs) {
                // Fallback for older narratives: assume everyone in story is active (or just user)
                activeIDs = (story.characters || []).map(c => c.id);
            }
            // ------------------------------------

            const newScenario = {
                id: UTILITY.uuid(),
                name: `${narrative.name} (Scenario)`,
                message: firstMessage ? firstMessage.content : "The story continues...",
                
                // Narrative Data
                static_entries: JSON.parse(JSON.stringify(narrative.state.static_entries || [])),
                worldMap: JSON.parse(JSON.stringify(narrative.state.worldMap || {})),
                example_dialogue: JSON.parse(JSON.stringify(exampleDialogue)),
                
                // --- NEW: Store IDs, NOT full objects ---
                active_character_ids: activeIDs,
                
                // Snapshot other settings (Prompts/Dynamic/UI)
                // We still snapshot prompts because those can change per run,
                // but we DON'T snapshot the 'characters' array anymore.
                dynamic_entries: JSON.parse(JSON.stringify(story.dynamic_entries || [])),
                prompts: {
                    system_prompt: story.system_prompt,
                    event_master_base_prompt: story.event_master_base_prompt,
                    prompt_persona_gen: story.prompt_persona_gen,
                    prompt_world_map_gen: story.prompt_world_map_gen,
                    prompt_location_gen: story.prompt_location_gen,
                    prompt_entry_gen: story.prompt_entry_gen,
                    prompt_location_memory_gen: story.prompt_location_memory_gen,
                    font: story.font,
                    backgroundImageURL: story.backgroundImageURL,
                    bubbleOpacity: story.bubbleOpacity,
                    chatTextColor: story.chatTextColor
                }
            };

            story.scenarios.push(newScenario);
            story.last_modified = new Date().toISOString();
            await DBService.saveStory(story);

            // Update in-memory
            const library = StateManager.getLibrary();
            const storyInLibrary = library.stories.find(s => s.id === storyId);
            if (storyInLibrary) {
                storyInLibrary.scenarios = story.scenarios;
                storyInLibrary.last_modified = story.last_modified;
            }

            UIManager.openStoryDetails(storyId);
        } catch (e) {
            console.error("Failed to elevate narrative:", e);
            alert(`Error: ${e.message}`);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },
    
    // --- Import / Export ---

    /**
     * Handles a single file upload from the I/O Hub, routing it to the ImportExportService.
     * @param {Event} event - The file input change event.
     */
async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        UIManager.showLoadingSpinner('Parsing file...');
		try {
            const { story: newStory, imageBlob } = await ImportExportService.parseUploadedFile(file);
            const library = StateManager.getLibrary();

            // --- START OF NEW/FIXED LOGIC ---

            // 1. Check for name conflicts (this part was already correct)
            const existingStory = library.stories.find(s => s.name && newStory.name && s.name.toLowerCase() === newStory.name.toLowerCase());
            if (existingStory) {
                const now = new Date();
                const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
                newStory.name = `${newStory.name} - ${timestamp}`;
                console.log(`Duplicate story name found. Renaming imported story to: ${newStory.name}`);
            }

            // 2. Separate narratives from the story object
            const narratives = newStory.narratives || [];
            
            // 3. Create stubs for the story object
            const narrativeStubs = narratives.map(n => ({ id: n.id, name: n.name, last_modified: n.last_modified }));
            newStory.narratives = narrativeStubs;

            // 4. Save the story (metadata) and all its narratives (heavy data)
            await DBService.saveStory(newStory);
            if (narratives.length > 0) {
                await Promise.all(narratives.map(n => DBService.saveNarrative(n)));
            }
            
            // 5. Add the new story (with stubs) to the in-memory library
            library.stories.push(newStory);

            // --- END OF NEW/FIXED LOGIC ---

            // 6. Save the image (this part was already correct)
            const primaryAiChar = newStory.characters?.find(c => !c.is_user);
            if (imageBlob && primaryAiChar && primaryAiChar.id) {
                const savedToDB = await DBService.saveImage(primaryAiChar.id, imageBlob);

                if (savedToDB) {
                    console.log(`Image saved to DB for ${primaryAiChar.id}, updating cache.`);
                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                    const oldUrl = UIManager.RUNTIME.characterImageCache[primaryAiChar.id];
                    if (oldUrl) {
                        URL.revokeObjectURL(oldUrl);
                    }
                    UIManager.RUNTIME.characterImageCache[primaryAiChar.id] = URL.createObjectURL(imageBlob);
                } else {
                     console.warn(`Failed to save image to DB for ${primaryAiChar.id}, cache not updated.`);
                }
            }

            // 7. Update caches and UI (this part was already correct)
            this.updateSearchIndex(newStory);
            StateManager.updateTagCache();
            // saveLibrary() is fine, it just saves active IDs to localStorage
            StateManager.saveLibrary(); 
            UIManager.hideLoadingSpinner();
            alert(`Story "${newStory.name}" imported successfully!`);
            UIManager.renderLibraryInterface();
            this.closeModal('io-hub-modal');

        } catch (err) {
            UIManager.hideLoadingSpinner();
            alert(`Error importing file: ${err.message}`);
            console.error(err);
        } finally {
            event.target.value = ''; // Reset file input
        }
    },

    /**
     * Initiates the bulk import process by opening a directory picker.
     */
    async handleBulkImport() {
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support directory selection. Please use a modern browser like Chrome or Edge.");
            return;
        }
        try {
            const dirHandle = await window.showDirectoryPicker();
            UIManager.showLoadingSpinner('Starting bulk import...');
            
            let processedFiles = 0;
            const failedFiles = [];
            const importedStoryNames = [];
            const library = StateManager.getLibrary();
            let totalSize = 0;

            const storageAvailable = UTILITY.checkLocalStorageQuota(totalSize);
            
		for await (const entry of dirHandle.values()) {
                // --- ADDED CHECKS ---
                if (entry.kind !== 'file' || typeof entry.name !== 'string' || !entry.name) {
                    // Skip if not a file, or if name isn't a non-empty string
                    console.warn("Skipping directory entry:", entry);
                    continue;
                }
                // --- END CHECKS ---

                // Now it's safe to use .toLowerCase()
                const lowerCaseName = entry.name.toLowerCase();

                if (lowerCaseName.endsWith('.png') || lowerCaseName.endsWith('.byaf') || lowerCaseName.endsWith('.zip')) {
                    UIManager.showLoadingSpinner(`Processing file ${++processedFiles}: ${entry.name}`);
                    let currentFileNameForError = entry.name; // Store name for potential error message
                    try {
                        const file = await entry.getFile();
                        if (!file || typeof file.name !== 'string' || !file.name) {
                             // Add a check for the File object itself, just in case
                            throw new Error("Could not retrieve a valid File object from the directory entry.");
                        }
                        currentFileNameForError = file.name; // Update with potentially more accurate name

                        const { story: newStory, imageBlob } = await ImportExportService.parseUploadedFile(file, !storageAvailable);

                        if (!newStory || typeof newStory.name !== 'string') {
                             // Check the result of parsing too
                             throw new Error("File parsed, but did not result in a valid story object with a name.");
                        }

                        // Check for existing story (uses newStory.name)
                        const existingStory = library.stories.find(s => s.name && s.name.toLowerCase() === newStory.name.toLowerCase());
                        if (existingStory) {
                            const now = new Date();
                            const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
                            newStory.name = `${newStory.name} - ${timestamp}`;
                        }

                        library.stories.push(newStory);

                        // --- IMAGE SAVING (Needs primary char ID) ---
                        const primaryAiChar = newStory.characters?.find(c => !c.is_user);
                        if (imageBlob && primaryAiChar && primaryAiChar.id) {
                            try {
                                // Use await here to ensure saving attempt before continuing loop potentially
                                const savedToDB = await DBService.saveImage(primaryAiChar.id, imageBlob);
								if (savedToDB) {
                                     console.log(`Bulk Import: Image saved to DB for ${primaryAiChar.id}, updating cache.`);
                                    // Ensure cache exists
                                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                                    // Revoke old URL if replacing image for the same ID (less likely in bulk import but good practice)
                                    const oldUrl = UIManager.RUNTIME.characterImageCache[primaryAiChar.id];
                                    if (oldUrl) {
                                        URL.revokeObjectURL(oldUrl);
                                    }
                                    // Add new blob URL to cache
                                    UIManager.RUNTIME.characterImageCache[primaryAiChar.id] = URL.createObjectURL(imageBlob);
                                } else {
                                     console.warn(`Bulk Import: Failed to save image to DB for ${primaryAiChar.id}, cache not updated.`);
                                }
                            } catch (dbSaveError) {
                                 console.warn(`Failed to save image to DB for ${primaryAiChar.id} (${newStory.name}) during bulk import:`, dbSaveError);
                                 // Continue import without the image
                            }
                        }
                         // --- END IMAGE SAVING ---

                        this.updateSearchIndex(newStory);
                        importedStoryNames.push(newStory.name);

                    } catch (err) {
                        // --- SAFER ERROR LOGGING ---
                        console.error(`Failed processing ${currentFileNameForError}:`, err);
                        // Ensure err.message exists, provide fallback
                        failedFiles.push({ name: currentFileNameForError, reason: (err && err.message) ? err.message : 'Unknown processing error' });
                        // --- END SAFER LOGGING ---
                    }
                }
            } // End for await loop

            StateManager.updateTagCache();
            StateManager.saveLibrary();
            UIManager.hideLoadingSpinner();
            UIManager.showBulkImportReport(importedStoryNames, failedFiles);
            UIManager.renderLibraryInterface();

        } catch (err) {
            UIManager.hideLoadingSpinner();
            console.error("Bulk import failed:", err);
            if (err.name !== 'AbortError') {
                alert(`An error occurred during bulk import: ${err.message}`);
            }
        }
    },

    /**
     * Handles the export process based on user selections in the I/O Hub.
     * @param {'json'|'png'|'byaf'} format - The desired export format.
     */
    async exportStoryAs(format) {
        const storySelector = document.getElementById('story-export-selector');
        const narrativeSelector = document.getElementById('narrative-export-selector');
        const storyId = storySelector.value;
        const narrativeId = narrativeSelector.value;

        if (!storyId || !narrativeId) {
            alert("Please select a story and a narrative to export.");
            return;
        }

        if (format !== 'json') {
            const proceed = await UIManager.showConfirmationPromise("Exporting to a non-Ellipsis format may result in data loss (e.g., extra characters, world map details). Continue?");
            if (!proceed) return;
        }

        UIManager.showLoadingSpinner(`Exporting as ${format.toUpperCase()}...`);
try {
            const library = StateManager.getLibrary();
            const story = library.stories.find(s => s.id === storyId);
            // Find narrative within the correct story object from the library
            const narrative = story?.narratives.find(n => n.id === narrativeId);
            // Get primary character if needed, also from the correct story object
            const charSelector = document.getElementById('character-export-selector');
            const primaryCharId = (format === 'png' || format === 'byaf') ? charSelector?.value : null;
            const primaryChar = primaryCharId ? story?.characters.find(c => c.id === primaryCharId) : null;


            if (!story || !narrative) {
                 throw new Error("Selected story or narrative not found.");
            }
             if ((format === 'png' || format === 'byaf') && !primaryChar) {
                 throw new Error("Primary character selection is required for PNG/BYAF export and was not found.");
             }


            let blob, filename;

            switch(format) {
                case 'json':
                    // This service function returns the Blob directly
                    blob = ImportExportService.exportStoryAsJSON(story);
                    filename = `${story.name || 'story'}.json`; // Use story name for JSON export
                    break;
                case 'png':
                    if (!primaryCharId) throw new Error("Please select a primary character for PNG export.");
                    // This service function returns a Promise<Blob>
                    blob = await ImportExportService.exportStoryAsV2(story, narrative, primaryCharId);
                    filename = `${story.name || 'story'}_${primaryChar?.name || 'character'}.png`;
                    break;
                case 'byaf':
                     if (!primaryCharId) throw new Error("Please select a primary character for BYAF export.");
                     // This service function returns a Promise<Blob>
                     blob = await ImportExportService.exportStoryAsBYAF(story, narrative, primaryCharId);
                     filename = `${story.name || 'story'}_${primaryChar?.name || 'character'}.byaf`;
                    break;
                default:
                    throw new Error("Unsupported export format.");
            }

            // Ensure blob is actually a Blob before proceeding
            if (!(blob instanceof Blob)) {
                console.error("Export function did not return a Blob:", blob);
                throw new Error(`Export process failed internally for format: ${format}. Expected a Blob.`);
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Sanitize filename (basic example, might need more robust sanitization)
            a.download = filename.replace(/[/\\?%*:|"<>]/g, '-');
            document.body.appendChild(a); // Append link to body for Firefox compatibility
            a.click();
            document.body.removeChild(a); // Clean up link
            URL.revokeObjectURL(url);

        } catch (e) {
            alert(`Export failed: ${e.message}`);
            console.error("Export error:", e);
        } finally {
            UIManager.hideLoadingSpinner();
        }
    },

    // --- Helper & Utility Actions ---
    _ensureCharacterColors() {
        const state = StateManager.getState();
        if (!state || !state.characters) return;
        let aiCharCount = 0;
        state.characters.forEach(char => {
            if (!char.is_user) {
                 if (!char.color || typeof char.color !== 'object') { 
                    char.color = this.CONSTANTS.CHARACTER_COLORS[aiCharCount % this.CONSTANTS.CHARACTER_COLORS.length];
                 }
                aiCharCount++;
            }
        });
    },
    saveAndRender() { StateManager.saveState(); UIManager.renderAll(); },
    saveAndRenderStaticEntries() { StateManager.saveState(); UIManager.renderStaticEntries(); },
    saveAndRenderDynamicEntries() { StateManager.saveState(); UIManager.renderDynamicEntries(); },
};

/**
 * =================================================================================================
 * app Module (The Initializer)
 * =================================================================================================
 * This is the main entry point of the application. It initializes all the other modules
 * and sets up the initial event listeners.
 */
const app = {
  async init() {
  
  if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
  
// --- NEW: ONE-TIME MIGRATION LOGIC ---
    
    // 1. Init the DB service first. Must be version 2.
    let dbReady = false;
    try {
      await DBService.init(); // This will try to open version 2
      dbReady = true;
    } catch (e) {
      console.error("CRITICAL: DBService failed to init. App cannot start.", e);
      alert("Error: Your browser's database failed to start. The app cannot load.");
      return;
    }

    // 2. Check if migration has already been run.
    const migrationFlag = 'v2_idb_migration_complete';
    if (!localStorage.getItem(migrationFlag)) {
        console.log("No migration flag found. Checking for old localStorage data...");
        
        // 3. Try to get the old library data
        const oldLibraryJSON = localStorage.getItem('aiStorytellerLibrary');
        
        if (oldLibraryJSON) {
            console.log("Old library data found. Starting migration to IndexedDB...");
            UIManager.showLoadingSpinner("Upgrading database... Please wait.");
            
            try {
                const parsedLibrary = JSON.parse(oldLibraryJSON);
                
                if (parsedLibrary.stories && parsedLibrary.stories.length > 0) {
                    for (const story of parsedLibrary.stories) {
                        // a. Split the story into metadata and narratives
                        const narrativeStubs = [];
                        
                        if (story.narratives && story.narratives.length > 0) {
                            for (const narrative of story.narratives) {
                                // Save the full narrative object to IDB
                                await DBService.saveNarrative(narrative);
                                // Create a stub for the story object
                                narrativeStubs.push({ id: narrative.id, name: narrative.name });
                            }
                        }
                        
                        // b. Create the new story metadata object
                        const storyData = { ...story };
                        delete storyData.narratives; // Remove heavy data
                        storyData.narratives = narrativeStubs; // Replace with light stubs
                        
                        // c. Save the story metadata object to IDB
                        await DBService.saveStory(storyData);
                    }
                }
                
                // 4. Set the active IDs from the old library
                localStorage.setItem('active_story_id', parsedLibrary.active_story_id || null);
                localStorage.setItem('active_narrative_id', parsedLibrary.active_narrative_id || null);

                // 5. Migration successful! Set flag and clean up.
                console.log(`Migration complete! Moved ${parsedLibrary.stories.length} stories.`);
                localStorage.setItem(migrationFlag, 'true');
                localStorage.removeItem('aiStorytellerLibrary'); // Clean up old 5MB+ key
                
            } catch (e) {
                console.error("Migration failed:", e);
                UIManager.hideLoadingSpinner(); // Make sure spinner hides on fail
                alert("An error occurred while upgrading your database. Old data may not be available.");
                localStorage.setItem(migrationFlag, 'failed'); // Avoid re-running a failed migration
            }
        } else {
            // No old data, just set the flag.
            console.log("No old library data found. Setting migration flag.");
            localStorage.setItem(migrationFlag, 'true');
        }
        
        // We always hide spinner, even if no migration was needed
        UIManager.hideLoadingSpinner(); 
    }
    // --- END OF MIGRATION LOGIC ---
	
	// --- [NEW] ONE-TIME MIGRATION FOR DYNAMIC ENTRIES --- [REMOVE THIS CODE LATER]
    const dynamicEntryMigrationFlag = 'v3_dynamic_entry_migration_complete';
    if (!localStorage.getItem(dynamicEntryMigrationFlag)) {
        console.log("Running one-time migration for dynamic entries...");
        UIManager.showLoadingSpinner("Updating data structure...");

        try {
            // 1. Fetch ALL stories directly from the database
            const allStories = await DBService.getAllStories();
            let storiesToUpdate = [];

            for (const story of allStories) {
                let storyWasModified = false;
                
                if (story.dynamic_entries && Array.isArray(story.dynamic_entries)) {
                    // 2. Iterate through each dynamic entry
                    for (const entry of story.dynamic_entries) {
                        
                        // 3. Check if it's the old model (has 'content' and not 'content_fields')
                        if (entry.content !== undefined && entry.content_fields === undefined) {
                            
                            // 4. Perform the migration
                            console.log(`Migrating entry: ${entry.title} in story: ${story.name}`);
                            entry.content_fields = [entry.content || ""]; // Create array from old string
                            entry.current_index = 0;                     // Add new required field
                            delete entry.content;                        // Delete old, invalid field
                            
                            storyWasModified = true;
                        }
                    }
                }
                
                if (storyWasModified) {
                    // 5. Add the modified story to the update queue
                    storiesToUpdate.push(story);
                }
            }

            // 6. Save all modified stories back to the database
            if (storiesToUpdate.length > 0) {
                console.log(`Saving ${storiesToUpdate.length} updated stories...`);
                await Promise.all(storiesToUpdate.map(story => DBService.saveStory(story)));
            }

            // 7. Set the flag so it doesn't run again
            localStorage.setItem(dynamicEntryMigrationFlag, 'true');
            console.log("Dynamic entry migration complete.");

        } catch (err) {
            console.error("Critical error during dynamic entry migration:", err);
            alert("An error occurred while updating your story data. Some entries might still be in the old format.");
        } finally {
            UIManager.hideLoadingSpinner(); // Always hide spinner
        }
    }
    // --- END OF NEW MIGRATION ---	
	
	// Load data first (NOW reads from IDB via StateManager)
    await StateManager.loadLibrary();
    
    const library = StateManager.getLibrary();
	
    if (library.stories.length === 0) {
      // This is now an async function
      const { newStory, newNarrative } = await StoryService.createDefaultStoryAndNarrative();
      // Manually set the active session and reload
      localStorage.setItem('active_story_id', newStory.id);
      localStorage.setItem('active_narrative_id', newNarrative.id);
      window.location.reload();
      return; // The create function reloads the page
    }
	
	// --- [NEW] HYDRATE ALL IMAGES ---
    // We run this *after* loading the library stubs and *before* loading the active state.
    // This populates the cache for the entire library, fixing the Story Library bug.
    if (dbReady && library.stories && library.stories.length > 0) {
        console.log(`Hydrating images for ${library.stories.length} stories...`);
        UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
        
        // Loop over ALL stories in the library
        for (const story of library.stories) {
            if (!story.characters) continue;
            
            // Loop over ALL characters in each story
            for (const char of story.characters) {
                try {
                    // 1. Hydrate base portrait
                    // We check if it's already cached to avoid duplicate DB calls/blob URLs
                    if (!UIManager.RUNTIME.characterImageCache[char.id]) {
                        const blob = await DBService.getImage(char.id);
                        if (blob) {
                            UIManager.RUNTIME.characterImageCache[char.id] = URL.createObjectURL(blob);
                        }
                    }

                    // 2. Hydrate emotion portraits
                    if (Array.isArray(char.extra_portraits)) {
                        for (const p of char.extra_portraits) {
                            const emotion = (p.emotion || 'neutral').toLowerCase();
                            const emoKey = `${char.id}::emotion::${emotion}`;
                            if (!UIManager.RUNTIME.characterImageCache[emoKey]) {
                                const blob = await DBService.getImage(emoKey);
                                if (blob) {
                                    UIManager.RUNTIME.characterImageCache[emoKey] = URL.createObjectURL(blob);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn("getImage failed for char", char.id, e);
                }
            }
        }
        console.log("Image hydration complete.");
    }
    // --- END NEW IMAGE HYDRATION ---
	
	// Now, load the active narrative
    await StateManager.loadActiveNarrative();
    
    const state = StateManager.getState();

    // --- Make the UI responsive immediately (listeners + layout + send-button state) ---
    // Doing this early ensures you don't get stuck in vertical-only layout with dead buttons.
    this.setupEventListeners();            // calls updateLayout() internally on load and on resize
    UIManager.setButtonToSendMode();       // ensures the input button is in the correct mode

    // --- Try IndexedDB, but DO NOT let it block the UI ---
    dbReady = false;
    try {
      await DBService.init();              // DBService is fail-soft; still guard with try/catch
      dbReady = true;
    } catch (e) {
      console.warn("DB init failed; proceeding without image cache", e);
    }

    // Always have a cache object—even if DB isn't ready
    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};

    // --- One-time image migration from legacy image_url/LocalStorage into IndexedDB ---
    // Define helpers locally so they don't leak globals.
    async function migrateLegacyImagesToIDB(root) {
      if (!root) return;

      // Accept either an active narrative with characters, or the full library
      const characters =
        root.characters ? root.characters :
        (root.stories && Array.isArray(root.stories))
          ? root.stories.flatMap(s => s.characters || [])
          : [];

      if (!characters || characters.length === 0) return;

      let changed = false;

      for (const char of characters) {
        try {
          // If there is already a blob in IDB for this char, skip
          const existing = await DBService.getImage(char.id);
          if (existing) continue;

          // If the character has a legacy inline/base64 or remote URL, try to fetch and store
          const url = (char.image_url || '').trim();
          if (!url) continue;

          const blob = url.startsWith('data:')
            ? dataURLToBlob(url)
            : await fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.blob() : null));

          if (blob) {
            // Save under the base key = char.id (keeps compatibility with your current hydrator)
            await DBService.saveImage(char.id, blob);

            // Normalize model to IDB-backed
            char.image_url = '';

            // Live-cache for immediate UI usage
            const oldUrl = UIManager.RUNTIME.characterImageCache[char.id];
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            UIManager.RUNTIME.characterImageCache[char.id] = URL.createObjectURL(blob);

            changed = true;
          }
        } catch (e) {
          console.warn('Legacy image migration failed for char', char?.id, e);
          // leave image_url as-is; renderers will still fall back to it if present
        }
      }

      if (changed) {
        StateManager.saveLibrary?.();
        // Minimal repaint to reflect newly cached portraits
        UIManager.renderCharacters?.();
        const active = StateManager.getState?.();
        if (active?.lastSpeakerId) {
          UIManager.updateSidePortrait?.(active.lastSpeakerId);
        }
      }
    }

    function dataURLToBlob(dataUrl) {
      const [header, data] = dataUrl.split(',');
      const isBase64 = /;base64$/i.test(header);
      const mime = (header.match(/data:(.*?)(;|$)/) || [])[1] || 'application/octet-stream';
      const bytes = isBase64 ? atob(data) : decodeURIComponent(data);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }

    // Run migration only if DB is ready
    if (dbReady) {
      try {
        await migrateLegacyImagesToIDB(
          StateManager.getState() || StateManager.getLibrary?.()
        );
      } catch (e) {
        console.warn("Legacy image migration failed:", e);
      }
    }
	
// Hydrate global background image
    if (dbReady && state) { // Check if DB is ready and state is loaded
        let stateNeedsUpdate = false;
        try {
            const blob = await DBService.getImage('global_background_image');
            if (blob) {
                // Image FOUND in IDB
                console.log("Found local background image in IDB during init.");
                UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(blob);
                // Ensure state reflects reality
                if (state.backgroundImageURL !== 'local_idb_background') {
                    console.log("Correcting state: Setting backgroundImageURL to local_idb_background.");
                    state.backgroundImageURL = 'local_idb_background';
                    stateNeedsUpdate = true; // Mark state as changed
                }
            } else {
                // Image NOT found in IDB
                console.log("No local background image found in IDB during init.");
                // If state mistakenly thinks there's a local image, clear it
                if (state.backgroundImageURL === 'local_idb_background') {
                    console.log("Correcting state: Clearing backgroundImageURL because local image is missing.");
                    state.backgroundImageURL = '';
                    stateNeedsUpdate = true; // Mark state as changed
                }
                // Clear cache just in case
                UIManager.RUNTIME.globalBackgroundImageCache = null;
            }
        } catch (e) {
            console.warn("Failed during IDB background image check/load", e);
            // Fallback: If DB check fails, clear local flag if set, to avoid broken state
            if (state.backgroundImageURL === 'local_idb_background') {
                 state.backgroundImageURL = '';
                 stateNeedsUpdate = true;
            }
        }
        // Save state *only* if we made corrections during hydration
        if (stateNeedsUpdate) {
            console.log("Saving corrected state after background hydration.");
            StateManager.saveState();
        }
    }

// Hydrate world map location images
    if (dbReady && state && state.worldMap && state.worldMap.grid) {
      UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
      for (const loc of state.worldMap.grid) {
        // Only try to load images that are marked as local
        if (loc.imageUrl && loc.imageUrl.startsWith('local_idb_location')) {
          const locationKey = `location::${loc.coords.x},${loc.coords.y}`;
          try {
            const blob = await DBService.getImage(locationKey);
            if (blob) {
              UIManager.RUNTIME.worldImageCache[locationKey] = URL.createObjectURL(blob);
            } else {
              // Image missing from DB, correct the state
              console.warn(`Correcting missing location image for ${locationKey}`);
              loc.imageUrl = '';
              stateNeedsUpdate = true; // Mark for saving
            }
          } catch (e) {
            console.warn(`Failed to load location image ${locationKey} from IDB`, e);
          }
        }
      }
    }

    // --- Render the app regardless of DB status (your original logic, unchanged) ---
    if (!state || Object.keys(state).length === 0) {
      const activeStory = library.stories.find(s => s.id === library.active_story_id);
      document.getElementById('story-title-input').value = activeStory ? activeStory.name : "No Story Loaded";
      document.getElementById('mobile-story-title-overlay').value = activeStory ? activeStory.name : "No Story Loaded";
      UIManager.renderChat();
    } else {
      Controller.RUNTIME.turnOfArrival = state.messageCounter; // Initialize on load
      Controller._ensureCharacterColors();
      UIManager.applyStyling();
      UIManager.renderAll();
    }
  },

  /** Sets up all global and persistent event listeners for the application. */
  setupEventListeners() {
    this.updateLayout();
    window.addEventListener('resize', debounce(() => this.updateLayout(), 100));
        
        const titleInputHandler = debounce((e) => { 
            const state = StateManager.getState();
            if(state) {
                state.narrativeName = e.target.value;
                StateManager.saveState();
            }
        }, 500);

        document.getElementById('story-title-input').addEventListener('input', titleInputHandler);
        document.getElementById('mobile-story-title-overlay').addEventListener('input', titleInputHandler);

        const hamburgerBtn = document.getElementById('hamburger-menu-button');
        if (hamburgerBtn) { hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); Controller.toggleMobileMenu(); }); }
        
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('mobile-menu');
            const btn = document.getElementById('hamburger-menu-button');
            if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) { Controller.toggleMobileMenu(); }
        });
        
        const titleTrigger = document.getElementById('title-trigger-area');
        const mobileTitle = document.getElementById('mobile-story-title-overlay');
        const showTitle = () => { if(document.body.classList.contains('layout-vertical')) { clearTimeout(UIManager.RUNTIME.titleTimeout); mobileTitle.style.opacity = '1'; } };
        const hideTitle = (immediate = false) => { if(document.body.classList.contains('layout-vertical')) { clearTimeout(UIManager.RUNTIME.titleTimeout); if (document.activeElement !== mobileTitle) { if (immediate) { mobileTitle.style.opacity = '0'; } else { UIManager.RUNTIME.titleTimeout = setTimeout(() => { mobileTitle.style.opacity = '0'; }, 2500); } } } };
        
        titleTrigger.addEventListener('mouseenter', showTitle);
        titleTrigger.addEventListener('mouseleave', () => hideTitle());
        titleTrigger.addEventListener('touchstart', (e) => { e.preventDefault(); if (mobileTitle.style.opacity === '1') { hideTitle(true); } else { showTitle(); hideTitle(); } });
        
        document.getElementById('regen-btn').addEventListener('click', () => Controller.handleRegen());
        document.getElementById('undo-btn').addEventListener('click', () => Controller.undoLastTurn());
  },

  /** Updates the body class based on screen orientation for responsive styling. */
  updateLayout() {
    if (window.innerHeight > window.innerWidth) {
      document.body.classList.add('layout-vertical');
      document.body.classList.remove('layout-horizontal');
    } else {
      document.body.classList.add('layout-horizontal');
      document.body.classList.remove('layout-vertical');
    }
    UIManager.updateSidePortrait();
  },
};
