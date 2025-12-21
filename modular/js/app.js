        const app = {
            /**
             * Initializes the application.
             * Sets up core services, loads library, hydrates images, and initializes the UI.
             */
            async init() {
                if ('scrollRestoration' in history) {
                    history.scrollRestoration = 'manual';
                }

                // 1. Initialize Core Services
                try { await DBService.init(); } catch (e) { console.warn("DB init failed", e); }

                // 2. Load Library
                await StateManager.loadLibrary();
                const library = StateManager.getLibrary();

                if (library.stories.length === 0) {
                    const { newStory, newNarrative } = await StoryService.createDefaultStoryAndNarrative();
                    localStorage.setItem('active_story_id', newStory.id);
                    localStorage.setItem('active_narrative_id', newNarrative.id);
                    window.location.reload();
                    return;
                }

                // 3. Hydrate Images (Optimized for performance)
                if (library.stories.length > 0) {
                    UIManager.RUNTIME.characterImageCache = UIManager.RUNTIME.characterImageCache || {};

                    // Loop over ALL stories in the library
                    for (const story of library.stories) {
                        if (!story.characters) continue;

                        // Hydrate Character Images
                        for (const char of story.characters) {
                            try {
                                // 1. Base Portrait
                                if (!UIManager.RUNTIME.characterImageCache[char.id]) {
                                    const blob = await DBService.getImage(char.id);
                                    if (blob) {
                                        UIManager.RUNTIME.characterImageCache[char.id] = URL.createObjectURL(blob);
                                    }
                                }

                                // 2. Emotion Portraits
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
                                console.warn("Image hydration failed for char", char.id, e);
                            }
                        }
                    }
                    console.log("Image hydration complete.");
                }

                // Hydrate Scoped Background Image
                const activeStoryId = localStorage.getItem('active_story_id');
                if (activeStoryId) {
                    try {
                        // Try fetching story-specific background
                        const bgBlob = await DBService.getImage(`bg_${activeStoryId}`);
                        if (bgBlob) {
                            UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(bgBlob);
                            console.log("Scoped background hydrated.");
                        } else {
                            // Fallback: Check for legacy global image (migration path)
                            const globalBlob = await DBService.getImage('global_background_image');
                            if (globalBlob) {
                                // We don't auto-migrate here to avoid side effects, but we respect it if it exists
                                // and the story claims to use it.
                                UIManager.RUNTIME.globalBackgroundImageCache = URL.createObjectURL(globalBlob);
                            }
                        }
                    } catch (e) {
                        console.warn("Background hydration failed:", e);
                    }
                }

                // 4. Load Active Narrative
                await StateManager.loadActiveNarrative();
                const state = StateManager.getState();

                // 5. Initialize Event System (THE NEW LOGIC)
                this.setupEventListeners();      // Updates layout
                UIManager.setButtonToSendMode(); // Sets initial button state
                ActionHandler.init();            // Starts listening for clicks
                ActionDispatcher.init();         // Wires clicks to Controllers

                // 6. Initialize Reactive State
                if (!state || Object.keys(state).length === 0) {
                    // Empty state fallback
                    const activeStory = library.stories.find(s => s.id === library.active_story_id);
                    const title = activeStory ? activeStory.name : "No Story Loaded";
                    if (document.getElementById('story-title-input')) document.getElementById('story-title-input').value = title;
                    if (document.getElementById('mobile-story-title-overlay')) document.getElementById('mobile-story-title-overlay').value = title;

                    ReactiveStore.init({});
                    UIManager.renderChat();
                } else {
                    // Initialize Store
                    ReactiveStore.init(state);

                    // Initialize Runtime Variables
                    if (typeof WorldController !== 'undefined') {
                        WorldController.RUNTIME.turnOfArrival = state.messageCounter;
                    }

                    // Ensure Colors
                    // Ensure Colors for ALL characters, including User
                    let aiCharCount = 0;
                    (state.characters || []).forEach(char => {
                        if (!char.color) {
                            if (char.is_user) {
                                // Default User Gray
                                char.color = { base: '#4b5563', bold: '#e5e7eb' };
                            } else {
                                // Cycle through AI colors
                                char.color = NarrativeController.CONSTANTS.CHARACTER_COLORS[aiCharCount % 8];
                                aiCharCount++;
                            }
                        } else if (!char.is_user) {
                            // Just increment counter if AI already has color, to keep variety for next new char
                            aiCharCount++;
                        }
                    });

                    // Setup Subscriptions (Mapped to UIManager)
                    [
                        'font', 'chatTextColor', 'textSize', 'bubbleOpacity', 'backgroundBlur',
                        'bubbleImageSize', 'backgroundImageURL', 'characterImageMode',
                        // Colors
                        'md_h1_color', 'md_h2_color', 'md_h3_color', 'md_bold_color',
                        'md_italic_color', 'md_quote_color',
                        // Fonts (The missing keys causing the update issue)
                        'md_h1_font', 'md_h2_font', 'md_h3_font', 'md_bold_font',
                        'md_italic_font', 'md_quote_font'
                    ]
                        .forEach(key => {
                            ReactiveStore.subscribe(key, () => UIManager.applyStyling());
                        });

                    // Smart Subscriptions (prevent focus loss)
                    ReactiveStore.subscribe('characters', () => {
                        const active = document.activeElement;
                        const isTypingInRoster = active && active.tagName === 'INPUT' && active.closest('#character-detail-modal-content');
                        if (!isTypingInRoster) {
                            UIManager.renderCharacters();
                            UIManager.updateAICharacterSelector();
                        }
                    });

                    // Don't re-render if we are manually handling the DOM (e.g., finishing a stream)
                    ReactiveStore.subscribe('chat_history', () => {
                        if (!UIManager.RUNTIME.suppressChatRender) UIManager.renderChat();
                    });

                    ReactiveStore.subscribe('static_entries', () => {
                        if (!document.activeElement?.closest('#static-entry-details')) UIManager.renderStaticEntries();
                    });
                    ReactiveStore.subscribe('dynamic_entries', () => {
                        if (!document.activeElement?.closest('#dynamic-entry-details')) UIManager.renderDynamicEntries();
                    });

                    ReactiveStore.subscribe('worldMap', () => {
                        UIManager.applyStyling();
                        if (!document.activeElement?.closest('#world-map-modal-content') && document.getElementById('world-map-modal').style.display !== 'none') {
                            UIManager.renderWorldMapModal();
                        }
                    });

                    ReactiveStore.subscribe('selectedStaticEntryId', () => { UIManager.renderStaticEntries(); UIManager.renderStaticEntryDetails(); });
                    ReactiveStore.subscribe('selectedDynamicEntryId', () => { UIManager.renderDynamicEntries(); UIManager.renderDynamicEntryDetails(); });

                    // Initial Render
                    UIManager.applyStyling();
                    UIManager.renderAll();
                }

                // Enable line breaks for single newlines (Chat Style Markdown)
                if (typeof marked !== 'undefined') {
                    marked.use({ breaks: true, gfm: true });
                }

                if ('scrollRestoration' in history) {
                    history.scrollRestoration = 'manual';
                }
            },

            /**
             * Sets up global event listeners for the application.
             * Handles resizing, input events, and mobile menu interactions.
             */
            setupEventListeners() {
                this.updateLayout();
                window.addEventListener('resize', debounce(() => this.updateLayout(), 100));

                // Update: Use LibraryController for title renaming
                const titleInputHandler = (e) => {
                    if (typeof NarrativeController !== 'undefined') {
                        NarrativeController.renameActiveNarrative(e.target.value);
                    }
                };

                const titleInput = document.getElementById('story-title-input');
                const mobileTitle = document.getElementById('mobile-story-title-overlay');
                if (titleInput) titleInput.addEventListener('input', titleInputHandler);
                if (mobileTitle) mobileTitle.addEventListener('input', titleInputHandler);

                // Enter-to-Send Logic
                const chatInput = document.getElementById('chat-input');
                if (chatInput) {
                    chatInput.addEventListener('keydown', (e) => {
                        // Check if Enter was pressed WITHOUT Shift
                        if (e.key === 'Enter' && !e.shiftKey) {
                            // Prevent the default new line insertion
                            e.preventDefault();
                            // Trigger the send action
                            NarrativeController.handlePrimaryAction();
                        }
                    });
                }

                // Hamburger Menu
                const hamburgerBtn = document.getElementById('hamburger-menu-button');
                if (hamburgerBtn) {
                    hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); AppController.toggleMobileMenu(); });
                }

                document.addEventListener('click', (e) => {
                    // Mobile Menu Logic
                    const menu = document.getElementById('mobile-menu');
                    const btn = document.getElementById('hamburger-menu-button');
                    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
                        AppController.toggleMobileMenu();
                    }

                    // Story Library Dropdown Logic
                    const dropdown = document.getElementById('new-story-dropdown');
                    if (dropdown && !dropdown.classList.contains('hidden')) {
                        // Only close if we clicked OUTSIDE the dropdown
                        // (Clicks inside are handled by their own buttons or need to bubble for data-action)
                        if (!dropdown.contains(e.target)) {
                            dropdown.classList.add('hidden');
                        }
                    }
                });

                // Mobile Title Fade Logic
                const titleTrigger = document.getElementById('title-trigger-area');

                const showTitle = () => {
                    if (document.body.classList.contains('layout-vertical') && mobileTitle) {
                        clearTimeout(UIManager.RUNTIME.titleTimeout);
                        mobileTitle.style.opacity = '1';
                        mobileTitle.style.pointerEvents = 'auto';
                    }
                };

                const hideTitle = (immediate = false) => {
                    if (document.body.classList.contains('layout-vertical') && mobileTitle) {
                        clearTimeout(UIManager.RUNTIME.titleTimeout);
                        if (document.activeElement !== mobileTitle) {
                            const doHide = () => {
                                mobileTitle.style.opacity = '0';
                                mobileTitle.style.pointerEvents = 'none';
                            };
                            if (immediate) { doHide(); } else { UIManager.RUNTIME.titleTimeout = setTimeout(doHide, 2500); }
                        }
                    }
                };

                if (titleTrigger) {
                    titleTrigger.addEventListener('mouseenter', showTitle);
                    titleTrigger.addEventListener('mouseleave', () => hideTitle());
                    titleTrigger.addEventListener('touchstart', (e) => { e.preventDefault(); if (mobileTitle && mobileTitle.style.opacity === '1') { hideTitle(true); } else { showTitle(); hideTitle(); } });
                }

                // Update: Use NarrativeController for Chat Buttons
                const regenBtn = document.getElementById('regen-btn');
                const undoBtn = document.getElementById('undo-btn');
                if (regenBtn) regenBtn.addEventListener('click', () => NarrativeController.handleRegen());
                if (undoBtn) undoBtn.addEventListener('click', () => NarrativeController.undoLastTurn());
            },

            /**
             * Updates the layout based on window dimensions.
             * Toggles between vertical and horizontal layouts.
             */
            updateLayout() {
                const isVertical = window.innerHeight > window.innerWidth;
                const wasVertical = document.body.classList.contains('layout-vertical');
                const layoutChanged = isVertical !== wasVertical;

                if (isVertical) {
                    document.body.classList.add('layout-vertical');
                    document.body.classList.remove('layout-horizontal');
                } else {
                    document.body.classList.add('layout-horizontal');
                    document.body.classList.remove('layout-vertical');
                }
                UIManager.updateSidePortrait();

                // FIX: Force library re-render if layout changed (Mobile <-> Desktop)
                if (layoutChanged) {
                    const libModal = document.getElementById('story-library-modal');
                    if (libModal && !libModal.classList.contains('hidden')) {
                        // Capture current filter state
                        const search = document.getElementById('lib-search')?.value;
                        const sort = document.getElementById('lib-sort')?.value;
                        const tag = document.getElementById('lib-tag')?.value;

                        // Clear container to bypass 'Early Return' optimization in renderLibraryInterface
                        const container = document.getElementById('library-content-container');
                        if (container) container.innerHTML = '';

                        UIManager.renderLibraryInterface({
                            searchTerm: search,
                            sortBy: sort,
                            filterTag: tag
                        });

                        // Re-open Story Details if one was active
                        if (UIManager.RUNTIME.viewingStoryId) {
                            // If switching to Horizontal (Desktop), ensure the Mobile Overlay is hidden
                            if (!isVertical) {
                                const mobileOverlay = document.getElementById('story-details-modal');
                                if (mobileOverlay) mobileOverlay.classList.add('hidden');
                            }
                            // Re-trigger open to render in the correct new container
                            UIManager.openStoryDetails(UIManager.RUNTIME.viewingStoryId);
                        }
                    }
                }
            },


        };