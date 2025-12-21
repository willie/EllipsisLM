        const UIComponents = {
            /**
             * Renders a single character card for the roster.
             */
            CharacterTile(char) {
                const tagsHTML = (char.tags || []).map(tag => DOM.html`<span class="bg-indigo-500/50 text-indigo-200 text-xs font-semibold mr-2 px-2.5 py-0.5 rounded">${tag}</span>`);
                const visualStyle = char.is_active ? "" : "opacity: 0.5; filter: grayscale(80%);";

                // FIX: Role-based Border Logic
                let roleBorderClass = 'border-gray-600'; // Default NPC (Subtle)
                let roleBadge = '';

                if (char.is_user) {
                    roleBorderClass = 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.3)]';
                    roleBadge = DOM.unsafe('<div class="absolute top-2 left-2 bg-indigo-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">User</div>');
                } else if (char.is_narrator) {
                    roleBorderClass = 'border-teal-500 shadow-[0_0_10px_rgba(20,184,166,0.3)]';
                    roleBadge = DOM.unsafe('<div class="absolute top-2 left-2 bg-teal-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Narrator</div>');
                }

                const activeBadge = char.is_active ? "" : DOM.unsafe('<div class="absolute top-2 right-2 bg-black/60 text-gray-300 text-xs px-2 py-1 rounded">Inactive</div>');

                // Standard gray silhouette icon (URL-Encoded SVG)
                const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234b5563' opacity='0.25'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

                const hasImage = UIManager.RUNTIME.characterImageCache[char.id] || (char.image_url && !char.image_url.startsWith('local_'));

                let rawUrl = hasImage ? (UIManager.RUNTIME.characterImageCache[char.id] || char.image_url) : placeholder;
                if (rawUrl) rawUrl = rawUrl.replace(/'/g, "%27");

                const bgImage = `url('${rawUrl}')`;
                const bgSize = 'cover';
                const bgRepeat = 'no-repeat';

                return DOM.html`
            <div data-action="open-character-detail" data-id="${char.id}" 
                 class="char-roster-btn bg-gray-800 ${roleBorderClass}" 
                 style="background-image: ${DOM.unsafe(bgImage)}; background-size: ${bgSize}; background-repeat: ${bgRepeat}; ${DOM.unsafe(visualStyle)}; border-width: 2px;">
                ${roleBadge}
                ${activeBadge}
                <div class="char-roster-content text-white">
                    <h3 class="font-bold text-lg truncate">${char.name}</h3>
                    <p class="text-sm text-gray-300 italic truncate">${char.short_description}</p>
                    <div class="mt-2 h-6 overflow-hidden">${tagsHTML}</div>
                </div>
            </div>
        `;
            },

            /**
             * Renders a single chat message bubble.
             * Handles Markdown parsing, newline preservation, and image embedding.
             */
            MessageBubble(msg, index, state) {
                if (msg.type === 'lore_reveal' || msg.isHidden) return '';

                if (msg.type === 'system_event') {
                    return DOM.html`<div class="w-full text-center my-2"><p class="text-sm italic text-gray-400">${msg.content}</p></div>`;
                }

                const character = state.characters.find(c => c.id === msg.character_id);
                if (!character) return '';

                const userChar = state.characters.find(c => c.is_user);
                const characterName = character.name;
                const userName = userChar ? userChar.name : 'You';

                const replacer = (text) => text.replace(/{character}/g, characterName).replace(/{user}/g, userName);

                // 1. Trim source to prevent initial whitespace issues
                let processedContent = replacer(msg.content).trim();

                // 2. Preserve Arbitrary Newlines (3 or more)
                // Standard Markdown collapses \n\n\n into a single paragraph break.
                // We replace 3+ newlines with explicit <br> tags so they render visually.
                processedContent = processedContent.replace(/\n{3,}/g, (match) => '<br>'.repeat(match.length));

                const styledContent = processedContent.replace(/(["“][^"”]*["”])/g, `<span class="dialogue-quote">$1</span>`);

                // 3. Trim output HTML to remove the trailing newline that 'marked' adds
                let contentHTML = DOM.unsafe(marked.parse(styledContent || '').trim());

                // Styling
                let bubbleStyle = '';
                let characterNameColor = '';
                const imgSrc = UIManager.getPortraitSrc(character, msg.emotion);

                if (state.characterImageMode === 'bubble' && imgSrc) {
                    contentHTML = DOM.html`
                <img src="${imgSrc}" 
                     class="bubble-char-image cursor-pointer hover:opacity-90 transition-opacity" 
                     data-action="view-chat-image" 
                     data-src="${imgSrc}" 
                     title="View Full Size">
                ${contentHTML}`;
                }

                const defaultColor = character.is_user
                    ? { base: '#4b5563', bold: '#e5e7eb' }
                    : { base: '#334155', bold: '#94a3b8' };

                const charColor = character.color || defaultColor;
                const topColor = UTILITY.hexToRgba(charColor.base, state.bubbleOpacity);
                const bottomColor = UTILITY.hexToRgba(UTILITY.darkenHex(charColor.base, 10), state.bubbleOpacity);

                bubbleStyle = `background-image: linear-gradient(to bottom, ${topColor}, ${bottomColor});`;
                characterNameColor = `style="color: ${charColor.bold};"`;

                const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                // HTML Container (Single line to prevent pre-wrap issues)
                return DOM.html`
            <div class="chat-bubble-container ${msg.isNew ? 'new-message' : ''}" data-message-index="${index}">
                <div class="bubble-header">
                     <p class="font-bold text-sm cursor-pointer hover:underline decoration-dotted underline-offset-4" 
                        ${DOM.unsafe(characterNameColor)}
                        data-action="open-character-detail" 
                        data-id="${character.id}"
                        title="Open Character Details">
                        ${character.name}
                     </p>
                     <span class="timestamp text-xs text-gray-500">${timestamp}</span>
                     <div class="action-btn-group flex ml-2 space-x-4">
                        <button data-action="create-static-from-message" data-index="${index}" class="text-gray-400 hover:text-emerald-300" title="Create Static Memory"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg></button>
                        <button data-action="chat-edit" data-index="${index}" class="text-gray-400 hover:text-white" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                        <button data-action="confirm-delete-message" data-index="${index}" class="text-gray-400 hover:text-red-400" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    </div>
                </div>
                <div class="bubble-body rounded-lg px-3 py-2" style="${DOM.unsafe(bubbleStyle)}"><div id="message-content-${index}" class="whitespace-pre-wrap" style="color: ${state.chatTextColor}; font-family: ${state.font};">${contentHTML}</div></div></div>`;
            },

            /**
             * Renders a story item in the library list.
             */
            StoryListItem(story, isActive, separator) {
                const activeBadge = isActive ? DOM.html`<span class="text-xs text-indigo-300 font-bold">ACTIVE</span>` : '';
                return DOM.html`
            ${separator}
            <div class="p-4 rounded-lg flex justify-between items-center cursor-pointer ${isActive ? 'bg-indigo-600/30' : 'bg-gray-700/50 hover:bg-gray-600/50'}" data-action="open-story" data-id="${story.id}">
                <div>
                    <h3 class="font-semibold text-lg">${story.name || 'Untitled Story'}</h3>
                    <p class="text-sm text-gray-400">Modified: ${new Date(story.last_modified).toLocaleString()}</p>
                </div>
                ${activeBadge}
            </div>
        `;
            },


            /**
             * Renders a collapsible Scenario item for Story Details.
             */
            ScenarioItem(scenario, storyId) {
                const messageHTML = DOM.unsafe(marked.parse(scenario.message || '*(No message)*'));
                return DOM.html`
            <details open class="bg-gray-700/30 rounded-lg overflow-hidden group">
                <summary class="p-3 cursor-pointer hover:bg-gray-700/50 flex justify-between items-center font-semibold select-none">
                    <span>${scenario.name}</span>
                    <span class="text-xs text-gray-400 group-open:hidden">▼</span>
                    <span class="text-xs text-gray-400 hidden group-open:block">▲</span>
                </summary>
                <div class="p-3 bg-black/20 border-t border-gray-600 space-y-3">
                    <div>
                        <p class="text-xs text-gray-400 font-bold mb-1">First Message:</p>
                        <div class="text-sm text-gray-300 prose prose-invert prose-sm max-w-none">
                            ${messageHTML}
                        </div>
                    </div>
                    <div class="flex gap-2 justify-end pt-2">
                        <button data-action="load-scenario" data-story-id="${storyId}" data-scenario-id="${scenario.id}" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-1 px-3 rounded" title="Load Scenario">Load</button>
                        <button data-action="rename-scenario" data-story-id="${storyId}" data-scenario-id="${scenario.id}" class="bg-gray-600 hover:bg-gray-500 text-white text-xs font-bold py-1 px-3 rounded" title="Rename">Rename</button>
                        <button data-action="delete-scenario" data-story-id="${storyId}" data-scenario-id="${scenario.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded"" title="Delete">Delete</button>
                    </div>
                </div>
            </details>
        `;
            },

            /**
             * Renders a Narrative list item for Story Details.
             */
            NarrativeItem(narrative, storyId, isActive) {
                const activeBadge = isActive ? DOM.html`<span class="text-xs text-sky-300 font-bold flex-shrink-0">ACTIVE</span>` : '';

                // FIX: defensive date parsing
                let dateDisplay = 'Date unknown';
                if (narrative.last_modified) {
                    const dateObj = new Date(narrative.last_modified);
                    // Check if date is valid
                    if (!isNaN(dateObj.getTime())) {
                        dateDisplay = dateObj.toLocaleString();
                    }
                }

                return DOM.html`
            <div class="bg-gray-700/60 p-3 rounded-lg flex justify-between items-center gap-2">
                <div class="flex-grow min-w-0">
                    <p class="font-semibold truncate">${narrative.name}</p>
                    <p class="text-xs text-gray-400">Modified: ${dateDisplay}</p>
                </div>
                ${activeBadge}
                <div class="flex-shrink-0 flex items-center gap-2">
                    <button data-action="delete-narrative" data-story-id="${storyId}" data-narrative-id="${narrative.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded" title="Delete"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    <button data-action="elevate-narrative" data-story-id="${storyId}" data-narrative-id="${narrative.id}" class="text-teal-400 hover:text-teal-300 p-1" title="Elevate to Scenario"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z"></path></svg></button>
                    <button data-action="duplicate-narrative" data-story-id="${storyId}" data-narrative-id="${narrative.id}" class="text-gray-400 hover:text-gray-300 p-1" title="Duplicate"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button data-action="load-narrative" data-story-id="${storyId}" data-narrative-id="${narrative.id}" class="text-green-400 hover:text-green-300 p-1" title="Load Narrative"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 0 0 4 4.11V15.89a1.5 1.5 0 0 0 2.3 1.269l9.344-5.89a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z"/></svg></button>
                </div>
            </div>
        `;
            },

            /** * Renders a dynamic content field editor.
             */
            DynamicContentField(content, index, entryId, totalCount) {
                const isLastField = index === totalCount - 1;
                const stickyNote = isLastField ? DOM.unsafe(`<span class="text-xs text-gray-400 italic ml-4">This entry will be used for all future triggers.</span>`) : '';
                const separator = index > 0 ? DOM.unsafe('<hr class="border-gray-700/50 my-2">') : '';

                return DOM.html`
            ${separator}
            <div class="bg-black/20 p-3 rounded-lg">
                <label class="font-bold mb-2 flex justify-between items-center">
                    <span>Step ${index + 1}</span>
                    ${stickyNote}
                </label>
                <div class="relative">
                    <textarea 
                        placeholder="All empty content fields will be removed when the modal is closed."
                        oninput="WorldController.updateDynamicContentField('${entryId}', ${index}, this.value)" 
                        class="w-full h-24 bg-gray-900/80 border-gray-600 p-2 resize-y rounded-md text-sm"
                    >${content}</textarea>
                    <button 
                        data-action="gen-dynamic-ai" data-id="${entryId}" data-index="${index}" 
                        class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" 
                        title="Generate with AI"
                    >${UIManager.getAIGenIcon()}</button>
                </div>
            </div>
        `;
            }
        };

        const UIManager = {
            RUNTIME: {
                streamingInterval: null,
                titleTimeout: null,
                lastCinematicImageUrl: null,
                activeCinematicBg: 1,
                globalBackgroundImageCache: null,
                characterImageCache: {},
                worldImageCache: {},
                viewingStoryId: null // FIX: Track currently viewed story for layout switching
            },

            /**
             * Switches the active tab in the Knowledge Modal.
             * @param {string} tabName - The name of the tab to switch to ('static' or 'dynamic').
             */
            switchKnowledgeTab(tabName) {
                // We can just call the render function, as it reads the active tab from the Controller/State
                if (typeof AppController !== 'undefined') AppController.activeKnowledgeTab = tabName;
                this.renderKnowledgeModalTabs();
            },

            /**
             * Switches the active tab in the World Map Modal.
             * @param {string} tabName - The name of the tab to switch to ('move' or 'worldmap').
             */
            switchWorldMapTab(tabName) {
                if (typeof WorldController !== 'undefined') WorldController.RUNTIME.activeWorldMapTab = tabName;
                this.renderWorldMapModal();
            },

            /**
             * Returns the SVG icon for AI generation buttons.
             * @returns {string} - The SVG HTML string.
             */
            getAIGenIcon() {
                return DOM.unsafe(`<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`);
            },

            /**
             * Opens the lightbox modal to view a chat image in full size.
             * @param {string} src - The source URL of the image.
             */
            viewChatImage(src) {
                // Reuse the lightbox modal structure but override the navigation
                const imgEl = document.getElementById('lightbox-image');
                const modal = document.getElementById('lightbox-modal');
                const prevBtn = modal.querySelector('button[data-action="lightbox-prev"]');
                const nextBtn = modal.querySelector('button[data-action="lightbox-next"]');
                const capEl = document.getElementById('lightbox-caption');

                if (imgEl) imgEl.src = src;
                if (capEl) capEl.textContent = ""; // No caption for raw chat images

                // Hide nav buttons since this is a single image view
                if (prevBtn) prevBtn.style.display = 'none';
                if (nextBtn) nextBtn.style.display = 'none';

                modal.classList.remove('hidden');
                modal.classList.add('flex');

                // Reset specific lightbox state so closing it works cleanly
                UIManager.RUNTIME.currentLightboxImages = [];
            },

            /**
             * Shows the confirmation modal with options for deleting a message.
             * Allows deleting a single message or all subsequent messages (forward).
             * @param {number} index - The index of the message to delete.
             */
            showDeleteMessageOptions(index) {
                const modal = document.getElementById('confirmation-modal');
                const messageEl = document.getElementById('confirmation-modal-message');
                const footerEl = modal.querySelector('.border-t'); // The footer div containing buttons

                if (!modal || !messageEl || !footerEl) return;

                messageEl.textContent = "How would you like to delete this message?";

                // FIX: Inject 3-Button Layout
                // We use flex-between and spacing to separate the destructive "Delete Forward"
                footerEl.innerHTML = `
            <div class="flex justify-between w-full items-center">
                <button onclick="AppController.closeModal('confirmation-modal')" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg text-sm">Cancel</button>
                
                <div class="flex space-x-4">
                    <button onclick="NarrativeController.executeDelete(${index}, 'single')" class="bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg text-sm">Delete This One</button>
                    <button onclick="NarrativeController.executeDelete(${index}, 'forward')" class="bg-red-900 hover:bg-red-800 text-red-100 font-bold py-2 px-4 rounded-lg text-sm border border-red-500">Delete Forward &rarr;</button>
                </div>
            </div>
        `;

                AppController.openModal('confirmation-modal');
            },

            /**
             * Renders all main UI components to reflect the current state.
             * Updates characters, static entries, dynamic entries, chat, and AI selector.
             */
            renderAll() {
                const state = StateManager.getState();
                if (state && state.narrativeName) {
                    document.getElementById('story-title-input').value = state.narrativeName;
                    const mobileTitle = document.getElementById('mobile-story-title-overlay');
                    if (mobileTitle) mobileTitle.value = state.narrativeName;
                }
                this.renderCharacters();
                this.renderStaticEntries();
                this.renderDynamicEntries();
                this.renderChat();
                this.updateAICharacterSelector();
            },

            /**
             * Renders the Story Library interface with filtering and sorting.
             * @param {Object} [filterState={}] - Optional filter state overrides.
             */
            renderLibraryInterface(filterState = {}) {
                const library = StateManager.getLibrary();
                const container = document.getElementById('library-content-container');

                const searchInput = document.getElementById('lib-search');
                const sortInput = document.getElementById('lib-sort');
                const tagInput = document.getElementById('lib-tag');
                const listContainer = document.getElementById('lib-list');

                // 1. Determine Layout & Filter Values
                let { searchTerm, sortBy, filterTag, layout } = filterState;

                // Logic: Use passed layout if available, otherwise detect
                const isTallScreen = layout ? (layout === 'mobile') : (window.innerHeight > window.innerWidth);

                if (searchTerm === undefined && searchInput) searchTerm = searchInput.value;
                if (sortBy === undefined && sortInput) sortBy = sortInput.value;
                if (filterTag === undefined && tagInput) filterTag = tagInput.value;

                searchTerm = searchTerm || '';
                sortBy = sortBy || 'last_modified';
                filterTag = filterTag || '';

                // 2. Filter & Sort Logic
                let stories = [...library.stories];
                if (searchTerm) {
                    const lowerCaseSearch = searchTerm.toLowerCase();
                    stories = stories.filter(s => s.search_index && s.search_index.includes(lowerCaseSearch));
                }
                if (filterTag) {
                    const lowerFilter = filterTag.toLowerCase();
                    stories = stories.filter(s => {
                        const storyTags = new Set();
                        (s.tags || []).forEach(t => storyTags.add(t.toLowerCase()));
                        (s.characters || []).forEach(c => (c.tags || []).forEach(t => storyTags.add(t.toLowerCase())));
                        return storyTags.has(lowerFilter);
                    });
                }
                stories.sort((a, b) => {
                    if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
                    if (sortBy === 'created_date') return new Date(b.created_date) - new Date(a.created_date);
                    return new Date(b.last_modified) - new Date(a.last_modified);
                });

                // 3. Generate List HTML
                // This creates a standard string of HTML
                const storyListHTML = stories.map((story, index) => {
                    const isActive = story.id === library.active_story_id;
                    const separator = index > 0 ? DOM.unsafe('<hr class="border-gray-700 my-2">') : '';
                    return UIComponents.StoryListItem(story, isActive, separator);
                }).join('');

                // Update Existing Frame (No wrapping needed, direct innerHTML assignment is safe here)
                // FIX: Check if layout structure matches before reusing existing frame
                const desktopDetailsPanel = document.getElementById('story-details-content-desktop');
                const isCurrentLayoutMobile = !desktopDetailsPanel; // If desktop panel is missing, we are in mobile structure
                const layoutMatches = (isTallScreen === isCurrentLayoutMobile);

                if (listContainer && searchInput && layoutMatches) {
                    listContainer.innerHTML = storyListHTML;
                    return;
                }

                // 4. Generate Full Frame (First Render or Layout Switch)
                const tagOptions = library.tag_cache.map(tag => DOM.html`<option value="${tag}" ${filterTag === tag ? 'selected' : ''}>${tag}</option>`);

                const controlsHTML = DOM.html`
            <div class="p-6 border-b border-gray-700 space-y-4">
                <input id="lib-search" type="search" placeholder="Search stories..." value="${searchTerm}" 
                    oninput="UIManager.renderLibraryInterface()" 
                    class="w-full bg-black/30 p-2 rounded-lg border-gray-600">
                <div class="flex space-x-4">
                    <select id="lib-sort" onchange="UIManager.renderLibraryInterface()" class="w-1/2 bg-black/30 p-2 rounded-lg border-gray-600">
                        <option value="last_modified" ${sortBy === 'last_modified' ? 'selected' : ''}>Modified</option>
                        <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Name</option>
                        <option value="created_date" ${sortBy === 'created_date' ? 'selected' : ''}>Created</option>
                    </select>
                    <select id="lib-tag" onchange="UIManager.renderLibraryInterface()" class="w-1/2 bg-black/30 p-2 rounded-lg border-gray-600">
                        <option value="">All Tags</option>
                        ${tagOptions}
                    </select>
                </div>
            </div>`;

                // Sanitization: Wrap storyListHTML in DOM.unsafe() so the sanitizer treats it as HTML, not text
                if (isTallScreen) {
                    container.innerHTML = DOM.html`<div class="flex flex-col flex-grow min-h-0">${controlsHTML}<div id="lib-list" class="p-6 overflow-y-auto">${DOM.unsafe(storyListHTML)}</div></div>`.toString();
                } else {
                    container.innerHTML = DOM.html`
                <div class="w-[450px] flex-shrink-0 border-r border-gray-700 flex flex-col">${controlsHTML}<div id="lib-list" class="p-6 overflow-y-auto flex-grow">${DOM.unsafe(storyListHTML)}</div></div>
                <div id="story-details-content-desktop" class="flex-grow p-6 flex text-gray-500"><div class="w-full h-full flex items-center justify-center">Select a story to see details...</div></div>
            `.toString();
                }
            },

            /**
             * Opens the Story Details modal for a specific story.
             * Populates the modal with scenarios, narratives, and character carousel.
             * @param {string} storyId - The ID of the story to open.
             */
            openStoryDetails(storyId) {
                const library = StateManager.getLibrary();
                const story = library.stories.find(s => s.id === storyId);
                if (!story) return;

                // Track for layout switching
                UIManager.RUNTIME.viewingStoryId = storyId;

                const desktopContainer = document.getElementById('story-details-content-desktop');
                // FIX: Fallback to mobile modal if the desktop container is missing (e.g. transitional layout state)
                const isMobile = (window.innerHeight > window.innerWidth) || !desktopContainer;
                const targetModal = isMobile ? 'story-details-modal' : 'story-library-modal';

                // Componentize Scenarios
                const scenariosHTML = (story.scenarios || []).map(scenario =>
                    UIComponents.ScenarioItem(scenario, story.id)
                );

                // Componentize Narratives
                const narrativesHTML = (story.narratives || []).sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified)).map(narrative => {
                    const isActive = (narrative.id === library.active_narrative_id && story.id === library.active_story_id);
                    return UIComponents.NarrativeItem(narrative, story.id, isActive);
                });

                const hasImages = (story.characters || []).some(c => UIManager.getPortraitSrc(c));

                const carouselHTML = hasImages ? DOM.html`
            <div class="relative w-full aspect-square bg-black/50 group cursor-pointer hover:opacity-90 transition-opacity" title="Click to view full image">
                 <div id="details-carousel" class="w-full h-full object-cover"></div>
                 <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <svg class="w-12 h-12 text-white drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
                 </div>
            </div>` : '';

                // Added 'pt-24' (Padding Top) if there are no images, so content doesn't hide behind the absolute header
                const contentPaddingClass = hasImages ? '' : 'pt-24';

                const detailsHTML = DOM.html`
            <div class="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent" style="padding-top: calc(1rem + env(safe-area-inset-top));">
                <input type="text" 
                   value="${story.name}" 
                   oninput="LibraryController.updateStoryField('${story.id}', 'name', this.value)" 
                   class="text-xl font-bold bg-transparent border border-transparent hover:border-gray-600 focus:border-indigo-500 rounded px-2 py-1 text-white w-2/3 transition-colors focus:outline-none focus:bg-black/30 story-details-title-input"
                   placeholder="Story Title">
                
                <div class="story-details-title-balancer"></div>

                <div class="flex items-center space-x-2">
                    <button data-action="duplicate-story" data-id="${story.id}" class="bg-gray-700/50 hover:bg-gray-600/80 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Duplicate Story">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                    <button data-action="delete-story" data-id="${story.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded" title="Delete Story">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                    <div class="w-px h-6 bg-gray-600/50 mx-2"></div>
                    <button data-action="close-modal" data-id="${targetModal}" class="story-details-close-btn bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Close">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            </div>

            <div class="flex-grow overflow-y-auto min-h-0 details-scroll-container">
                
                ${carouselHTML}

                <div class="p-6 space-y-8 ${contentPaddingClass}">
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label class="text-sm text-gray-400 font-bold mb-1 block">Creator's Note</label>
                            <div class="relative">
                                <textarea oninput="LibraryController.updateStoryField('${story.id}', 'creator_notes', this.value)" class="w-full bg-black/30 border-gray-600 p-3 rounded-lg resize-none h-24 text-sm focus:ring-1 focus:ring-indigo-500 transition-all">${story.creator_notes || ''}</textarea>
                                <button data-action="gen-story-notes" data-id="${story.id}" class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
                            </div>
                        </div>
                        <div>
                            <label class="text-sm text-gray-400 font-bold mb-1 block">Tags</label>
                            <div class="relative">
                                <input type="text" value="${(story.tags || []).join(', ')}" oninput="LibraryController.updateStoryTags('${story.id}', this.value)" class="w-full bg-black/30 border-gray-600 p-3 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 transition-all">
                                <button data-action="gen-story-tags" data-id="${story.id}" class="absolute top-1/2 right-2 -translate-y-1/2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
                            </div>
                        </div>
                    </div>

                    <hr class="border-gray-700">

                    <div>
                        <h4 class="font-bold text-lg mb-4 text-indigo-300 flex items-center">
                            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                            Scenarios (Templates)
                        </h4>
                        <div class="space-y-3">${scenariosHTML.length ? scenariosHTML : DOM.unsafe('<p class="text-sm text-gray-500 italic">No scenarios available.</p>')}</div>
                    </div>

                    <hr class="border-gray-700">

                    <div>
                        <h4 class="font-bold text-lg mb-4 text-sky-300 flex items-center">
                            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                            Narratives (Chats)
                        </h4>
                        <div class="space-y-2">${narrativesHTML.length ? narrativesHTML : DOM.unsafe('<p class="text-sm text-gray-500 italic">No narratives started. Load a scenario to begin.</p>')}</div>
                    </div>
                </div>
            </div>
        `;

                if (isMobile) {
                    document.querySelector('#story-details-modal > div:not(.modal-overlay)').innerHTML = detailsHTML.toString();
                    AppController.openModal('story-details-modal');
                } else {
                    const detailsWrapperHTML = DOM.html`
                <div class="w-full h-full flex flex-col md:-m-6 bg-gray-900 relative">
                    ${detailsHTML}
                </div>
            `;
                    document.getElementById('story-details-content-desktop').innerHTML = detailsWrapperHTML.toString();
                }

                if (hasImages) {
                    this.startCarousel(story.characters, 'details-carousel', story.id);
                }
            },

            /**
             * Starts the character image carousel for the story details modal.
             * @param {Array} characters - The list of characters in the story.
             * @param {string} containerId - The ID of the container element.
             * @param {string} storyId - The ID of the story.
             */
            startCarousel(characters, containerId, storyId) {
                if (ModalManager.RUNTIME.carousel_interval) clearInterval(ModalManager.RUNTIME.carousel_interval);

                const container = document.getElementById(containerId);
                if (!container) return;

                // Map characters to a clean object for the lightbox
                const imageData = (characters || []).map(c => {
                    const src = UIManager.getPortraitSrc(c);
                    return src ? { src, name: c.name } : null;
                }).filter(Boolean);

                if (imageData.length === 0) {
                    container.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-gray-900 text-gray-500">No character images</div>`;
                    return;
                }

                // Cache this list for the lightbox
                UIManager.RUNTIME.currentLightboxImages = imageData;

                // If only 1 image, render static and do NOT start interval
                if (imageData.length === 1) {
                    container.innerHTML = `
                <img src="${imageData[0].src}" 
                     data-action="open-lightbox" 
                     data-index="0"
                     class="absolute inset-0 w-full h-full object-cover object-top" 
                     style="opacity: 1;">
            `;
                    return;
                }

                // Multiple images: Render two for crossfading
                container.innerHTML = `
            <img id="${containerId}-img1" data-action="open-lightbox" data-index="0" class="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000" style="opacity: 1;">
            <img id="${containerId}-img2" data-action="open-lightbox" data-index="0" class="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000" style="opacity: 0;">
        `;

                let currentIndex = 0;
                let activeImg = 1;
                const img1 = document.getElementById(`${containerId}-img1`);
                const img2 = document.getElementById(`${containerId}-img2`);

                img1.src = imageData[currentIndex].src;

                ModalManager.RUNTIME.carousel_interval = setInterval(() => {
                    currentIndex = (currentIndex + 1) % imageData.length;
                    const nextSrc = imageData[currentIndex].src;

                    // Update the hidden image source, then fade it in
                    if (activeImg === 1) {
                        img2.src = nextSrc;
                        img2.dataset.index = currentIndex; // Update index for lightbox
                        img1.style.opacity = 0;
                        img2.style.opacity = 1;
                        activeImg = 2;
                    } else {
                        img1.src = nextSrc;
                        img1.dataset.index = currentIndex; // Update index for lightbox
                        img1.style.opacity = 1;
                        img2.style.opacity = 0;
                        activeImg = 1;
                    }
                }, 4000);
            },

            /**
             * Opens the lightbox modal for a specific image index.
             * @param {number|string} index - The index of the image to show.
             */
            openLightbox(index) {
                const images = UIManager.RUNTIME.currentLightboxImages || [];
                if (images.length === 0) return;

                UIManager.RUNTIME.lightboxIndex = parseInt(index) || 0;
                this.updateLightboxDisplay();

                const modal = document.getElementById('lightbox-modal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            },

            /**
             * Updates the lightbox image and caption based on the current index.
             */
            updateLightboxDisplay() {
                const images = UIManager.RUNTIME.currentLightboxImages || [];
                const index = UIManager.RUNTIME.lightboxIndex;
                const data = images[index];

                const imgEl = document.getElementById('lightbox-image');
                const capEl = document.getElementById('lightbox-caption');

                if (imgEl && data) imgEl.src = data.src;
                if (capEl && data) capEl.textContent = data.name;
            },

            /**
             * Navigates the lightbox to the next or previous image.
             * @param {number} direction - The direction to move (1 or -1).
             */
            navigateLightbox(direction) {
                const images = UIManager.RUNTIME.currentLightboxImages || [];
                if (images.length === 0) return;

                let newIndex = UIManager.RUNTIME.lightboxIndex + direction;
                if (newIndex >= images.length) newIndex = 0;
                if (newIndex < 0) newIndex = images.length - 1;

                UIManager.RUNTIME.lightboxIndex = newIndex;
                this.updateLightboxDisplay();
            },

            /**
             * Closes the lightbox modal.
             */
            closeLightbox() {
                const modal = document.getElementById('lightbox-modal');
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            },

            /**
             * Renders the character roster in the sidebar.
             * Sorts characters by User, Active status, then Alphabetical.
             */
            renderCharacters() {
                const state = StateManager.getState();
                const container = document.getElementById('characters-container');
                if (!state.characters) {
                    container.innerHTML = '';
                    return;
                }

                // Sorting Logic: Prioritize User, then Active, then Alphabetical
                // 1. User First
                // 2. Active Next (Alphabetical)
                // 3. Inactive Last (Alphabetical)
                const sortedChars = [...state.characters].sort((a, b) => {
                    // Priority 1: User Character
                    if (a.is_user && !b.is_user) return -1;
                    if (!a.is_user && b.is_user) return 1;

                    // Priority 2: Active Status
                    if (a.is_active && !b.is_active) return -1;
                    if (!a.is_active && b.is_active) return 1;

                    // Priority 3: Alphabetical Name
                    const nameA = a.name || "";
                    const nameB = b.name || "";
                    return nameA.localeCompare(nameB);
                });

                container.innerHTML = sortedChars.map(UIComponents.CharacterTile).join('');
            },

            /**
             * Renders the tabs for the Knowledge Modal (Static vs Dynamic).
             */
            renderKnowledgeModalTabs() {
                const tabName = (typeof AppController !== 'undefined' && AppController.activeKnowledgeTab) ? AppController.activeKnowledgeTab : 'static';

                const staticTab = document.getElementById('knowledge-tab-static');
                const dynamicTab = document.getElementById('knowledge-tab-dynamic');
                const staticContent = document.getElementById('knowledge-static-content');
                const dynamicContent = document.getElementById('knowledge-dynamic-content');

                if (tabName === 'static') {
                    staticContent.classList.remove('hidden');
                    dynamicContent.classList.add('hidden');
                    staticTab.classList.add('border-indigo-500', 'text-white');
                    staticTab.classList.remove('border-transparent', 'text-gray-400');
                    dynamicTab.classList.add('border-transparent', 'text-gray-400');
                    dynamicTab.classList.remove('border-indigo-500', 'text-white');
                    this.renderStaticEntries();
                } else {
                    dynamicContent.classList.remove('hidden');
                    staticContent.classList.add('hidden');
                    dynamicTab.classList.add('border-indigo-500', 'text-white');
                    dynamicTab.classList.remove('border-transparent', 'text-gray-400');
                    staticTab.classList.add('border-transparent', 'text-gray-400');
                    staticTab.classList.remove('border-indigo-500', 'text-white');
                    this.renderDynamicEntries();
                }
            },

            switchKnowledgeTab(tabName) {
                // Helper to switch tabs without calling Controller directly
                if (typeof AppController !== 'undefined') AppController.activeKnowledgeTab = tabName;
                this.renderKnowledgeModalTabs();
            },

            switchWorldMapTab(tabName) {
                // Helper for World Map
                if (typeof WorldController !== 'undefined') WorldController.RUNTIME.activeWorldMapTab = tabName;
                this.renderWorldMapModal();
            },

            /**
             * Renders the list of static lore entries.
             */
            renderStaticEntries() {
                const state = StateManager.getState();
                const listHtml = (state.static_entries || []).map(entry => DOM.html`<div data-action="select-static-entry" data-id="${entry.id}" class="p-3 rounded-lg cursor-pointer ${state.selectedStaticEntryId === entry.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} mb-1"><h4 class="font-semibold truncate">${entry.title}</h4></div>`).join('');

                // Item 9 - Square Add Button at bottom
                const addButtonHtml = `<div class="mt-2 p-2 border-t border-gray-700"><button data-action="add-static-entry" class="w-full py-2 bg-gray-700 hover:bg-indigo-600 text-white rounded flex justify-center items-center transition-colors"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg></button></div>`;

                const container = document.getElementById('static-entries-list');
                // We need to target the parent to append the button outside the scroll area, or keep it inside. 
                // Given the HTML structure change in Modal, the 'static-entries-list' is the flex-grow area.
                // Let's put the button adjacent to the list.
                container.innerHTML = listHtml;

                // Append button to parent container of the list
                let parent = container.parentElement;
                let existingBtn = parent.querySelector('.knowledge-add-btn-container');
                if (existingBtn) existingBtn.remove();

                const btnDiv = document.createElement('div');
                btnDiv.className = 'knowledge-add-btn-container flex-shrink-0 bg-black/30 rounded-b-lg p-2';
                btnDiv.innerHTML = `<button data-action="add-static-entry" class="w-full py-2 bg-gray-700 hover:bg-indigo-600 text-white rounded flex justify-center items-center transition-colors"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg></button>`;
                parent.appendChild(btnDiv);

                this.renderStaticEntryDetails();
            },

            /**
             * Renders the details view for the selected static entry.
             */
            renderStaticEntryDetails() {
                const state = StateManager.getState();
                const container = document.getElementById('static-entry-details-content');
                const entry = (state.static_entries || []).find(e => e.id === state.selectedStaticEntryId);
                if (entry) {
                    container.innerHTML = DOM.html`
            <div class="flex flex-col h-full">
                <div class="flex justify-between items-center mb-4">
                    <input type="text" value="${entry.title}" oninput="WorldController.updateStaticEntryField('${entry.id}', 'title', this.value)" onblur="UIManager.renderStaticEntries()" class="text-xl font-bold bg-black/30 p-2 flex-grow rounded mr-2">
                    <button onclick="WorldController.convertStaticToDynamic('${entry.id}')" class="text-xs bg-indigo-600/80 hover:bg-indigo-500 text-white font-bold py-2 px-3 rounded flex-shrink-0" title="Convert to Dynamic Entry">
                        To Dynamic &rarr;
                    </button>
                </div>
                <div class="relative flex-grow">
                    <textarea oninput="WorldController.updateStaticEntryField('${entry.id}', 'content', this.value)" class="w-full h-full bg-black/30 p-4 resize-none rounded-md">${entry.content}</textarea>
                    <button data-action="gen-static-ai" data-id="${entry.id}" class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
                </div>
                <div class="flex justify-end mt-4 flex-shrink-0">
                    <button data-action="delete-static-entry" data-id="${entry.id}" class="text-sm bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded-lg">Delete</button>
                </div>
            </div>`.toString();
                } else {
                    container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a static entry.</div>`;
                }
            },

            /**
             * Renders the list of dynamic lore entries.
             */
            renderDynamicEntries() {
                const state = StateManager.getState();
                // Ensure Robust ID Comparison (Convert to String) to handle legacy numeric IDs
                const listHtml = (state.dynamic_entries || []).map(entry => {
                    const isSelected = String(state.selectedDynamicEntryId) === String(entry.id);
                    return DOM.html`
                <div data-action="select-dynamic-entry" data-id="${entry.id}" 
                     class="p-3 rounded-lg cursor-pointer ${isSelected ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} flex justify-between items-center mb-1">
                    <h4 class="font-semibold truncate">${entry.title}</h4> 
                    ${entry.triggered_at_turn !== null ? DOM.unsafe('<span class="text-xs text-sky-300">ACTIVE</span>') : ''}
                </div>`;
                }).join('');

                const container = document.getElementById('dynamic-entries-list');
                container.innerHTML = listHtml;

                let parent = container.parentElement;
                let existingBtn = parent.querySelector('.knowledge-add-btn-container');
                if (existingBtn) existingBtn.remove();

                const btnDiv = document.createElement('div');
                btnDiv.className = 'knowledge-add-btn-container flex-shrink-0 bg-black/30 rounded-b-lg p-2';
                btnDiv.innerHTML = `<button data-action="add-dynamic-entry" class="w-full py-2 bg-gray-700 hover:bg-indigo-600 text-white rounded flex justify-center items-center transition-colors"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg></button>`;
                parent.appendChild(btnDiv);

                this.renderDynamicEntryDetails();
            },

            /**
             * Renders the details view for the selected dynamic entry.
             */
            renderDynamicEntryDetails() {
                const state = StateManager.getState();
                const container = document.getElementById('dynamic-entry-details-content');

                // FIX: Ensure Robust ID Comparison (Convert to String)
                const entry = (state.dynamic_entries || []).find(e => String(e.id) === String(state.selectedDynamicEntryId));

                if (entry) {
                    const contentFieldsHTML = (entry.content_fields || [""]).map((content, index) =>
                        UIComponents.DynamicContentField(content, index, entry.id, entry.content_fields.length)
                    );

                    container.innerHTML = DOM.html`<div class="flex flex-col h-full">
                <label class="font-bold text-sm text-gray-400">Title</label>
                <input type="text" value="${entry.title}" oninput="WorldController.updateDynamicEntryField('${entry.id}', 'title', this.value)" onblur="UIManager.renderDynamicEntries()" class="text-xl font-bold bg-black/30 p-2 w-full mb-4 rounded">
                
                <label class="font-bold mb-1 text-sm text-gray-400">Triggers (Keywords, AND, XOR, % Chance)</label>
                <input type="text" value="${entry.triggers}" oninput="WorldController.updateDynamicEntryField('${entry.id}', 'triggers', this.value)" placeholder="e.g. house, cat AND dog, 25%" class="bg-black/30 p-2 w-full mb-4 rounded">
                
                <div class="relative flex-grow flex flex-col">
                    <label class="font-bold mb-2 text-sm text-gray-400">Content Sequence</label>
                    <div class="space-y-2 overflow-y-auto pr-1">
                        ${contentFieldsHTML}
                    </div>
                    <div class="mt-2 flex justify-end">
                        <button 
                            data-action="add-dynamic-field" data-id="${entry.id}" 
                            class="bg-gray-700 hover:bg-indigo-600 text-white text-xs font-bold py-1 px-3 rounded transition-colors"
                        >
                            + Add Step
                        </button>
                    </div>
                </div>

                <div class="flex justify-end mt-4 border-t border-gray-700 pt-2">
                    <button data-action="delete-dynamic-entry" data-id="${entry.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded">Delete Entry</button>
                </div>
            </div>`.toString();
                } else {
                    container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a dynamic entry.</div>`;
                }
            },

            /**
             * Helper to create the HTML for a single chat message.
             * @param {Object} msg - The message object.
             * @param {number} index - The index of the message.
             * @returns {string} - The HTML string.
             * @private
             */
            _createMessageHTML(msg, index) {
                const state = StateManager.getState();
                return UIComponents.MessageBubble(msg, index, state);
            },

            /**
             * Renders the main chat window.
             * Handles scrolling, cinematic mode, and message display.
             */
            renderChat() {
                // Hardened check to prevent blinking during streaming updates
                if (this.RUNTIME.suppressChatRender) return;

                const state = StateManager.getState();
                const chatWindow = document.getElementById('chat-window');


                // 1. Empty State Check
                if (!state || !state.chat_history) {
                    if (chatWindow) chatWindow.innerHTML = `<div class="h-full w-full flex items-center justify-center text-gray-500 text-lg">No Narrative Loaded</div>`;
                    return;
                }

                // 2. Optimization: Don't full-render if actively streaming text
                if (this.RUNTIME.streamingInterval) return;

                // 3. Update Mode & Portraits
                document.body.dataset.mode = state.characterImageMode;
                this.updateSidePortrait();

                // 4. Handle Cinematic Background Logic
                if (state.characterImageMode === 'cinematic_overlay') {
                    let latestAiImageUrl = null;

                    // Find the last valid AI image in history
                    for (let i = state.chat_history.length - 1; i >= 0; i--) {
                        const msg = state.chat_history[i];
                        if (!msg) continue; // Safety check
                        if (msg.type !== 'chat' || msg.isHidden) continue;

                        const speaker = state.characters.find(c => c.id === msg.character_id);
                        if (speaker && !speaker.is_user) {
                            const candidate = this.getPortraitSrc(speaker, msg.emotion);
                            if (candidate) { latestAiImageUrl = candidate; break; }
                        }
                    }

                    // Apply the image transition
                    if (latestAiImageUrl && latestAiImageUrl !== this.RUNTIME.lastCinematicImageUrl) {
                        this.RUNTIME.lastCinematicImageUrl = latestAiImageUrl;
                        const bg1 = document.getElementById('cinematic-bg-1');
                        const bg2 = document.getElementById('cinematic-bg-2');

                        if (this.RUNTIME.activeCinematicBg === 1) {
                            bg2.style.backgroundImage = `url('${latestAiImageUrl}')`;
                            bg1.style.opacity = 0;
                            bg2.style.opacity = 1;
                            this.RUNTIME.activeCinematicBg = 2;
                        } else {
                            bg1.style.backgroundImage = `url('${latestAiImageUrl}')`;
                            bg1.style.opacity = 1;
                            bg2.style.opacity = 0;
                            this.RUNTIME.activeCinematicBg = 1;
                        }
                    } else if (!latestAiImageUrl && this.RUNTIME.lastCinematicImageUrl) {
                        // Keep old image if no new one found, or handle specific fallback
                        const activeBg = document.getElementById(`cinematic-bg-${this.RUNTIME.activeCinematicBg}`);
                        if (activeBg) activeBg.style.backgroundImage = `url('${this.RUNTIME.lastCinematicImageUrl}')`;
                    }
                } else {
                    // Reset cinematic backgrounds if not in that mode
                    const bg1 = document.getElementById('cinematic-bg-1');
                    const bg2 = document.getElementById('cinematic-bg-2');
                    if (bg1) { bg1.style.backgroundImage = 'none'; bg1.style.opacity = '0'; }
                    if (bg2) { bg2.style.backgroundImage = 'none'; bg2.style.opacity = '0'; }
                    this.RUNTIME.lastCinematicImageUrl = null;
                    this.RUNTIME.activeCinematicBg = 1;
                }

                // 5. Generate HTML
                chatWindow.innerHTML = (state.chat_history || [])
                    .map((msg, index) => {
                        // Guard against undefined messages during array mutation (Undo/Splice)
                        if (!msg) return '';
                        return UIComponents.MessageBubble(msg, index, state);
                    })
                    .join('');

                // 6. Cleanup flags
                (state.chat_history || []).forEach(m => { if (m) m.isNew = false; });

                // 7. Scroll to bottom
                setTimeout(() => {
                    window.requestAnimationFrame(() => {
                        if (chatWindow) {
                            chatWindow.scrollTop = chatWindow.scrollHeight;
                        }
                    });
                }, 50);
            },

            /**
             * Renders the Example Dialogue modal content.
             */
            renderExampleDialogueModal() {
                const state = StateManager.getState();
                const container = document.getElementById('example-dialogue-container');
                if (!container) return;

                const userChar = state.characters.find(c => c.is_user);
                const aiChars = state.characters.filter(c => !c.is_user);
                const exampleMessages = state.chat_history.map((msg, index) => ({ ...msg, originalIndex: index })).filter(msg => msg.isHidden === true);

                if (exampleMessages.length === 0) {
                    container.innerHTML = `<div class="text-gray-400 text-center">No example dialogue found. Add a turn to start.</div>`;
                    return;
                }

                container.innerHTML = exampleMessages.map((msg, idx) => {
                    const speakerOptions = [userChar, ...aiChars].map(char => DOM.html`<option value="${char.id}" ${msg.character_id === char.id ? 'selected' : ''}>${char.name}</option>`);
                    return DOM.html`
                <div class="bg-black/20 p-4 rounded-lg flex items-center space-x-4">
                    <div class="flex flex-col space-y-2">
                        <button data-action="move-example-turn" data-index="${msg.originalIndex}" data-direction="up" ${idx === 0 ? 'disabled' : ''} class="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:opacity-50 text-white font-bold p-2 rounded-lg" title="Move Up"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg></button>
                        <button data-action="move-example-turn" data-index="${msg.originalIndex}" data-direction="down" ${idx === exampleMessages.length - 1 ? 'disabled' : ''} class="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:opacity-50 text-white font-bold p-2 rounded-lg" title="Move Down"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button>
                    </div>
                    <div class="flex-grow flex flex-col space-y-2">
                        <select onchange="NarrativeController.updateExampleDialogueTurn(${msg.originalIndex}, 'character_id', this.value)" class="w-full bg-gray-700 border-gray-600 rounded p-2 text-sm">${speakerOptions}</select>
                        <textarea oninput="NarrativeController.updateExampleDialogueTurn(${msg.originalIndex}, 'content', this.value)" class="w-full bg-gray-900/80 border-gray-600 p-2 resize-none rounded-md">${msg.content}</textarea>
                    </div>
                    <button data-action="delete-example-turn" data-index="${msg.originalIndex}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded" title="Delete Turn"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            `;
                }).join('');

                const textareas = container.querySelectorAll('textarea');
                textareas.forEach(textarea => {
                    const autoResize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
                    textarea.addEventListener('input', autoResize);
                    setTimeout(autoResize, 0);
                });
            },

            /**
             * Updates the side portrait image based on the last speaker.
             */
            updateSidePortrait() {
                const state = StateManager.getState();
                const portraitContainer = document.getElementById('character-portrait-container');
                const chatWindow = document.getElementById('chat-window');
                const globalSettings = StateManager.data.globalSettings;

                // Check Layout Mode AND the User Preference
                const showPanel = globalSettings.showPortraitPanel !== false; // Default true

                // Vertical Layout (Mobile) always hides desktop portrait container
                if (document.body.classList.contains('layout-vertical')) {
                    if (portraitContainer) {
                        portraitContainer.style.display = 'none';
                        portraitContainer.innerHTML = '';
                    }
                    // Reset chat window styles for mobile to Defaults
                    if (chatWindow) {
                        chatWindow.style.width = '';
                        chatWindow.style.maxWidth = '';
                        chatWindow.style.margin = '';
                    }
                    return;
                }

                // Horizontal Layout (Desktop)
                if (portraitContainer && chatWindow) {
                    if (!showPanel) {
                        // If user disabled it, hide it and expand chat
                        portraitContainer.style.display = 'none';
                        portraitContainer.innerHTML = '';

                        // Adjust Chat Window to be centered and wider
                        chatWindow.style.width = '100%';
                        chatWindow.style.maxWidth = '900px'; // Prevent it from stretching too wide
                        chatWindow.style.margin = '0 auto';
                    } else {
                        // Restore default styles if enabled
                        portraitContainer.style.display = 'flex';

                        // Default horizontal layout style: 65% width, aligned next to portrait
                        chatWindow.style.width = '65%';
                        chatWindow.style.maxWidth = '100%';
                        chatWindow.style.margin = '0'; // IMPORTANT: Reset auto margin to align left
                    }
                }

                const lastChatMessages = (state.chat_history || [])
                    .filter(m => m.type === 'chat' && !m.isHidden && !state.characters.find(c => c.id === m.character_id)?.is_user);
                const lastSpeakerMsg = lastChatMessages.length ? lastChatMessages[lastChatMessages.length - 1] : null;
                const lastSpeaker = lastSpeakerMsg ? state.characters.find(c => c.id === lastSpeakerMsg.character_id) : null;

                if (!lastSpeaker) {
                    if (portraitContainer) portraitContainer.innerHTML = '';
                    return;
                }

                const mood = lastSpeakerMsg?.emotion || 'neutral';
                const portraitUrl = UIManager.getPortraitSrc(lastSpeaker, mood);

                if (!portraitUrl) {
                    if (portraitContainer) portraitContainer.innerHTML = '';
                    return;
                }

                if (portraitContainer) {
                    portraitContainer.innerHTML = DOM.html`<img src="${portraitUrl}" class="max-w-full max-h-full object-contain rounded-lg">`.toString();
                }
            },



            /**
             * Simulates a streaming response from the AI.
             * Updates the chat UI character by character.
             * @param {string} charId - The ID of the speaking character.
             * @param {string} fullText - The full text to stream.
             * @param {string} emotion - The emotion of the character.
             */
            startStreamingResponse(charId, fullText, emotion) {
                if (this.RUNTIME.streamingInterval) clearInterval(this.RUNTIME.streamingInterval);

                const state = ReactiveStore.state;
                const chatWindow = document.getElementById('chat-window');

                // 1. LOCK THE DB
                if (typeof ReactiveStore.pauseSaving === 'function') {
                    ReactiveStore.pauseSaving();
                }

                // 2. Create the "Empty" Message in State
                const messageIndex = state.chat_history.length;
                const newMessage = {
                    character_id: charId,
                    content: "",
                    type: 'chat',
                    emotion: emotion,
                    timestamp: new Date().toISOString(),
                    isNew: true
                };

                // Suppress full re-render (Prevent Start Blink)
                this.RUNTIME.suppressChatRender = true;
                state.chat_history.push(newMessage);
                this.RUNTIME.suppressChatRender = false;

                // Manually append the new bubble
                const newBubbleHTML = UIComponents.MessageBubble(newMessage, messageIndex, state);
                if (chatWindow) {
                    chatWindow.insertAdjacentHTML('beforeend', newBubbleHTML.toString());
                }

                // 3. Locate the DOM Element
                const messageContentEl = document.getElementById(`message-content-${messageIndex}`);
                const bubbleEl = messageContentEl ? messageContentEl.closest('.chat-bubble-container') : null;

                if (!messageContentEl) {
                    if (typeof ReactiveStore.resumeSaving === 'function') ReactiveStore.resumeSaving();
                    return;
                }

                // 4. The Animation Loop
                const words = fullText.split(/(\s+)/);
                let currentText = "";
                let wordIndex = 0;

                this.RUNTIME.streamingInterval = setInterval(() => {
                    if (wordIndex < words.length) {
                        currentText += words[wordIndex];

                        const styledContent = currentText.replace(/(["“][^"”]*["”])/g, `<span class="dialogue-quote">$1</span>`);
                        const fullHTML = DOM.unsafe(marked.parse(styledContent || ''));

                        let finalHTML = fullHTML.toString();
                        const character = state.characters.find(c => c.id === charId);

                        if (state.characterImageMode === 'bubble' && character) {
                            const imgSrc = this.getPortraitSrc(character, emotion);
                            if (imgSrc) finalHTML = `<img src="${imgSrc}" class="bubble-char-image">${finalHTML}`;
                        }

                        messageContentEl.innerHTML = finalHTML;
                        wordIndex++;
                    } else {
                        // 5. FINISH: Commit Data
                        clearInterval(this.RUNTIME.streamingInterval);
                        this.RUNTIME.streamingInterval = null;

                        // FIX: Keep suppression ON during post-processing
                        this.RUNTIME.suppressChatRender = true;

                        // Update the TRUE state now that we are done
                        state.chat_history[messageIndex].content = fullText;
                        state.chat_history[messageIndex].isNew = false;

                        // Manually clean up the 'new-message' class from the DOM
                        // Since we are skipping the re-render, we must update the class manually
                        if (bubbleEl) bubbleEl.classList.remove('new-message');

                        // 6. UNLOCK DB (Triggers save, but render is still suppressed)
                        if (typeof ReactiveStore.resumeSaving === 'function') {
                            ReactiveStore.resumeSaving();
                        }

                        // Check for Dynamic Entries (May modify state)
                        // We keep suppression ON so if a lore entry is added, we don't blink the whole chat.
                        // Note: If a lore entry IS added, it won't appear until the next interaction. 
                        // This is a trade-off for smoothness, but acceptable for "hidden" lore. 
                        // If you want Lore Reveals to appear instantly, we would need to manually append them here too.
                        let structureChanged = false;
                        if (typeof NarrativeController !== 'undefined') {
                            structureChanged = NarrativeController.checkDynamicEntryTriggers();
                        }

                        // If dynamic entries modified the array structure (splicing out old entries),
                        // the DOM indices are now stale. We MUST force a re-render to align them.
                        if (structureChanged) {
                            this.RUNTIME.suppressChatRender = false;
                            this.renderChat(); // Force update to fix edit buttons
                        }

                        // Final Scroll Logic
                        if (bubbleEl && !structureChanged) {
                            // Only do smooth scroll if we didn't just blow away the DOM with renderChat
                            window.requestAnimationFrame(() => {
                                bubbleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                setTimeout(() => {
                                    this.RUNTIME.suppressChatRender = false;
                                }, 100);
                            });
                        } else if (structureChanged) {
                            // If we re-rendered, just ensure we are at the bottom or near the new content
                            const chatWindow = document.getElementById('chat-window');
                            if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
                        } else {
                            this.RUNTIME.suppressChatRender = false;
                        }
                    }
                }, 5);
            },

            /**
             * Displays a typing indicator for a specific character.
             * @param {string} charId - The ID of the character thinking.
             * @param {string} [text="is thinking..."] - The text to display.
             */
            showTypingIndicator(charId, text = "is thinking...") {
                this.hideTypingIndicator();
                const chatWindow = document.getElementById('chat-window');
                const name = (StateManager.getState().characters || []).find(c => c.id === charId)?.name || 'System';
                const indicator = document.createElement('div');
                indicator.id = 'typing-indicator';

                indicator.className = 'chat-bubble-container';
                indicator.innerHTML = DOM.html`
            <div class="mb-4 flex flex-col items-start">
                <p class="font-bold text-sm mb-1">${name}</p>
                <div class="p-3 bg-gray-700/80 rounded-lg typing-bubble-pulse">
                    <p class="italic">${text}</p>
                </div>
            </div>`.toString();

                chatWindow.appendChild(indicator);
                chatWindow.scrollTop = chatWindow.scrollHeight;
            },

            /**
             * Hides the current typing indicator.
             */
            hideTypingIndicator() {
                const el = document.getElementById('typing-indicator');
                if (el) el.remove();
            },

            /**
             * Applies global styling based on the current state.
             * Updates background images, blur, fonts, and colors.
             */
            applyStyling() {
                const state = StateManager.getState();
                const backgroundElement = document.getElementById('global-background');

                // 1. Handle Background Image Logic
                let backgroundUrl = '';

                // Priority 1: Location Image (World Map)
                if (state.worldMap && state.worldMap.grid.length > 0 && state.worldMap.currentLocation) {
                    const currentLoc = state.worldMap.grid.find(loc => loc.coords.x === state.worldMap.currentLocation.x && loc.coords.y === state.worldMap.currentLocation.y);
                    if (currentLoc) {
                        const locationKey = `location::${currentLoc.coords.x},${currentLoc.coords.y}`;
                        UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};

                        if (UIManager.RUNTIME.worldImageCache[locationKey]) {
                            backgroundUrl = UIManager.RUNTIME.worldImageCache[locationKey];
                        }
                        else if (currentLoc.imageUrl && !currentLoc.imageUrl.startsWith('local_idb_location')) {
                            backgroundUrl = currentLoc.imageUrl;
                        }
                        // HYDRATION FIX: If it SHOULD be a local IDB image, but it's not in cache, fetch it.
                        else if (currentLoc.imageUrl && currentLoc.imageUrl.startsWith('local_idb_location')) {
                            // Trigger async load, but don't block render.
                            // Pass the *stored* key (e.g. local_idb_location::4,4) to the hydration helper
                            // The helper expects the raw IDB key, which is "location::4,4" usually?
                            // Let's check how we save it. 
                            // In WorldController.handleWorldMapLocationImageUpload: 
                            // locationKey = `location::${x},${y}`;
                            // location.imageUrl = `local_idb_location::${x},${y}`;
                            // So we strip the prefix.
                            this.hydrateLocationImage(currentLoc.imageUrl);
                        }
                    }
                }

                // Priority 2: Story Setting
                // Only use the cache if the setting explicitly requests the local IDB image.
                // Logic: If Priority 1 set a backgroundUrl, we should skip this block.

                if (!backgroundUrl) {
                    if (state.backgroundImageURL === 'local_idb_background' && UIManager.RUNTIME.globalBackgroundImageCache) {
                        backgroundUrl = UIManager.RUNTIME.globalBackgroundImageCache;
                    }
                    else if (state.backgroundImageURL && state.backgroundImageURL !== 'local_idb_background') {
                        backgroundUrl = state.backgroundImageURL;
                    }
                }

                if (backgroundElement) {
                    backgroundElement.style.backgroundImage = backgroundUrl ? `url('${backgroundUrl}')` : 'none';
                }

                // 2. Handle Base UI Settings
                document.getElementById('app-container').style.backdropFilter = `blur(${state.backgroundBlur || 0}px)`;
                document.documentElement.style.setProperty('--chat-font-size', `${state.textSize || 16}px`);
                document.documentElement.style.setProperty('--bubble-image-size', `${state.bubbleImageSize || 100}px`);

                // 3. Calculate Border Hue from Text Color
                const hexToRgb = (hex) => {
                    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                    return result ? {
                        r: parseInt(result[1], 16),
                        g: parseInt(result[2], 16),
                        b: parseInt(result[3], 16)
                    } : null;
                };

                const rgb = hexToRgb(state.chatTextColor);
                if (rgb) {
                    document.documentElement.style.setProperty('--border-hue-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`);
                }

                document.documentElement.style.setProperty('--chat-text-color', state.chatTextColor);
                document.documentElement.style.setProperty('--chat-font-family', state.font);

                // 4. Sync Titles
                const storyTitleInput = document.getElementById('story-title-input');
                const mobileStoryTitleOverlay = document.getElementById('mobile-story-title-overlay');
                if (storyTitleInput) {
                    storyTitleInput.style.color = state.chatTextColor;
                    storyTitleInput.style.fontFamily = state.font;
                }
                if (mobileStoryTitleOverlay) {
                    mobileStoryTitleOverlay.style.color = state.chatTextColor;
                    mobileStoryTitleOverlay.style.fontFamily = state.font;
                }

                // 5. Apply Markdown Colors & Fonts
                const defaults = UTILITY.getDefaultUiSettings();
                const root = document.documentElement;
                const chatFont = state.font || defaults.font;

                // Colors
                root.style.setProperty('--md-h1-color', state.md_h1_color || defaults.md_h1_color);
                root.style.setProperty('--md-h2-color', state.md_h2_color || defaults.md_h2_color);
                root.style.setProperty('--md-h3-color', state.md_h3_color || defaults.md_h3_color);
                root.style.setProperty('--md-bold-color', state.md_bold_color || defaults.md_bold_color);
                root.style.setProperty('--md-italic-color', state.md_italic_color || defaults.md_italic_color);
                root.style.setProperty('--md-quote-color', state.md_quote_color || defaults.md_quote_color);

                // Fonts (Fallback to chat font if empty)
                root.style.setProperty('--md-h1-font', state.md_h1_font || chatFont);
                root.style.setProperty('--md-h2-font', state.md_h2_font || chatFont);
                root.style.setProperty('--md-h3-font', state.md_h3_font || chatFont);
                root.style.setProperty('--md-bold-font', state.md_bold_font || chatFont);
                root.style.setProperty('--md-italic-font', state.md_italic_font || chatFont);
                root.style.setProperty('--md-quote-font', state.md_quote_font || chatFont);

                // Smart Quote Logic
                // If the user is using the default color (#9ca3af), we use the original "Filter" style (inherit + opacity/saturation).
                // If the user picked a CUSTOM color, we disable the filter so the color appears exactly as chosen.
                const defaultQuoteColor = '#9ca3af';
                const isDefaultQuote = (state.md_quote_color || defaultQuoteColor).toLowerCase() === defaultQuoteColor.toLowerCase();

                if (isDefaultQuote) {
                    // Restore original cinematic look
                    root.style.setProperty('--active-quote-color', 'inherit');
                    root.style.setProperty('--active-quote-filter', 'saturate(175%) opacity(75%) drop-shadow(1px 1px 5px black)');
                } else {
                    // Use exact user color with a standard shadow (no opacity/saturation filter)
                    root.style.setProperty('--active-quote-color', state.md_quote_color);
                    root.style.setProperty('--active-quote-filter', 'drop-shadow(1px 1px 2px rgba(0,0,0,0.5))');
                }

                this.renderChat();
            },



            /**
             * Hydrates a location image from IndexDB into the runtime cache.
             * @param {string} locationUrl - The stored image URL (e.g. 'local_idb_location::4,4').
             */
            async hydrateLocationImage(locationUrl) {
                if (!locationUrl || !locationUrl.startsWith('local_idb_')) return;

                // key logic: remove the prefix?
                // In handleWorldMapLocationImageUpload: 
                // key = `location::${x},${y}`
                // saved url = `local_idb_location::${x},${y}`
                // So key = locationUrl.replace('local_idb_', '')

                const key = locationUrl.replace('local_idb_', ''); // "location::4,4"

                // Avoid double fetching
                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                if (UIManager.RUNTIME.worldImageCache[key]) return; // Already in cache

                try {
                    const blob = await DBService.getImage(key);
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        UIManager.RUNTIME.worldImageCache[key] = url;
                        // Re-apply styling to update the background immediately
                        this.applyStyling();

                        // Also re-render map execution if open (optional but nice)
                        // If map modal is open, re-render it
                        const mapModal = document.getElementById('world-map-modal');
                        if (mapModal && !mapModal.classList.contains('hidden')) {
                            this.renderWorldMapModal();
                        }
                    }
                } catch (e) {
                    console.warn("Hydration failed for", locationUrl, e);
                }
            },

            /**
             * Renders the World Map modal content.
             * Handles both "Move" and "World Map" (Edit) tabs.
             */
            renderWorldMapModal() {
                const state = StateManager.getState();
                const activeWorldMapTab = (typeof WorldController !== 'undefined') ? WorldController.RUNTIME.activeWorldMapTab : 'move';
                const pendingMove = (typeof WorldController !== 'undefined') ? WorldController.RUNTIME.pendingMove : null;
                const { worldMap } = state;
                const container = document.getElementById('world-map-modal-content');

                let contentHTML = '';
                // Only use columns for "Move" tab. "World Map" tab is now full width grid.
                const gridLayoutClass = activeWorldMapTab === 'move' ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1';

                if (activeWorldMapTab === 'move') {
                    // --- MOVE TAB LOGIC (Unchanged) ---
                    const { currentLocation } = worldMap;
                    let moveGridHTML = '';
                    // Generate 3x3 Grid centered on player
                    for (let y = currentLocation.y - 1; y <= currentLocation.y + 1; y++) {
                        for (let x = currentLocation.x - 1; x <= currentLocation.x + 1; x++) {
                            const isCenter = x === currentLocation.x && y === currentLocation.y;
                            const location = worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                            let imageSrc = '';
                            if (location) {
                                const locationKey = `location::${x},${y}`;
                                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                                if (UIManager.RUNTIME.worldImageCache[locationKey]) imageSrc = UIManager.RUNTIME.worldImageCache[locationKey];
                                else if (location.imageUrl && !location.imageUrl.startsWith('local_idb_location')) imageSrc = location.imageUrl;
                            }
                            const bgImage = imageSrc ? `background-image: url('${imageSrc}');` : '';
                            let classList = ['aspect-square', 'rounded-lg', 'flex', 'items-center', 'justify-center', 'text-center', 'p-2', 'text-white', 'relative', 'overflow-hidden', 'bg-cover', 'bg-center', 'transition-all'];

                            if (isCenter) classList.push('bg-indigo-800/80', 'ring-2', 'ring-indigo-300');
                            else if (location) {
                                // If we have a background image, don't use the opaque gray background.
                                // Use a transparent black overlay to ensure text contrast if needed, but let the image shine.
                                if (imageSrc) classList.push('bg-black/20', 'cursor-pointer', 'hover:ring-2', 'hover:ring-sky-400');
                                else classList.push('bg-gray-700/80', 'cursor-pointer', 'hover:ring-2', 'hover:ring-sky-400');
                            }
                            else classList.push('bg-black/50');

                            if (pendingMove && pendingMove.x === x && pendingMove.y === y && !isCenter) classList.push('ring-4', 'ring-yellow-400');

                            if (location) {
                                const displayName = (location.name && location.name !== 'Undefined') ? location.name : '';
                                moveGridHTML += DOM.html`<div class="${classList.join(' ')}" style="${DOM.unsafe(bgImage)}" ${!isCenter ? DOM.unsafe(`data-action="select-pending-move" data-x="${x}" data-y="${y}"`) : ''}><div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>${displayName ? DOM.html`<span class="relative z-10 text-sm font-bold">${displayName}</span>` : ''}</div>`.toString();
                            } else {
                                moveGridHTML += DOM.html`<div class="${classList.join(' ')}"></div>`.toString();
                            }
                        }
                    }

                    let detailsHTML = '';
                    const pendingLocation = pendingMove ? worldMap.grid.find(l => l.coords.x === pendingMove.x && l.coords.y === pendingMove.y) : null;
                    if (pendingLocation) {
                        detailsHTML = DOM.html`<h3 class="text-2xl font-bold">${pendingLocation.name}</h3><p class="text-gray-400 mt-2 flex-grow">${pendingLocation.description}</p><button data-action="confirm-move" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg mt-4">Confirm Move</button>`;
                    } else {
                        const currentLocationData = worldMap.grid.find(l => l.coords.x === currentLocation.x && l.coords.y === currentLocation.y);
                        detailsHTML = DOM.html`<h3 class="text-2xl font-bold">Movement</h3><p class="text-gray-400 mt-2">You are currently at <strong>${currentLocationData.name}</strong>.</p><p class="text-gray-400 mt-2">Select an adjacent tile to see its details and confirm your move.</p>`;
                    }

                    contentHTML = DOM.html`<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-start h-full"><div class="grid grid-cols-3 gap-2">${DOM.unsafe(moveGridHTML)}</div><div class="flex flex-col h-full bg-black/20 p-4 rounded-lg">${detailsHTML}</div></div>`;

                } else {
                    // --- EDIT TAB LOGIC (Updated) ---
                    const { currentLocation, destination, path } = worldMap;
                    let mapGridHTML = '';
                    for (let y = 0; y < 8; y++) {
                        for (let x = 0; x < 8; x++) {
                            // 1. Resolve Image for Edit Tab
                            let imageSrc = '';
                            if (location) {
                                const locationKey = `location::${x},${y}`;
                                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                                if (UIManager.RUNTIME.worldImageCache[locationKey]) imageSrc = UIManager.RUNTIME.worldImageCache[locationKey];
                                else if (location.imageUrl && !location.imageUrl.startsWith('local_idb_location')) imageSrc = location.imageUrl;
                            }

                            let classList = [
                                'aspect-square', 'rounded', 'cursor-pointer', 'text-xs', 'p-1', 'overflow-hidden', 'leading-tight',
                                'flex', 'items-center', 'justify-center', 'text-center', 'transition-all', 'duration-200',
                                'bg-cover', 'bg-center', 'relative' // Added for image support
                            ];

                            // Subtle gradients for visibility
                            if (location) {
                                if (imageSrc) {
                                    classList.push('bg-black/20', 'text-white', 'shadow-sm', 'text-shadow-sm');
                                } else {
                                    classList.push('bg-gradient-to-br', 'from-gray-700/90', 'to-gray-800/90', 'hover:from-gray-600/90', 'hover:to-gray-700/90', 'text-gray-100', 'shadow-sm');
                                }
                            } else {
                                classList.push('bg-gradient-to-br', 'from-gray-800/40', 'to-gray-900/40', 'hover:from-gray-800/60', 'hover:to-gray-900/60', 'text-gray-500');
                            }

                            if (currentLocation.x === x && currentLocation.y === y) classList.push('ring-2', 'ring-green-400', 'z-10');
                            if (destination && destination.x === x && destination.y === y) classList.push('ring-2', 'ring-red-500', 'z-10');
                            if (path && path.some(p => p.x === x && p.y === y)) classList.push('bg-sky-900/50');

                            // Removed selectedMapTile ring logic from here as it opens a modal now

                            const bgStyle = imageSrc ? `background-image: url('${imageSrc}');` : '';
                            // Add overlay for text readability if image exists
                            const displayName = (location && location.name && location.name !== 'Undefined') ? location.name : '';
                            const content = location ? (imageSrc ? `<div class="absolute inset-0 bg-black/40"></div>${displayName ? `<span class="relative z-10">${displayName}</span>` : ''}` : displayName) : '';

                            mapGridHTML += DOM.html`<div class="${classList.join(' ')}" style="${DOM.unsafe(bgStyle)}" data-action="select-map-tile" data-x="${x}" data-y="${y}">${DOM.unsafe(content)}</div>`.toString();
                        }
                    }

                    // Center the grid and limit width for better aesthetics
                    contentHTML = DOM.html`
            <div class="p-6 h-full flex flex-col items-center justify-center">
                <p class="text-sm text-gray-400 mb-2 w-full max-w-3xl text-left">Click any tile to edit details, set prompts, or manage local lore.</p>
                <div class="grid grid-cols-8 gap-1 w-full max-w-3xl aspect-square">
                    ${DOM.unsafe(mapGridHTML)}
                </div>
            </div>`;
                }

                const headerHTML = DOM.html`
                <div class="p-4 border-b border-gray-700 flex justify-between items-center bg-black/40 flex-shrink-0">
                     <div class="flex space-x-4">
                        <button onclick="UIManager.switchWorldMapTab('move')" class="pb-2 text-lg font-bold border-b-2 ${activeWorldMapTab === 'move' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-400 hover:text-white'} transition-colors">Move</button>
                        <button onclick="UIManager.switchWorldMapTab('worldmap')" class="pb-2 text-lg font-bold border-b-2 ${activeWorldMapTab === 'worldmap' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-400 hover:text-white'} transition-colors">Edit Map</button>
                     </div>
                     <div class="flex items-center space-x-3">
                        <button data-action="clear-world-map" class="text-red-400 hover:text-red-300 transition-colors mr-3" title="Clear World Map">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        <button id="generate-world-button" data-action="gen-world-map" class="text-sky-400 hover:text-sky-300 transition-colors" title="Generate World with AI">${this.getAIGenIcon()}</button>
                        <button data-action="close-modal" data-id="world-map-modal" class="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Close">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                     </div>
                </div>`;

                container.innerHTML = DOM.html`<div class="flex flex-col h-full">${headerHTML}<div class="flex-grow overflow-y-auto min-h-0">${contentHTML}</div></div>`.toString();
            },

            /**
             * Renders the details modal for a selected map location.
             */
            renderLocationDetailsModal() {
                if (typeof WorldController === 'undefined') return;
                const { selectedMapTile } = WorldController.RUNTIME;
                const container = document.getElementById('location-details-content');

                if (!selectedMapTile || !container) return;

                // 1. Resolve Image Source (Lazy Load & Cache)
                const x = selectedMapTile.coords.x;
                const y = selectedMapTile.coords.y;
                const imgKey = `location::${x},${y}`;
                let visualSrc = null;

                // Ensure cache object exists
                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};

                if (selectedMapTile.imageUrl) {
                    if (selectedMapTile.imageUrl.startsWith('local_idb_')) {
                        if (UIManager.RUNTIME.worldImageCache[imgKey]) {
                            visualSrc = UIManager.RUNTIME.worldImageCache[imgKey];
                        } else {
                            DBService.getImage(imgKey).then(blob => {
                                if (blob) {
                                    UIManager.RUNTIME.worldImageCache[imgKey] = URL.createObjectURL(blob);
                                    if (WorldController.RUNTIME.selectedMapTile &&
                                        WorldController.RUNTIME.selectedMapTile.coords.x === x &&
                                        WorldController.RUNTIME.selectedMapTile.coords.y === y) {
                                        UIManager.renderLocationDetailsModal();
                                    }
                                }
                            }).catch(e => console.warn("Failed to load location image", e));
                        }
                    } else {
                        visualSrc = selectedMapTile.imageUrl;
                    }
                }

                // 2. Generate Image HTML
                const imageDisplayHTML = visualSrc
                    ? `
                        <div class="relative w-full aspect-video rounded-lg overflow-hidden border border-gray-600 mb-3 group bg-black/50">
                             <img src="${visualSrc}" class="w-full h-full object-cover">
                             <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <span class="text-white font-bold text-sm drop-shadow-md">Change Image</span>
                             </div>
                        </div>`
                    : `
                        <div class="w-full aspect-video rounded-lg bg-black/40 border-2 border-dashed border-gray-700 mb-3 flex flex-col items-center justify-center text-gray-500 gap-2">
                            <svg class="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <span class="text-xs">No Image Set</span>
                        </div>`;

                const imageHint = selectedMapTile.imageUrl ? (selectedMapTile.imageUrl.startsWith('local_idb_') ? 'Local Storage' : 'Legacy URL') : 'None';

                const content = DOM.html`
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div class="space-y-6">
                    <div>
                        <label class="block text-sm font-bold text-gray-400 mb-1">Location Name</label>
                        <input type="text" value="${selectedMapTile.name}" oninput="WorldController.updateLocationDetail('name', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded text-lg focus:border-indigo-500">
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-400 mb-1">Brief Description</label>
                        <textarea oninput="WorldController.updateLocationDetail('description', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded h-24 resize-none text-sm">${selectedMapTile.description}</textarea>
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-400 mb-1">Visuals</label>
                        ${DOM.unsafe(imageDisplayHTML)}
                        <div class="flex items-center justify-between bg-black/20 p-2 rounded border border-gray-700">
                            <span class="text-xs text-gray-500">Source: ${imageHint}</span>
                            <label class="cursor-pointer bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-1 px-3 rounded transition-colors shadow-sm">
                                Upload New
                                <input type="file" accept="image/*" 
                                       onchange="WorldController.handleWorldMapLocationImageUpload(event, ${selectedMapTile.coords.x}, ${selectedMapTile.coords.y})"
                                       class="hidden">
                            </label>
                        </div>
                    </div>

                    <div class="pt-4 border-t border-gray-700">
                        <label class="block text-sm font-bold text-gray-400 mb-2">Navigation Actions</label>
                        <div class="grid grid-cols-2 gap-3">
                           <button data-action="set-destination" class="bg-sky-600/80 hover:bg-sky-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">Set Destination</button>
                           <button data-action="jump-to-location" data-x="${selectedMapTile.coords.x}" data-y="${selectedMapTile.coords.y}" class="bg-indigo-600/80 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">Jump To Here</button>
                        </div>
                    </div>
                </div>

                <div class="space-y-6 flex flex-col h-full">
                    
                    <div class="flex-grow flex flex-col min-h-[200px]">
                        <label class="block text-sm font-bold text-gray-400 mb-1">Full Generative Prompt</label>
                        <div class="relative flex-grow">
                            <textarea oninput="WorldController.updateLocationDetail('prompt', this.value)" class="w-full h-full bg-black/30 border-gray-600 p-3 rounded resize-none text-sm leading-relaxed">${selectedMapTile.prompt}</textarea>
                            <button data-action="gen-loc-prompt" class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
                        </div>
                    </div>

                    <div class="h-1/2 flex flex-col min-h-[250px]">
                        <div class="flex justify-between items-center mb-2">
                            <h4 class="font-bold text-sm text-gray-300 flex items-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253z"></path></svg>
                                Local Static Memory
                            </h4>
                            <button data-action="add-local-static-entry" class="text-xs bg-gray-700 hover:bg-indigo-600 text-white font-bold py-1 px-2 rounded transition-colors">+ Add</button>
                        </div>
                        <div class="flex-grow border border-gray-700 rounded-lg overflow-hidden flex">
                            <div id="local-static-entries-list" class="w-1/3 bg-black/40 border-r border-gray-700 overflow-y-auto p-1 space-y-1"></div>
                            <div id="local-static-entry-details" class="w-2/3 bg-black/20 p-2 flex flex-col"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

                container.innerHTML = content.toString();
                this.renderLocalStaticEntriesList();
                this.renderLocalStaticEntryDetails();
            },

            /**
             * Renders the list of local static entries for a location.
             */
            renderLocalStaticEntriesList() {
                // Access Controller state via WorldController
                if (typeof WorldController === 'undefined') return;
                const { selectedMapTile, selectedLocalStaticEntryId } = WorldController.RUNTIME;

                const container = document.getElementById('local-static-entries-list');
                if (!container || !selectedMapTile) return;

                const entries = selectedMapTile.local_static_entries || [];
                container.innerHTML = entries.map(entry => DOM.html`
            <div data-action="select-local-static-entry" data-id="${entry.id}" 
                 class="p-2 rounded-md cursor-pointer ${selectedLocalStaticEntryId === entry.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'}">
                <h5 class="font-semibold truncate text-sm">${entry.title}</h5>
            </div>
        `).join('');
            },

            /**
             * Renders the details view for a selected local static entry.
             */
            renderLocalStaticEntryDetails() {
                if (typeof WorldController === 'undefined') return;
                const { selectedMapTile, selectedLocalStaticEntryId } = WorldController.RUNTIME;

                const container = document.getElementById('local-static-entry-details');
                if (!container || !selectedMapTile) return;

                const entry = (selectedMapTile.local_static_entries || []).find(e => e.id === selectedLocalStaticEntryId);

                if (entry) {
                    container.innerHTML = DOM.html`
                <input type="text" value="${entry.title}" oninput="WorldController.updateLocalStaticEntryField('${entry.id}', 'title', this.value)" class="font-bold bg-black/30 p-2 w-full mb-2 text-sm rounded-md">
                <textarea oninput="WorldController.updateLocalStaticEntryField('${entry.id}', 'content', this.value)" class="w-full flex-grow bg-black/30 p-2 resize-none text-sm rounded-md">${entry.content}</textarea>
                <div class="flex justify-end mt-2">
                    <button data-action="delete-local-static-entry" data-id="${entry.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded">Delete</button>
                </div>`.toString();
                } else {
                    container.innerHTML = `<div class="text-gray-500 flex items-center justify-center h-full text-sm">Select an entry.</div>`;
                }
            },

            /**
             * Retrieves the appropriate portrait URL for a character and emotion.
             * Checks cache and local storage before falling back to URL.
             * @param {Object} character - The character object.
             * @param {string} [mood=null] - The emotion to retrieve.
             * @returns {string|null} - The image URL or null.
             */
            getPortraitSrc(character, mood) {
                const cache = UIManager.RUNTIME.characterImageCache || {};

                const emoKey = mood ? `${character.id}::emotion::${mood}` : null;
                if (emoKey && cache[emoKey]) return cache[emoKey];

                if (cache[character.id]) return cache[character.id];

                if (character.image_url && !character.image_url.startsWith('local_idb_')) {
                    return character.image_url;
                }

                return null;
            },

            /**
             * Opens the Character Detail modal for editing a character.
             * @param {string} charId - The ID of the character to edit.
             */
            openCharacterDetailModal(charId) {
                const state = StateManager.getState();
                const char = state.characters.find(c => c.id === charId);
                if (!char) return;
                const container = document.getElementById('character-detail-modal-content');

                let currentRole = 'none';
                if (char.is_user) currentRole = 'user';
                else if (char.is_narrator) currentRole = 'narrator';

                const extraPortraitsHTML = (char.extra_portraits || []).map((portrait, index) => {
                    const emo = portrait.emotion || 'happy';
                    const fileInputId = `emo-file-${char.id}-${index}`;
                    const urlInputId = `emo-url-${char.id}-${index}`;
                    const labelId = `emo-label-${char.id}-${index}`;
                    const cached = (UIManager.RUNTIME.characterImageCache || {})[`${char.id}::emotion::${emo}`];
                    const hint = cached ? '[local image]' : (portrait.url ? '[url]' : '[none]');
                    return DOM.html`
                <div class="flex flex-col space-y-2 mt-2 p-2 rounded border border-gray-700/50">
                    <div class="flex items-center space-x-2">
                        <select onchange="NarrativeController.updateExtraPortrait('${char.id}', ${index}, 'emotion', this.value)" class="w-1/3 bg-black/30 border-gray-600 rounded p-1 text-sm">
                            <option value="happy" ${emo === 'happy' ? 'selected' : ''}>Happy</option>
                            <option value="sad" ${emo === 'sad' ? 'selected' : ''}>Sad</option>
                            <option value="angry" ${emo === 'angry' ? 'selected' : ''}>Angry</option>
                            <option value="surprised" ${emo === 'surprised' ? 'selected' : ''}>Surprised</option>
                            <option value="neutral" ${emo === 'neutral' ? 'selected' : ''}>Neutral</option>
                        </select>
                        <input id="${urlInputId}" type="text" value="${portrait.url || ''}" oninput="NarrativeController.updateExtraPortrait('${char.id}', ${index}, 'url', this.value)" class="w-2/3 bg-black/30 border-gray-600 p-1 text-sm" placeholder="Image URL">
                        <button data-action="remove-extra-portrait" data-id="${char.id}" data-index="${index}" class="text-red-400 hover:text-red-300">X</button>
                    </div>
                    <div class="flex items-center justify-between">
                        <label class="text-sm text-gray-400" for="${fileInputId}">Upload local image for <span class="font-semibold">${emo}</span>:</label>
                        <span id="${labelId}" class="text-xs text-gray-400">${hint}</span>
                    </div>
                    <input id="${fileInputId}" type="file" accept="image/*" data-action-change="upload-emo-image" data-id="${char.id}" data-index="${index}" class="block w-full text-sm text-gray-400 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer">
                </div>`;
                });

                const tagsValue = (char.tags || []).join(', ');
                const color = char.color || { base: '#334155', bold: '#94a3b8' };

                const modalHTML = DOM.html`
            <div class="p-6 border-b border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 class="text-2xl font-semibold" data-char-id="${char.id}">${char.name}</h2>
                    <div class="flex items-center space-x-2 mt-1">
                        <span class="text-sm text-gray-400">Active in this chat</span>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" class="sr-only peer" ${char.is_active ? 'checked' : ''} onchange="NarrativeController.toggleCharacterActive(event, '${char.id}')">
                            <div class="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>
                </div>
                
                <div class="flex items-center space-x-4">
                    <div class="flex bg-black/40 rounded-lg p-1">
                        <button data-action="set-char-role" data-id="${char.id}" data-role="user" class="px-3 py-1 rounded-md text-sm font-bold transition-colors ${currentRole === 'user' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}">User</button>
                        <button data-action="set-char-role" data-id="${char.id}" data-role="none" class="px-3 py-1 rounded-md text-sm font-bold transition-colors ${currentRole === 'none' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}">NPC</button>
                        <button data-action="set-char-role" data-id="${char.id}" data-role="narrator" class="px-3 py-1 rounded-md text-sm font-bold transition-colors ${currentRole === 'narrator' ? 'bg-teal-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}">Narrator</button>
                    </div>
                    <button data-action="close-modal" data-id="character-detail-modal" class="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Close">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            </div>

            <div class="p-6 overflow-y-auto space-y-4">
                <details open>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Primary Info</summary>
                    <div class="p-4 space-y-4 bg-black/20 rounded-b-lg">
                        <input type="text" value="${char.name}" oninput="NarrativeController.updateCharacterField('${char.id}', 'name', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded text-lg" placeholder="Character Name">
                        <div><label class="text-sm text-gray-400">Short Description (for roster card)</label><input type="text" value="${char.short_description}" oninput="NarrativeController.updateCharacterField('${char.id}', 'short_description', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded"></div>
                        <div>
                            <label class="text-sm text-gray-400">Default Image</label>
                            <input type="text" value="${char.image_url}" oninput="NarrativeController.updateCharacterField('${char.id}', 'image_url', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded mb-2" placeholder="Paste URL...">
                            <input type="file" accept="image/*" data-action-change="upload-local-image" data-id="${char.id}" class="block w-full text-sm text-gray-400 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div><label class="text-sm text-gray-400">Bubble Base Color</label><input type="color" value="${color.base}" oninput="NarrativeController.updateCharacterColor('${char.id}', 'base', this.value)" class="w-full h-10 p-1 bg-black/30 border-gray-600 rounded"></div>
                            <div><label class="text-sm text-gray-400">Name Color</label><input type="color" value="${color.bold}" oninput="NarrativeController.updateCharacterColor('${char.id}', 'bold', this.value)" class="w-full h-10 p-1 bg-black/30 border-gray-600 rounded"></div>
                        </div>
                        <div><label class="text-sm text-gray-400">Tags (comma-separated)</label><input type="text" value="${tagsValue}" oninput="NarrativeController.updateCharacterTags('${char.id}', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded"><button data-action="gen-char-tags" data-id="${char.id}" class="text-xs text-sky-400 hover:text-sky-300 mt-1 p-1 bg-sky-600/80 rounded">${this.getAIGenIcon()}</button></div>
                    </div>
                </details>
                <details>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Persona</summary>
                    <div class="p-4 space-y-4 bg-black/20 rounded-b-lg">
                         <textarea id="persona-description-${char.id}" oninput="NarrativeController.updateCharacterField('${char.id}', 'description', this.value); UIManager.updateTokenCount('${char.id}', this.value)" class="w-full h-48 bg-black/30 border-gray-600 p-2 resize-y rounded">${char.description}</textarea>
                         <div class="flex justify-between items-center"><span class="text-right text-sm text-gray-400" id="token-counter-${char.id}">~${Math.round((char.description || '').length / 4)} tokens</span><button data-action="enhance-persona" data-id="${char.id}" class="text-sm bg-sky-600/80 hover:bg-sky-500/80 font-semibold py-2 px-3 rounded-lg">${this.getAIGenIcon()}</button></div>
                    </div>
                </details>
                <details>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Model Instructions</summary>
                    <div class="p-4 space-y-4 bg-black/20 rounded-b-lg">
                         <textarea oninput="NarrativeController.updateCharacterField('${char.id}', 'model_instructions', this.value)" class="w-full h-48 bg-black/30 border-gray-600 p-2 resize-y rounded">${char.model_instructions}</textarea>
                         <div class="text-right"><button data-action="gen-model-instructions" data-id="${char.id}" class="text-sm bg-sky-600/80 hover:bg-sky-700/80 font-semibold py-2 px-3 rounded-lg">${this.getAIGenIcon()}</button></div>
                    </div>
                </details>
                <details>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Emotional Portraits</summary>
                    <div class="p-4 space-y-2 bg-black/20 rounded-b-lg">
                        <div id="extra-portraits-${char.id}">${extraPortraitsHTML}</div>
                        <button data-action="add-extra-portrait" data-id="${char.id}" class="text-sm text-sky-400 hover:text-sky-300 mt-2">+ Add Emotional Portrait</button>
                    </div>
                </details>
            </div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-between">
                <button data-action="delete-character" data-id="${char.id}" class="text-xs bg-red-900/50 hover:bg-red-700/80 text-red-200 font-semibold py-2 px-3 rounded">Delete</button>
                <button data-action="close-modal" data-id="character-detail-modal" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Done</button>
            </div>
        `;
                container.innerHTML = modalHTML.toString();

                container.querySelectorAll('textarea').forEach(textarea => {
                    const autoResize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
                    textarea.addEventListener('input', autoResize);
                    setTimeout(autoResize, 0);
                });
            },

            updateTokenCount(charId, text) {
                const counter = document.getElementById(`token-counter-${charId}`);
                if (counter) counter.textContent = `~${Math.round((text || '').length / 4)} tokens`;
            },

            /**
             * Updates the AI character selector visibility and options.
             * Hides the selector if there is only one AI character.
             */
            updateAICharacterSelector() {
                const state = StateManager.getState();
                const selector = document.getElementById('ai-character-selector');
                if (!state || !state.characters) {
                    selector.innerHTML = '';
                    return;
                }

                // activeAiChars contains ONLY non-user characters
                const activeAiChars = state.characters.filter(c => !c.is_user && c.is_active);

                // FIX: Item 7 - Logic check:
                // If 1 AI char + 1 User = 2 total. activeAiChars.length is 1. 1 <= 1 is true. Hidden. Correct.
                // If 2 AI chars + 1 User = 3 total. activeAiChars.length is 2. 2 <= 1 is false. Shown. Correct.
                if (activeAiChars.length <= 1) {
                    selector.style.display = 'none';
                } else {
                    selector.style.display = 'block';
                }

                // ... (rest of function remains same)
                const currentValue = selector.value;
                let optionsHTML = DOM.html`<option value="any">Any</option>`.toString();
                optionsHTML += activeAiChars.map(c => DOM.html`<option value="${c.id}">${c.name}</option>`).join('');
                selector.innerHTML = optionsHTML;

                if (currentValue && selector.querySelector(`option[value="${currentValue}"]`)) {
                    selector.value = currentValue;
                }
            },

            /**
             * Renders the Import/Export Hub modal.
             * Provides options for importing files/folders and exporting stories/libraries.
             */
            renderIOHubModal() {
                const modalContent = document.getElementById('io-hub-modal-content');

                const library = StateManager.getLibrary();
                const storyOptions = library.stories
                    .map(s => DOM.html`<option value="${s.id}">${s.name}</option>`)
                    .join('');

                const hubHTML = DOM.html`
            <div class="p-6 border-b border-gray-700 flex justify-between items-center">
                <h2 class="text-2xl font-semibold">Import / Export Hub</h2>
                <button data-action="close-modal" data-id="io-hub-modal" class="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Close">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <div class="p-6 overflow-y-auto">
                <div class="grid md:grid-cols-2 gap-8">
                    
                    <!-- === IMPORT COLUMN === -->
                    <div class="space-y-6">
                        <h3 class="text-xl font-bold border-b pb-2 border-gray-600">Import</h3>
                        
                        <div>
                            <p class="text-sm text-gray-300 mb-2">Import a single Story from a V2 PNG, BYAF, or Ellipsis JSON file.</p>
                            <label for="single-file-upload" class="cursor-pointer">
                                <div class="border-2 border-dashed border-gray-500 rounded-lg p-6 text-center bg-black/20 hover:bg-black/40">
                                    <p class="font-semibold text-indigo-300">Click to upload a file</p>
                                    <p class="text-xs text-gray-400 mt-1">.png, .byaf, .zip, .json</p>
                                </div>
                            </label>
                            <input id="single-file-upload" type="file" class="hidden" accept=".png,.byaf,.zip,.json" data-action-change="handle-file-upload">
                        </div>

                        <div>
                            <p class="text-sm text-gray-300 mb-2">Import an entire folder of V2 PNG or BYAF files at once.</p>
                            <button data-action="handle-bulk-import" class="w-full mt-2 bg-teal-600/80 hover:bg-teal-700/80 text-white font-bold py-2 px-4 rounded-lg">Select Folder to Import</button>
                        </div>

                        <div>
                            <p class="text-sm text-gray-300 mb-2">Replace your current library with an Ellipsis Library ZIP file. <span class="font-bold text-red-400">Warning: This is a destructive action.</span></p>
                            <label class="w-full mt-2 bg-red-800/80 hover:bg-red-900/80 text-white font-bold py-2 px-4 rounded-lg inline-block text-center cursor-pointer">
                                <span>Import Library (ZIP)</span>
                                <input type="file" class="hidden" accept=".zip" data-action-change="import-library">
                            </label>
                        </div>
                    </div>

                    <!-- === EXPORT COLUMN === -->
                    <div class="space-y-4">
                        <h3 class="text-xl font-bold border-b pb-2 border-gray-600">Export</h3>
                        
                        <div>
                            <label for="story-export-selector" class="block text-sm font-medium text-gray-300">1. Select Story to Export</label>
                            <select id="story-export-selector" class="w-full mt-1 bg-black/30 p-2 rounded-lg border-gray-600" onchange="UIManager.populateNarrativeSelector()">
                                <option value="">-- Select a Story --</option>
                                ${DOM.unsafe(storyOptions)}
                            </select>
                        </div>
                        <div>
                            <label for="narrative-export-selector" class="block text-sm font-medium text-gray-300">2. Select Narrative</label>
                            <select id="narrative-export-selector" class="w-full mt-1 bg-black/30 p-2 rounded-lg border-gray-600" onchange="UIManager.populateCharacterSelector()"></select>
                        </div>
                        <div id="character-export-selector-container" class="hidden">
                            <label for="character-export-selector" class="block text-sm font-medium text-gray-300">3. Select Primary Character (for V2/BYAF)</label>
                            <select id="character-export-selector" class="w-full mt-1 bg-black/30 p-2 rounded-lg border-gray-600"></select>
                        </div>
                        <div>
                            <p class="block text-sm font-medium text-gray-300 mt-2">4. Choose Export Format</p>
                            <div class="grid grid-cols-3 gap-2 mt-2">
                                <button data-action="export-story" data-format="json" class="bg-indigo-600/80 hover:bg-indigo-700/80 text-white font-bold py-2 px-3 rounded-lg">JSON</button>
                                <button data-action="export-story" data-format="png" class="bg-sky-600/80 hover:bg-sky-700/80 text-white font-bold py-2 px-3 rounded-lg">V2 PNG</button>
                                <button data-action="export-story" data-format="byaf" class="bg-emerald-600/80 hover:bg-emerald-700/80 text-white font-bold py-2 px-3 rounded-lg">BYAF</button>
                            </div>
                        </div>
                         
                         <hr class="border-gray-600 !mt-8">
                        <div>
                            <p class="text-sm text-gray-300 mb-2">Save a backup of your entire library, including all images.</p>
                            <button data-action="export-library" class="w-full mt-2 bg-gray-600/80 hover:bg-gray-700/80 text-white font-bold py-2 px-4 rounded-lg">Export Library (ZIP)</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-end">
                <button data-action="close-modal" data-id="io-hub-modal" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Close</button>
            </div>
        `;

                modalContent.innerHTML = hubHTML.toString();
                this.populateNarrativeSelector();
            },

            /**
             * Populates the narrative selector dropdown based on the selected story.
             */
            populateNarrativeSelector() {
                const storyId = document.getElementById('story-export-selector').value;
                const narrativeSelector = document.getElementById('narrative-export-selector');
                narrativeSelector.innerHTML = '';
                if (storyId) {
                    const story = StateManager.getLibrary().stories.find(s => s.id === storyId);
                    if (story && story.narratives) {
                        narrativeSelector.innerHTML = story.narratives.map(n => DOM.html`<option value="${n.id}">${n.name}</option>`).join('');
                    }
                }
                this.populateCharacterSelector();
            },

            /**
             * Populates the character selector dropdown based on the selected story/narrative.
             */
            populateCharacterSelector() {
                const storyId = document.getElementById('story-export-selector').value;
                const charContainer = document.getElementById('character-export-selector-container');
                const charSelector = document.getElementById('character-export-selector');
                charSelector.innerHTML = '';
                if (storyId) {
                    const story = StateManager.getLibrary().stories.find(s => s.id === storyId);
                    const aiChars = story.characters.filter(c => !c.is_user);
                    if (aiChars.length > 0) {
                        charSelector.innerHTML = aiChars.map(c => DOM.html`<option value="${c.id}">${c.name}</option>`).join('');
                        charContainer.classList.remove('hidden');
                    } else {
                        charContainer.classList.add('hidden');
                    }
                } else {
                    charContainer.classList.add('hidden');
                }
            },

            /**
             * Shows a confirmation modal and returns a Promise resolving to true/false.
             * @param {string} message - The confirmation message.
             * @returns {Promise<boolean>} - Resolves with the user's choice.
             */
            showConfirmationPromise(message) {
                return new Promise((resolve) => {
                    const modal = document.getElementById('confirmation-modal');
                    const messageEl = document.getElementById('confirmation-modal-message');
                    const confirmBtn = document.getElementById('confirmation-modal-confirm-button');

                    // Defensive check: If critical UI elements are missing, auto-fail gracefully
                    if (!modal || !messageEl || !confirmBtn) {
                        console.error("UIManager: Critical Error - Confirmation Modal elements missing from DOM.");
                        resolve(false);
                        return;
                    }

                    const cancelBtn = modal.querySelector('button:not(#confirmation-modal-confirm-button)');
                    if (!cancelBtn) {
                        console.error("UIManager: Critical Error - Cancel button missing.");
                        resolve(false);
                        return;
                    }

                    messageEl.textContent = message;

                    const confirmClickHandler = () => {
                        cleanup();
                        resolve(true);
                    };
                    const cancelClickHandler = () => {
                        cleanup();
                        resolve(false);
                    };

                    const cleanup = () => {
                        confirmBtn.removeEventListener('click', confirmClickHandler);
                        cancelBtn.removeEventListener('click', cancelClickHandler);
                        const overlay = modal.querySelector('.modal-overlay');
                        if (overlay) overlay.removeEventListener('click', cancelClickHandler);
                        AppController.closeModal('confirmation-modal');
                    };

                    confirmBtn.addEventListener('click', confirmClickHandler, { once: true });
                    cancelBtn.addEventListener('click', cancelClickHandler, { once: true });

                    const overlay = modal.querySelector('.modal-overlay');
                    if (overlay) overlay.addEventListener('click', cancelClickHandler, { once: true });

                    AppController.openModal('confirmation-modal');
                });
            },

            /**
             * Displays a full-screen loading spinner with a message.
             * @param {string} [message='Loading...'] - The message to display.
             */
            showLoadingSpinner(message = 'Loading...') {
                let spinner = document.getElementById('loading-spinner');
                if (!spinner) {
                    spinner = document.createElement('div');
                    spinner.id = 'loading-spinner';
                    spinner.className = 'fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center';
                    spinner.innerHTML = DOM.html`
                <div class="w-16 h-16 border-4 border-t-indigo-500 border-gray-600 rounded-full animate-spin"></div>
                <p id="spinner-message" class="mt-4 text-white font-semibold"></p>
            `.toString();
                    document.body.appendChild(spinner);
                }
                document.getElementById('spinner-message').textContent = message;
                spinner.style.display = 'flex';
            },

            /**
             * Hides the loading spinner.
             */
            hideLoadingSpinner() {
                const spinner = document.getElementById('loading-spinner');
                if (spinner) {
                    spinner.style.display = 'none';
                }
            },

            /**
             * Displays a report modal after a bulk import operation.
             * @param {Array<string>} importedStoryNames - List of successfully imported stories.
             * @param {Array<Object>} failedFiles - List of files that failed to import.
             */
            showBulkImportReport(importedStoryNames, failedFiles) {
                const container = document.getElementById('report-modal-content');

                const successList = importedStoryNames.map(name => DOM.html`<li>${name}</li>`);
                const failureSection = failedFiles.length > 0 ? (() => {
                    const logContent = failedFiles.map(f => `File: ${f.name}\nReason: ${f.reason}\n---`).join('\n');
                    const logBlob = new Blob([logContent], { type: 'text/plain' });
                    const logUrl = URL.createObjectURL(logBlob);
                    return DOM.html`
                <div>
                    <h3 class="font-bold text-lg text-red-400">Failures (${failedFiles.length})</h3>
                    <p class="text-sm mt-2">Some files could not be imported. <a href="${logUrl}" download="import_error_log.txt" class="text-indigo-400 hover:underline">Download Error Log</a> for details.</p>
                </div>
            `;
                })() : '';

                const reportHTML = DOM.html`
            <div class="p-6 border-b border-gray-700"><h2 class="text-2xl font-semibold">Bulk Import Report</h2></div>
            <div class="p-6 overflow-y-auto space-y-4">
                <div>
                    <h3 class="font-bold text-lg text-green-400">Success (${importedStoryNames.length})</h3>
                    <ul class="list-disc list-inside text-sm mt-2 max-h-40 overflow-y-auto bg-black/20 p-2 rounded-md">
                        ${successList.length ? successList : DOM.unsafe('<li>No stories were imported successfully.</li>')}
                    </ul>
                </div>
                ${failureSection}
            </div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-end">
                <button data-action="close-modal" data-id="report-modal" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Done</button>
            </div>
        `;

                container.innerHTML = reportHTML.toString();
                AppController.openModal('report-modal');
            },

            /**
             * Shows a confirmation modal with a callback for the confirm action.
             * @param {string} message - The confirmation message.
             * @param {Function} onConfirmCallback - The function to call on confirmation.
             */
            showConfirmationModal(message, onConfirmCallback) {
                const modal = document.getElementById('confirmation-modal');
                const messageEl = document.getElementById('confirmation-modal-message');
                const confirmBtn = document.getElementById('confirmation-modal-confirm-button');

                if (modal && messageEl && confirmBtn) {
                    messageEl.textContent = message;

                    const newConfirmBtn = confirmBtn.cloneNode(true);
                    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

                    newConfirmBtn.onclick = () => {
                        onConfirmCallback();
                        AppController.closeModal('confirmation-modal');
                    };
                    AppController.openModal('confirmation-modal');
                } else {
                    console.error("Confirmation modal elements not found.");
                }
            },

            /**
             * Updates the primary action button to "Stop Generation" mode.
             */
            setButtonToStopMode() {
                const button = document.getElementById('primary-action-btn');
                if (!button) return;
                button.onclick = () => NarrativeController.stopGeneration();
                button.title = "Stop Generation";
                button.classList.remove('bg-indigo-600/50', 'hover:bg-indigo-600/80');
                button.classList.add('bg-red-700/60', 'hover:bg-red-700/80');
                // FIX: Updated Stop Icon (Rounded Square)
                button.innerHTML = DOM.unsafe(`<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>`);

                setTimeout(() => {
                    button.onclick = () => NarrativeController.stopGeneration();
                }, 0);
            },

            /**
             * Updates the primary action button to "Send / Write for Me" mode.
             */
            setButtonToSendMode() {
                const button = document.getElementById('primary-action-btn');
                if (!button) return;
                button.onclick = () => NarrativeController.handlePrimaryAction();
                button.title = "Send / Write for Me";
                button.classList.remove('bg-red-700/60', 'hover:bg-red-700/80');
                button.classList.add('bg-indigo-600/50', 'hover:bg-indigo-600/80');
                // FIX: Updated Send Icon (Paper Plane)
                button.innerHTML = DOM.unsafe(`<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`);
            },
        };