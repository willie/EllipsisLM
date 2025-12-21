        const AppController = {
            RUNTIME: {
                activeSettingsTab: 'appearance',
            },

            CONSTANTS: {
                MODEL_SETTING_KEYS: [
                    'geminiApiKey', 'openRouterKey', 'openRouterModel',
                    'koboldcpp_url', 'koboldcpp_template', 'koboldcpp_min_p', 'koboldcpp_dry', 'lmstudio_url',
                    'geminiModel' // Added
                ]
            },

            /**
             * Opens a modal dialog, performing necessary setup and guard checks.
             * @param {string} modalId - The ID of the modal to open.
             * @param {*} [contextId=null] - Optional context (character ID, message index, etc.).
             */
            openModal(modalId, contextId = null) {
                // 1. Guard: Check if story is loaded for context-dependent modals
                // 'io-hub-modal' and 'story-library-modal' are allowed without an active story.
                const needsStory = ['knowledge-modal', 'characters-modal', 'settings-modal', 'world-map-modal', 'example-dialogue-modal', 'character-detail-modal', 'edit-response-modal'];

                if (needsStory.includes(modalId) && !StateManager.getLibrary().active_story_id) {
                    alert("Please load a narrative first.");
                    return;
                }

                // 2. Specific Setup Logic based on Modal ID
                switch (modalId) {
                    case 'story-library-modal':
                        // Detect layout mode and pass it down
                        const isMobile = document.body.classList.contains('layout-vertical') || (window.innerHeight > window.innerWidth);
                        UIManager.renderLibraryInterface({ layout: isMobile ? 'mobile' : 'desktop' });
                        break;

                    case 'io-hub-modal':
                        UIManager.renderIOHubModal();
                        break;

                    case 'knowledge-modal':
                        // Reset to static tab by default
                        this.activeKnowledgeTab = 'static'; // Ensure Controller state is sync'd if used elsewhere
                        UIManager.switchKnowledgeTab('static');
                        break;

                    case 'world-map-modal':
                        // Reset map selection state via WorldController
                        if (typeof WorldController !== 'undefined') {
                            WorldController.RUNTIME.selectedMapTile = null;
                            WorldController.RUNTIME.pendingMove = null;
                            WorldController.RUNTIME.selectedLocalStaticEntryId = null;
                        }
                        UIManager.switchWorldMapTab('move');
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
                        // Delegate to NarrativeController if it exists
                        if (typeof NarrativeController !== 'undefined') {
                            NarrativeController.openEditModal(contextId);
                        }
                        break;


                    case 'location-details-modal':
                        UIManager.renderLocationDetailsModal();
                        break;
                }

                // 3. Open the modal via the low-level manager
                ModalManager.open(modalId);
            },

            /**
             * Closes a modal and performs necessary cleanup.
             * @param {string} modalId 
             */
            closeModal(modalId) {
                ModalManager.close(modalId);

                // Clear viewingStoryId if closing story details
                if (modalId === 'story-details-modal' || modalId === 'story-library-modal') {
                    UIManager.RUNTIME.viewingStoryId = null;
                }

                // Cleanup Logic
                if (modalId === 'character-detail-modal') {
                    UIManager.renderCharacters();
                }

                if (modalId === 'characters-modal') {
                    UIManager.updateAICharacterSelector();
                }

                if (modalId === 'knowledge-modal') {
                    // Clean up empty fields in dynamic entries
                    if (typeof WorldController !== 'undefined') {
                        WorldController.cleanupEmptyDynamicFields();
                    }
                }
            },

            /**
             * Toggles the mobile navigation menu.
             */
            toggleMobileMenu() {
                const menu = document.getElementById('mobile-menu');
                if (menu) {
                    menu.classList.toggle('hidden');
                }
            },

            /**
             * Prepares the settings modal structure if it hasn't been initialized yet.
             */
            prepareSettingsModal() {
                const container = document.getElementById('settings-content-container');
                if (container.innerHTML.trim() !== '...') return; // Already populated

                const templates = document.getElementById('settings-templates');
                let maxHeight = 0;
                ['appearance', 'prompt', 'model'].forEach(tabName => {
                    const content = templates.querySelector(`#settings-${tabName}-content`);
                    if (content) {
                        document.body.appendChild(content); // Temporarily append to measure
                        maxHeight = Math.max(maxHeight, content.scrollHeight);
                        templates.appendChild(content); // Move it back
                    }
                });
                container.style.minHeight = `${maxHeight}px`;
            },

            /**
             * Switches tabs within the Settings modal.
             * @param {string} tabName - 'appearance', 'prompt', or 'model'.
             */
            switchSettingsTab(tabName) {
                this.RUNTIME.activeSettingsTab = tabName;
                const tabs = ['appearance', 'prompt', 'model', 'personas'];
                const container = document.getElementById('settings-content-container');
                const template = document.getElementById(`settings-${tabName}-content`);

                if (container && template) {
                    container.innerHTML = template.innerHTML;
                    const buildDisplay = document.getElementById('build-info-display');
                    if (buildDisplay && typeof APP_BUILD_TIMESTAMP !== 'undefined') {
                        buildDisplay.textContent = APP_BUILD_TIMESTAMP;
                    }
                }

                tabs.forEach(tab => {
                    const tabButton = document.getElementById(`settings-tab-${tab}`);
                    if (tabButton) {
                        if (tab === tabName) {
                            tabButton.classList.add('border-indigo-500', 'text-white');
                            tabButton.classList.remove('border-transparent', 'text-gray-400');
                        } else {
                            tabButton.classList.remove('border-indigo-500', 'text-white');
                            tabButton.classList.add('border-transparent', 'text-gray-400');
                        }
                    }
                });

                this.bindSettingsListeners();

                if (tabName === 'personas') {
                    this.renderUserPersonaList();
                } else if (tabName === 'model') {
                    this.renderSavedOpenRouterModels();
                    // NEW: Populate Gemini Models dynamically
                    this.populateGeminiModels();
                }
            },

            /**
             * Fetches available Gemini models and populates the selector.
             */
            async populateGeminiModels() {
                const selector = document.getElementById('gemini-model-selector');
                const state = StateManager.getState();
                const globalSettings = StateManager.data.globalSettings;

                // Get Key from global settings primarily
                const apiKey = globalSettings.geminiApiKey || state.geminiApiKey;

                if (!selector) return;

                // If no key, show placeholder
                if (!apiKey) {
                    selector.innerHTML = '<option value="gemini-1.5-flash">Default (Gemini 1.5 Flash)</option>';
                    return;
                }

                const currentSelection = globalSettings.geminiModel || state.geminiModel || 'gemini-1.5-flash';

                // Add loading indicator
                selector.innerHTML = '<option>Fetching available models...</option>';

                try {
                    const models = await APIService.getGeminiModels();

                    if (models.length > 0) {
                        selector.innerHTML = ''; // Clear loading
                        models.forEach(m => {
                            // m.name usually comes as "models/gemini-pro"
                            // We will use the simple ID "gemini-pro" as value to keep things clean,
                            // or keep the full name. APIService.callGemini now handles both.
                            // Let's store the CLEAN ID.
                            const simpleId = m.name.replace('models/', '');

                            const opt = document.createElement('option');
                            opt.value = simpleId;
                            opt.text = `${m.displayName} (${m.version})`;
                            selector.appendChild(opt);
                        });
                    } else {
                        // Fallback if list fails but key exists
                        selector.innerHTML = '<option value="gemini-1.5-flash">Gemini 1.5 Flash (Fallback)</option><option value="gemini-1.5-pro">Gemini 1.5 Pro</option>';
                    }

                    // Restore selection
                    // We check against the simple ID (e.g. "gemini-1.5-flash")
                    let cleanCurrent = currentSelection.replace('models/', '');
                    selector.value = cleanCurrent;

                } catch (e) {
                    console.error("Error populating models", e);
                    selector.innerHTML = '<option value="gemini-1.5-flash">Error loading list (Using Flash)</option>';
                }
            },

            /**
             * Opens the settings modal and immediately switches to a specific tab.
             */
            openSettingsToTab(tabName) {
                this.openModal('settings-modal');
                this.switchSettingsTab(tabName);
            },

            /**
             * Binds live event listeners to inputs in the Settings modal.
             * Handles bi-directional binding between UI and ReactiveStore/GlobalSettings.
             */
            bindSettingsListeners() {
                const state = ReactiveStore.state;
                const globalSettings = StateManager.data.globalSettings;

                // Retrieve defaults to handle uninitialized values (e.g. blank prompts)
                const defaultPrompts = UTILITY.getDefaultSystemPrompts();
                const defaultUI = UTILITY.getDefaultUiSettings();
                const allDefaults = { ...defaultPrompts, ...defaultUI };

                const setListener = (id, key, callback) => {
                    const input = document.getElementById(id);
                    if (!input) return;

                    const isGlobal = this.CONSTANTS.MODEL_SETTING_KEYS.includes(key);

                    // Logic to determine value: Global -> State -> Default -> Empty String
                    let val;
                    if (isGlobal) {
                        val = globalSettings[key];
                    } else {
                        val = state[key];
                        // If state value is missing/undefined, try the default
                        if (val === undefined || val === null) {
                            val = allDefaults[key];
                        }
                    }

                    input.value = (val !== undefined && val !== null) ? val : '';

                    const debouncedCallback = debounce(function (e) {
                        // Determine value
                        const val = e.target.value;

                        if (isGlobal) {
                            globalSettings[key] = val;
                            StateManager.saveGlobalSettings();
                        } else {
                            // Update Proxy State
                            state[key] = val;
                            // Explicitly trigger the save mechanism to be safe
                            if (typeof ReactiveStore.forceSave === 'function') {
                                ReactiveStore.forceSave();
                            }
                        }
                        if (callback) callback();
                    }.bind(this), 500);

                    input.addEventListener('input', debouncedCallback);
                };

                // Helper: Bind range sliders
                const setupSlider = (sliderId, valueId, stateKey, callback = null) => {
                    const slider = document.getElementById(sliderId);
                    const valueDisplay = document.getElementById(valueId);
                    if (!slider || !valueDisplay) return;

                    const isGlobal = this.CONSTANTS.MODEL_SETTING_KEYS.includes(stateKey);
                    const currentValue = isGlobal ? globalSettings[stateKey] : state[stateKey];

                    slider.value = currentValue;
                    valueDisplay.textContent = slider.value;

                    slider.addEventListener('input', (e) => {
                        const newValue = parseFloat(e.target.value);

                        if (isGlobal) {
                            globalSettings[stateKey] = newValue;
                        } else {
                            state[stateKey] = newValue;
                        }

                        valueDisplay.textContent = e.target.value;
                        if (callback) callback();
                    });

                    slider.addEventListener('change', () => {
                        if (isGlobal) StateManager.saveGlobalSettings();
                        // ReactiveStore auto-saves state on set, so no manual save needed for local state
                    });
                };

                // --- Bindings: Model Tab ---
                if (document.getElementById('gemini-api-key-input')) setListener('gemini-api-key-input', 'geminiApiKey');
                if (document.getElementById('openrouter-api-key-input')) setListener('openrouter-api-key-input', 'openRouterKey');
                if (document.getElementById('openrouter-model-input')) setListener('openrouter-model-input', 'openRouterModel');
                if (document.getElementById('koboldcpp-min-p-slider')) setupSlider('koboldcpp-min-p-slider', 'koboldcpp-min-p-value', 'koboldcpp_min_p');
                if (document.getElementById('koboldcpp-dry-slider')) setupSlider('koboldcpp-dry-slider', 'koboldcpp-dry-value', 'koboldcpp_dry');
                if (document.getElementById('koboldcpp-url-input')) setListener('koboldcpp-url-input', 'koboldcpp_url');
                if (document.getElementById('lmstudio-url-input')) setListener('lmstudio-url-input', 'lmstudio_url');
                // Gemini Model Selector (Just bind listener, population handled in switchSettingsTab)
                if (document.getElementById('gemini-model-selector')) {
                    setListener('gemini-model-selector', 'geminiModel');
                }

                // --- Bindings: Appearance Tab ---
                // Background Image Handlers (Delegating to LibraryController if available)
                document.getElementById('background-image-upload')?.addEventListener('change', (e) => {
                    if (typeof LibraryController !== 'undefined') LibraryController.handleBackgroundImageUpload(e);
                });
                document.getElementById('background-image-clear')?.addEventListener('click', () => {
                    if (typeof LibraryController !== 'undefined') LibraryController.clearBackgroundImage();
                });

                // Visual Settings
                if (document.getElementById('chat-text-color')) setListener('chat-text-color', 'chatTextColor');
                if (document.getElementById('blur-slider')) setupSlider('blur-slider', 'blur-value', 'backgroundBlur');
                if (document.getElementById('text-size-slider')) setupSlider('text-size-slider', 'text-size-value', 'textSize');
                if (document.getElementById('bubble-image-size-slider')) setupSlider('bubble-image-size-slider', 'bubble-image-size-value', 'bubbleImageSize');

                // Background Hint Update
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

                // --- Bindings: Prompt Tab ---
                if (document.getElementById('system-prompt-input')) setListener('system-prompt-input', 'system_prompt');
                if (document.getElementById('event-master-prob-input')) {
                    setListener('event-master-prob-input', 'event_master_probability');
                    // Ensure default display if missing
                    const input = document.getElementById('event-master-prob-input');
                    if (input.value === '' || input.value === undefined) input.value = 10;
                }
                if (document.getElementById('prompt-persona-gen-input')) setListener('prompt-persona-gen-input', 'prompt_persona_gen');
                if (document.getElementById('prompt-world-map-gen-input')) setListener('prompt-world-map-gen-input', 'prompt_world_map_gen');
                if (document.getElementById('prompt-location-gen-input')) setListener('prompt-location-gen-input', 'prompt_location_gen');
                if (document.getElementById('prompt-entry-gen-input')) setListener('prompt-entry-gen-input', 'prompt_entry_gen');
                if (document.getElementById('prompt-location-memory-gen-input')) setListener('prompt-location-memory-gen-input', 'prompt_location_memory_gen');

                // Toggle for Analysis
                const analysisToggle = document.getElementById('enable-analysis-toggle');
                if (analysisToggle) {
                    analysisToggle.checked = state.enableAnalysis !== false; // Default true
                    analysisToggle.addEventListener('change', (e) => {
                        state.enableAnalysis = e.target.checked;
                        if (typeof ReactiveStore.forceSave === 'function') ReactiveStore.forceSave();
                    });
                }

                // Font Selector
                const fontSelector = document.getElementById('font-selector');
                if (fontSelector) {
                    fontSelector.value = state.font;
                    fontSelector.addEventListener('change', (e) => this.changeFont(e.target.value));
                }

                // Markdown Color & Font Bindings
                [
                    'md_h1_color', 'md_h2_color', 'md_h3_color', 'md_bold_color', 'md_italic_color', 'md_quote_color',
                    'md_h1_font', 'md_h2_font', 'md_h3_font', 'md_bold_font', 'md_italic_font', 'md_quote_font'
                ].forEach(key => {
                    // The HTML IDs use dashes, the state keys use underscores
                    const inputId = key.replace(/_/g, '-') + '-input';
                    if (document.getElementById(inputId)) setListener(inputId, key);
                });

                // Kobold Template Selector
                const templateSelector = document.getElementById('koboldcpp-template-selector');
                if (templateSelector) {
                    templateSelector.value = globalSettings.koboldcpp_template || 'none';
                    templateSelector.addEventListener('change', (e) => {
                        globalSettings.koboldcpp_template = e.target.value;
                        StateManager.saveGlobalSettings();
                    });
                }

                // Bubble Opacity
                const opacitySlider = document.getElementById('bubble-opacity-slider');
                if (opacitySlider) {
                    const opacityValue = document.getElementById('bubble-opacity-value');
                    opacitySlider.value = state.bubbleOpacity;
                    opacityValue.textContent = `${Math.round(state.bubbleOpacity * 100)}%`;
                    opacitySlider.addEventListener('input', (e) => {
                        state.bubbleOpacity = parseFloat(e.target.value);
                        opacityValue.textContent = `${Math.round(state.bubbleOpacity * 100)}%`;
                    });
                }

                // Radio Buttons
                document.querySelectorAll('input[name="imageDisplayMode"]').forEach(radio => {
                    radio.checked = state.characterImageMode === radio.value;
                    radio.addEventListener('change', (e) => this.setCharacterImageMode(e.target.value));
                });

                // API Provider Dropdown
                const apiProviderSelect = document.getElementById('api-provider-selector');
                if (apiProviderSelect) {
                    // Use Global Settings as source of truth, fallback to 'gemini'
                    const activeProvider = globalSettings.apiProvider || 'gemini';
                    apiProviderSelect.value = activeProvider;

                    apiProviderSelect.addEventListener('change', (e) => {
                        this.setApiProvider(e.target.value);
                    });
                }

                // Settings Visibility Toggles
                const geminiSettings = document.getElementById('gemini-settings');
                const openrouterSettings = document.getElementById('openrouter-settings');
                const koboldcppSettings = document.getElementById('koboldcpp-settings');
                const lmstudioSettings = document.getElementById('lmstudio-settings');

                const currentProvider = globalSettings.apiProvider || 'gemini';

                if (geminiSettings) geminiSettings.style.display = currentProvider === 'gemini' ? 'block' : 'none';
                if (openrouterSettings) openrouterSettings.style.display = currentProvider === 'openrouter' ? 'block' : 'none';
                if (koboldcppSettings) koboldcppSettings.style.display = currentProvider === 'koboldcpp' ? 'block' : 'none';
                if (lmstudioSettings) lmstudioSettings.style.display = currentProvider === 'lmstudio' ? 'block' : 'none';

                // Toggle for Portrait Panel
                const portraitToggle = document.getElementById('show-portrait-panel-toggle');
                if (portraitToggle) {
                    // Use Global Settings for UI preference, or Story settings? usually UI pref is global
                    portraitToggle.checked = globalSettings.showPortraitPanel !== false; // Default true
                    portraitToggle.addEventListener('change', (e) => {
                        globalSettings.showPortraitPanel = e.target.checked;
                        StateManager.saveGlobalSettings();
                        if (typeof app !== 'undefined' && app.updateLayout) {
                            app.updateLayout(); // Trigger immediate layout refresh
                        }
                    });
                }
            },


            /**
             * Helper: Updates font setting via Reactive Store.
             */
            changeFont(font) {
                ReactiveStore.state.font = font;
            },

            /**
             * Helper: Updates character image display mode via Reactive Store.
             */
            setCharacterImageMode(mode) {
                ReactiveStore.state.characterImageMode = mode;
            },

            /**
             * Helper: Updates API Provider setting (Global & Local) and refreshes settings view.
             */
            setApiProvider(provider) {
                // Update live state
                ReactiveStore.state.apiProvider = provider;

                // Update global state
                StateManager.data.globalSettings.apiProvider = provider;
                StateManager.saveGlobalSettings();

                // Re-bind to show/hide correct sections
                this.bindSettingsListeners();
            },

            // --- User Persona Methods ---

            /**
             * Creates a new user persona with default values.
             */
            addUserPersona() {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.userPersonas) globalSettings.userPersonas = [];

                const newPersona = {
                    id: UTILITY.uuid(),
                    name: "New Persona",
                    short_description: "Brief summary.",
                    description: "Full description.",
                    model_instructions: "Write a response for {character}...",
                    tags: []
                };

                globalSettings.userPersonas.push(newPersona);
                StateManager.saveGlobalSettings();
                this.RUNTIME.selectedPersonaId = newPersona.id;
                this.renderUserPersonaList();
            },

            /**
             * Deletes a user persona by ID after confirmation.
             * @param {string} id - The ID of the persona to delete.
             */
            deleteUserPersona(id) {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.userPersonas) return;

                if (confirm("Delete this persona?")) {
                    globalSettings.userPersonas = globalSettings.userPersonas.filter(p => p.id !== id);
                    if (this.RUNTIME.selectedPersonaId === id) this.RUNTIME.selectedPersonaId = null;
                    StateManager.saveGlobalSettings();
                    this.renderUserPersonaList();
                }
            },

            /**
             * Selects a user persona for editing.
             * @param {string} id - The ID of the persona to select.
             */
            selectUserPersona(id) {
                this.RUNTIME.selectedPersonaId = id;
                this.renderUserPersonaList(); // Update visual selection state
            },

            /**
             * Updates a specific field of a user persona.
             * @param {string} id - The ID of the persona.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateUserPersonaField(id, field, value) {
                const globalSettings = StateManager.data.globalSettings;
                const persona = globalSettings.userPersonas.find(p => p.id === id);
                if (persona) {
                    if (field === 'tags') {
                        persona.tags = value.split(',').map(t => t.trim()).filter(Boolean);
                    } else {
                        persona[field] = value;
                    }
                    StateManager.saveGlobalSettings();
                    // If name changed, update list
                    if (field === 'name') this.renderUserPersonaList(true);
                }
            },

            /**
             * Renders the list of user personas in the settings modal.
             * @param {boolean} [preserveDetails=false] - Whether to skip re-rendering details.
             */
            renderUserPersonaList(preserveDetails = false) {
                const globalSettings = StateManager.data.globalSettings;
                const personas = globalSettings.userPersonas || [];
                const listContainer = document.getElementById('user-personas-list');

                listContainer.innerHTML = personas.map(p => `
            <div onclick="AppController.selectUserPersona('${p.id}')" class="p-3 rounded-lg cursor-pointer ${this.RUNTIME.selectedPersonaId === p.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} mb-1 transition-colors">
                <h4 class="font-semibold truncate">${p.name}</h4>
                <p class="text-xs text-gray-300 truncate">${p.short_description}</p>
            </div>
        `).join('');

                if (!preserveDetails) this.renderUserPersonaDetails();
            },

            /**
             * Renders the details form for the selected user persona.
             * Handles image hydration and display.
             */
            async renderUserPersonaDetails() {
                const container = document.getElementById('user-persona-details');
                const globalSettings = StateManager.data.globalSettings;
                const persona = (globalSettings.userPersonas || []).find(p => p.id === this.RUNTIME.selectedPersonaId);

                if (!persona) {
                    container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a persona to edit.</div>`;
                    return;
                }

                // Hydrate image if missing from cache
                if (!UIManager.RUNTIME.characterImageCache[persona.id]) {
                    try {
                        const blob = await DBService.getImage(persona.id);
                        if (blob) UIManager.RUNTIME.characterImageCache[persona.id] = URL.createObjectURL(blob);
                    } catch (e) { /* Ignore */ }
                }

                const imgSrc = UIManager.RUNTIME.characterImageCache[persona.id] || persona.image_url;
                // Standard placeholder (URL encoded)
                const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234b5563' opacity='0.25'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
                const displayImage = imgSrc ? imgSrc : placeholder;

                container.innerHTML = `
            <div class="flex flex-col gap-4">
                <div class="flex justify-between items-center pb-2 border-b border-gray-700">
                    <h3 class="text-xl font-bold">Edit Persona</h3>
                    <div class="flex gap-2">
                        <button onclick="AppController.applyUserPersonaToCurrentStory('${persona.id}')" class="bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold py-1 px-3 rounded">Add to Roleplay</button>
                        <button onclick="AppController.deleteUserPersona('${persona.id}')" class="bg-red-900/50 hover:bg-red-700/80 text-red-200 text-sm font-bold py-1 px-3 rounded">Delete</button>
                    </div>
                </div>

                <div class="flex items-start gap-4">
                    <div class="w-24 h-32 flex-shrink-0 bg-gray-800 rounded-lg overflow-hidden border border-gray-600 relative group">
                        <img src="${displayImage}" class="w-full h-full object-cover">
                        <label class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity text-xs text-white font-bold">
                            Change
                            <input type="file" accept="image/*" onchange="AppController.handleUserPersonaImageUpload(event, '${persona.id}')" class="hidden">
                        </label>
                    </div>
                    <div class="flex-grow space-y-4">
                        <div>
                            <label class="block text-sm font-bold text-gray-400 mb-1">Name</label>
                            <input type="text" value="${persona.name}" oninput="AppController.updateUserPersonaField('${persona.id}', 'name', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded focus:border-indigo-500">
                        </div>
                        <div>
                            <label class="block text-sm font-bold text-gray-400 mb-1">Short Description</label>
                            <input type="text" value="${persona.short_description}" oninput="AppController.updateUserPersonaField('${persona.id}', 'short_description', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded focus:border-indigo-500">
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-400 mb-1">Full Description</label>
                    <textarea oninput="AppController.updateUserPersonaField('${persona.id}', 'description', this.value)" class="w-full h-32 bg-black/30 border-gray-600 p-2 rounded resize-y">${persona.description}</textarea>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-400 mb-1">Model Instructions</label>
                    <textarea oninput="AppController.updateUserPersonaField('${persona.id}', 'model_instructions', this.value)" class="w-full h-24 bg-black/30 border-gray-600 p-2 rounded resize-y">${persona.model_instructions}</textarea>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-400 mb-1">Tags (comma-separated)</label>
                    <input type="text" value="${(persona.tags || []).join(', ')}" oninput="AppController.updateUserPersonaField('${persona.id}', 'tags', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded focus:border-indigo-500">
                </div>
            </div>
        `;
            },

            /**
             * Handles the upload of a custom image for a user persona.
             * Processes the image and saves it to IndexedDB.
             * @param {Event} event - The file input change event.
             * @param {string} personaId - The ID of the persona.
             */
            async handleUserPersonaImageUpload(event, personaId) {
                const file = event.target.files[0];
                if (!file) return;

                UIManager.showLoadingSpinner('Saving persona image...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    await DBService.saveImage(personaId, blob);

                    // Update Cache
                    if (UIManager.RUNTIME.characterImageCache[personaId]) {
                        URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[personaId]);
                    }
                    UIManager.RUNTIME.characterImageCache[personaId] = URL.createObjectURL(blob);

                    // Update Data Object marker
                    this.updateUserPersonaField(personaId, 'image_url', `local_idb_persona_${personaId}`);

                    // Refresh UI
                    this.renderUserPersonaDetails();
                } catch (e) {
                    alert("Image upload failed: " + e.message);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Applies the selected user persona to the current story.
             * Demotes the current user to an NPC and creates a new User character.
             * @param {string} personaId - The ID of the persona to apply.
             */
            async applyUserPersonaToCurrentStory(personaId) {
                const state = ReactiveStore.state;
                if (!state || !state.characters) {
                    alert("No active story loaded.");
                    return;
                }

                const globalSettings = StateManager.data.globalSettings;
                const persona = globalSettings.userPersonas.find(p => p.id === personaId);
                if (!persona) return;

                if (!confirm(`Add "${persona.name}" as the new User? The current User character will be saved as an inactive NPC.`)) {
                    return;
                }

                // 1. Demote existing User(s)
                state.characters.forEach(c => {
                    if (c.is_user) {
                        c.is_user = false;
                        c.is_active = false;
                    }
                });

                // 2. Create New Character Object
                const newCharId = UTILITY.uuid();

                // Clone Image Logic:
                // If persona has an image in IDB, copy it to the new character ID
                // This ensures the story character has an independent copy of the image
                let newImageUrl = "";
                try {
                    const personaBlob = await DBService.getImage(persona.id);
                    if (personaBlob) {
                        await DBService.saveImage(newCharId, personaBlob);
                        newImageUrl = `local_idb_${newCharId}`;
                        // Pre-cache for immediate display
                        UIManager.RUNTIME.characterImageCache[newCharId] = URL.createObjectURL(personaBlob);
                    }
                } catch (e) {
                    console.warn("Failed to clone persona image:", e);
                }

                const newChar = {
                    id: newCharId,
                    name: persona.name,
                    short_description: persona.short_description || "User Persona",
                    description: persona.description || "",
                    model_instructions: persona.model_instructions || `Act as ${persona.name}.`,
                    tags: [...(persona.tags || [])],
                    image_url: newImageUrl,
                    extra_portraits: [],
                    is_user: true,
                    is_active: true,
                    is_narrator: false,
                    color: { base: '#4b5563', bold: '#e5e7eb' }
                };

                // 3. Add to Story
                state.characters.push(newChar);

                // 4. Save and Refresh UI
                await ReactiveStore.forceSave();
                UIManager.renderCharacters();
                UIManager.updateAICharacterSelector();

                alert(`"${persona.name}" is now the active User.`);
            },
            // --- OpenRouter Saved Models Logic ---

            /**
             * Saves the current OpenRouter model string to the global settings.
             */
            saveOpenRouterModel() {
                const input = document.getElementById('openrouter-model-input');
                if (!input) return;

                const value = input.value.trim();
                if (!value) return;

                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedOpenRouterModels) globalSettings.savedOpenRouterModels = [];

                // Avoid duplicates
                if (!globalSettings.savedOpenRouterModels.includes(value)) {
                    globalSettings.savedOpenRouterModels.push(value);
                    StateManager.saveGlobalSettings();
                    this.renderSavedOpenRouterModels();
                }
            },

            /**
             * Deletes a saved OpenRouter model from the global settings.
             * @param {string} modelName - The name of the model to delete.
             */
            deleteOpenRouterModel(modelName) {
                const globalSettings = StateManager.data.globalSettings;
                if (!globalSettings.savedOpenRouterModels) return;

                if (confirm(`Remove "${modelName}" from saved models?`)) {
                    globalSettings.savedOpenRouterModels = globalSettings.savedOpenRouterModels.filter(m => m !== modelName);
                    StateManager.saveGlobalSettings();
                    this.renderSavedOpenRouterModels();
                }
            },

            /**
             * Selects a saved OpenRouter model and updates the input field.
             * @param {string} modelName - The name of the model to select.
             */
            selectOpenRouterModel(modelName) {
                const input = document.getElementById('openrouter-model-input');
                if (input) {
                    input.value = modelName;
                    // Manually trigger the input event to update the Global Settings via the listener
                    input.dispatchEvent(new Event('input'));
                }
            },

            /**
             * Renders the list of saved OpenRouter models in the settings modal.
             */
            renderSavedOpenRouterModels() {
                const container = document.getElementById('openrouter-saved-models-list');
                if (!container) return;

                const globalSettings = StateManager.data.globalSettings;
                const models = globalSettings.savedOpenRouterModels || [];

                if (models.length === 0) {
                    container.innerHTML = '<span class="text-xs text-gray-500 italic">No saved models.</span>';
                    return;
                }

                container.innerHTML = models.map(model => `
            <div class="inline-flex items-center bg-black/30 border border-gray-600 rounded-lg overflow-hidden">
                <button onclick="AppController.selectOpenRouterModel('${model}')" class="px-3 py-1 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors truncate max-w-[200px]" title="Use this model">
                    ${model}
                </button>
                <button onclick="AppController.deleteOpenRouterModel('${model}')" class="px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-black/20 border-l border-gray-600 transition-colors" title="Remove">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `).join('');
            },

            // --- OpenRouter Model Browser ---

            /**
             * Opens the OpenRouter model browser modal and fetches available models.
             */
            async openOpenRouterModelBrowser() {
                const listContainer = document.getElementById('openrouter-model-list');
                const searchInput = document.getElementById('openrouter-model-search');

                // Reset search input
                if (searchInput) {
                    searchInput.value = '';
                }

                // Show loading state
                if (listContainer) {
                    listContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><span>Loading models...</span></div>';
                }

                this.openModal('openrouter-model-modal');

                try {
                    const models = await APIService.fetchOpenRouterModels();
                    this._openRouterModelsList = models;
                    this._renderOpenRouterModelList(models);

                    // Setup search handler with debounce
                    if (searchInput) {
                        searchInput.oninput = debounce((e) => {
                            const query = e.target.value.toLowerCase().trim();
                            const filtered = query ? models.filter(m =>
                                m.id.toLowerCase().includes(query) ||
                                (m.name && m.name.toLowerCase().includes(query))
                            ) : models;
                            this._renderOpenRouterModelList(filtered);
                        }, 200);
                    }
                } catch (error) {
                    console.error('Failed to fetch OpenRouter models:', error);
                    if (listContainer) {
                        listContainer.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-red-400 p-4">
                            <span class="text-center">Failed to load models.</span>
                            <span class="text-center text-sm mt-1">${error.message}</span>
                            <button onclick="AppController.openOpenRouterModelBrowser()" class="mt-4 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-white">Retry</button>
                        </div>`;
                    }
                }
            },

            /**
             * Renders the OpenRouter model list in the browser modal.
             * @param {Array} models - Array of model objects to render.
             */
            _renderOpenRouterModelList(models) {
                const listContainer = document.getElementById('openrouter-model-list');
                if (!listContainer) return;

                if (!models || models.length === 0) {
                    listContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><span>No models found</span></div>';
                    return;
                }

                const global = StateManager.data.globalSettings;
                const state = StateManager.getState();
                const currentModel = global.openRouterModel || state.openRouterModel;

                // Sort models: selected first, then alphabetically by name
                const sortedModels = [...models].sort((a, b) => {
                    if (a.id === currentModel) return -1;
                    if (b.id === currentModel) return 1;
                    return (a.name || a.id).localeCompare(b.name || b.id);
                });

                const formatPrice = (price) => {
                    if (!price || price === 0) return 'Free';
                    const perMillion = parseFloat(price) * 1000000;
                    if (perMillion < 0.01) return '<$0.01/M';
                    return `$${perMillion.toFixed(2)}/M`;
                };

                listContainer.innerHTML = sortedModels.map(model => {
                    const isSelected = model.id === currentModel;
                    const promptPrice = formatPrice(model.pricing?.prompt);
                    const completionPrice = formatPrice(model.pricing?.completion);
                    const contextLength = model.context_length ? `${Math.round(model.context_length / 1024)}K ctx` : '';

                    return `
                        <div class="p-3 rounded-lg cursor-pointer transition-colors mb-1 ${isSelected ? 'bg-indigo-600/50 border border-indigo-500' : 'bg-gray-700/50 hover:bg-gray-600/50 border border-transparent'}" onclick="AppController._selectModelFromBrowser('${model.id}')">
                            <div class="flex justify-between items-start">
                                <div class="flex-1 min-w-0">
                                    <div class="font-medium text-white truncate">${model.name || model.id}</div>
                                    <div class="text-xs text-gray-400 truncate">${model.id}</div>
                                </div>
                                ${isSelected ? '<span class="ml-2 text-indigo-300 text-sm whitespace-nowrap">Current</span>' : ''}
                            </div>
                            <div class="flex gap-3 mt-2 text-xs text-gray-400">
                                <span title="Input price per million tokens">In: ${promptPrice}</span>
                                <span title="Output price per million tokens">Out: ${completionPrice}</span>
                                ${contextLength ? `<span title="Context window">${contextLength}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            },

            /**
             * Selects a model from the browser and populates the input field.
             * @param {string} modelId - The model ID to select.
             */
            _selectModelFromBrowser(modelId) {
                const input = document.getElementById('openrouter-model-input');
                if (input) {
                    input.value = modelId;
                    // Trigger input event to sync with globalSettings
                    input.dispatchEvent(new Event('input'));
                }
                // Also update ReactiveStore.state directly (like apiProvider does)
                ReactiveStore.state.openRouterModel = modelId;
                this.closeModal('openrouter-model-modal');
            }
        };

        const LibraryController = {

            // --- Story Management ---

            /**
             * Creates a new, blank story in the library.
             */
            async createNewStory() {
                UIManager.showLoadingSpinner('Creating new story...');
                try {
                    // 1. Call the service to create and save the story in the DB
                    const newStory = await StoryService.createNewStory();

                    // 2. Add the new story (which is a stub) to the in-memory library
                    const library = StateManager.getLibrary();
                    library.stories.push(newStory);

                    // 3. Clear active session to ensure clean slate
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
             * Renames a scenario within a story.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async renameScenario(storyId, scenarioId) {
                const story = await DBService.getStory(storyId);
                if (!story) return;

                const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                if (!scenario) return;

                const newName = prompt("Enter new name for this scenario:", scenario.name);
                if (!newName || newName.trim() === "") return;

                try {
                    scenario.name = newName.trim();
                    story.last_modified = new Date().toISOString();

                    // 1. Save to DB
                    await DBService.saveStory(story);

                    // 2. Update In-Memory Library Stub
                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    // 3. Refresh UI
                    UIManager.openStoryDetails(storyId);

                } catch (e) {
                    console.error("Failed to rename scenario:", e);
                    alert(`Error: ${e.message}`);
                }
            },

            /**
             * Deletes a story and all associated data.
             * @param {string} storyId - The ID of the story to delete.
             */
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
                        // Close modal if open
                        AppController.closeModal('story-details-modal');
                        UIManager.renderLibraryInterface(); // Refresh library list
                    }
                } catch (e) {
                    console.error("Failed to delete story:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Duplicates an entire story structure, including narratives and scenarios.
             * @param {string} storyId - The ID of the story to duplicate.
             */
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

                    // 2. Create new story object
                    const newStory = JSON.parse(JSON.stringify(originalStory));
                    newStory.id = UTILITY.uuid();
                    newStory.name = `${originalStory.name || 'Untitled Story'} (Copy)`;
                    newStory.last_modified = new Date().toISOString();
                    newStory.created_date = new Date().toISOString();

                    // Create ID Mapping for Characters
                    // We must track which Old ID maps to which New ID so we can update the chat history
                    const charIdMap = {};
                    (newStory.characters || []).forEach(c => {
                        const oldId = c.id;
                        const newId = UTILITY.uuid();
                        c.id = newId;
                        charIdMap[oldId] = newId;
                    });

                    // Helper to remap IDs in a history array
                    const remapHistory = (history) => {
                        if (!Array.isArray(history)) return;
                        history.forEach(msg => {
                            if (msg.character_id && charIdMap[msg.character_id]) {
                                msg.character_id = charIdMap[msg.character_id];
                            }
                        });
                    };

                    // Helper to remap active character lists
                    const remapActiveIds = (ids) => {
                        if (!Array.isArray(ids)) return ids;
                        return ids.map(id => charIdMap[id] || id);
                    };

                    // 3. Create new narratives with new IDs AND Remapped Character References
                    const newNarratives = [];
                    const newNarrativeStubs = [];

                    for (const narrative of originalNarratives) {
                        if (!narrative) continue;
                        const newNarrative = JSON.parse(JSON.stringify(narrative));
                        newNarrative.id = UTILITY.uuid();

                        // Update Chat History to point to new Character IDs
                        if (newNarrative.state && newNarrative.state.chat_history) {
                            remapHistory(newNarrative.state.chat_history);
                        }

                        // Update Active Character List
                        if (newNarrative.active_character_ids) {
                            newNarrative.active_character_ids = remapActiveIds(newNarrative.active_character_ids);
                        }

                        newNarratives.push(newNarrative);
                        newNarrativeStubs.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });
                    }

                    // 4. Update new story with new narrative stubs
                    newStory.narratives = newNarrativeStubs;

                    // 5. Update Scenarios and other IDs
                    (newStory.scenarios || []).forEach(s => {
                        s.id = UTILITY.uuid();
                        // Update Scenario Example Dialogue and Active Lists
                        remapHistory(s.example_dialogue);
                        if (s.active_character_ids) {
                            s.active_character_ids = remapActiveIds(s.active_character_ids);
                        }
                    });

                    (newStory.dynamic_entries || []).forEach(e => e.id = UTILITY.uuid());

                    // 6. Save all new data to DB
                    await DBService.saveStory(newStory);
                    await Promise.all(newNarratives.map(n => DBService.saveNarrative(n)));

                    // 7. Update in-memory library
                    this.updateSearchIndex(newStory);
                    const library = StateManager.getLibrary();
                    library.stories.push(newStory);
                    StateManager.updateTagCache();

                    UIManager.renderLibraryInterface();
                    UIManager.openStoryDetails(newStory.id);

                } catch (e) {
                    console.error("Failed to duplicate story:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Updates a specific field of a story object (debounced).
             * This handles updating both the Database and the In-Memory Library Stub.
             * @param {string} storyId - The ID of the story.
             * @param {string} field - The field to update.
             * @param {*} value - The new value.
             */
            updateStoryField: debounce(async function (storyId, field, value) {
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
                    if (field === 'creator_notes' || field === 'name') {
                        this.updateSearchIndex(storyInLibrary);
                    }

                    // 4. If this is the active story, sync ReactiveStore to show changes live (e.g. title bar)
                    if (storyId === library.active_story_id && typeof ReactiveStore !== 'undefined') {
                        if (field === 'name') ReactiveStore.state.name = value;
                        // Note: creator_notes isn't usually reactive in the UI, but we could set it if needed
                    }

                } catch (e) {
                    console.error(`Failed to update story field ${field}:`, e);
                }
            }, 300),

            /**
             * Updates a story's tags (debounced).
             * @param {string} storyId - The ID of the story.
             * @param {string} value - The comma-separated tags string.
             */
            updateStoryTags: debounce(async function (storyId, value) {
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

                    // 4. Sync ReactiveStore if active
                    if (storyId === library.active_story_id && typeof ReactiveStore !== 'undefined') {
                        ReactiveStore.state.tags = tags;
                    }

                } catch (e) {
                    console.error("Failed to update story tags:", e);
                }
            }, 500),

            // --- Scenario & Narrative Management ---

            /**
             * Loads a specific narrative and reloads the page.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            loadNarrative(storyId, narrativeId) {
                const library = StateManager.getLibrary();
                library.active_story_id = storyId;
                library.active_narrative_id = narrativeId;
                StateManager.saveLibrary(); // Save IDs to localStorage
                window.location.reload();
            },

            /**
             * Creates a new narrative from a scenario template.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async createNarrativeFromScenario(storyId, scenarioId) {
                UIManager.showLoadingSpinner('Creating new narrative...');
                try {
                    // 1. Force save current state to be safe
                    if (typeof ReactiveStore !== 'undefined') await ReactiveStore.forceSave();

                    // 2. Block auto-save to prevent race condition on reload
                    if (typeof ReactiveStore !== 'undefined' && ReactiveStore.blockAutoSave) {
                        ReactiveStore.blockAutoSave();
                    }

                    const newNarrative = await StoryService.createNarrativeFromScenario(storyId, scenarioId);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);

                    if (storyInLibrary) {
                        if (!storyInLibrary.narratives) storyInLibrary.narratives = [];
                        storyInLibrary.narratives.push({
                            id: newNarrative.id,
                            name: newNarrative.name,
                            last_modified: newNarrative.last_modified
                        });
                        storyInLibrary.last_modified = new Date().toISOString();
                    }

                    this.loadNarrative(storyId, newNarrative.id);

                } catch (error) {
                    UIManager.hideLoadingSpinner();
                    console.error("Failed to create narrative from scenario:", error);
                    alert(`Error: ${error.message}`);
                }
            },

            /**
             * Deletes a narrative and its history.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            async deleteNarrative(storyId, narrativeId) {
                const proceed = await UIManager.showConfirmationPromise('Are you sure you want to permanently delete this narrative and all its chat history?');
                if (!proceed) return;

                UIManager.showLoadingSpinner('Deleting narrative...');
                try {
                    const updatedStory = await StoryService.deleteNarrative(storyId, narrativeId);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.narratives = updatedStory.narratives;
                        storyInLibrary.last_modified = updatedStory.last_modified;
                    }

                    if (library.active_narrative_id === narrativeId) {
                        library.active_narrative_id = null;
                        library.active_story_id = null;
                        StateManager.saveLibrary();
                        window.location.reload();
                    } else {
                        StateManager.saveLibrary();
                        UIManager.openStoryDetails(storyId); // Refresh UI
                    }
                } catch (e) {
                    console.error("Failed to delete narrative:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Duplicates an existing narrative.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            async duplicateNarrative(storyId, narrativeId) {
                UIManager.showLoadingSpinner('Duplicating narrative...');
                try {
                    const story = await DBService.getStory(storyId);
                    const narrative = await DBService.getNarrative(narrativeId);
                    if (!story || !narrative) throw new Error("Data not found.");

                    const newNarrative = JSON.parse(JSON.stringify(narrative));
                    newNarrative.id = UTILITY.uuid();
                    newNarrative.name = `${narrative.name} (Copy)`;
                    newNarrative.last_modified = new Date().toISOString();

                    await DBService.saveNarrative(newNarrative);

                    story.narratives.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });
                    story.last_modified = new Date().toISOString();
                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.narratives = story.narratives;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Failed to duplicate narrative:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Deletes a scenario from a story.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async deleteScenario(storyId, scenarioId) {
                const story = await DBService.getStory(storyId);
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
                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Failed to delete scenario:", e);
                    alert(`Error: ${e.message}`);
                }
            },

            /**
             * Duplicates an existing scenario.
             * @param {string} storyId - The ID of the story.
             * @param {string} scenarioId - The ID of the scenario.
             */
            async duplicateScenario(storyId, scenarioId) {
                UIManager.showLoadingSpinner('Duplicating scenario...');
                try {
                    const story = await DBService.getStory(storyId);
                    const scenario = story.scenarios.find(sc => sc.id === scenarioId);
                    if (!story || !scenario) throw new Error("Data not found.");

                    const newScenario = JSON.parse(JSON.stringify(scenario));
                    newScenario.id = UTILITY.uuid();
                    newScenario.name = `${scenario.name} (Copy)`;
                    story.scenarios.push(newScenario);
                    story.last_modified = new Date().toISOString();

                    await DBService.saveStory(story);

                    const library = StateManager.getLibrary();
                    const storyInLibrary = library.stories.find(s => s.id === storyId);
                    if (storyInLibrary) {
                        storyInLibrary.scenarios = story.scenarios;
                        storyInLibrary.last_modified = story.last_modified;
                    }

                    UIManager.openStoryDetails(storyId);
                } catch (e) {
                    console.error("Failed to duplicate scenario:", e);
                    alert(`Error: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Promotes a narrative to a scenario, saving its current state as a template.
             * @param {string} storyId - The ID of the story.
             * @param {string} narrativeId - The ID of the narrative.
             */
            async elevateNarrativeToScenario(storyId, narrativeId) {
                UIManager.showLoadingSpinner('Creating scenario from chat...');
                try {
                    // Re-use Controller logic logic, but ensure it's fully encapsulated here
                    const story = await DBService.getStory(storyId);
                    const narrative = await DBService.getNarrative(narrativeId);
                    if (!story || !narrative) throw new Error("Data not found.");

                    const firstMessage = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
                    const exampleDialogue = (narrative.state.chat_history || []).filter(m => m.isHidden);
                    let activeIDs = narrative.active_character_ids || (story.characters || []).map(c => c.id);

                    const newScenario = {
                        id: UTILITY.uuid(),
                        name: `${narrative.name} (Scenario)`,
                        message: firstMessage ? firstMessage.content : "The story continues...",
                        static_entries: JSON.parse(JSON.stringify(narrative.state.static_entries || [])),
                        worldMap: JSON.parse(JSON.stringify(narrative.state.worldMap || {})),
                        example_dialogue: JSON.parse(JSON.stringify(exampleDialogue)),
                        active_character_ids: activeIDs,
                        // Snapshot dynamic entries and prompts from current story settings
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

            // === STORY ARCHITECT ===

            RUNTIME_GEN: {
                draftStory: null,
                userPrompt: "",
                conceptData: null
            },

            /**
             * Phase 1 of Story Architect: Generates the initial story concept from a user prompt.
             * @param {Event} event - The click event from the Generate button.
             */
            async generateStoryPhase1(event) {
                const input = document.getElementById('gen-story-prompt');
                const userPrompt = input.value.trim();
                if (!userPrompt) { alert("Please enter a prompt."); return; }

                this.RUNTIME_GEN.userPrompt = userPrompt;

                // 1. VISUAL FEEDBACK: Disable Button
                let btn = null;
                if (event && event.target) {
                    btn = event.target.closest('button');
                    if (btn) {
                        btn.disabled = true;
                        btn.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Drafting...`;
                    }
                }

                // Reset UI
                document.getElementById('gen-story-input-view').classList.add('hidden');
                document.getElementById('gen-story-progress-view').classList.remove('hidden');
                document.getElementById('gen-story-progress-view').classList.add('flex');

                const updateUI = (pct, msg) => {
                    document.getElementById('gen-story-bar').style.width = `${pct}%`;
                    document.getElementById('gen-story-status').textContent = msg;
                };

                try {
                    // STEP 1: CONCEPT
                    updateUI(10, "Architecting the universe...");

                    // REFINED PROMPT: Demanding atmosphere and depth
                    const conceptPrompt = `You are a creative director for a high-quality interactive novel. Based on this prompt: "${userPrompt}", create a detailed story bible. Be imaginitive and unexpected yet logical to craft a world and scenario where participants will desire to explore and become immersed.
                    
                    Notes on output elements:
                    - Story should be as authentic as possible to the initiating prompt. Avoid adding magical elements to a realistic idea, or horror elements to a romantic comedy, for instance. Think about how each character may expand the narrative in compelling ways.
                    - The brief_summary should further define the genre, style, and atmosphere of the story. Then, build out the environment and setting, describe any relevant 'factions' or political alliances, and describe the inciting incident that will serve as the scenario.
                    - Create as many characters as makes sense for the narrative, with a minimum of 3. The first shall be the 'user'.

                    Respond with VALID JSON ONLY:
                    {
                        "title": "A Compelling Story Title",
                        "creator_notes": "An atmospheric, engaging introduction to the story's environment and tone (approx 2 paragraphs). Sell the concept.",
                        "tags": ["tag1", "tag2", "genre", "vibe"],
                        "scenario_name": "A creative name for the starting scene. This sets the tone for how the participants will interact in this world",
                        "brief_summary": "A rich summary of the world, the core conflict, and the stakes involved. Focus on the drama.",
                        "characters": [
                            {"name": "Name", "role": "User", "archetype": "The Protagonist (Describe their situation, not just 'You')"},
                            {"name": "Name", "role": "PrimaryAI", "archetype": "The Companion/Antagonist/Narrator (The main NPC interaction)"},
                            {"name": "Name", "role": "Secondary", "archetype": "Support/World Builder"} 
                        ]
                    }`;

                    const conceptData = await this._callAIWithRetry(conceptPrompt);
                    if (!conceptData) throw new Error("Failed to generate concept.");

                    this.RUNTIME_GEN.conceptData = conceptData;

                    // Switch to Edit/Approval View
                    document.getElementById('gen-story-progress-view').classList.remove('flex');
                    document.getElementById('gen-story-progress-view').classList.add('hidden');
                    document.getElementById('gen-story-approval-view').classList.remove('hidden');
                    document.getElementById('gen-story-approval-view').classList.add('flex');

                    // Populate Inputs for Editing
                    document.getElementById('gen-approval-title-input').value = conceptData.title;
                    document.getElementById('gen-approval-summary-input').value = conceptData.creator_notes; // Using creator_notes as summary for display
                    document.getElementById('gen-approval-tags-input').value = (conceptData.tags || []).join(', ');

                } catch (e) {
                    alert("Generation Error: " + e.message);
                    this.retryGenStory();
                }
            },

            /**
             * Resets the UI to the input phase for regenerating a story concept.
             */
            retryGenStory() {
                this.RUNTIME_GEN.draftStory = null;
                document.getElementById('gen-story-approval-view').classList.add('hidden');
                document.getElementById('gen-story-approval-view').classList.remove('flex');
                document.getElementById('gen-story-input-view').classList.remove('hidden');
            },

            /**
             * Confirms the generated story concept and proceeds to generate lore, characters, and scenario.
             * This is the "Phase 2" of the Story Architect flow.
             */
            async confirmGenStory() {
                // Read Edited Values
                const title = document.getElementById('gen-approval-title-input').value;
                const summary = document.getElementById('gen-approval-summary-input').value;
                const tagsStr = document.getElementById('gen-approval-tags-input').value;
                const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);

                // UI Switch
                document.getElementById('gen-story-approval-view').classList.remove('flex');
                document.getElementById('gen-story-approval-view').classList.add('hidden');
                document.getElementById('gen-story-progress-view').classList.remove('hidden');
                document.getElementById('gen-story-progress-view').classList.add('flex');

                const updateUI = (pct, msg) => {
                    document.getElementById('gen-story-bar').style.width = `${pct}%`;
                    document.getElementById('gen-story-status').textContent = msg;
                };

                // Init Draft
                const draft = {
                    id: UTILITY.uuid(), created_date: new Date().toISOString(), last_modified: new Date().toISOString(),
                    ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(),
                    ...UTILITY.getDefaultSystemPrompts(), ...UTILITY.getDefaultStorySettings(),
                    characters: [], static_entries: [], narratives: [], scenarios: [], dynamic_entries: [],
                    name: title, creator_notes: summary, tags: tags, backgroundImageURL: ""
                };

                const concept = this.RUNTIME_GEN.conceptData;
                // Update concept summary with user edits
                const contextSummary = `Title: ${title}\nSummary: ${summary}\nCore Conflict: ${concept.brief_summary}`;

                try {
                    // STEP 2: LORE
                    updateUI(20, "Forging history and lore...");

                    // REFINED PROMPT: Focus on worldbuilding flavor, not dry facts.
                    const lorePrompt = `Based on this summary: "${summary}", generate 3-10 deep worldbuilding entries (Lore).
                    Focus on history, culture, factions, secrets, or atmospheric details that make the world feel alive. Avoid generic definitions. Each entry should be an important piece of information within the environment of the story that adds to the narrative complexity. Ensure that each entry is authentic to the genre, style, and scenario of this narrative; a high fantasy narrative will have much differen lore than a slice-of-life tale set in Brooklyn, for example.
                    
                    Title: The entry title should be a clear, direct, and concise name for the entry.

                    Return VALID JSON: { "entries": [{"title": "Entry Title", "content": "Rich, descriptive content..."}] }`;

                    const loreData = await this._callAIWithRetry(lorePrompt);
                    if (loreData && loreData.entries) {
                        draft.static_entries = loreData.entries.map(e => ({ id: UTILITY.uuid(), title: e.title, content: e.content }));
                    }

                    // STEP 3: RELATIONSHIP MATRIX
                    updateUI(30, "Setting the board...");
                    const roster = concept.characters || [];
                    let relationshipContext = "";

                    try {
                        const relPrompt = `Given the characters: ${roster.map(c => c.name + ' (' + c.role + ')').join(', ')}.
                        Story Context: ${contextSummary}.
                        Define the specific relationship dynamics between the User and the Primary AI character, and then between other characters in this narrative. Focus on how they feel about each other and what their goals are when interacting with each other.
                        Return VALID JSON: { "relationship_description": "Analysis of their dynamic (allies, enemies, strangers, etc)." }`;

                        const relData = await this._callAIWithRetry(relPrompt);
                        if (relData && relData.relationship_description) {
                            relationshipContext = `\nRELATIONSHIPS:\n${relData.relationship_description}`;
                        }
                    } catch (e) { console.warn("Relationship gen failed, skipping."); }

                    // STEP 4: CHARACTERS (Sequential with Relationship Injection)
                    for (let i = 0; i < roster.length; i++) {
                        const charDef = roster[i];
                        updateUI(35 + (i * 10), `Breathing life into ${charDef.name}...`);

                        // Inject relationship context
                        const charContext = `${contextSummary}\nCharacter Role: ${charDef.role}\nArchetype: ${charDef.archetype}${relationshipContext}`;
                        const charData = await NarrativeController.generateCharacterProfile(charDef.name, charContext);

                        if (charData) {
                            draft.characters.push({
                                id: UTILITY.uuid(),
                                name: charDef.name,
                                description: charData.description || "No description.",
                                short_description: charData.short_description || "A character.",
                                model_instructions: charData.model_instructions || `Act as ${charDef.name}.`,
                                tags: charData.tags || [],
                                is_user: charDef.role === 'User',
                                is_active: true,
                                is_narrator: charDef.role === 'PrimaryAI' && !roster.some(r => r.role === 'User'),
                                color: { base: charData.color_hex || '#4b5563', bold: '#ffffff' },
                                image_url: '',
                                extra_portraits: []
                            });
                        }
                    }

                    // Fallback: Ensure a user exists if AI didn't generate one
                    if (!draft.characters.some(c => c.is_user)) {
                        draft.characters.push({ id: UTILITY.uuid(), name: "Traveler", description: "You.", short_description: "You.", is_user: true, is_active: true, color: { base: '#4b5563', bold: '#fff' }, image_url: '', extra_portraits: [], tags: [], model_instructions: "Act as User." });
                    }

                    // STEP 5: SCENARIO (Logic Fix: Determine Speaker First)
                    updateUI(80, "Setting the scene...");

                    // Identify the NPC Speaker and the User Target
                    const speakerChar = draft.characters.find(c => !c.is_user) || draft.characters[0];
                    const userChar = draft.characters.find(c => c.is_user) || { name: "You" };

                    // REFINED PROMPT: Enforce Perspective and Speaker Identity
                    const scenarioPrompt = `Context: ${contextSummary}${relationshipContext}
                    
                    Task:
                    1. Write an "opening_message" for the chat. This message is spoken or enacted by ${speakerChar.name}. 
                       It must be directed AT ${userChar.name}. 
                       Do NOT describe ${userChar.name}'s thoughts or actions. 
                       Only describe what ${speakerChar.name} says or does.
                       Use 'prose-style' writing with speech in quotations, rather than roleplay-style writing with actions in parentheses or asterisks.
                       Organically set the setting, scene, and at least a hint of the inciting incident so that the participants know how to interact.
                    
                    2. Write "scenario_lore". This is a static description of the narrative genre, style, and atmosphere, the setting/scene, and the inciting incident. This should establish the initial goals or intent of ${speakerChar.name}. 
                       Write this in 3rd Person (e.g., "The room is dark," not "You are in a dark room").
                    
                    Return VALID JSON:
                    {
                        "opening_message": "The opening lines of the scene...",
                        "scenario_lore": "Static lore describing the scene..."
                    }`;

                    const scenData = await this._callAIWithRetry(scenarioPrompt);
                    const firstMsg = scenData ? scenData.opening_message : "The story begins.";

                    if (scenData && scenData.scenario_lore) {
                        draft.static_entries.push({ id: UTILITY.uuid(), title: "Current Scenario", content: scenData.scenario_lore });
                    }

                    // STEP 6: SMART MAP SEEDING
                    updateUI(90, "Singing the world into existence...");
                    let grid = UTILITY.createDefaultMapGrid();
                    try {
                        // Extract Titles and Content for seeding
                        const loreDetails = draft.static_entries.map(e => `${e.title}: ${e.content}`).join('\n');
                        const mapContext = {
                            characters: draft.characters.map(c => c.name).join(', '),
                            static_lore: `${contextSummary}\nKey worldbuilding to respond to and expand upon with locations that are authentic and logical within the story framework and scale. Provide a physical description of the location, along with any importance within the environment or scenario:\n${loreDetails}`,
                            recent_events: firstMsg
                        };
                        grid = await WorldController.generateMapGrid(mapContext);
                    } catch (e) {
                        console.warn("Map Gen Failed, using default", e);
                    }

                    // FINAL SAVE
                    updateUI(100, "Finalizing...");
                    const newScenario = {
                        id: UTILITY.uuid(), name: concept.scenario_name || "The Beginning", message: firstMsg,
                        active_character_ids: draft.characters.map(c => c.id),
                        static_entries: [], dynamic_entries: [], example_dialogue: [],
                        worldMap: { grid: grid, currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] },
                        prompts: UTILITY.getDefaultSystemPrompts()
                    };
                    draft.scenarios.push(newScenario);

                    const newNarrative = {
                        id: UTILITY.uuid(), name: `${newScenario.name} - Chat`,
                        last_modified: new Date().toISOString(),
                        active_character_ids: draft.characters.map(c => c.id),
                        state: {
                            chat_history: [], messageCounter: 1,
                            static_entries: [...draft.static_entries],
                            worldMap: JSON.parse(JSON.stringify(newScenario.worldMap))
                        }
                    };

                    // Assign the message strictly to the NPC speaker we identified earlier
                    newNarrative.state.chat_history.push({
                        character_id: speakerChar.id,
                        content: firstMsg,
                        type: 'chat',
                        emotion: 'neutral',
                        timestamp: new Date().toISOString()
                    });

                    draft.narratives.push({ id: newNarrative.id, name: newNarrative.name, last_modified: newNarrative.last_modified });

                    await DBService.saveStory(draft);
                    await DBService.saveNarrative(newNarrative);

                    StateManager.getLibrary().stories.push(draft);
                    LibraryController.updateSearchIndex(draft);
                    StateManager.updateTagCache();

                    // Auto Load
                    StateManager.getLibrary().active_story_id = draft.id;
                    StateManager.getLibrary().active_narrative_id = newNarrative.id;
                    StateManager.saveLibrary();

                    AppController.closeModal('gen-story-modal');
                    window.location.reload();

                } catch (e) {
                    console.error(e);
                    alert("Generation Error: " + e.message);
                    this.retryGenStory();
                }
            },

            /**
             * Helper: Calls the AI service with automatic retries for JSON parsing.
             * @param {string} prompt - The prompt to send.
             * @param {number} [retries=2] - Number of retry attempts.
             * @returns {Promise<Object|null>} - The parsed JSON response or null on failure.
             */
            async _callAIWithRetry(prompt, retries = 2) {
                for (let i = 0; i <= retries; i++) {
                    try {
                        const res = await APIService.callAI(prompt, true);
                        const json = UTILITY.extractAndParseJSON(res);
                        if (json) return json;
                        throw new Error("Invalid JSON");
                    } catch (e) {
                        if (i === retries) return null;
                    }
                }
            },

            // --- Import / Export & File Handling ---

            /**
             * Handles the upload of a single story file (JSON, PNG, BYAF, ZIP).
             * Parses the file and imports it into the library.
             * @param {Event} event - The file input change event.
             */
            async handleFileUpload(event) {
                const file = event.target.files[0];
                if (!file) return;
                UIManager.showLoadingSpinner('Parsing file...');
                try {
                    // Accept backgroundImageBlob from the parser
                    const { story: newStory, imageBlob, backgroundImageBlob } = await ImportExportService.parseUploadedFile(file);
                    const library = StateManager.getLibrary();

                    // Duplicate Name Check
                    const existingStory = library.stories.find(s => s.name && newStory.name && s.name.toLowerCase() === newStory.name.toLowerCase());
                    if (existingStory) {
                        const now = new Date();
                        // Simple timestamp
                        newStory.name = `${newStory.name} - ${Date.now()}`;
                    }

                    // Separating Narratives from the Story Object
                    const narratives = newStory.narratives || [];
                    const narrativeStubs = narratives.map(n => ({ id: n.id, name: n.name, last_modified: n.last_modified }));
                    newStory.narratives = narrativeStubs;

                    // 1. Save Story to DB
                    await DBService.saveStory(newStory);

                    // 2. Save Narratives to DB (Sequentially for memory safety)
                    if (narratives.length > 0) {
                        for (const n of narratives) {
                            await DBService.saveNarrative(n);
                        }
                    }

                    // 3. Update In-Memory Library
                    library.stories.push(newStory);

                    // 4. Save Primary Image to DB
                    const primaryAiChar = newStory.characters?.find(c => !c.is_user);
                    if (imageBlob && primaryAiChar && primaryAiChar.id) {
                        await DBService.saveImage(primaryAiChar.id, imageBlob);

                        // Update Cache
                        UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                        if (UIManager.RUNTIME.characterImageCache[primaryAiChar.id]) URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[primaryAiChar.id]);
                        UIManager.RUNTIME.characterImageCache[primaryAiChar.id] = URL.createObjectURL(imageBlob);
                    }

                    // Save Background Image if the parser found one (BYAF or JSON)
                    if (backgroundImageBlob) {
                        const bgKey = `bg_${newStory.id}`;
                        await DBService.saveImage(bgKey, backgroundImageBlob);

                        // Update the story setting to use local background
                        newStory.backgroundImageURL = 'local_idb_background';
                        await DBService.saveStory(newStory);
                    }

                    this.updateSearchIndex(newStory);
                    StateManager.updateTagCache();
                    StateManager.saveLibrary();
                    UIManager.hideLoadingSpinner();
                    alert(`Story "${newStory.name}" imported successfully!`);
                    UIManager.renderLibraryInterface();
                    AppController.closeModal('io-hub-modal');

                } catch (err) {
                    UIManager.hideLoadingSpinner();
                    alert(`Error importing file: ${err.message}`);
                } finally {
                    event.target.value = '';
                }
            },

            /**
             * Handles the bulk import of multiple story files from a directory.
             * Uses the File System Access API to read a directory.
             */
            async handleBulkImport() {
                if (!window.showDirectoryPicker) {
                    alert("Your browser does not support directory selection.");
                    return;
                }
                try {
                    const dirHandle = await window.showDirectoryPicker();
                    UIManager.showLoadingSpinner('Starting bulk import...');

                    let processedFiles = 0;
                    const failedFiles = [];
                    const importedStoryNames = [];
                    const library = StateManager.getLibrary();

                    for await (const entry of dirHandle.values()) {
                        if (entry.kind !== 'file' || !entry.name) continue;
                        const lowerCaseName = entry.name.toLowerCase();

                        if (lowerCaseName.endsWith('.png') || lowerCaseName.endsWith('.byaf') || lowerCaseName.endsWith('.zip') || lowerCaseName.endsWith('.json')) {
                            UIManager.showLoadingSpinner(`Processing file ${++processedFiles}: ${entry.name}`);
                            try {
                                const file = await entry.getFile();

                                // 1. Parse the file into memory
                                const { story: newStory, imageBlob } = await ImportExportService.parseUploadedFile(file, false);

                                if (!newStory || !newStory.name) throw new Error("Invalid parsed story data.");

                                // 2. Handle Duplicate Names
                                const existingStory = library.stories.find(s => s.name && s.name.toLowerCase() === newStory.name.toLowerCase());
                                if (existingStory) {
                                    newStory.name = `${newStory.name} - ${Date.now()}`;
                                }

                                // 3. Separate heavy narrative data from the story object
                                // We must separate the heavy narrative data from the story object to ensure the story object remains lightweight.
                                const narratives = newStory.narratives || [];
                                const narrativeStubs = narratives.map(n => ({
                                    id: n.id,
                                    name: n.name,
                                    last_modified: n.last_modified
                                }));

                                // Replace full narratives with stubs in the story object
                                newStory.narratives = narrativeStubs;

                                // Save the Story to DB
                                await DBService.saveStory(newStory);

                                // Save all Narratives to DB
                                for (const narrative of narratives) {
                                    await DBService.saveNarrative(narrative);
                                }

                                // 4. Save Image to DB
                                const primaryAiChar = newStory.characters?.find(c => !c.is_user);
                                if (imageBlob && primaryAiChar) {
                                    await DBService.saveImage(primaryAiChar.id, imageBlob);

                                    // Update cache immediately so it shows in UI
                                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};
                                    if (UIManager.RUNTIME.characterImageCache[primaryAiChar.id]) {
                                        URL.revokeObjectURL(UIManager.RUNTIME.characterImageCache[primaryAiChar.id]);
                                    }
                                    UIManager.RUNTIME.characterImageCache[primaryAiChar.id] = URL.createObjectURL(imageBlob);
                                }

                                // 5. Update In-Memory Library (UI)
                                library.stories.push(newStory);
                                this.updateSearchIndex(newStory);
                                importedStoryNames.push(newStory.name);

                            } catch (err) {
                                console.error(`Failed to import ${entry.name}`, err);
                                failedFiles.push({ name: entry.name, reason: err.message || 'Unknown error' });
                            }
                        }
                    }

                    StateManager.updateTagCache();
                    // Save the library list order/meta-data
                    StateManager.saveLibrary();

                    UIManager.hideLoadingSpinner();
                    UIManager.showBulkImportReport(importedStoryNames, failedFiles);
                    UIManager.renderLibraryInterface();

                } catch (err) {
                    UIManager.hideLoadingSpinner();
                    if (err.name !== 'AbortError') alert(`Bulk import error: ${err.message}`);
                }
            },

            /**
             * Imports a full library backup from a ZIP file.
             * Replaces the current library with the imported one.
             * @param {Event} event - The file input change event.
             */
            async importLibrary(event) {
                const file = event.target.files[0];
                if (!file) return;
                event.target.value = ''; // Reset

                try {
                    const proceed = await UIManager.showConfirmationPromise('WARNING: This will permanently replace your entire story library. Are you sure?');
                    if (proceed) {
                        // Prevent ReactiveStore from saving the *old* state during the unload/reload cycle.
                        // If we don't do this, the 'beforeunload' event will trigger forceSave(), which will 
                        // write the old in-memory state back to the DB, corrupting the fresh import.
                        if (typeof ReactiveStore !== 'undefined') {
                            ReactiveStore.blockAutoSave();
                        }

                        // Clear in-memory references to prevent any accidental UI reads/writes during the process
                        StateManager.data.library.stories = [];
                        StateManager.data.activeNarrativeState = {};

                        UIManager.showLoadingSpinner('Importing library... Do not close this tab.');

                        await StoryService.importLibraryFromZip(file);

                        UIManager.hideLoadingSpinner();
                        alert("Library imported successfully! Reloading...");
                        setTimeout(() => window.location.reload(), 500);
                    }
                } catch (err) {
                    UIManager.hideLoadingSpinner();
                    console.error("Import failed:", err);
                    alert(`Error importing library: ${err.message}`);
                }
            },

            /**
             * Exports the entire library as a ZIP file.
             */
            async exportLibrary() {
                UIManager.showLoadingSpinner('Exporting entire library...');
                try {
                    const result = await StoryService.exportLibraryAsZip();
                    // Handle legacy return (blob only) vs new object return
                    const zipBlob = result.blob || result;
                    const report = result.report || { success: true, errors: [] };

                    const url = URL.createObjectURL(zipBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ellipsis_library_backup_${new Date().toISOString().split('T')[0]}.zip`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    if (report.errors && report.errors.length > 0) {
                        const errorMsg = report.errors.map(e => `• ${e.key}: ${e.error}`).join('\n');
                        alert(`⚠️ Export Partial Success\n\nThe backup was created, BUT ${report.errors.length} files failed to be included:\n\n${errorMsg}\n\nPlease check your Console for details.`);
                        console.error("Export Failures:", report.errors);
                    }
                } catch (e) {
                    alert(`Library export failed: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Exports the current story in the specified format (JSON, PNG, BYAF).
             * @param {string} format - The format to export as ('json', 'png', 'byaf').
             */
            async exportStoryAs(format) {
                const storyId = document.getElementById('story-export-selector').value;
                const narrativeId = document.getElementById('narrative-export-selector').value;

                if (!storyId || !narrativeId) {
                    alert("Please select a story and a narrative to export.");
                    return;
                }

                if (format !== 'json') {
                    const proceed = await UIManager.showConfirmationPromise("Exporting to a non-Ellipsis format may result in data loss. Continue?");
                    if (!proceed) return;
                }

                UIManager.showLoadingSpinner(`Exporting as ${format.toUpperCase()}...`);
                try {
                    const library = StateManager.getLibrary();
                    const story = library.stories.find(s => s.id === storyId);

                    // Fetch the FULL narrative object from DB, because the library only has stubs
                    const narrative = await DBService.getNarrative(narrativeId);

                    const charSelector = document.getElementById('character-export-selector');
                    const primaryCharId = (format === 'png' || format === 'byaf') ? charSelector?.value : null;

                    if (!story) throw new Error("Story not found.");
                    if (!narrative) throw new Error("Narrative data not found in database.");

                    // Ensure state exists to prevent crashes if data is malformed
                    if (!narrative.state) narrative.state = { worldMap: {}, chat_history: [], static_entries: [] };

                    if ((format === 'png' || format === 'byaf') && !primaryCharId) throw new Error("Primary character required.");

                    let blob, filename;
                    switch (format) {
                        case 'json':
                            // Hydrate the narrative stubs with full data
                            // The story object in memory only has stubs. We need the real data from IDB.
                            const fullNarratives = await Promise.all(
                                (story.narratives || []).map(n => DBService.getNarrative(n.id))
                            );

                            // Create a clone to avoid mutating the live object with heavy data
                            const exportObj = JSON.parse(JSON.stringify(story));
                            // Replace stubs with full objects (filtering out any nulls from DB errors)
                            exportObj.narratives = fullNarratives.filter(n => n);

                            blob = ImportExportService.exportStoryAsJSON(exportObj);
                            filename = `${story.name}.json`;
                            break;
                        case 'png':
                            blob = await ImportExportService.exportStoryAsV2(story, narrative, primaryCharId);
                            filename = `${story.name}.png`;
                            break;
                        case 'byaf':
                            blob = await ImportExportService.exportStoryAsBYAF(story, narrative, primaryCharId);
                            filename = `${story.name}.byaf`;
                            break;
                    }

                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename.replace(/[/\\?%*:|"<>]/g, '-');
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                } catch (e) {
                    console.error(e);
                    alert(`Export failed: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                }
            },

            // --- Meta / AI Helpers ---

            /**
             * Generates AI notes for the story based on its content.
             * @param {Event} event - The click event.
             * @param {string} storyId - The ID of the story.
             */
            async generateStoryNotesAI(event, storyId) {
                const context = await StoryService.buildStoryContext(storyId);
                const state = StateManager.getState(); // Access prompts from active state if avail, else defaults
                const prompt = state.prompt_story_notes_gen || UTILITY.getDefaultSystemPrompts().prompt_story_notes_gen;

                const result = await this._generateContentForField(event, prompt, { context });
                if (result) {
                    this.updateStoryField(storyId, 'creator_notes', result);
                    UIManager.openStoryDetails(storyId);
                }
            },

            /**
             * Generates AI tags for the story based on its content.
             * @param {Event} event - The click event.
             * @param {string} storyId - The ID of the story.
             */
            async generateStoryTagsAI(event, storyId) {
                const context = await StoryService.buildStoryContext(storyId);
                const state = StateManager.getState();
                const prompt = state.prompt_story_tags_gen || UTILITY.getDefaultSystemPrompts().prompt_story_tags_gen;

                const result = await this._generateContentForField(event, prompt, { context });
                if (result) {
                    const newTags = result.split(',').map(t => t.trim().toLowerCase());
                    const library = StateManager.getLibrary();
                    const story = library.stories.find(s => s.id === storyId);
                    const combined = [...new Set([...(story.tags || []), ...newTags])];
                    this.updateStoryTags(storyId, combined.join(', '));
                    UIManager.openStoryDetails(storyId);
                }
            },

            // --- Global Image Handling ---

            /**
             * Handles the upload of a custom background image for the story.
             * @param {Event} event - The file input change event.
             */
            async handleBackgroundImageUpload(event) {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { alert("Image too large (>5MB)."); return; }

                const library = StateManager.getLibrary();
                const storyId = library.active_story_id;
                if (!storyId) { alert("No active story to save background to."); return; }

                UIManager.showLoadingSpinner('Processing background...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);

                    // Save with Story-Specific Key (bg_UUID)
                    const key = `bg_${storyId}`;
                    const saved = await DBService.saveImage(key, blob);

                    if (!saved) throw new Error("Failed to save to database.");

                    if (UIManager.RUNTIME.globalBackgroundImageCache) URL.revokeObjectURL(UIManager.RUNTIME.globalBackgroundImageCache);
                    UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(blob);

                    // Update State to use the marker
                    if (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) {
                        ReactiveStore.state.backgroundImageURL = 'local_idb_background';
                        // Trigger save to persist the 'local_idb_background' setting to the story object
                        ReactiveStore.forceSave();
                    }

                    UIManager.applyStyling();

                    const bgHint = document.getElementById('background-image-hint');
                    if (bgHint) bgHint.textContent = 'Current: [Local Image]';
                } catch (e) {
                    alert(`Upload failed: ${e.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                    event.target.value = '';
                }
            },

            /**
             * Clears the custom background image for the active story.
             */
            async clearBackgroundImage() {
                const library = StateManager.getLibrary();
                const storyId = library.active_story_id;

                // Delete Story-Specific Key
                if (storyId) {
                    await DBService.deleteImage(`bg_${storyId}`);
                }

                if (UIManager.RUNTIME.globalBackgroundImageCache) URL.revokeObjectURL(UIManager.RUNTIME.globalBackgroundImageCache);
                UIManager.RUNTIME.globalBackgroundImageCache = null;

                if (typeof ReactiveStore !== 'undefined' && ReactiveStore.state) {
                    ReactiveStore.state.backgroundImageURL = '';
                    ReactiveStore.forceSave();
                }

                UIManager.applyStyling();
                const bgHint = document.getElementById('background-image-hint');
                if (bgHint) bgHint.textContent = 'Current: None';
            },

            /**
             * Shared helper for AI generation buttons
             */
            /**
             * Helper function to generate AI content for a specific field.
             * @param {Event} event - The triggering event.
             * @param {string} promptTemplate - The prompt template to use.
             * @param {Object} context - The context object for prompt replacement.
             * @returns {Promise<string|null>} - The generated content or null.
             * @private
             */
            async _generateContentForField(event, promptTemplate, context) {
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
                    return await APIService.callAI(prompt, false);
                } catch (error) {
                    alert(`AI generation failed: ${error.message}`);
                    return null;
                } finally {
                    button.disabled = false;
                    button.innerHTML = originalContent;
                }
            },

            /**
             * Updates the search index for a story object.
             * @param {Object} story - The story object to update.
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
            }
        };

        const NarrativeController = {
            CONSTANTS: {
                CHARACTER_COLORS: [
                    { base: '#334155', bold: '#94a3b8' }, // Slate
                    { base: '#1e3a8a', bold: '#60a5fa' }, // Blue
                    { base: '#581c87', bold: '#f472b6' }, // Fuchsia
                    { base: '#78350f', bold: '#fbbf24' }, // Amber
                    { base: '#365314', bold: '#a3e635' }, // Lime
                    { base: '#5b21b6', bold: '#a78bfa' }, // Violet
                    { base: '#881337', bold: '#fb7185' }, // Rose
                    { base: '#155e75', bold: '#22d3ee' }  // Cyan
                ]
            },

            RUNTIME: {
                streamingInterval: null,
                activeRequestAbortController: null
            },

            // --- Chat Interaction ---

            /**
             * Handles the primary action button (Send/Write).
             * Delegates to writeForMe or sendMessage based on input.
             */
            handlePrimaryAction() {
                if (!StateManager.getLibrary().active_story_id) {
                    UIManager.showConfirmationModal("Please load or create a story from the Story Library first.", () => AppController.openModal('story-library-modal'));
                    return;
                }
                const input = document.getElementById('chat-input');
                input.value.trim() === '' ? this.writeForMe() : this.sendMessage();
            },
            /**
             * Pure Generation Function (Reused by Quick Create & Story Architect).
             * Generates a character profile JSON based on context.
             * @param {string} name - The name of the character.
             * @param {string} contextString - The context string for generation.
             * @returns {Promise<Object>} - The generated character profile.
             */
            async generateCharacterProfile(name, contextString) {
                const prompt = `You are a character designer.
                Based on the context provided, generate a detailed character profile for "${name}".
                
                CONTEXT:
                ${contextString}
                
                INSTRUCTIONS:
                Infer their personality, appearance, and role.
                Respond with VALID JSON ONLY:
                {
                    "description": "Full personality and physical description, written in 3rd person (approx 150 words).",
                    "short_description": "A very brief, one-sentence summary.",
                    "tags": ["tag1", "tag2", "tag3"],
                    "model_instructions": "Specific instructions for the AI on how to roleplay this character (e.g., 'Act as ${name}, speak in a rough tone...')",
                    "color_hex": "#71717a"
                }`;

                const response = await APIService.callAI(prompt, true);
                return UTILITY.extractAndParseJSON(response);
            },
            /**
             * Checks if the "Event Master" should trigger a random event.
             * Rolls a die and, if successful, generates a system instruction for the AI.
             */
            async checkEventMaster() {
                const state = ReactiveStore.state;

                // 1. Configuration Guard
                if (!state.event_master_base_prompt) return;

                // 2. Dice Roll: Configurable Chance
                // Strictly parse probability to prevent NaN causing 100% trigger rate
                let probability = parseInt(state.event_master_probability);
                if (isNaN(probability)) probability = 15; // Default if invalid

                // Logic: If random roll (0-100) is GREATER than probability, we SKIP.
                // Example: Prob 15. Roll 20. 20 > 15 is True. Return (Skip).
                if (Math.random() * 100 > probability) return;

                // 3. Overlap Guard
                if (state.event_master_prompt) return;

                // 4. Show UI Feedback
                // Since this blocks the chat, we must tell the user what is happening.
                UIManager.showLoadingSpinner("The Event Master is plotting...");

                try {
                    console.log("Event Master: 🎲 Roll successful. Analyzing narrative...");

                    // 5. Build Context (Last 10 messages)
                    const recentHistory = state.chat_history
                        .slice(-10)
                        .filter(m => m && m.type === 'chat' && !m.isHidden)
                        .map(m => {
                            const char = state.characters.find(c => c.id === m.character_id);
                            return `${char ? char.name : 'Unknown'}: ${m.content}`;
                        })
                        .join('\n');

                    // 6. Construct Prompt
                    const prompt = `${state.event_master_base_prompt}
            
            RECENT CHAT HISTORY:
            ${recentHistory}
            
            INSTRUCTION:
            Analyze the chat history. Generate a single, concise "System Instruction" that introduces a plot twist, a sudden event, or a change in tone to push the story in a new direction.
            
            Output ONLY the instruction. Do not write a chat message.
            Example Output: "A sudden thunderstorm knocks out the power."`;

                    // 7. Blocking API Call
                    // We use a new AbortController so this specific request has its own lifecycle
                    const controller = new AbortController();
                    const instruction = await APIService.callAI(prompt, false, controller.signal);

                    if (instruction && instruction.trim().length > 0) {
                        console.log("Event Master Triggered:", instruction);
                        // Save to state. 
                        // The PromptBuilder will inject this into the System Prompt when triggerAIResponse runs next.
                        state.event_master_prompt = instruction;
                    }

                } catch (e) {
                    console.warn("Event Master skipped turn:", e);
                } finally {
                    // 8. Always hide the spinner, whether we succeeded or failed
                    UIManager.hideLoadingSpinner();
                }
            },

            /**
             * Sends a user message.
             * Adds the message, checks triggers, runs Event Master, and triggers AI response.
             */
            async sendMessage() {
                if (this.RUNTIME.activeRequestAbortController) {
                    this.stopGeneration();
                }
                if (UIManager.RUNTIME.streamingInterval) {
                    clearInterval(UIManager.RUNTIME.streamingInterval);
                    UIManager.RUNTIME.streamingInterval = null;
                }

                const state = ReactiveStore.state;
                const input = document.getElementById('chat-input');
                const userChar = state.characters.find(c => c.is_user);

                if (!userChar) {
                    alert("No character is set as the 'User'.");
                    return;
                }

                const messageContent = input.value.trim();
                if (!messageContent) return;

                // 1. Add user message immediately
                this.addMessageToHistory(userChar.id, messageContent);
                input.value = '';

                // 2. Check triggers (Lore)
                this.checkDynamicEntryTriggers();

                // 3. Run Event Master (BLOCKING)
                // This "cuts in line" before the character replies.
                await this.checkEventMaster();

                // 4. Trigger Character Response
                // The character will now see the Event Master's instruction in the prompt context.
                await this.triggerAIResponse(null, messageContent);

                // 5. Cleanup / Auto-Save logic is handled by ReactiveStore
            },

            /**
             * Triggers the AI to write a message on behalf of the user.
             * Uses a placeholder animation during generation.
             */
            async writeForMe() {
                if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;
                // Clear errors here too
                this.clearSystemErrors();
                const state = ReactiveStore.state;
                const userChar = state.characters.find(c => c.is_user);
                if (!userChar) return;
                const input = document.getElementById('chat-input');

                UIManager.setButtonToStopMode();
                this.RUNTIME.activeRequestAbortController = new AbortController();

                // Start Placeholder Animation
                // Cycles through: "." -> ". ." -> ". . ."
                let dotFrame = 0;
                input.placeholder = ".";

                this.RUNTIME.placeholderInterval = setInterval(() => {
                    dotFrame = (dotFrame + 1) % 3;
                    // Create string based on frame: 0=".", 1=". .", 2=". . ."
                    input.placeholder = Array(dotFrame + 1).fill(".").join(" ");
                }, 500);

                try {
                    const prompt = PromptBuilder.buildPrompt(userChar.id, true);
                    const response = await APIService.callAI(prompt, false, this.RUNTIME.activeRequestAbortController.signal);
                    input.value = response;
                } catch (error) {
                    if (error.name === 'AbortError') console.log("Write For Me stopped.");
                    else console.error("Write for Me failed:", error);
                } finally {
                    // Stop Animation & Restore Original Text
                    if (this.RUNTIME.placeholderInterval) {
                        clearInterval(this.RUNTIME.placeholderInterval);
                        this.RUNTIME.placeholderInterval = null;
                    }
                    input.placeholder = "Enter your message...";

                    UIManager.setButtonToSendMode();
                    this.RUNTIME.activeRequestAbortController = null;
                }
            },

            /**
             * Regenerates the last AI response.
             * Removes the last message and triggers a new response.
             */
            async handleRegen() {
                const state = ReactiveStore.state;
                if (!StateManager.getLibrary().active_narrative_id) { alert("Load a narrative first."); return; }
                if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;

                let selectedCharId = document.getElementById('ai-character-selector').value;
                if (selectedCharId === 'any') {
                    selectedCharId = this.determineNextSpeaker(false);
                }

                // Check if last message was AI
                const lastMsg = state.chat_history.filter(m => m.type === 'chat').pop();
                const lastChar = lastMsg ? state.characters.find(c => c.id === lastMsg.character_id) : null;

                if (lastChar && !lastChar.is_user && lastMsg.character_id === selectedCharId) {
                    this.undoLastTurn();
                    await this.triggerAIResponse(selectedCharId);
                } else {
                    await this.triggerAIResponse(selectedCharId);
                }
            },

            /**
             * Adds a message to the chat history and updates the state.
             * @param {string} id - The character ID.
             * @param {string} content - The message content.
             * @param {string} [type='chat'] - The message type.
             * @param {string} [emotion='neutral'] - The emotion associated with the message.
             */
            async addMessageToHistory(id, content, type = 'chat', emotion = 'neutral') {
                if (UIManager.RUNTIME.streamingInterval) {
                    clearInterval(UIManager.RUNTIME.streamingInterval);
                    UIManager.RUNTIME.streamingInterval = null;
                }

                const state = ReactiveStore.state;

                if (state.chat_history.length > 0) {
                    const cleanHistory = state.chat_history.filter(msg =>
                        !(msg.type === 'system_event' && (msg.content.startsWith('AI Error') || msg.content.includes('Failed to fetch')))
                    );
                    if (cleanHistory.length !== state.chat_history.length) {
                        state.chat_history = cleanHistory;
                    }
                }

                const newMessage = {
                    character_id: id, content, type, emotion,
                    timestamp: new Date().toISOString(), isNew: true
                };

                // Push to state
                ReactiveStore.state.chat_history.push(newMessage);

                if (type === 'chat') {
                    ReactiveStore.state.messageCounter++;
                }

                // Await the save operation to ensure iOS persistence
                await ReactiveStore.forceSave();

                setTimeout(() => {
                    const chatWindow = document.getElementById('chat-window');
                    if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
                }, 50);
            },

            /**
             * Adds a system message to the chat history.
             * @param {string} content - The system message content.
             */
            addSystemMessageToHistory(content) {
                ReactiveStore.state.chat_history.push({
                    type: 'system_event', content, timestamp: new Date().toISOString(), isNew: true
                });
            },

            /**
             * Deletes a single message by index.
             * @param {number} index - The index of the message.
             */
            deleteMessage(index) {
                UIManager.showConfirmationModal('Delete this message?', () => {
                    const msg = ReactiveStore.state.chat_history[index];
                    if (msg && msg.type === 'chat') {
                        ReactiveStore.state.messageCounter--;
                    }
                    ReactiveStore.state.chat_history.splice(index, 1);
                });
            },

            /**
             * Opens the delete options modal for a message.
             * @param {number} index - The index of the message.
             */
            confirmDeleteMessage(index) {
                UIManager.showDeleteMessageOptions(index);
            },

            /**
             * Executes the deletion of messages based on the selected mode.
             * @param {number} index - The index of the message.
             * @param {string} mode - 'single' or 'forward'.
             */
            executeDelete(index, mode) {
                const state = ReactiveStore.state;

                if (mode === 'single') {
                    const msg = state.chat_history[index];
                    if (msg && msg.type === 'chat') state.messageCounter--;
                    state.chat_history.splice(index, 1);
                }
                else if (mode === 'forward') {
                    // Delete this index and everything after it
                    // Count how many chat messages we are removing to update counter
                    const removed = state.chat_history.slice(index);
                    const chatCount = removed.filter(m => m.type === 'chat').length;
                    state.messageCounter = Math.max(0, state.messageCounter - chatCount);

                    // Perform truncate
                    state.chat_history.splice(index);
                }

                AppController.closeModal('confirmation-modal');
            },

            /**
             * Undoes the last turn (removes the last message).
             */
            undoLastTurn() {
                if (this.RUNTIME.activeRequestAbortController || UIManager.RUNTIME.streamingInterval) return;
                const history = ReactiveStore.state.chat_history;
                if (history.length === 0) return;

                let removedChatMessage = false;
                let i = history.length - 1;
                while (i >= 0 && !removedChatMessage) {
                    const msg = history[i];
                    history.splice(i, 1); // Reactive splice
                    if (msg.type === 'chat') {
                        ReactiveStore.state.messageCounter--;
                        removedChatMessage = true;
                    }
                    i--;
                }
            },

            /**
             * Copies the content of a message to the clipboard.
             * @param {number} index - The index of the message.
             */
            copyMessage(index) {
                const msg = ReactiveStore.state.chat_history[index];
                if (!msg) return;

                // Use modern Clipboard API
                navigator.clipboard.writeText(msg.content).then(() => {
                    // UI Feedback
                    const btn = document.querySelector(`[data-message-index='${index}'] button[data-action='chat-copy']`);
                    if (btn) {
                        const original = btn.innerHTML;
                        btn.innerHTML = `<span class="text-xs text-green-400 font-bold">Copied!</span>`;
                        setTimeout(() => btn.innerHTML = original, 1500);
                    }
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                    alert("Failed to copy to clipboard.");
                });
            },

            /**
             * Opens the edit modal for a specific message.
             * @param {number} index - The index of the message.
             */
            openEditModal(index) {
                const message = ReactiveStore.state.chat_history[index];
                if (!message) return;

                const input = document.getElementById('edit-modal-input');
                input.value = message.content;

                // Bind save button dynamically to this index
                const saveBtn = document.getElementById('edit-modal-save-button');
                // Remove old listener to prevent stacking
                const newBtn = saveBtn.cloneNode(true);
                saveBtn.parentNode.replaceChild(newBtn, saveBtn);

                newBtn.onclick = () => {
                    ReactiveStore.state.chat_history[index].content = input.value;
                    AppController.closeModal('edit-response-modal');
                };

                AppController.openModal('edit-response-modal');
            },

            /**
             * Renames the active narrative (debounced).
             * @param {string} newName - The new name.
             */
            renameActiveNarrative: debounce(function (newName) {
                const state = ReactiveStore.state;
                if (!state) return;

                // 1. Update Reactive State immediately
                state.narrativeName = newName;

                // 2. Force a save immediately to sync this name to the DB Stubs
                // This relies on our new "Surgical Update" in StoryService.saveActiveState
                ReactiveStore.forceSave();

            }, 500),

            // --- AI Generation Logic ---

            /**
             * Clears any system error messages from the chat history.
             */
            clearSystemErrors() {
                const state = ReactiveStore.state;
                if (state.chat_history.length > 0) {
                    // Filter out system events starting with "AI Error"
                    const cleanHistory = state.chat_history.filter(msg =>
                        !(msg.type === 'system_event' && msg.content.startsWith('AI Error'))
                    );

                    if (cleanHistory.length !== state.chat_history.length) {
                        state.chat_history = cleanHistory;
                    }
                }
            },

            /**
             * Triggers the AI to generate a response.
             * Handles character selection, prompt building, API calls, and streaming.
             * @param {string|null} charId - The ID of the character to speak.
             * @param {string} userMessage - The user's last message (for analysis).
             * @param {boolean} isAfterMove - Whether this follows a location move.
             */
            async triggerAIResponse(charId = null, userMessage = '', isAfterMove = false) {
                const state = ReactiveStore.state;

                // Clear previous error messages before starting new generation
                this.clearSystemErrors();

                // 1. Validation
                const activeAiChars = state.characters.filter(c => !c.is_user && c.is_active);
                if (activeAiChars.length === 0) {
                    this.addSystemMessageToHistory("No active AI characters.");
                    return;
                }
                if (!this._isModelConfigured(state)) {
                    this.addSystemMessageToHistory("AI model not configured. Check Settings.");
                    return;
                }

                // 2. Determine Speaker
                const selectorVal = document.getElementById('ai-character-selector').value;
                const targetId = charId || (selectorVal === 'any' ? this.determineNextSpeaker(isAfterMove) : selectorVal);

                if (!targetId) return;

                // 3. Setup UI for Generation
                UIManager.showTypingIndicator(targetId);
                UIManager.setButtonToStopMode();
                this.RUNTIME.activeRequestAbortController = new AbortController();

                try {
                    // 4. Generate Response
                    const prompt = PromptBuilder.buildPrompt(targetId);
                    const responseText = await APIService.callAI(prompt, false, this.RUNTIME.activeRequestAbortController.signal);

                    // 5. Analyze for Emotion/Location (Parallel)
                    let emotion = 'neutral';
                    if (userMessage) {
                        this.analyzeTurn(userMessage).then(analysis => {
                            if (analysis.locationName && typeof WorldController !== 'undefined') {
                                const grid = state.worldMap.grid;
                                const target = grid.find(l => l.name.toLowerCase() === analysis.locationName.toLowerCase());
                                const current = grid.find(l => l.coords.x === state.worldMap.currentLocation.x && l.coords.y === state.worldMap.currentLocation.y);

                                if (target && target.name !== current?.name) {
                                    setTimeout(() => WorldController.moveToLocation(target.coords.x, target.coords.y), 1500);
                                }
                            }
                        });
                    }
                    // Analyze AI Response for Sentiment (Emotion)
                    // We await this so the portrait is correct when the bubble appears
                    try {
                        const aiAnalysis = await this.analyzeTurn(responseText);
                        emotion = aiAnalysis.emotion;
                    } catch (err) {
                        console.warn("Sentiment analysis failed, defaulting to neutral.");
                    }

                    // 6. Stream Result
                    UIManager.hideTypingIndicator();
                    UIManager.startStreamingResponse(targetId, responseText, emotion);

                } catch (error) {
                    if (error.name === 'AbortError') console.log("Stopped.");
                    else this.addSystemMessageToHistory(`AI Error: ${error.message}`);
                    UIManager.hideTypingIndicator();
                } finally {
                    UIManager.setButtonToSendMode();
                    this.RUNTIME.activeRequestAbortController = null;
                    UIManager.hideTypingIndicator();
                }
            },

            /**
             * Stops the current AI generation process.
             */
            stopGeneration() {
                if (this.RUNTIME.activeRequestAbortController) {
                    this.RUNTIME.activeRequestAbortController.abort();
                }
                const state = ReactiveStore.state;
                if (state.apiProvider === 'koboldcpp' && state.koboldcpp_url) {
                    fetch(`${state.koboldcpp_url}/api/v1/generate/stop`, { method: 'POST' }).catch(() => { });
                }

                if (UIManager.RUNTIME.streamingInterval) {
                    clearInterval(UIManager.RUNTIME.streamingInterval);
                    UIManager.RUNTIME.streamingInterval = null;
                }

                UIManager.hideTypingIndicator();
                UIManager.setButtonToSendMode();
                this.RUNTIME.activeRequestAbortController = null;
            },

            /**
             * Determines the next speaker based on heuristics and history.
             * @param {boolean} isAfterMove - Whether this follows a location move.
             * @returns {string|null} - The ID of the next speaker.
             */
            determineNextSpeaker(isAfterMove) {
                const state = ReactiveStore.state;
                let pool = state.characters.filter(c => !c.is_user && c.is_active);
                if (pool.length === 0) return null;
                if (pool.length === 1) return pool[0].id;

                if (isAfterMove) {
                    const narrators = pool.filter(c => c.is_narrator);
                    if (narrators.length > 0) return narrators[Math.floor(Math.random() * narrators.length)].id;
                }

                // Simple heuristic scoring
                const scores = {};
                pool.forEach(c => scores[c.id] = c.is_narrator ? 0 : 1);

                // Weight recent speakers lower
                const history = state.chat_history.slice(-5).reverse();
                history.forEach((msg, idx) => {
                    if (msg.type === 'chat' && scores[msg.character_id] !== undefined) {
                        scores[msg.character_id] -= (5 - idx) * 0.2; // Decay
                    }
                });

                const weights = pool.map(c => Math.max(0.1, scores[c.id]));
                const winner = UTILITY.weightedChoice(pool, weights);
                return winner ? winner.id : pool[0].id;
            },

            /**
             * Analyzes a text turn for emotion and location changes.
             * @param {string} text - The text to analyze.
             * @returns {Promise<Object>} - The analysis result { emotion, locationName }.
             */
            async analyzeTurn(text) {
                const state = ReactiveStore.state;

                // 1. Check Toggle
                if (state.enableAnalysis === false) return { emotion: 'neutral', locationName: null };

                // 2. Context-Aware Location List (Current + Adjacent)
                const grid = state.worldMap?.grid || [];
                const currentCoords = state.worldMap?.currentLocation;
                let validLocations = [];

                if (currentCoords) {
                    const cur = grid.find(l => l.coords.x === currentCoords.x && l.coords.y === currentCoords.y);
                    if (cur) validLocations.push(cur.name);
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            const adj = grid.find(l => l.coords.x === currentCoords.x + dx && l.coords.y === currentCoords.y + dy);
                            if (adj && adj.name) validLocations.push(adj.name);
                        }
                    }
                }
                if (validLocations.length === 0) validLocations = grid.map(l => l.name);
                validLocations = [...new Set(validLocations)].filter(Boolean);
                const locStr = validLocations.join(', ');

                try {
                    const prompt = `Analyze the text.
                    1. Identify the speaker's emotion. Options: 'happy', 'sad', 'angry', 'surprised', 'neutral'.
                    2. Determine if the text explicitly indicates moving to a location.
                    IMPORTANT: You may ONLY select a location from this list: [${locStr}].
                    If the text does not strictly match a location in that list, set "locationName" to null.
                    TEXT: "${text}"
                    Return valid JSON: { "emotion": "string", "locationName": "string" or null }`;

                    const res = await APIService.callAI(prompt, true);
                    const data = UTILITY.extractAndParseJSON(res); // Use safe parser

                    const validEmotions = ['happy', 'sad', 'angry', 'surprised', 'neutral'];
                    const emotion = (data?.emotion && validEmotions.includes(data.emotion.toLowerCase())) ? data.emotion.toLowerCase() : 'neutral';
                    return { emotion, locationName: data?.locationName || null };
                } catch (e) {
                    return { emotion: 'neutral', locationName: null };
                }
            },

            // --- Character Management ---

            /**
             * Adds a new character to the roster.
             */
            addCharacter() {
                const aiCount = ReactiveStore.state.characters.filter(c => !c.is_user).length;
                const color = this.CONSTANTS.CHARACTER_COLORS[aiCount % this.CONSTANTS.CHARACTER_COLORS.length];

                const newChar = {
                    id: UTILITY.uuid(), name: "New Character", description: "", short_description: "Summary",
                    model_instructions: "Act as {character}.", image_url: "", extra_portraits: [],
                    tags: [], is_user: false, is_active: true, color: color, is_narrator: false
                };

                ReactiveStore.state.characters.push(newChar);
                AppController.openModal('character-detail-modal', newChar.id);
            },

            /**
             * Deletes a character by ID.
             * @param {string} id - The character ID.
             */
            deleteCharacter(id) {
                UIManager.showConfirmationModal('Delete this character?', () => {
                    ReactiveStore.state.characters = ReactiveStore.state.characters.filter(c => c.id !== id);
                    DBService.deleteImage(id);
                    AppController.closeModal('character-detail-modal');
                });
            },

            /**
             * Quickly creates a new character using AI based on a name and context.
             */
            async quickCreateCharacter() {
                const state = ReactiveStore.state;
                if (!state || !state.chat_history) {
                    alert("Please load a story first.");
                    return;
                }

                // 1. Get the name
                const name = prompt("Who would you like to create? Enter a name mentioned in the story:");
                if (!name || name.trim() === "") return;

                UIManager.showLoadingSpinner(`Dreaming up ${name}...`);

                try {
                    // 2. Gather Context (Last 30 messages + World Info)
                    const recentHistory = state.chat_history
                        .slice(-30)
                        .filter(m => m.type === 'chat' && !m.isHidden)
                        .map(m => {
                            const char = state.characters.find(c => c.id === m.character_id);
                            return `${char ? char.name : 'Unknown'}: ${m.content}`;
                        })
                        .join('\n');
                    const staticLore = (state.static_entries || []).map(e => `${e.title}: ${e.content}`).join('\n');

                    const context = `LORE:\n${staticLore}\n\nRECENT CHAT:\n${recentHistory}`;

                    // 3. Call Shared Generator
                    const data = await this.generateCharacterProfile(name, context);

                    if (!data) throw new Error("AI returned invalid JSON or failed to generate profile.");

                    // 4. Create Character Object
                    const aiCount = state.characters.filter(c => !c.is_user).length;

                    // Use AI-suggested color or cycle through defaults
                    const color = data.color_hex
                        ? { base: data.color_hex, bold: '#ffffff' }
                        : this.CONSTANTS.CHARACTER_COLORS[aiCount % this.CONSTANTS.CHARACTER_COLORS.length];

                    const newChar = {
                        id: UTILITY.uuid(),
                        name: name.trim(),
                        description: data.description || "A mysterious character.",
                        short_description: data.short_description || "A new character.",
                        model_instructions: data.model_instructions || `Act as ${name}.`,
                        image_url: "",
                        extra_portraits: [],
                        tags: data.tags || [],
                        is_user: false,
                        is_active: true,
                        color: color,
                        is_narrator: false
                    };

                    // 5. Save and Open
                    state.characters.push(newChar);
                    await ReactiveStore.forceSave(); // Ensure persistence

                    UIManager.hideLoadingSpinner();
                    UIManager.renderCharacters();

                    // Open the detail modal so user can refine it
                    AppController.openModal('character-detail-modal', newChar.id);

                } catch (error) {
                    UIManager.hideLoadingSpinner();
                    console.error("Quick Create failed:", error);
                    alert(`Failed to generate character: ${error.message}`);
                }
            },

            /**
             * Updates a specific field of a character (debounced).
             * @param {string} id - The character ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateCharacterField: debounce(function (id, field, value) {
                const char = ReactiveStore.state.characters.find(c => c.id === id);
                if (char) {
                    char[field] = value;
                    if (field === 'name') { // Live update modal header
                        const header = document.querySelector(`#character-detail-modal-content h2[data-char-id="${id}"]`);
                        if (header) header.textContent = value;
                    }
                }
            }, 300),

            /**
             * Updates a character's tags (debounced).
             * @param {string} id - The character ID.
             * @param {string} value - The comma-separated tags string.
             */
            updateCharacterTags: debounce(function (id, value) {
                const char = ReactiveStore.state.characters.find(c => c.id === id);
                if (char) {
                    char.tags = value.split(',').map(t => t.trim()).filter(Boolean);
                }
            }, 300),

            /**
             * Sets the role of a character (user or narrator).
             * @param {string} charId - The character ID.
             * @param {string} role - 'user' or 'narrator'.
             */
            setCharacterRole(charId, role) {
                ReactiveStore.state.characters.forEach(c => {
                    if (c.id === charId) {
                        c.is_user = (role === 'user');
                        c.is_narrator = (role === 'narrator');
                    } else if (role === 'user') {
                        c.is_user = false; // Single user enforcement
                    }
                });
                UIManager.openCharacterDetailModal(charId); // Refresh view
            },

            /**
             * Toggles a character's active status.
             * @param {Event} event - The checkbox change event.
             * @param {string} id - The character ID.
             */
            toggleCharacterActive(event, id) {
                const char = ReactiveStore.state.characters.find(c => c.id === id);
                if (char) char.is_active = event.target.checked;
            },

            // Character Colors ---
            /**
             * Updates a character's color settings (debounced).
             * @param {string} id - The character ID.
             * @param {string} type - 'base' or 'bold'.
             * @param {string} value - The hex color code.
             */
            updateCharacterColor: debounce(function (id, type, value) {
                const char = ReactiveStore.state.characters.find(c => c.id === id);
                if (char) {
                    if (!char.color) char.color = { base: '#334155', bold: '#94a3b8' };
                    char.color[type] = value;
                    // Force styling refresh if needed, though ReactiveStore should handle standard bindings.
                    // However, message bubbles use color directly from state during renderChat.
                    // If we want live update of existing bubbles without full re-render, we might need UIManager.renderChat();
                    UIManager.renderChat();
                }
            }, 300),

            // Emotional Portraits ---
            /**
             * Adds a new extra portrait slot for a character.
             * @param {string} charId - The character ID.
             */
            addExtraPortrait(charId) {
                const char = ReactiveStore.state.characters.find(c => c.id === charId);
                if (!char) return;
                if (!char.extra_portraits) char.extra_portraits = [];

                // Capture scroll position
                const container = document.getElementById('character-detail-modal-content');
                const scrollTop = container ? container.scrollTop : 0;

                char.extra_portraits.push({ emotion: 'neutral', url: '' });
                UIManager.openCharacterDetailModal(charId); // Refresh modal

                // Restore scroll position
                const newContainer = document.getElementById('character-detail-modal-content');
                if (newContainer) newContainer.scrollTop = scrollTop;
            },

            /**
             * Removes an extra portrait slot.
             * @param {string} charId - The character ID.
             * @param {number} index - The index of the portrait.
             */
            removeExtraPortrait(charId, index) {
                const char = ReactiveStore.state.characters.find(c => c.id === charId);
                if (!char || !char.extra_portraits) return;
                char.extra_portraits.splice(index, 1);

                // Clean up IDB image if exists
                const emoKey = `${charId}::emotion::${index}`; // Note: Logic in hydration uses emotion name, but deletion might be tricky if emotion name changed. 
                // Simplified: We just refresh the UI. Actual image cleanup usually happens on story delete or explicit cleanup.
                UIManager.openCharacterDetailModal(charId);
            },

            /**
             * Updates a field of an extra portrait (debounced).
             * @param {string} charId - The character ID.
             * @param {number} index - The index of the portrait.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateExtraPortrait: debounce(function (charId, index, field, value) {
                const char = ReactiveStore.state.characters.find(c => c.id === charId);
                if (char && char.extra_portraits && char.extra_portraits[index]) {
                    char.extra_portraits[index][field] = value;
                }
            }, 300),

            /**
             * Handles the upload of a local image for a specific emotion.
             * @param {Event} event - The file input change event.
             * @param {string} charId - The character ID.
             * @param {number} index - The index of the portrait.
             */
            async handleLocalEmotionImageUpload(event, charId, index) {
                const file = event.target.files[0];
                if (!file) return;
                const char = ReactiveStore.state.characters.find(c => c.id === charId);
                if (!char || !char.extra_portraits[index]) return;

                try {
                    const emotion = char.extra_portraits[index].emotion || 'neutral';
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    const key = `${charId}::emotion::${emotion}`;

                    await DBService.saveImage(key, blob);
                    UIManager.RUNTIME.characterImageCache[key] = URL.createObjectURL(blob);

                    // Clear manual URL to indicate local preference
                    char.extra_portraits[index].url = '';

                    UIManager.openCharacterDetailModal(charId);
                } catch (e) { alert("Image upload failed."); }
            },

            // --- Example Dialogue Logic ---

            /**
             * Adds a new turn to the example dialogue.
             */
            addExampleDialogueTurn() {
                const state = ReactiveStore.state;
                const firstAi = state.characters.find(c => !c.is_user);
                if (!firstAi) return alert("Need AI character.");
                state.chat_history.push({
                    character_id: firstAi.id, content: "New example.", type: 'chat',
                    emotion: 'neutral', timestamp: new Date().toISOString(), isHidden: true
                });
                UIManager.renderExampleDialogueModal();
            },

            /**
             * Deletes a turn from the example dialogue.
             * @param {number} index - The index of the turn.
             */
            deleteExampleDialogueTurn(index) {
                ReactiveStore.state.chat_history.splice(index, 1);
                UIManager.renderExampleDialogueModal();
            },

            /**
             * Moves an example dialogue turn up or down.
             * @param {number} index - The index of the turn.
             * @param {string} direction - 'up' or 'down'.
             */
            moveExampleDialogueTurn(index, direction) {
                const history = ReactiveStore.state.chat_history;
                if (!history[index]) return;

                let swapIndex = -1;
                // Find next/prev hidden message
                if (direction === 'up') {
                    for (let i = index - 1; i >= 0; i--) { if (history[i].isHidden) { swapIndex = i; break; } }
                } else {
                    for (let i = index + 1; i < history.length; i++) { if (history[i].isHidden) { swapIndex = i; break; } }
                }

                if (swapIndex !== -1) {
                    const temp = history[swapIndex];
                    history[swapIndex] = history[index];
                    history[index] = temp;
                    UIManager.renderExampleDialogueModal();
                }
            },

            /**
             * Updates a field of an example dialogue turn (debounced).
             * @param {number} index - The index of the turn.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateExampleDialogueTurn: debounce(function (index, field, value) {
                if (ReactiveStore.state.chat_history[index]) {
                    ReactiveStore.state.chat_history[index][field] = value;
                }
            }, 300),

            // --- Helpers ---

            /**
             * Enhances a character's description using AI.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async enhancePersonaWithAI(event, charId) {
                const char = ReactiveStore.state.characters.find(c => c.id === charId);
                if (!char) return;
                UIManager.showConfirmationModal('Overwrite persona?', async () => {
                    const prompt = ReactiveStore.state.prompt_persona_gen.replace('{concept}', char.description);
                    const res = await this._gen(event, prompt);
                    if (res) {
                        char.description = res;
                        // Update UI manually for immediate feedback if open
                        const el = document.getElementById(`persona-description-${char.id}`);
                        if (el) el.value = res;
                    }
                });
            },

            /**
             * Generates tags for a character using AI.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async generateTagsForCharacter(event, charId) {
                const char = ReactiveStore.state.characters.find(c => c.id === charId);
                if (!char) return;
                const prompt = `Generate 3-5 tags for: ${char.name}. Description: ${char.description}`;
                const res = await this._gen(event, prompt);
                if (res) {
                    const tags = res.split(',').map(t => t.trim().toLowerCase());
                    char.tags = [...new Set([...(char.tags || []), ...tags])];
                }
            },

            /**
             * Generates model instructions for a character using AI.
             * @param {Event} event - The click event.
             * @param {string} charId - The character ID.
             */
            async generateModelInstructions(event, charId) {
                const char = ReactiveStore.state.characters.find(c => c.id === charId);
                if (!char) return;
                const prompt = `Generate model instructions for ${char.name} based on: ${char.description}`;
                const res = await this._gen(event, prompt);
                if (res) {
                    char.model_instructions = res;
                    UIManager.openCharacterDetailModal(charId);
                }
            },

            /**
             * Handles the upload of a local image for a character.
             * @param {Event} event - The file input change event.
             * @param {string} charId - The character ID.
             */
            async handleLocalImageUpload(event, charId) {
                const file = event.target.files[0];
                if (!file) return;
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    await DBService.saveImage(charId, blob);
                    UIManager.RUNTIME.characterImageCache[charId] = URL.createObjectURL(blob);
                    this.updateCharacterField(charId, 'image_url', ''); // Clear legacy
                    UIManager.renderCharacters();
                } catch (e) { alert("Image upload failed."); }
            },

            /**
             * Compiles a regex for a keyword trigger.
             * @param {string} keyword - The keyword to match.
             * @returns {RegExp} - The compiled regex.
             * @private
             */
            _compileTriggerRegex(keyword) {
                // Escape special regex characters
                const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Matches whole word/phrase, case insensitive
                return new RegExp(`\\b${escaped}\\b`, 'i');
            },

            /**
             * Parses a trigger string into groups and probability chance.
             * @param {string} triggersStr - The raw trigger string.
             * @returns {Object} - { groups: Array, chance: number }.
             */
            parseTriggers(triggersStr) {
                if (!triggersStr) return { groups: [], chance: 0 };
                const parts = triggersStr.split(',').map(s => s.trim());
                const chancePart = parts.find(p => p.match(/^\d+\s*\%$/));
                const chance = chancePart ? parseInt(chancePart.replace('%', '')) : 0;
                const keywordParts = parts.filter(p => p && !p.match(/^\d+\s*\%$/));

                const groups = keywordParts.map(part => {
                    if (part.includes(' XOR ')) {
                        const keywords = part.split(' XOR ').map(k => k.trim().toLowerCase()).filter(Boolean);
                        if (keywords.length === 2) return { type: 'XOR', keywords };
                    }
                    if (part.includes(' AND ')) {
                        const keywords = part.split(' AND ').map(k => k.trim().toLowerCase()).filter(Boolean);
                        if (keywords.length > 0) return { type: 'AND', keywords };
                    }
                    return { type: 'OR', keywords: [part.toLowerCase()] };
                });
                return { groups, chance };
            },

            /**
             * Checks the last message for dynamic entry keyphrases.
             * If triggered, injects the entry into the history (and optionally removes previous reveals).
             * @returns {boolean} - True if state changed (requires re-render).
             */
            checkDynamicEntryTriggers() {
                const state = ReactiveStore.state;

                const lastMsg = state.chat_history.slice().reverse().find(m => m && m.type === 'chat');
                if (!lastMsg) return false; // Return false if no check occurred

                const content = lastMsg.content;
                let stateChanged = false;

                (state.dynamic_entries || []).forEach(entry => {
                    // 1. Check triggers
                    const { groups, chance } = this.parseTriggers(entry.triggers);

                    const keywordMatch = groups.some(group => {
                        const patterns = group.keywords.map(kw => this._compileTriggerRegex(kw));
                        switch (group.type) {
                            case 'OR': return patterns.some(regex => regex.test(content));
                            case 'AND': return patterns.every(regex => regex.test(content));
                            case 'XOR':
                                const [f, s] = [patterns[0].test(content), patterns[1].test(content)];
                                return (f && !s) || (!f && s);
                            default: return false;
                        }
                    });

                    // 2. If triggered:
                    if (keywordMatch || (Math.random() * 100 < chance)) {

                        // 3. De-duplicate: Look-behind 20 messages
                        const searchWindowStart = Math.max(0, state.chat_history.length - 20);
                        let foundIndex = -1;

                        for (let i = state.chat_history.length - 1; i >= searchWindowStart; i--) {
                            const msg = state.chat_history[i];
                            if (msg && msg.type === 'lore_reveal' && msg.dynamic_entry_id === entry.id) {
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
                        if (!entry.content_fields || entry.content_fields.length === 0) return;

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
                    UIManager.renderDynamicEntries();
                }

                // Return the boolean so UIManager knows if indices shifted
                return stateChanged;
            },


            /**
             * Helper for AI generation buttons.
             * @param {Event} event - The triggering event.
             * @param {string} prompt - The prompt to send.
             * @returns {Promise<string|null>} - The generated content or null.
             * @private
             */
            async _gen(event, prompt) {
                // Helper for button state handling
                const btn = event.target.closest('button');
                if (btn) { btn.disabled = true; btn.innerHTML = '...'; }
                try { return await APIService.callAI(prompt); }
                catch (e) { alert(e.message); return null; }
                finally { if (btn) { btn.disabled = false; btn.innerHTML = 'Gen'; } }
            },

            /**
             * Checks if an AI model is properly configured.
             * Checks both local state and global settings.
             */
            _isModelConfigured(s) {
                const global = StateManager.data.globalSettings;

                if (s.apiProvider === 'gemini') {
                    return (s.geminiApiKey && s.geminiApiKey.trim() !== '') ||
                        (global.geminiApiKey && global.geminiApiKey.trim() !== '');
                }
                if (s.apiProvider === 'openrouter') {
                    return (s.openRouterKey && s.openRouterKey.trim() !== '') ||
                        (global.openRouterKey && global.openRouterKey.trim() !== '');
                }
                if (s.apiProvider === 'koboldcpp') return !!s.koboldcpp_url;
                if (s.apiProvider === 'lmstudio') return !!s.lmstudio_url;

                return false;
            },

            /**
             * Displays the raw prompt that would be sent to the AI.
             * Useful for debugging.
             */
            viewRawPrompt() {
                const state = ReactiveStore.state;

                // 1. Determine who the prompt is for
                let charId = document.getElementById('ai-character-selector').value;
                if (charId === 'any') charId = this.determineNextSpeaker(false);

                if (!charId) {
                    alert("No active AI character found to build a prompt for.");
                    return;
                }

                // 2. Build the prompt string using the shared logic
                const promptText = PromptBuilder.buildPrompt(charId);

                // 3. Generate Metadata Header for the view
                let metaInfo = `--- DEBUG INFO ---\n`;
                metaInfo += `Active Provider: ${state.apiProvider}\n`;

                if (state.apiProvider === 'koboldcpp') {
                    // Show specific template being used
                    const template = state.koboldcpp_template || 'none';
                    metaInfo += `Active Template: ${template.toUpperCase()}\n`;

                    // Estimate Token Count (Roughly 4 chars per token)
                    const estTokens = Math.ceil(promptText.length / 4);
                    const maxCtx = 4096; // Default context limit
                    const usage = Math.round((estTokens / maxCtx) * 100);
                    metaInfo += `Est. Context Usage: ~${estTokens} / ${maxCtx} tokens (${usage}%)\n`;
                } else {
                    metaInfo += `Template: Standard (Cloud/Default)\n`;
                }

                metaInfo += `------------------\n\n`;

                // 4. Render
                const contentEl = document.getElementById('raw-prompt-content');
                if (contentEl) {
                    contentEl.textContent = metaInfo + promptText;
                }

                AppController.openModal('view-raw-prompt-modal');
            }
        };

        const WorldController = {
            RUNTIME: {
                activeWorldMapTab: 'move',
                selectedMapTile: null,
                pendingMove: null,
                turnOfArrival: 0,
                selectedLocalStaticEntryId: null
            },

            // --- World Map Navigation ---

            /**
             * Switches the active tab in the World Map modal.
             * @param {string} tabName - 'move' or 'edit'.
             */
            switchWorldMapTab(tabName) {
                this.RUNTIME.activeWorldMapTab = tabName;
                UIManager.renderWorldMapModal();
            },



            /**
             * Selects a tile for a pending move operation.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            selectPendingMove(x, y) {
                this.RUNTIME.pendingMove = { x, y };
                UIManager.renderWorldMapModal();
            },

            /**
             * Confirms and executes the pending move.
             */
            confirmMove() {
                const state = ReactiveStore.state;
                const { pendingMove } = this.RUNTIME;
                const { currentLocation } = state.worldMap;

                if (pendingMove && (pendingMove.x !== currentLocation.x || pendingMove.y !== currentLocation.y)) {
                    this.moveToLocation(pendingMove.x, pendingMove.y);
                }

                this.RUNTIME.pendingMove = null;
                AppController.closeModal('world-map-modal');
            },

            /**
             * Moves the party to a specific location.
             * Updates state, path, background, and triggers AI response.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            moveToLocation(x, y) {
                const state = ReactiveStore.state;
                const targetLocation = state.worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);

                if (targetLocation) {
                    const previousLocationCoords = { ...state.worldMap.currentLocation };
                    const turnOfDeparture = state.messageCounter;

                    // Trigger memory summary (Async side effect)
                    if (this.RUNTIME.turnOfArrival !== null && turnOfDeparture > this.RUNTIME.turnOfArrival) {
                        this.summarizeActivityForLocation(previousLocationCoords, this.RUNTIME.turnOfArrival);
                    }

                    // 1. Update Location (Triggers auto-save)
                    state.worldMap.currentLocation = { x, y };
                    this.RUNTIME.turnOfArrival = state.messageCounter;

                    // 2. Update Path
                    if (state.worldMap.destination && state.worldMap.destination.x !== null) {
                        state.worldMap.path = UTILITY.findPath(state.worldMap.grid, state.worldMap.currentLocation, state.worldMap.destination);
                    } else {
                        state.worldMap.path = [];
                    }

                    // 3. Add System Message
                    if (typeof NarrativeController !== 'undefined') {
                        NarrativeController.addSystemMessageToHistory(`You have moved to ${targetLocation.name}.`);
                    }

                    // 4. Reset UI Selection Runtime State
                    this.RUNTIME.selectedMapTile = null;
                    this.RUNTIME.pendingMove = null;

                    // 5. Trigger AI Response (Narrator prefers to speak on move)
                    const narrator = state.characters.find(c => c.is_narrator && c.is_active);
                    if (typeof NarrativeController !== 'undefined') {
                        NarrativeController.triggerAIResponse(narrator ? narrator.id : null, '', true);
                    }

                    // 6. Update Background
                    UIManager.applyStyling();
                }
            },

            /**
             * Generates a summary of activity at a location upon departure.
             * @param {Object} locationCoords - The coordinates of the location.
             * @param {number} startTurn - The turn number when arrived.
             */
            async summarizeActivityForLocation(locationCoords, startTurn) {
                try {
                    const state = ReactiveStore.state;
                    const endTurn = state.messageCounter;

                    // Access raw array from proxy to avoid issues, though proxy access is usually fine for read
                    const history = state.chat_history;
                    const relevantHistory = history.slice(startTurn, endTurn).filter(msg => msg.type === 'chat' && !msg.isHidden);

                    if (relevantHistory.length === 0) return;

                    const chatTranscript = relevantHistory.map(msg => {
                        const char = state.characters.find(c => c.id === msg.character_id);
                        return `${char ? char.name : 'Unknown'}: ${msg.content}`;
                    }).join('\n');

                    const promptTemplate = state.prompt_location_memory_gen || UTILITY.getDefaultSystemPrompts().prompt_location_memory_gen;
                    const prompt = promptTemplate.replace('{transcript}', chatTranscript);

                    const summaryContent = await APIService.callAI(prompt);

                    // Find location in ReactiveStore to update
                    const location = state.worldMap.grid.find(loc => loc.coords.x === locationCoords.x && loc.coords.y === locationCoords.y);
                    if (location) {
                        if (!location.local_static_entries) location.local_static_entries = [];

                        location.local_static_entries.push({
                            id: UTILITY.uuid(),
                            title: `Events from turn ${startTurn} to ${endTurn}`,
                            content: summaryContent
                        });
                    }
                } catch (error) {
                    console.error("Failed to auto-generate location memory:", error);
                }
            },

            // --- Map Management (Edit Mode) ---

            /**
             * Selects a map tile for editing or viewing details.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            selectMapTile(x, y) {
                const state = ReactiveStore.state;
                const tile = state.worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                this.RUNTIME.selectedMapTile = tile || null;
                this.RUNTIME.selectedLocalStaticEntryId = null;

                // Open the specific location details modal
                if (this.RUNTIME.selectedMapTile) {
                    AppController.openModal('location-details-modal');
                    UIManager.renderLocationDetailsModal();
                }
            },

            // Update image upload handler to refresh the new modal if open
            /**
             * Handles the upload of a custom image for a location.
             * @param {Event} event - The file input change event.
             * @param {number} x - The x-coordinate.
             * @param {number} y - The y-coordinate.
             */
            async handleWorldMapLocationImageUpload(event, x, y) {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { alert("Image too large."); return; }

                UIManager.showLoadingSpinner('Processing location image...');
                try {
                    const blob = await ImageProcessor.processImageAsBlob(file);
                    const locationKey = `location::${x},${y}`;
                    await DBService.saveImage(locationKey, blob);

                    UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                    if (UIManager.RUNTIME.worldImageCache[locationKey]) URL.revokeObjectURL(UIManager.RUNTIME.worldImageCache[locationKey]);
                    UIManager.RUNTIME.worldImageCache[locationKey] = URL.createObjectURL(blob);

                    const grid = ReactiveStore.state.worldMap.grid;
                    const location = grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                    if (location) location.imageUrl = `local_idb_location::${x},${y}`;

                    // Refresh the new modal
                    UIManager.renderLocationDetailsModal();
                    UIManager.applyStyling();

                } catch (err) {
                    alert(`Upload failed: ${err.message}`);
                } finally {
                    UIManager.hideLoadingSpinner();
                    event.target.value = '';
                }
            },

            /**
             * Sets the current selected tile as the travel destination.
             * Calculates the path.
             */
            setDestination() {
                const selected = this.RUNTIME.selectedMapTile;
                if (!selected) return;

                const state = ReactiveStore.state;
                state.worldMap.destination = selected.coords;
                state.worldMap.path = UTILITY.findPath(state.worldMap.grid, state.worldMap.currentLocation, selected.coords);

                UIManager.renderWorldMapModal();
            },

            /**
             * Updates a field of the selected location (debounced).
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateLocationDetail: debounce(function (field, value) {
                const selected = this.RUNTIME.selectedMapTile;
                if (!selected) return;

                // Find the object INSIDE the ReactiveStore array to trigger the proxy
                const grid = ReactiveStore.state.worldMap.grid;
                const locationInGrid = grid.find(loc => loc.coords.x === selected.coords.x && loc.coords.y === selected.coords.y);

                if (locationInGrid) {
                    locationInGrid[field] = value;
                }
            }, 500),




            /**
             * Clears the entire world map after confirmation.
             */
            async clearWorldMap() {
                const proceed = await UIManager.showConfirmationPromise('Are you sure you want to clear the entire world map? This cannot be undone.');
                if (!proceed) return;

                const state = ReactiveStore.state;
                state.worldMap.grid = UTILITY.createDefaultMapGrid();
                state.worldMap.currentLocation = { x: 4, y: 4 };
                state.worldMap.destination = { x: null, y: null };
                state.worldMap.path = [];
                this.RUNTIME.selectedMapTile = null;

                UIManager.renderWorldMapModal();
                UIManager.applyStyling();
            },

            /**
             * Pure Generator Function.
             * Generates a 8x8 map grid based on context.
             * @param {Object} contextObj - The context for generation.
             * @returns {Promise<Array>} - The generated grid.
             */
            async generateMapGrid(contextObj) {
                const promptTemplate = StateManager.getState().prompt_world_map_gen || UTILITY.getDefaultSystemPrompts().prompt_world_map_gen;
                let prompt = promptTemplate
                    .replace('{characters}', contextObj.characters || '')
                    .replace('{static}', contextObj.static_lore || '')
                    .replace('{recent}', contextObj.recent_events || '');

                const response = await APIService.callAI(prompt, true);
                const data = UTILITY.extractAndParseJSON(response);
                if (data && data.grid && data.grid.length === 64) {
                    // Sanitize
                    data.grid.forEach(l => {
                        if (!l.local_static_entries) l.local_static_entries = [];
                        if (!l.imageUrl) l.imageUrl = "";
                        if (!l.prompt) l.prompt = "";
                        if (!l.name || l.name === "Undefined") l.name = "";
                    });
                    return data.grid;
                }
                throw new Error("Invalid grid");
            },

            /**
             * UI Handler for generating the world map.
             * Requests user confirmation before overwriting.
             * @param {Event} event - The click event.
             */
            async generateWorldMap(event) {
                const proceed = await UIManager.showConfirmationPromise('Overwrite map with AI generation?');
                if (!proceed) return;

                const state = ReactiveStore.state;
                const btn = event.target.closest('button');
                if (btn) { btn.disabled = true; btn.innerHTML = '...'; }

                try {
                    const context = {
                        characters: state.characters.map(c => `${c.name}: ${c.short_description}`).join('\n'),
                        static_lore: (state.static_entries || []).map(e => `* ${e.title}: ${e.content}`).join('\n'),
                        recent_events: (state.chat_history || []).filter(m => m.type === 'chat').slice(-3).map(m => m.content).join('\n---\n')
                    };

                    const newGrid = await this.generateMapGrid(context);
                    state.worldMap.grid = newGrid;
                    state.worldMap.currentLocation = { x: 4, y: 4 };
                    state.worldMap.destination = { x: null, y: null };
                    state.worldMap.path = [];

                    this.RUNTIME.selectedMapTile = null;
                    UIManager.renderWorldMapModal();
                    UIManager.applyStyling();
                } catch (e) {
                    alert(e.message);
                } finally {
                    if (btn) { btn.disabled = false; btn.innerHTML = UIManager.getAIGenIcon(); }
                }
            },

            /**
             * Generates a description for a location using AI.
             * @param {Event} event - The click event.
             */
            async generateLocationPromptAI(event) {
                const state = ReactiveStore.state;
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;

                // Resolve button first
                const button = event.target.closest('button');
                if (!button) return;

                button.disabled = true; button.innerHTML = '...';

                try {
                    const prompt = state.prompt_location_gen
                        .replace('{name}', location.name)
                        .replace('{description}', location.description);

                    const newContent = await APIService.callAI(prompt);
                    this.updateLocationDetail('prompt', newContent);

                    // Find textarea relative to the BUTTON
                    const textarea = button.parentElement.querySelector('textarea');
                    if (textarea) textarea.value = newContent;

                } catch (e) { alert(e.message); }
                finally { button.disabled = false; button.innerHTML = UIManager.getAIGenIcon(); }
            },

            // --- Local Static Lore (Map Specific) ---

            /**
             * Adds a new local static entry to the selected location.
             */
            addLocalStaticEntry() {
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;

                // We must operate on the reactive object
                const state = ReactiveStore.state;
                const reactiveLoc = state.worldMap.grid.find(l => l.coords.x === location.coords.x && l.coords.y === location.coords.y);

                if (reactiveLoc) {
                    if (!reactiveLoc.local_static_entries) reactiveLoc.local_static_entries = [];
                    const newEntry = { id: UTILITY.uuid(), title: "New Local Entry", content: "" };
                    reactiveLoc.local_static_entries.push(newEntry);
                    this.RUNTIME.selectedLocalStaticEntryId = newEntry.id;

                    UIManager.renderLocalStaticEntriesList();
                    UIManager.renderLocalStaticEntryDetails();
                }
            },

            /**
             * Deletes a local static entry.
             * @param {string} entryId - The entry ID.
             */
            deleteLocalStaticEntry(entryId) {
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;

                const state = ReactiveStore.state;
                const reactiveLoc = state.worldMap.grid.find(l => l.coords.x === location.coords.x && l.coords.y === location.coords.y);

                if (reactiveLoc && reactiveLoc.local_static_entries) {
                    reactiveLoc.local_static_entries = reactiveLoc.local_static_entries.filter(e => e.id !== entryId);
                    if (this.RUNTIME.selectedLocalStaticEntryId === entryId) {
                        this.RUNTIME.selectedLocalStaticEntryId = null;
                    }
                    UIManager.renderLocalStaticEntriesList();
                    UIManager.renderLocalStaticEntryDetails();
                }
            },

            /**
             * Selects a local static entry for viewing/editing.
             * @param {string} entryId - The entry ID.
             */
            selectLocalStaticEntry(entryId) {
                this.RUNTIME.selectedLocalStaticEntryId = entryId;
                UIManager.renderLocalStaticEntriesList();
                UIManager.renderLocalStaticEntryDetails();
            },

            /**
             * Updates a field of a local static entry (debounced).
             * @param {string} entryId - The entry ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateLocalStaticEntryField: debounce(function (entryId, field, value) {
                const location = this.RUNTIME.selectedMapTile;
                if (!location) return;
                const state = ReactiveStore.state;
                const reactiveLoc = state.worldMap.grid.find(l => l.coords.x === location.coords.x && l.coords.y === location.coords.y);

                if (reactiveLoc && reactiveLoc.local_static_entries) {
                    const entry = reactiveLoc.local_static_entries.find(e => e.id === entryId);
                    if (entry) entry[field] = value;
                }
            }, 300),

            // --- Static Knowledge (Global) ---

            /**
             * Adds a new global static entry.
             */
            addStaticEntry() {
                const newEntry = { id: UTILITY.uuid(), title: "New Static Entry", content: "" };
                ReactiveStore.state.static_entries.push(newEntry);
                ReactiveStore.state.selectedStaticEntryId = newEntry.id;
            },

            /**
             * Deletes a global static entry.
             * @param {string} id - The entry ID.
             */
            deleteStaticEntry(id) {
                ReactiveStore.state.static_entries = ReactiveStore.state.static_entries.filter(e => e.id !== id);
                if (ReactiveStore.state.selectedStaticEntryId === id) {
                    ReactiveStore.state.selectedStaticEntryId = null;
                }
            },

            /**
             * Selects a global static entry for viewing/editing.
             * @param {string} id - The entry ID.
             */
            selectStaticEntry(id) {
                ReactiveStore.state.selectedStaticEntryId = id;
            },

            /**
             * Updates a field of a global static entry (debounced).
             * @param {string} id - The entry ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateStaticEntryField: debounce(function (id, field, value) {
                const entry = ReactiveStore.state.static_entries.find(e => e.id === id);
                if (entry) entry[field] = value;
            }, 300),

            /**
             * Generates content for a static entry using AI.
             * @param {Event} event - The click event.
             * @param {string} entryId - The entry ID.
             */
            async generateStaticEntryContentAI(event, entryId) {
                const entry = ReactiveStore.state.static_entries.find(e => e.id === entryId);
                if (!entry) return;

                // Resolve button first
                const button = event.target.closest('button');
                if (!button) return;

                button.disabled = true; button.innerHTML = '...';

                try {
                    const prompt = ReactiveStore.state.prompt_entry_gen.replace('{title}', entry.title).replace('{triggers}', '');
                    const content = await APIService.callAI(prompt);
                    this.updateStaticEntryField(entryId, 'content', content);

                    // Find textarea relative to the BUTTON
                    const textarea = button.parentElement.querySelector('textarea');
                    if (textarea) textarea.value = content;
                } catch (e) { alert(e.message); }
                finally { button.disabled = false; button.innerHTML = UIManager.getAIGenIcon(); }
            },

            // --- Dynamic Knowledge ---

            /**
             * Adds a new dynamic entry.
             */
            addDynamicEntry() {
                const newEntry = {
                    id: UTILITY.uuid(),
                    title: "New Dynamic Entry",
                    triggers: "",
                    content_fields: [""],
                    current_index: 0,
                    triggered_at_turn: null
                };
                ReactiveStore.state.dynamic_entries.push(newEntry);
                ReactiveStore.state.selectedDynamicEntryId = newEntry.id;
            },

            /**
             * Deletes a dynamic entry.
             * @param {string} id - The entry ID.
             */
            deleteDynamicEntry(id) {
                ReactiveStore.state.dynamic_entries = ReactiveStore.state.dynamic_entries.filter(e => e.id !== id);
                if (ReactiveStore.state.selectedDynamicEntryId === id) {
                    ReactiveStore.state.selectedDynamicEntryId = null;
                }
            },

            /**
             * Selects a dynamic entry for viewing/editing.
             * @param {string} id - The entry ID.
             */
            selectDynamicEntry(id) {
                ReactiveStore.state.selectedDynamicEntryId = id;
            },

            /**
             * Updates a field of a dynamic entry (debounced).
             * @param {string} id - The entry ID.
             * @param {string} field - The field to update.
             * @param {string} value - The new value.
             */
            updateDynamicEntryField: debounce(function (id, field, value) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === id);
                if (entry && (field === 'title' || field === 'triggers')) {
                    entry[field] = value;
                }
            }, 300),

            /**
             * Adds a new content field to a dynamic entry.
             * @param {string} entryId - The entry ID.
             */
            addDynamicContentField(entryId) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === entryId);
                if (entry) {
                    entry.content_fields.push("");
                    // Force UI refresh since subscription protects inputs
                    UIManager.renderDynamicEntryDetails();
                }
            },

            /**
             * Updates a content field of a dynamic entry (debounced).
             * @param {string} entryId - The entry ID.
             * @param {number} index - The index of the field.
             * @param {string} value - The new value.
             */
            updateDynamicContentField: debounce(function (entryId, index, value) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === entryId);
                if (entry && entry.content_fields[index] !== undefined) {
                    entry.content_fields[index] = value;
                }
            }, 300),

            /**
             * Generates content for a dynamic entry field using AI.
             * @param {Event} event - The click event.
             * @param {string} entryId - The entry ID.
             * @param {number} index - The index of the field.
             */
            async generateDynamicEntryContentAI(event, entryId, index) {
                const entry = ReactiveStore.state.dynamic_entries.find(e => e.id === entryId);
                if (!entry) return;

                // Resolve button first
                const button = event.target.closest('button');
                if (!button) return;

                button.disabled = true; button.innerHTML = '...';

                try {
                    const prompt = ReactiveStore.state.prompt_entry_gen
                        .replace('{title}', entry.title)
                        .replace('{triggers}', entry.triggers);

                    const content = await APIService.callAI(prompt);
                    this.updateDynamicContentField(entryId, index, content);

                    // Find textarea relative to the BUTTON, not the click target (event.target)
                    const textarea = button.parentElement.querySelector('textarea');
                    if (textarea) textarea.value = content;
                } catch (e) { alert(e.message); }
                finally { button.disabled = false; button.innerHTML = UIManager.getAIGenIcon(); }
            },

            /**
             * Cleans up empty content fields in dynamic entries.
             */
            cleanupEmptyDynamicFields() {
                const state = ReactiveStore.state;
                if (state.dynamic_entries) {
                    state.dynamic_entries.forEach(entry => {
                        if (entry.content_fields) {
                            // Filter out whitespace-only fields
                            entry.content_fields = entry.content_fields.filter(field => field.trim() !== "");
                            // Ensure at least one field exists
                            if (entry.content_fields.length === 0) entry.content_fields.push("");
                            // Clamp index
                            if (entry.current_index >= entry.content_fields.length) {
                                entry.current_index = entry.content_fields.length - 1;
                            }
                        }
                    });
                }
            },

            // --- Background Agents ---

            /**
             * Runs the World Info Agent to update static knowledge based on recent chat.
             * @param {boolean} [silent=false] - Whether to suppress UI feedback.
             */
            async checkWorldInfoAgent(silent = false) {
                const state = ReactiveStore.state;
                if (!StateManager.getLibrary().active_narrative_id) return;

                if (!silent) UIManager.showTypingIndicator('static-entry-agent', 'Updating static knowledge...');

                try {
                    // Build Context
                    let recentTranscript = "";
                    (state.chat_history || [])
                        .filter(m => m.type === 'chat')
                        .slice(-8)
                        .forEach(msg => {
                            const c = state.characters.find(i => i.id === msg.character_id);
                            if (c) recentTranscript += `${c.name}: ${msg.content}\n`;
                        });

                    const existingTitles = (state.static_entries || []).map(e => e.title);

                    const prompt = `As an AI Archivist, read the chat transcript. Identify NEW facts not present in the existing knowledge.
            Existing Entries: ${JSON.stringify(existingTitles)}
            
            Output valid JSON: { "add": [{"title": "Title", "content": "Fact"}], "modify": [{"title": "Existing Title", "new_content": "Updated Fact"}] }
            If no updates needed, return empty object {}.
            
            TRANSCRIPT:
            ${recentTranscript}`;

                    const response = await APIService.callAI(prompt, true);
                    const updates = JSON.parse(response);

                    let changed = false;

                    if (updates.add) {
                        updates.add.forEach(item => {
                            // Duplicate check by title
                            if (!state.static_entries.some(e => e.title.toLowerCase() === item.title.toLowerCase())) {
                                state.static_entries.push({ id: UTILITY.uuid(), ...item });
                                changed = true;
                            }
                        });
                    }

                    if (updates.modify) {
                        updates.modify.forEach(item => {
                            const entry = state.static_entries.find(e => e.title.toLowerCase() === item.title.toLowerCase());
                            if (entry) {
                                entry.content = item.new_content;
                                changed = true;
                            }
                        });
                    }

                    if (changed && !silent) {
                        UIManager.renderStaticEntries();
                        alert("Static knowledge updated successfully.");
                    }

                } catch (e) {
                    if (!silent) {
                        console.error("Static Entry Agent failed:", e);
                        alert("The AI failed to update static entries.");
                    }
                } finally {
                    if (!silent) UIManager.hideTypingIndicator();
                }
            },

            // --- New Features ---

            /**
             * Creates a new static entry from a specific chat message.
             * @param {number} index - The index of the message.
             */
            async createStaticFromMessage(index) {
                const state = ReactiveStore.state;
                const msg = state.chat_history[index];
                if (!msg) return;

                // 1. Show Feedback
                UIManager.showLoadingSpinner("Extracting knowledge...");

                // Defaults (Fallback)
                let entryTitle = "Extracted Memory";
                let entryContent = msg.content;

                try {
                    // 2. Construct Prompt
                    const char = state.characters.find(c => c.id === msg.character_id);
                    const speaker = char ? char.name : "Unknown Character";

                    const prompt = `Analyze the following roleplay message from ${speaker}.
            Extract the most significant static facts, lore, or plot developments into a concise World Info entry.
            
            Return valid JSON only:
            {
                "title": "A short, descriptive title for this entry (3-6 words)",
                "content": "A concise, objective summary of the new information found in the message."
            }

            MESSAGE:
            "${msg.content}"`;

                    // 3. Call AI
                    const response = await APIService.callAI(prompt, true); // true = parses JSON automatically logic in APIService or returns string to parse

                    // Note: APIService.callAI(..., true) returns the JSON string block, we must parse it.
                    const data = JSON.parse(response);

                    if (data.title) entryTitle = data.title;
                    if (data.content) entryContent = data.content;

                } catch (e) {
                    console.warn("AI extraction failed, falling back to raw text:", e);
                    // We proceed with the raw text defaults defined above
                }

                // 4. Create Entry
                const newEntry = {
                    id: UTILITY.uuid(),
                    title: entryTitle,
                    content: entryContent
                };

                state.static_entries.push(newEntry);
                state.selectedStaticEntryId = newEntry.id;

                // 5. Update UI
                UIManager.hideLoadingSpinner();
                AppController.openModal('knowledge-modal');
                UIManager.switchKnowledgeTab('static');
            },

            /**
             * Converts a static entry into a dynamic entry.
             * @param {string} staticId - The ID of the static entry.
             */
            convertStaticToDynamic(staticId) {
                const state = ReactiveStore.state;
                const staticEntry = state.static_entries.find(e => e.id === staticId);

                if (!staticEntry) return;

                if (confirm("Convert this to a Dynamic Entry? The Static entry will be removed.")) {
                    // 1. Create Dynamic
                    const newDynamic = {
                        id: UTILITY.uuid(),
                        title: staticEntry.title,
                        triggers: staticEntry.title, // Default trigger to title
                        content_fields: [staticEntry.content],
                        current_index: 0,
                        triggered_at_turn: null
                    };

                    // 2. Add Dynamic, Remove Static
                    state.dynamic_entries.push(newDynamic);
                    state.static_entries = state.static_entries.filter(e => e.id !== staticId);

                    // 3. Switch Views
                    state.selectedDynamicEntryId = newDynamic.id;
                    state.selectedStaticEntryId = null;

                    // 4. Force UI Refresh
                    UIManager.switchKnowledgeTab('dynamic');
                }
            },

        };

        const ActionDispatcher = {
            /**
             * Initializes the ActionDispatcher.
             * Registers all action handlers to their respective controllers.
             */
            init() {

                ActionHandler.register('gen-story-phase-1', (ds, val, e) => LibraryController.generateStoryPhase1(e));
                ActionHandler.register('gen-story-retry', () => LibraryController.retryGenStory());
                ActionHandler.register('gen-story-confirm', () => LibraryController.confirmGenStory());

                // --- AppController (Navigation & Global UI) ---
                ActionHandler.register('open-modal', (ds) => AppController.openModal(ds.target, ds.id));
                ActionHandler.register('close-modal', (ds) => AppController.closeModal(ds.id));
                ActionHandler.register('toggle-mobile-menu', () => AppController.toggleMobileMenu());

                // Settings are mostly bi-directional bindings handled inside AppController.bindSettingsListeners,
                // but we can map specific actions here if needed in the future.

                // --- LibraryController (Stories, Scenarios, IO) ---
                ActionHandler.register('open-story', (ds) => UIManager.openStoryDetails(ds.id));
                ActionHandler.register('duplicate-story', (ds) => LibraryController.duplicateStory(ds.id));
                ActionHandler.register('delete-story', (ds) => LibraryController.deleteStory(ds.id));
                ActionHandler.register('gen-story-notes', (ds, e) => LibraryController.generateStoryNotesAI(e, ds.id));
                ActionHandler.register('gen-story-tags', (ds, e) => LibraryController.generateStoryTagsAI(e, ds.id));

                // Lightbox Actions
                ActionHandler.register('open-lightbox', (ds) => UIManager.openLightbox(ds.index));
                ActionHandler.register('lightbox-next', () => UIManager.navigateLightbox(1));
                ActionHandler.register('lightbox-prev', () => UIManager.navigateLightbox(-1));
                ActionHandler.register('close-lightbox', () => UIManager.closeLightbox());

                // Scenario Actions (Load, Rename, Delete)
                ActionHandler.register('load-scenario', (ds) => LibraryController.createNarrativeFromScenario(ds.storyId, ds.scenarioId));
                ActionHandler.register('rename-scenario', (ds) => LibraryController.renameScenario(ds.storyId, ds.scenarioId));
                ActionHandler.register('delete-scenario', (ds) => LibraryController.deleteScenario(ds.storyId, ds.scenarioId));

                // Narrative Actions
                ActionHandler.register('load-narrative', (ds) => LibraryController.loadNarrative(ds.storyId, ds.narrativeId));
                ActionHandler.register('duplicate-narrative', (ds) => LibraryController.duplicateNarrative(ds.storyId, ds.narrativeId));
                ActionHandler.register('delete-narrative', (ds) => LibraryController.deleteNarrative(ds.storyId, ds.narrativeId));
                ActionHandler.register('elevate-narrative', (ds) => LibraryController.elevateNarrativeToScenario(ds.storyId, ds.narrativeId));

                // Import / Export
                ActionHandler.register('handle-file-upload', (ds, val, e) => LibraryController.handleFileUpload(e));
                ActionHandler.register('handle-bulk-import', () => LibraryController.handleBulkImport());
                ActionHandler.register('import-library', (ds, val, e) => LibraryController.importLibrary(e));
                ActionHandler.register('export-story', (ds) => LibraryController.exportStoryAs(ds.format));
                ActionHandler.register('export-library', () => LibraryController.exportLibrary());

                // --- NarrativeController (Chat, Characters, AI) ---
                ActionHandler.register('chat-copy', (ds) => NarrativeController.copyMessage(ds.index));
                ActionHandler.register('chat-edit', (ds) => NarrativeController.openEditModal(ds.index));
                ActionHandler.register('chat-delete', (ds) => NarrativeController.deleteMessage(ds.index));
                ActionHandler.register('quick-create-character', () => NarrativeController.quickCreateCharacter());

                ActionHandler.register('move-example-turn', (ds) => NarrativeController.moveExampleDialogueTurn(parseInt(ds.index), ds.direction));
                ActionHandler.register('delete-example-turn', (ds) => NarrativeController.deleteExampleDialogueTurn(parseInt(ds.index)));

                ActionHandler.register('open-character-detail', (ds) => AppController.openModal('character-detail-modal', ds.id));
                ActionHandler.register('delete-character', (ds) => NarrativeController.deleteCharacter(ds.id));
                ActionHandler.register('set-char-role', (ds) => NarrativeController.setCharacterRole(ds.id, ds.role));
                ActionHandler.register('gen-char-tags', (ds, e) => NarrativeController.generateTagsForCharacter(e, ds.id));
                ActionHandler.register('enhance-persona', (ds, e) => NarrativeController.enhancePersonaWithAI(e, ds.id));
                ActionHandler.register('gen-model-instructions', (ds, e) => NarrativeController.generateModelInstructions(e, ds.id));
                ActionHandler.register('add-extra-portrait', (ds) => NarrativeController.addExtraPortrait(ds.id));
                ActionHandler.register('remove-extra-portrait', (ds) => NarrativeController.removeExtraPortrait(ds.id, ds.index));
                ActionHandler.register('upload-local-image', (ds, val, e) => NarrativeController.handleLocalImageUpload(e, ds.id));
                ActionHandler.register('upload-emo-image', (ds, val, e) => NarrativeController.handleLocalEmotionImageUpload(e, ds.id, ds.index));

                // --- WorldController (Map, Lore) ---
                ActionHandler.register('switch-world-map-tab', (ds) => WorldController.switchWorldMapTab(ds.tab));
                ActionHandler.register('gen-world-map', (ds, e) => WorldController.generateWorldMap(e));
                ActionHandler.register('clear-world-map', () => WorldController.clearWorldMap());
                ActionHandler.register('select-pending-move', (ds) => WorldController.selectPendingMove(parseInt(ds.x), parseInt(ds.y)));
                ActionHandler.register('confirm-move', () => WorldController.confirmMove());
                ActionHandler.register('select-map-tile', (ds) => WorldController.selectMapTile(parseInt(ds.x), parseInt(ds.y)));
                ActionHandler.register('upload-loc-image', (ds, val, e) => WorldController.handleWorldMapLocationImageUpload(e, ds.x, ds.y));
                ActionHandler.register('gen-loc-prompt', (ds, e) => WorldController.generateLocationPromptAI(e));
                ActionHandler.register('set-destination', () => WorldController.setDestination());
                ActionHandler.register('jump-to-location', (ds) => {
                    WorldController.moveToLocation(parseInt(ds.x), parseInt(ds.y));
                    AppController.closeModal('world-map-modal');
                });

                ActionHandler.register('add-static-entry', () => WorldController.addStaticEntry());
                ActionHandler.register('select-static-entry', (ds) => WorldController.selectStaticEntry(ds.id));
                ActionHandler.register('gen-static-ai', (ds, e) => WorldController.generateStaticEntryContentAI(e, ds.id));
                ActionHandler.register('delete-static-entry', (ds) => WorldController.deleteStaticEntry(ds.id));
                ActionHandler.register('check-world-info', () => WorldController.checkWorldInfoAgent());

                ActionHandler.register('add-dynamic-entry', () => WorldController.addDynamicEntry());
                ActionHandler.register('select-dynamic-entry', (ds) => WorldController.selectDynamicEntry(ds.id));
                ActionHandler.register('gen-dynamic-ai', (ds, e) => WorldController.generateDynamicEntryContentAI(e, ds.id, ds.index));
                ActionHandler.register('add-dynamic-field', (ds) => WorldController.addDynamicContentField(ds.id));
                ActionHandler.register('delete-dynamic-entry', (ds) => WorldController.deleteDynamicEntry(ds.id));

                ActionHandler.register('add-local-static-entry', () => WorldController.addLocalStaticEntry());
                ActionHandler.register('select-local-static-entry', (ds) => WorldController.selectLocalStaticEntry(ds.id));
                ActionHandler.register('delete-local-static-entry', (ds) => WorldController.deleteLocalStaticEntry(ds.id));

                // Narrative Actions
                ActionHandler.register('view-chat-image', (ds) => UIManager.viewChatImage(ds.src));
                ActionHandler.register('create-static-from-message', (ds) => WorldController.createStaticFromMessage(parseInt(ds.index)));
                ActionHandler.register('confirm-delete-message', (ds) => NarrativeController.confirmDeleteMessage(parseInt(ds.index)));
            }
        };