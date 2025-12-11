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

// Start the application once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => app.init());
