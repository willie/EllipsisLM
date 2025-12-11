const UIManager = {
    // Holds temporary, non-persistent properties related to the app's runtime behavior.
    RUNTIME: {
        streamingInterval: null,
        titleTimeout: null,
        lastCinematicImageUrl: null,
        activeCinematicBg: 1,
		globalBackgroundImageCache: null,
    },
    
    /**
     * Returns the SVG icon string for AI generation buttons.
     * @returns {string} SVG HTML string.
     */
    getAIGenIcon() {
        return `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 3.5a1.5 1.5 0 011.5 1.5V6a1.5 1.5 0 01-3 0V5A1.5 1.5 0 0110 3.5zM5.429 7.429a1.5 1.5 0 012.121 0l1.061 1.061a1.5 1.5 0 01-2.121 2.121L5.429 9.55a1.5 1.5 0 010-2.121zM14.571 7.429a1.5 1.5 0 010 2.121l-1.061 1.061a1.5 1.5 0 01-2.121-2.121l1.061-1.061a1.5 1.5 0 012.121 0zM10 16.5a1.5 1.5 0 01-1.5-1.5V14a1.5 1.5 0 013 0v1a1.5 1.5 0 01-1.5 1.5z"></path></svg>`;
    },

    /**
     * Renders all primary UI components. Called on initial load and after major state changes.
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
     * Renders the main story library interface, including search, sort, and filter controls.
     * @param {object} [filterState={}] - The current state of the filters (searchTerm, sortBy, filterTag).
     */
    renderLibraryInterface(filterState = {}) {
        const library = StateManager.getLibrary();
        const container = document.getElementById('library-content-container');
        const { searchTerm = '', sortBy = 'last_modified', filterTag = '' } = filterState;

        const isTallScreen = window.innerHeight > window.innerWidth;

        // --- Filter, Search, Sort Logic ---
        let stories = [...library.stories];
        if (searchTerm) {
            const lowerCaseSearch = searchTerm.toLowerCase();
            stories = stories.filter(s => s.search_index && s.search_index.includes(lowerCaseSearch));
        }
	if (filterTag) {
            const lowerFilter = filterTag.toLowerCase();
            stories = stories.filter(s => {
                // Create a set of all tags in this story, converted to lowercase
                const storyTags = new Set();
                
                // Add story tags
                (s.tags || []).forEach(t => storyTags.add(t.toLowerCase()));
                
                // Add character tags
                (s.characters || []).forEach(c => (c.tags || []).forEach(t => storyTags.add(t.toLowerCase())));
                
                return storyTags.has(lowerFilter);
            });
        }
        stories.sort((a, b) => {
            if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
            if (sortBy === 'created_date') return new Date(b.created_date) - new Date(a.created_date);
            return new Date(b.last_modified) - new Date(a.last_modified);
        });

        // --- Controls HTML ---
        const tagOptions = library.tag_cache.map(tag => `<option value="${tag}" ${filterTag === tag ? 'selected':''}>${tag}</option>`).join('');
        const controlsHTML = `
            <div class="p-6 border-b border-gray-700 space-y-4">
                <input type="search" placeholder="Search stories..." value="${searchTerm}" oninput="UIManager.renderLibraryInterface({searchTerm: this.value, sortBy: document.getElementById('sort-by').value, filterTag: document.getElementById('filter-by-tag').value})" class="w-full bg-black/30 p-2 rounded-lg border-gray-600">
                <div class="flex space-x-4">
                    <select id="sort-by" onchange="UIManager.renderLibraryInterface({searchTerm: document.querySelector('#library-content-container input[type=search]').value, sortBy: this.value, filterTag: document.getElementById('filter-by-tag').value})" class="w-1/2 bg-black/30 p-2 rounded-lg border-gray-600">
                        <option value="last_modified" ${sortBy === 'last_modified' ? 'selected' : ''}>Modified</option>
                        <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Name</option>
                        <option value="created_date" ${sortBy === 'created_date' ? 'selected' : ''}>Created</option>
                    </select>
                    <select id="filter-by-tag" onchange="UIManager.renderLibraryInterface({searchTerm: document.querySelector('#library-content-container input[type=search]').value, sortBy: document.getElementById('sort-by').value, filterTag: this.value})" class="w-1/2 bg-black/30 p-2 rounded-lg border-gray-600">
                        <option value="">All Tags</option>
                        ${tagOptions}
                    </select>
                </div>
            </div>`;

        // --- Story List HTML ---
        const storyListHTML = stories.map(story => {
            const displayName = story.name || 'Untitled Story';
            const isActiveStory = story.id === library.active_story_id;
            return `
            <div class="p-4 rounded-lg flex justify-between items-center cursor-pointer ${isActiveStory ? 'bg-indigo-600/30' : 'bg-gray-700/50 hover:bg-gray-600/50'}" onclick="UIManager.openStoryDetails('${story.id}')">
                <div>
                    <h3 class="font-semibold text-lg">${UTILITY.escapeHTML(displayName)}</h3>
                    <p class="text-sm text-gray-400">Modified: ${new Date(story.last_modified).toLocaleString()}</p>
                </div>
                ${isActiveStory ? '<span class="text-xs text-indigo-300 font-bold">ACTIVE</span>' : ''}
            </div>
        `}).join('<hr class="border-gray-700 my-2">');

        // --- Assemble Final Layout ---
        if (isTallScreen) {
             container.innerHTML = `<div class="flex flex-col flex-grow min-h-0">${controlsHTML}<div class="p-6 overflow-y-auto">${storyListHTML}</div></div>`;
        } else {
            container.innerHTML = `
                <div class="w-[450px] flex-shrink-0 border-r border-gray-700 flex flex-col">${controlsHTML}<div class="p-6 overflow-y-auto flex-grow">${storyListHTML}</div></div>
                <div id="story-details-content-desktop" class="flex-grow p-6 flex text-gray-500"><div class="w-full h-full flex items-center justify-center">Select a story to see details...</div></div>
            `;
        }
    },

/**
     * Renders the detailed view for a selected story.
     * [UPDATED] Header-based actions, scrollable carousel, expandable scenarios.
     */
    openStoryDetails(storyId) {
        const library = StateManager.getLibrary();
        const story = library.stories.find(s => s.id === storyId);
        if (!story) return;
		const isMobile = (window.innerHeight > window.innerWidth);
		const closeModalAction = isMobile 
			? "Controller.closeModal('story-details-modal')" 
			: "Controller.closeModal('story-library-modal')";

        // 1. Generate Scenarios HTML (Expandable, Markdown, No Message BG)
        const scenariosHTML = (story.scenarios || []).map(scenario => `
            <details open class="bg-gray-700/30 rounded-lg overflow-hidden group">
                <summary class="p-3 cursor-pointer hover:bg-gray-700/50 flex justify-between items-center font-semibold select-none">
                    <span>${UTILITY.escapeHTML(scenario.name)}</span>
                    <span class="text-xs text-gray-400 group-open:hidden">▼</span>
                    <span class="text-xs text-gray-400 hidden group-open:block">▲</span>
                </summary>
                <div class="p-3 bg-black/20 border-t border-gray-600 space-y-3">
                    <div>
                        <p class="text-xs text-gray-400 font-bold mb-1">First Message:</p>
                        <div class="text-sm text-gray-300 prose prose-invert prose-sm max-w-none">
                            ${marked.parse(scenario.message || '*(No message)*')}
                        </div>
                    </div>
                    <div class="flex gap-2 justify-end pt-2">
                        <button onclick="Controller.createNarrativeFromScenario('${story.id}', '${scenario.id}')" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-1 px-3 rounded" title="Load Scenario">Load</button>
                        <button onclick="Controller.duplicateScenario('${story.id}', '${scenario.id}')" class="bg-gray-600 hover:bg-gray-500 text-white text-xs font-bold py-1 px-3 rounded" title="Duplicate">Duplicate</button>
                        <button onclick="Controller.deleteScenario('${story.id}', '${scenario.id}')" class="bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-1 px-3 rounded" title="Delete">Delete</button>
                    </div>
                </div>
            </details>
        `).join('');

        // 2. Generate Narratives HTML (Buttons re-ordered, new Load icon)
        const narrativesHTML = (story.narratives || []).sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified)).map(narrative => `
            <div class="bg-gray-700/60 p-3 rounded-lg flex justify-between items-center gap-2">
                <div class="flex-grow min-w-0">
                    <p class="font-semibold truncate">${UTILITY.escapeHTML(narrative.name)}</p>
                    <p class="text-xs text-gray-400">Modified: ${new Date(narrative.last_modified).toLocaleString()}</p>
                </div>
                ${narrative.id === library.active_narrative_id && story.id === library.active_story_id ? '<span class="text-xs text-sky-300 font-bold flex-shrink-0">ACTIVE</span>' : ''}
                
                <div class="flex-shrink-0 flex items-center gap-2">
                    <button onclick="Controller.deleteNarrative('${story.id}', '${narrative.id}')" class="text-red-400 hover:text-red-300 p-1" title="Delete"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    <button onclick="Controller.elevateNarrativeToScenario('${story.id}', '${narrative.id}')" class="text-teal-400 hover:text-teal-300 p-1" title="Elevate to Scenario"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z"></path></svg></button>
                    <button onclick="Controller.duplicateNarrative('${story.id}', '${narrative.id}')" class="text-gray-400 hover:text-gray-300 p-1" title="Duplicate"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="Controller.loadNarrative('${story.id}', '${narrative.id}')" class="text-green-400 hover:text-green-300 p-1" title="Load Narrative"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 0 0 4 4.11V15.89a1.5 1.5 0 0 0 2.3 1.269l9.344-5.89a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z"/></svg></button>
                </div>
            </div>
        `).join('');

        // 3. Construct Full HTML
        const detailsHTML = `
            <div class="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent" style="padding-top: calc(1rem + env(safe-area-inset-top));">
				<input type="text" 
                   value="${UTILITY.escapeHTML(story.name)}" 
                   oninput="Controller.updateStoryField('${story.id}', 'name', this.value)" 
                   class="text-xl font-bold bg-transparent border border-transparent hover:border-gray-600 focus:border-indigo-500 rounded px-2 py-1 text-white w-2/3 transition-colors focus:outline-none focus:bg-black/30 story-details-title-input"
                   placeholder="Story Title">
            
            <div class="story-details-title-balancer"></div>

                <div class="flex items-center space-x-2">
                    <button onclick="Controller.duplicateStory('${story.id}')" class="bg-gray-700/50 hover:bg-gray-600/80 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Duplicate Story">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                    <button onclick="Controller.deleteStory('${story.id}')" class="bg-red-900/50 hover:bg-red-700/80 text-red-200 hover:text-white p-2 rounded-lg transition-colors" title="Delete Story">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                    <div class="w-px h-6 bg-gray-600/50 mx-2"></div>
                    <button onclick="${closeModalAction}" class="bg-gray-700/50 hover:bg-gray-600/80 text-gray-300 hover:text-white p-2 rounded-lg transition-colors" title="Close">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            </div>

            <div class="flex-grow overflow-y-auto min-h-0 details-scroll-container">
                
                <div class="relative w-full aspect-square bg-black/50 group">
                     <div id="details-carousel" class="w-full h-full object-cover"></div>
                     </div>

                <div class="p-6 space-y-8">
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label class="text-sm text-gray-400 font-bold mb-1 block">Creator's Note</label>
                            <div class="relative">
                                <textarea oninput="Controller.updateStoryField('${story.id}', 'creator_notes', this.value)" class="w-full bg-black/30 border-gray-600 p-3 rounded-lg resize-none h-24 text-sm focus:ring-1 focus:ring-indigo-500 transition-all">${UTILITY.escapeHTML(story.creator_notes || '')}</textarea>
                                <button onclick="Controller.generateStoryNotesAI(event, '${story.id}')" class="absolute top-2 right-2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
                            </div>
                        </div>
						<div>
							<label class="text-sm text-gray-400 font-bold mb-1 block">Tags</label>
							<div class="relative">
								<input type="text" value="${UTILITY.escapeHTML((story.tags || []).join(', '))}" oninput="Controller.updateStoryTags('${story.id}', this.value)" class="w-full bg-black/30 border-gray-600 p-3 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 transition-all">
								<button onclick="Controller.generateStoryTagsAI(event, '${story.id}')" class="absolute top-1/2 right-2 -translate-y-1/2 text-gray-500 hover:text-indigo-400 transition-colors" title="Generate with AI">${this.getAIGenIcon()}</button>
							</div>
						</div>
                    </div>

                    <hr class="border-gray-700">

                    <div>
                        <h4 class="font-bold text-lg mb-4 text-indigo-300 flex items-center">
                            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                            Scenarios (Templates)
                        </h4>
                        <div class="space-y-3">${scenariosHTML || '<p class="text-sm text-gray-500 italic">No scenarios available.</p>'}</div>
                    </div>

                    <hr class="border-gray-700">

                    <div>
                        <h4 class="font-bold text-lg mb-4 text-sky-300 flex items-center">
                            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                            Narratives (Chats)
                        </h4>
                        <div class="space-y-2">${narrativesHTML || '<p class="text-sm text-gray-500 italic">No narratives started. Load a scenario to begin.</p>'}</div>
                    </div>
                </div>
            </div>
        `;

        // Render based on device
        if (window.innerHeight > window.innerWidth) {
            // MODIFIED: Target the modal's main content box to overwrite the footer
            document.querySelector('#story-details-modal > div:not(.modal-overlay)').innerHTML = detailsHTML;
            Controller.openModal('story-details-modal');
        } else {
            // MODIFIED: Wrap desktop content to fix padding issue
            const detailsWrapperHTML = `
                <div class="w-full h-full flex flex-col md:-m-6 bg-gray-900 relative">
                    ${detailsHTML}
                </div>
            `;
            document.getElementById('story-details-content-desktop').innerHTML = detailsWrapperHTML;
        }
        
        // Start carousel
        this.startCarousel(story.characters, 'details-carousel');
    },

    /**
     * Starts an image carousel for the story details view.
     * @param {Array} characters - The characters from the story.
     * @param {string} containerId - The ID of the element to host the carousel.
     */
    startCarousel(characters, containerId) {
        if (ModalManager.RUNTIME.carousel_interval) clearInterval(ModalManager.RUNTIME.carousel_interval);
        
        const container = document.getElementById(containerId);
        if (!container) return;

		const images = (characters || [])
		  .map(c => UIManager.getPortraitSrc(c))
		  .filter(Boolean);

        if (images.length === 0) {
            container.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-gray-900 text-gray-500">No character images</div>`;
            return;
        }

        container.innerHTML = `
            <img id="${containerId}-img1" class="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000" style="opacity: 1;">
            <img id="${containerId}-img2" class="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000" style="opacity: 0;">
        `;
        
        let currentIndex = 0;
        let activeImg = 1;

        const img1 = document.getElementById(`${containerId}-img1`);
        const img2 = document.getElementById(`${containerId}-img2`);
        img1.src = images[currentIndex];
        
        ModalManager.RUNTIME.carousel_interval = setInterval(() => {
            currentIndex = (currentIndex + 1) % images.length;
            if (activeImg === 1) {
                img2.src = images[currentIndex];
                img1.style.opacity = 0;
                img2.style.opacity = 1;
                activeImg = 2;
            } else {
                img1.src = images[currentIndex];
                img1.style.opacity = 1;
                img2.style.opacity = 0;
                activeImg = 1;
            }
        }, 4000);
    },
    
	renderCharacters() { 
        const state = StateManager.getState();
        const container = document.getElementById('characters-container');
        if (!state.characters) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = state.characters.map(char => {
            const tagsHTML = (char.tags || []).map(tag => `<span class="bg-indigo-500/50 text-indigo-200 text-xs font-semibold mr-2 px-2.5 py-0.5 rounded">${UTILITY.escapeHTML(tag)}</span>`).join('');
            
            // --- NEW VISUAL LOGIC ---
            // If inactive: 50% opacity and grayscale
            const visualStyle = char.is_active 
                ? "" 
                : "opacity: 0.5; filter: grayscale(80%);";
            const activeBadge = char.is_active
                ? ""
                : '<div class="absolute top-2 right-2 bg-black/60 text-gray-300 text-xs px-2 py-1 rounded">Inactive</div>';
            // ------------------------

            return `
                <div onclick="Controller.openModal('character-detail-modal', '${char.id}')" 
                     class="char-roster-btn" 
                     style="background-image: url('${UIManager.RUNTIME.characterImageCache[char.id] || char.image_url || 'https://placehold.co/600x800/111827/4b5563?text=?'}'); ${visualStyle}">
                    ${activeBadge}
                    <div class="char-roster-content text-white">
                        <h3 class="font-bold text-lg truncate">${UTILITY.escapeHTML(char.name)}</h3>
                        <p class="text-sm text-gray-300 italic truncate">${UTILITY.escapeHTML(char.short_description)}</p>
                        <div class="mt-2 h-6 overflow-hidden">${tagsHTML}</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    renderKnowledgeModalTabs() {
        const tabName = Controller.RUNTIME.activeKnowledgeTab;
        const staticTab = document.getElementById('knowledge-tab-static');
        const dynamicTab = document.getElementById('knowledge-tab-dynamic');
        const staticContent = document.getElementById('knowledge-static-content');
        const dynamicContent = document.getElementById('knowledge-dynamic-content');
        const addButton = document.getElementById('knowledge-add-button');

        if (tabName === 'static') {
            staticContent.classList.remove('hidden');
            dynamicContent.classList.add('hidden');
            staticTab.classList.add('border-indigo-500', 'text-white');
            staticTab.classList.remove('border-transparent', 'text-gray-400');
            dynamicTab.classList.add('border-transparent', 'text-gray-400');
            dynamicTab.classList.remove('border-indigo-500', 'text-white');
            addButton.onclick = () => Controller.addStaticEntry();
            this.renderStaticEntries();
        } else { // dynamic
            dynamicContent.classList.remove('hidden');
            staticContent.classList.add('hidden');
            dynamicTab.classList.add('border-indigo-500', 'text-white');
            dynamicTab.classList.remove('border-transparent', 'text-gray-400');
            staticTab.classList.add('border-transparent', 'text-gray-400');
            staticTab.classList.remove('border-indigo-500', 'text-white');
            addButton.onclick = () => Controller.addDynamicEntry();
            this.renderDynamicEntries();
        }
    },
    
    renderStaticEntries() { 
        const state = StateManager.getState(); 
        document.getElementById('static-entries-list').innerHTML = (state.static_entries || []).map(entry => `<div onclick="Controller.selectStaticEntry('${entry.id}')" class="p-3 rounded-lg cursor-pointer ${state.selectedStaticEntryId === entry.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'}"><h4 class="font-semibold truncate">${UTILITY.escapeHTML(entry.title)}</h4></div>`).join(''); 
        this.renderStaticEntryDetails(); 
    },
    
    renderStaticEntryDetails() { 
        const state = StateManager.getState(); 
        const container = document.getElementById('static-entry-details-content'); 
        const entry = (state.static_entries || []).find(e => e.id === state.selectedStaticEntryId); 
        if (entry) { 
            container.innerHTML = `
            <div class="flex flex-col h-full">
				<input type="text" value="${UTILITY.escapeHTML(entry.title)}" oninput="Controller.updateStaticEntryField('${entry.id}', 'title', this.value)" onblur="UIManager.renderStaticEntries()" class="text-xl font-bold bg-black/30 p-2 w-full mb-4 flex-shrink-0">
                <div class="relative flex-grow">
                    <textarea oninput="Controller.updateStaticEntryField('${entry.id}', 'content', this.value)" class="w-full h-full bg-black/30 p-2 resize-none rounded-md">${UTILITY.escapeHTML(entry.content)}</textarea>
                    <button onclick="Controller.generateStaticEntryContentAI(event, '${entry.id}')" class="absolute top-2 right-2 text-sky-400 hover:text-sky-300 p-1 bg-sky-600/80 rounded" title="Generate with AI">${this.getAIGenIcon()}</button>
                </div>
                <div class="flex justify-end mt-4 flex-shrink-0">
                    <button onclick="Controller.deleteStaticEntry('${entry.id}')" class="text-sm bg-red-600/80 hover:bg-red-700/80 font-semibold py-2 px-3 rounded-lg">Delete</button>
                </div>
            </div>`; 
        } else { 
            container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a static entry.</div>`; 
        } 
    },
    
    renderDynamicEntries() { 
        const state = StateManager.getState(); 
        document.getElementById('dynamic-entries-list').innerHTML = (state.dynamic_entries || []).map(entry => `<div onclick="Controller.selectDynamicEntry('${entry.id}')" class="p-3 rounded-lg cursor-pointer ${state.selectedDynamicEntryId === entry.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'} flex justify-between items-center"><h4 class="font-semibold truncate">${UTILITY.escapeHTML(entry.title)}</h4> ${entry.triggered_at_turn !== null ? '<span class="text-xs text-sky-300">ACTIVE</span>' : ''}</div>`).join(''); 
        this.renderDynamicEntryDetails(); 
    },
    
renderDynamicEntryDetails() { 
        const state = StateManager.getState();
        const container = document.getElementById('dynamic-entry-details-content'); 
        const entry = (state.dynamic_entries || []).find(e => e.id === state.selectedDynamicEntryId); 
        
        if (entry) {
            // 1. Map over the content_fields array to generate a textarea for each
            const contentFieldsHTML = (entry.content_fields || [""]).map((content, index) => {
                // The last field gets a "sticky" note
                const isLastField = index === entry.content_fields.length - 1;
                const stickyNote = isLastField 
                    ? `<span class="text-xs text-gray-400 italic ml-4">This entry will be used for all future triggers.</span>`
                    : '';

                return `
                    <div class="bg-black/20 p-3 rounded-lg">
                        <label class="font-bold mb-2 flex justify-between items-center">
                            <span>Step ${index + 1}</span>
                            ${stickyNote}
                        </label>
                        <div class="relative">
                            <textarea 
                                oninput="Controller.updateDynamicContentField('${entry.id}', ${index}, this.value)" 
                                class="w-full h-24 bg-gray-900/80 border-gray-600 p-2 resize-y rounded-md"
                            >${UTILITY.escapeHTML(content)}</textarea>
                            <button 
                                onclick="Controller.generateDynamicEntryContentAI(event, '${entry.id}', ${index})" 
                                class="absolute top-2 right-2 text-sky-400 hover:text-sky-300 p-1 bg-sky-600/80 rounded" 
                                title="Generate with AI"
                            >${this.getAIGenIcon()}</button>
                        </div>
                    </div>
                `;
            }).join('<hr class="border-gray-700/50 my-2">'); // Separator

            // 2. Build the final HTML
            container.innerHTML = `<div class="flex flex-col h-full">
                <label class="font-bold">Title</label>
				<input type="text" value="${UTILITY.escapeHTML(entry.title)}" oninput="Controller.updateDynamicEntryField('${entry.id}', 'title', this.value)" onblur="UIManager.renderDynamicEntries()" class="text-xl font-bold bg-black/30 p-2 w-full mb-4">
                
                <label class="font-bold mb-2">Triggers (Keywords, AND, XOR, % Chance)</label>
                <input type="text" value="${UTILITY.escapeHTML(entry.triggers)}" oninput="Controller.updateDynamicEntryField('${entry.id}', 'triggers', this.value)" placeholder="e.g. house, cat AND dog, 25%" class="bg-black/30 p-2 w-full mb-4">
                
                <div class="relative flex-grow flex flex-col">
                    <label class="font-bold mb-2">Content Sequence</label>
                    <div class="space-y-2">
                        ${contentFieldsHTML}
                    </div>
                    <button 
                        onclick="Controller.addDynamicContentField('${entry.id}')" 
                        class="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-sm w-full"
                    >
                        + Add Content Field
                    </button>
                </div>

                <div class="flex justify-end mt-4">
                    <button onclick="Controller.deleteDynamicEntry('${entry.id}')" class="text-sm bg-red-600/80 hover:bg-red-700/80 font-semibold py-2 px-3 rounded-lg">Delete Entry</button>
                </div>
            </div>`; 
        } else { 
            container.innerHTML = `<div class="text-gray-400 flex items-center justify-center h-full">Select a dynamic entry.</div>`; 
        } 
    },
    
    _createMessageHTML(msg, index) {
        const state = StateManager.getState();
        if (msg.type === 'lore_reveal' || msg.isHidden) return '';
        
        if (msg.type === 'system_event') {
            return `<div class="w-full text-center my-2"><p class="text-sm italic text-gray-400">${UTILITY.escapeHTML(msg.content)}</p></div>`;
        }

        const character = state.characters.find(c => c.id === msg.character_id);
        if (!character) return '';

        const userChar = state.characters.find(c => c.is_user);
        const characterName = character ? character.name : '';
        const userName = userChar ? userChar.name : 'You';
        const replacer = (text) => {
            if (typeof text !== 'string') return '';
            return text.replace(/{character}/g, characterName).replace(/{user}/g, userName);
        };

        const processedContent = replacer(msg.content);
        const contentId = `message-content-${index}`;
		const styledContent = processedContent.replace(/(["“][^"”]*["”])/g, `<span class="dialogue-quote">$1</span>`);
		let contentHTML = marked.parse(styledContent || '');
        
        let bubbleStyle = '';
        let characterNameColor = '';

		const imgSrc = UIManager.getPortraitSrc(character, msg.emotion);
		if (state.characterImageMode === 'bubble' && imgSrc) {
		  contentHTML = `<img src="${imgSrc}" class="bubble-char-image">` + contentHTML;
		}



        if (character.is_user) {
            bubbleStyle = `background-color: rgba(75, 85, 99, ${state.bubbleOpacity});`;
        } else {
            const charColor = character.color || { base: '#334155', bold: '#94a3b8' };
            const topColor = UTILITY.hexToRgba(charColor.base, state.bubbleOpacity);
            const bottomColor = UTILITY.hexToRgba(UTILITY.darkenHex(charColor.base, 10), state.bubbleOpacity);
            bubbleStyle = `background-image: linear-gradient(to bottom, ${topColor}, ${bottomColor});`;
            characterNameColor = `style="color: ${charColor.bold};"`;
        }
        
        const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        return `
            <div class="chat-bubble-container ${msg.isNew ? 'new-message' : ''}" data-message-index="${index}">
                <div class="bubble-header">
                     <p class="font-bold text-sm" ${characterNameColor}>${UTILITY.escapeHTML(character.name)}</p>
                     <span class="timestamp text-xs text-gray-500">${timestamp}</span>
                     <div class="action-btn-group flex ml-2 space-x-4">
                        <button onclick="Controller.copyMessage(${index})" class="text-gray-400 hover:text-white" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                        <button onclick="Controller.openModal('edit-response-modal', ${index})" class="text-gray-400 hover:text-white" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                        <button onclick="Controller.deleteMessage(${index})" class="text-gray-400 hover:text-white" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    </div>
                </div>
                <div class="bubble-body rounded-lg px-3 py-2" style="${bubbleStyle}">
                    <div id="${contentId}" class="whitespace-pre-wrap" style="color: ${state.chatTextColor}; font-family: ${state.font};">
                        ${contentHTML}
                    </div>
                </div>
            </div>`;
    },

    renderChat() {
        const state = StateManager.getState();
        if (!state || !state.chat_history) {
             document.getElementById('chat-window').innerHTML = `<div class="h-full w-full flex items-center justify-center text-gray-500 text-lg">No Narrative Loaded</div>`;
             return;
        }
        if (this.RUNTIME.streamingInterval) return; 
        
        document.body.dataset.mode = state.characterImageMode;
        this.updateSidePortrait();

		if (state.characterImageMode === 'cinematic_overlay') {
		  let latestAiImageUrl = null;

		  for (let i = state.chat_history.length - 1; i >= 0; i--) {
			const msg = state.chat_history[i];
			if (msg.type !== 'chat' || msg.isHidden) continue;
			const speaker = state.characters.find(c => c.id === msg.character_id);
			if (speaker && !speaker.is_user) {
			  const candidate = UIManager.getPortraitSrc(speaker, msg.emotion);
			  if (candidate) { latestAiImageUrl = candidate; break; }
			}
		  }

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
			// Keep last one visible, as before
			const activeBg = document.getElementById(`cinematic-bg-${this.RUNTIME.activeCinematicBg}`);
			if (activeBg) activeBg.style.backgroundImage = `url('${this.RUNTIME.lastCinematicImageUrl}')`;
		  }
		} else {
		  // existing clear logic unchanged
		  const bg1 = document.getElementById('cinematic-bg-1');
		  const bg2 = document.getElementById('cinematic-bg-2');
		  if (bg1) { bg1.style.backgroundImage = 'none'; bg1.style.opacity = '0'; }
		  if (bg2) { bg2.style.backgroundImage = 'none'; bg2.style.opacity = '0'; }
		  this.RUNTIME.lastCinematicImageUrl = null;
		  this.RUNTIME.activeCinematicBg = 1;
		}

        document.getElementById('chat-window').innerHTML = (state.chat_history || []).map((msg, index) => this._createMessageHTML(msg, index)).join('');
        (state.chat_history || []).forEach(m => m.isNew = false);
		
		const chatWindow = document.getElementById('chat-window');
        chatWindow.innerHTML = (state.chat_history || []).map((msg, index) => this._createMessageHTML(msg, index)).join('');
        (state.chat_history || []).forEach(m => m.isNew = false);

        // --- ROBUST AUTO-SCROLL FIX ---
        // 1. Use setTimeout to yield to the render thread
        setTimeout(() => {
            // 2. Use requestAnimationFrame to ensure layout is calculated
            window.requestAnimationFrame(() => {
                if (chatWindow) {
                    chatWindow.scrollTop = chatWindow.scrollHeight;
                }
            });
        }, 50); // 50ms delay allows images/styles to settle
		
    },
    
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
            const speakerOptions = [userChar, ...aiChars].map(char => `<option value="${char.id}" ${msg.character_id === char.id ? 'selected' : ''}>${UTILITY.escapeHTML(char.name)}</option>`).join('');
            return `
                <div class="bg-black/20 p-4 rounded-lg flex items-center space-x-4">
                    <div class="flex flex-col space-y-2">
                        <button onclick="Controller.moveExampleDialogueTurn(${msg.originalIndex}, 'up')" ${idx === 0 ? 'disabled' : ''} class="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:opacity-50 text-white font-bold p-2 rounded-lg" title="Move Up"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg></button>
                        <button onclick="Controller.moveExampleDialogueTurn(${msg.originalIndex}, 'down')" ${idx === exampleMessages.length - 1 ? 'disabled' : ''} class="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:opacity-50 text-white font-bold p-2 rounded-lg" title="Move Down"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button>
                    </div>
                    <div class="flex-grow flex flex-col space-y-2">
                        <select onchange="Controller.updateExampleDialogueTurn(${msg.originalIndex}, 'character_id', this.value)" class="w-full bg-gray-700 border-gray-600 rounded p-2 text-sm">${speakerOptions}</select>
                        <textarea oninput="Controller.updateExampleDialogueTurn(${msg.originalIndex}, 'content', this.value)" class="w-full bg-gray-900/80 border-gray-600 p-2 resize-none rounded-md">${UTILITY.escapeHTML(msg.content)}</textarea>
                    </div>
                    <button onclick="Controller.deleteExampleDialogueTurn(${msg.originalIndex})" class="flex-shrink-0 bg-red-600/80 hover:bg-red-700/80 text-white font-bold p-2 rounded-lg" title="Delete Turn"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
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

	updateSidePortrait() {
	  const portraitContainer = document.getElementById('character-portrait-container');
	  if (document.body.classList.contains('layout-vertical')) {
		if (portraitContainer) portraitContainer.innerHTML = '';
		return;
	  }

	  const state = StateManager.getState();
	  if (!portraitContainer || !state || !state.characters || !state.chat_history) {
		if (portraitContainer) portraitContainer.innerHTML = '';
		return;
	  }

	  // Last non-user chat message
	  const lastChatMessages = (state.chat_history || [])
		.filter(m => m.type === 'chat' && !m.isHidden && !state.characters.find(c => c.id === m.character_id)?.is_user);
	  const lastSpeakerMsg = lastChatMessages.length ? lastChatMessages[lastChatMessages.length - 1] : null;
	  const lastSpeaker = lastSpeakerMsg ? state.characters.find(c => c.id === lastSpeakerMsg.character_id) : null;

	  if (!lastSpeaker) {
		portraitContainer.innerHTML = '';
		return;
	  }

	  const mood = lastSpeakerMsg?.emotion || 'neutral';
	  const portraitUrl = UIManager.getPortraitSrc(lastSpeaker, mood);

	  // If we truly have nothing usable (unlikely), clear the container
	  if (!portraitUrl) {
		portraitContainer.innerHTML = '';
		return;
	  }

	  portraitContainer.innerHTML = `<img src="${portraitUrl}" class="max-w-full max-h-full object-contain rounded-lg">`;
	},

startStreamingResponse(charId, fullText, emotion) {
        if (this.RUNTIME.streamingInterval) clearInterval(this.RUNTIME.streamingInterval);
        const state = StateManager.getState();

        const messageIndex = state.chat_history.length;
        state.chat_history.push({ 
            character_id: charId, content: '', type: 'chat', emotion: emotion, 
            timestamp: new Date().toISOString(), isNew: true 
        });

        this.renderChat();
        
        const messageContentEl = document.getElementById(`message-content-${messageIndex}`);
        if (!messageContentEl) {
            console.error("Could not find message element to stream to.");
            return;
        }
        const bubbleEl = messageContentEl.closest('.chat-bubble-container');
        const words = fullText.split(/(\s+)/);
        let wordIndex = 0;

        this.RUNTIME.streamingInterval = setInterval(() => {
            if (wordIndex < words.length) {
                const word = words[wordIndex];
                state.chat_history[messageIndex].content += word;
                
                const userChar = state.characters.find(c => c.is_user);
                const character = state.characters.find(c => c.id === charId);
                const replacer = (text) => text.replace(/{character}/g, character.name).replace(/{user}/g, userChar.name);
                let processedContent = replacer(state.chat_history[messageIndex].content);
                
                // --- FIX ---
                // Replaced the 'boldedContent' logic with the 'styledContent' logic
                // to match the _createMessageHTML function.
                const styledContent = processedContent.replace(/(["“][^"”]*["”])/g, `<span class="dialogue-quote">$1</span>`);
                let fullHTML = marked.parse(styledContent || '');
                // --- END FIX ---
                
				const imgSrc = UIManager.getPortraitSrc(character, state.chat_history[messageIndex].emotion);
				
				if (state.characterImageMode === 'bubble' && imgSrc) {
				  fullHTML = `<img src="${imgSrc}" class="bubble-char-image">` + fullHTML;
				}

                messageContentEl.innerHTML = fullHTML;
                
                const chatWindow = document.getElementById('chat-window');
                const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + 50;
                if(isScrolledToBottom) {
                     bubbleEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
                wordIndex++;
			} else {
                clearInterval(this.RUNTIME.streamingInterval);
                this.RUNTIME.streamingInterval = null;
                state.chat_history[messageIndex].isNew = false;
                StateManager.saveState();

                // --- NEW: Check for dynamic triggers based on the AI's response ---
                Controller.checkDynamicEntryTriggers(); 
                // ------------------------------------------------------------------

                setTimeout(() => bubbleEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        }, 2); // Speed of streaming in inverse.
    },
    
showTypingIndicator(charId, text="is thinking...") { 
        this.hideTypingIndicator(); 
        const chatWindow=document.getElementById('chat-window'); 
        const name = (StateManager.getState().characters || []).find(c => c.id === charId)?.name || 'System'; 
        const indicator = document.createElement('div'); 
        indicator.id = 'typing-indicator'; 

        // --- MODIFICATION ---
        // Use the same container as chat bubbles for correct alignment and width
        indicator.className = 'chat-bubble-container'; 
        indicator.innerHTML = `
            <div class="mb-4 flex flex-col items-start">
                <p class="font-bold text-sm mb-1">${UTILITY.escapeHTML(name)}</p>
                <div class="p-3 bg-gray-700/80 rounded-lg typing-bubble-pulse">
                    <p class="italic">${text}</p>
                </div>
            </div>`;
        // --- END MODIFICATION ---
            
        chatWindow.appendChild(indicator); 
        chatWindow.scrollTop = chatWindow.scrollHeight; 
    },
    
    hideTypingIndicator() { 
        const el = document.getElementById('typing-indicator'); 
        if (el) el.remove(); 
    },
    
applyStyling() { 
        const state = StateManager.getState();
        const backgroundElement = document.getElementById('global-background');
        
		let backgroundUrl = ''; // Default to no background

        // 1. Check for a location-specific image first (highest priority)
        if (state.worldMap && state.worldMap.grid.length > 0) {
            const currentLoc = state.worldMap.grid.find(loc => loc.coords.x === state.worldMap.currentLocation.x && loc.coords.y === state.worldMap.currentLocation.y);
            if (currentLoc) {
                // NEW: Check local cache first
                const locationKey = `location::${currentLoc.coords.x},${currentLoc.coords.y}`;
                UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                
                if (UIManager.RUNTIME.worldImageCache[locationKey]) {
                    backgroundUrl = UIManager.RUNTIME.worldImageCache[locationKey];
                } 
                // FALLBACK: Check legacy URL (if not a local key)
                else if (currentLoc.imageUrl && !currentLoc.imageUrl.startsWith('local_idb_location')) {
                    backgroundUrl = currentLoc.imageUrl;
                }
            }
        }
        
        // 2. If no location image, check for a user-uploaded local background
        if (!backgroundUrl && UIManager.RUNTIME.globalBackgroundImageCache) {
             backgroundUrl = UIManager.RUNTIME.globalBackgroundImageCache;
        }
        // 3. If no local background, fall back to a legacy URL (if it's not our keyword)
        else if (!backgroundUrl && state.backgroundImageURL && state.backgroundImageURL !== 'local_idb_background') {
            backgroundUrl = state.backgroundImageURL;
        }

        backgroundElement.style.backgroundImage = backgroundUrl ? `url('${backgroundUrl}')` : 'none';
        
        document.getElementById('app-container').style.backdropFilter = `blur(${state.backgroundBlur || 0}px)`;
        document.documentElement.style.setProperty('--chat-font-size', `${state.textSize || 16}px`);
        document.documentElement.style.setProperty('--bubble-image-size', `${state.bubbleImageSize || 100}px`);

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
		
        const storyTitleInput = document.getElementById('story-title-input');
        const mobileStoryTitleOverlay = document.getElementById('mobile-story-title-overlay');
        if (storyTitleInput) storyTitleInput.style.color = state.chatTextColor;
        if (mobileStoryTitleOverlay) mobileStoryTitleOverlay.style.color = state.chatTextColor;
		
        this.renderChat();
    },

    renderWorldMapModal() {
        const state = StateManager.getState();
        const { activeWorldMapTab, selectedMapTile, pendingMove } = Controller.RUNTIME;
        const { worldMap } = state;
        const container = document.getElementById('world-map-modal-content');

        let contentHTML = '';
        const isMobile = window.innerHeight > window.innerWidth;

        if (activeWorldMapTab === 'move') {
            const { currentLocation } = worldMap;
            let moveGridHTML = '';
            for (let y = currentLocation.y - 1; y <= currentLocation.y + 1; y++) {
                for (let x = currentLocation.x - 1; x <= currentLocation.x + 1; x++) {
                    const isCenter = x === currentLocation.x && y === currentLocation.y;
                    const location = worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
					let imageSrc = '';
                    if (location) {
                        const locationKey = `location::${x},${y}`;
                        UIManager.RUNTIME.worldImageCache = UIManager.RUNTIME.worldImageCache || {};
                        
                        if (UIManager.RUNTIME.worldImageCache[locationKey]) {
                            // Use cached local image if available
                            imageSrc = UIManager.RUNTIME.worldImageCache[locationKey];
                        } else if (location.imageUrl && !location.imageUrl.startsWith('local_idb_location')) {
                            // Fallback to legacy URL if it exists and isn't a local key
                            imageSrc = location.imageUrl;
                        }
                    }
                    const bgImage = imageSrc ? `background-image: url('${imageSrc}');` : '';                    let classList = ['aspect-square', 'rounded-lg', 'flex', 'items-end', 'p-2', 'text-white', 'relative', 'overflow-hidden', 'bg-cover', 'bg-center', 'transition-all'];
                    
                    if (isCenter) {
                        classList.push('bg-indigo-800/80', 'ring-2', 'ring-indigo-300');
                    } else if (location) {
                        classList.push('bg-gray-700/80', 'cursor-pointer', 'hover:ring-2', 'hover:ring-sky-400');
                    } else {
                        classList.push('bg-black/50');
                    }

                    if (pendingMove && pendingMove.x === x && pendingMove.y === y && !isCenter) {
                        classList.push('ring-4', 'ring-yellow-400');
                    }

                    if (location) {
                        moveGridHTML += `<div 
                            class="${classList.join(' ')}"
                            style="${bgImage}"
                            ${!isCenter ? `onclick="Controller.selectPendingMove(${x}, ${y})"` : ''}>
                            <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                            <span class="relative z-10 text-sm font-bold">${UTILITY.escapeHTML(location.name)}</span>
                        </div>`;
                    } else {
                        moveGridHTML += `<div class="${classList.join(' ')}"></div>`;
                    }
                }
            }

            let detailsHTML = '';
            const pendingLocation = pendingMove ? worldMap.grid.find(l => l.coords.x === pendingMove.x && l.coords.y === pendingMove.y) : null;
            if (pendingLocation) {
                 detailsHTML = `
                    <h3 class="text-2xl font-bold">${UTILITY.escapeHTML(pendingLocation.name)}</h3>
                    <p class="text-gray-400 mt-2 flex-grow">${UTILITY.escapeHTML(pendingLocation.description)}</p>
                    <button onclick="Controller.confirmMove()" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg mt-4">Confirm Move</button>
                `;
            } else {
                 const currentLocationData = worldMap.grid.find(l => l.coords.x === currentLocation.x && l.coords.y === currentLocation.y);
                 detailsHTML = `
                    <h3 class="text-2xl font-bold">Movement</h3>
                    <p class="text-gray-400 mt-2">You are currently at <strong>${UTILITY.escapeHTML(currentLocationData.name)}</strong>.</p>
                    <p class="text-gray-400 mt-2">Select an adjacent tile to see its details and confirm your move.</p>
                `;
            }

             contentHTML = `<div class="p-6 flex-grow grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div class="grid grid-cols-3 gap-2">${moveGridHTML}</div>
                <div class="flex flex-col h-full">${detailsHTML}</div>
            </div>`;

        } else { // 'worldmap' tab
            const { currentLocation, destination, path } = worldMap;
            let mapGridHTML = '';
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const location = worldMap.grid.find(loc => loc.coords.x === x && loc.coords.y === y);
                    let classList = ['aspect-square', 'rounded', 'bg-gray-800/80', 'hover:bg-gray-700/80', 'cursor-pointer', 'text-xs', 'p-1', 'overflow-hidden', 'leading-tight'];
                    
                    if (currentLocation.x === x && currentLocation.y === y) classList.push('ring-2', 'ring-green-400');
                    if (destination && destination.x === x && destination.y === y) classList.push('ring-2', 'ring-red-500');
                    if (path && path.some(p => p.x === x && p.y === y)) classList.push('bg-sky-700/50');
                    if (selectedMapTile && selectedMapTile.coords.x === x && selectedMapTile.coords.y === y) classList.push('ring-2', 'ring-yellow-300');

                    mapGridHTML += `<div class="${classList.join(' ')}" onclick="Controller.selectMapTile(${x}, ${y})">${location ? UTILITY.escapeHTML(location.name) : ''}</div>`;
                }
            }

            let detailsHTML = `<div class="h-full flex items-center justify-center text-gray-500">Select a tile to view details.</div>`;
            if (selectedMapTile) {
                detailsHTML = `
                    <div class="h-full flex flex-col space-y-3">
                        <div><label class="text-sm text-gray-400">Name</label><input type="text" value="${UTILITY.escapeHTML(selectedMapTile.name)}" oninput="Controller.updateLocationDetail('name', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded"></div>

                        <div>
                            <label class="text-sm text-gray-400 mt-2 block">Upload Local Image</label>
                            <span class="text-xs text-gray-500 mb-2 block">Current: ${selectedMapTile.imageUrl.startsWith('local_idb_location') ? '[Local Image]' : (selectedMapTile.imageUrl ? '[Legacy URL]' : 'None')}</span>
                            <input type="file" accept="image/*" onchange="Controller.handleWorldMapLocationImageUpload(event, ${selectedMapTile.coords.x}, ${selectedMapTile.coords.y})" class="mt-1 block w-full text-sm text-gray-400 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer">
                        </div>
                        <div><label class="text-sm text-gray-400">Brief Description</label><textarea oninput="Controller.updateLocationDetail('description', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded h-20 resize-none">${UTILITY.escapeHTML(selectedMapTile.description)}</textarea></div>
                        <div class="flex-grow flex flex-col">
                            <label class="text-sm text-gray-400">Full Prompt</label>
                            <div class="relative flex-grow">
                                <textarea oninput="Controller.updateLocationDetail('prompt', this.value)" class="w-full h-full bg-black/30 border-gray-600 p-2 rounded resize-none">${UTILITY.escapeHTML(selectedMapTile.prompt)}</textarea>
                                <button onclick="Controller.generateLocationPromptAI(event)" class="absolute top-2 right-2 text-sky-400 hover:text-sky-300 p-1 bg-sky-600/80 rounded" title="Generate with AI">${this.getAIGenIcon()}</button>
                            </div>
                        </div>
                        <div class="flex gap-2">
                           <button onclick="Controller.setDestination()" class="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-lg">Set Destination</button>
                           <button onclick="if(confirm('This will immediately move you to this location. Proceed?')) { Controller.moveToLocation(${selectedMapTile.coords.x}, ${selectedMapTile.coords.y}); Controller.closeModal('world-map-modal'); }" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg">Jump To</button>
                        </div>
                    </div>`;
            }

            const gridLayoutClass = isMobile ? 'grid-cols-1' : 'grid-cols-3';
            const detailsWrapperClass = isMobile ? 'h-64 overflow-y-auto' : 'flex flex-col';

            contentHTML = `<div class="p-6 flex-grow grid ${gridLayoutClass} gap-6 h-full min-h-0">
                <div class="col-span-2 grid grid-cols-8 gap-1">${mapGridHTML}</div>
                <div class="col-span-1 bg-black/30 rounded-lg p-4 ${detailsWrapperClass}">${detailsHTML}</div>
            </div>`;
        }

        container.innerHTML = `
            <div class="p-6 pb-0 flex justify-between items-center border-b border-gray-700">
                <div class="flex">
                    <button id="world-map-tab-move" onclick="Controller.switchWorldMapTab('move')" class="py-3 px-4 font-semibold text-lg ${activeWorldMapTab === 'move' ? 'border-b-2 border-indigo-500 text-white' : 'border-b-2 border-transparent text-gray-400 hover:text-white'}">Move</button>
                    <button id="world-map-tab-worldmap" onclick="Controller.switchWorldMapTab('worldmap')" class="py-3 px-4 font-semibold text-lg ${activeWorldMapTab === 'worldmap' ? 'border-b-2 border-indigo-500 text-white' : 'border-b-2 border-transparent text-gray-400 hover:text-white'}">World Map</button>
                </div>
                <button id="generate-world-button" onclick="Controller.generateWorldMap(event)" class="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-3 rounded-lg ml-4 flex-shrink-0">${this.getAIGenIcon()}</button>
            </div>
            ${contentHTML}
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-end">
                <button onclick="Controller.closeModal('world-map-modal')" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Done</button>
            </div>`;

        if (activeWorldMapTab === 'worldmap' && selectedMapTile) {
            const detailsContainer = container.querySelector('.col-span-1');
            detailsContainer.innerHTML += `
                <hr class="border-gray-600 my-4">
                <div class="flex-grow flex flex-col min-h-0">
                    <div class="flex justify-between items-center mb-2">
                        <h4 class="font-bold text-lg">Local Static Memory</h4>
                        <button onclick="Controller.addLocalStaticEntry()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-2 rounded-lg text-sm">Add</button>
                    </div>
                    <div class="grid grid-cols-3 gap-4 flex-grow min-h-0">
                        <div id="local-static-entries-list" class="col-span-1 bg-black/40 rounded-lg p-2 overflow-y-auto"></div>
                        <div id="local-static-entry-details" class="col-span-2 flex flex-col"></div>
                    </div>
                </div>`;
            this.renderLocalStaticEntriesList();
            this.renderLocalStaticEntryDetails();
        }
    },

    renderLocalStaticEntriesList() {
        const { selectedMapTile, selectedLocalStaticEntryId } = Controller.RUNTIME;
        const container = document.getElementById('local-static-entries-list');
        if (!container || !selectedMapTile) return;

        const entries = selectedMapTile.local_static_entries || [];
        container.innerHTML = entries.map(entry => `
            <div onclick="Controller.selectLocalStaticEntry('${entry.id}')" 
                 class="p-2 rounded-md cursor-pointer ${selectedLocalStaticEntryId === entry.id ? 'bg-indigo-600' : 'hover:bg-indigo-600/50'}">
                <h5 class="font-semibold truncate text-sm">${UTILITY.escapeHTML(entry.title)}</h5>
            </div>
        `).join('');
    },

    renderLocalStaticEntryDetails() {
        const { selectedMapTile, selectedLocalStaticEntryId } = Controller.RUNTIME;
        const container = document.getElementById('local-static-entry-details');
        if (!container || !selectedMapTile) return;

        const entry = (selectedMapTile.local_static_entries || []).find(e => e.id === selectedLocalStaticEntryId);

        if (entry) {
            container.innerHTML = `
                <input type="text" value="${UTILITY.escapeHTML(entry.title)}" oninput="Controller.updateLocalStaticEntryField('${entry.id}', 'title', this.value)" class="font-bold bg-black/30 p-2 w-full mb-2 text-sm rounded-md">
                <textarea oninput="Controller.updateLocalStaticEntryField('${entry.id}', 'content', this.value)" class="w-full flex-grow bg-black/30 p-2 resize-none text-sm rounded-md">${UTILITY.escapeHTML(entry.content)}</textarea>
                <div class="flex justify-end mt-2">
                    <button onclick="Controller.deleteLocalStaticEntry('${entry.id}')" class="text-xs bg-red-600/80 hover:bg-red-700/80 font-semibold py-1 px-2 rounded-lg">Delete</button>
                </div>`;
        } else {
            container.innerHTML = `<div class="text-gray-500 flex items-center justify-center h-full text-sm">Select an entry.</div>`;
        }
    },

getPortraitSrc(character, mood) {
	  const cache = UIManager.RUNTIME.characterImageCache || {};

	  const emoKey = mood ? `${character.id}::emotion::${mood}` : null;
	  if (emoKey && cache[emoKey]) return cache[emoKey];

	  // Base portrait (IDB-backed cache)
	  if (cache[character.id]) return cache[character.id];

	  // Legacy URL (pre-IDB) - Make sure it's not our local keyword
	  if (character.image_url && !character.image_url.startsWith('local_idb_')) {
          return character.image_url;
      }

	  // Return null instead of placeholder
	  return null;
	},

	openCharacterDetailModal(charId) {
        const state = StateManager.getState();
        const char = state.characters.find(c => c.id === charId);
        if (!char) return;
        const container = document.getElementById('character-detail-modal-content');
        
        // Determine current role for UI state
        let currentRole = 'none';
        if (char.is_user) currentRole = 'user';
        else if (char.is_narrator) currentRole = 'narrator';

        const extraPortraitsHTML = (char.extra_portraits || []).map((portrait, index) => {
             // ... (Keep existing extraPortraitsHTML logic exactly as is) ...
             const emo = portrait.emotion || 'happy';
             const fileInputId = `emo-file-${char.id}-${index}`;
             const urlInputId  = `emo-url-${char.id}-${index}`;
             const labelId     = `emo-label-${char.id}-${index}`;
             const cached = (UIManager.RUNTIME.characterImageCache || {})[`${char.id}::emotion::${emo}`];
             const hint   = cached ? '[local image]' : (portrait.url ? '[url]' : '[none]');
             return `
                <div class="flex flex-col space-y-2 mt-2 p-2 rounded border border-gray-700/50">
                    <div class="flex items-center space-x-2">
                        <select onchange="Controller.updateExtraPortrait('${char.id}', ${index}, 'emotion', this.value)" class="w-1/3 bg-black/30 border-gray-600 rounded p-1 text-sm">
                            <option value="happy" ${emo === 'happy' ? 'selected' : ''}>Happy</option>
                            <option value="sad" ${emo === 'sad' ? 'selected' : ''}>Sad</option>
                            <option value="angry" ${emo === 'angry' ? 'selected' : ''}>Angry</option>
                            <option value="surprised" ${emo === 'surprised' ? 'selected' : ''}>Surprised</option>
                            <option value="neutral" ${emo === 'neutral' ? 'selected' : ''}>Neutral</option>
                        </select>
                        <input id="${urlInputId}" type="text" value="${UTILITY.escapeHTML(portrait.url || '')}" oninput="Controller.updateExtraPortrait('${char.id}', ${index}, 'url', this.value)" class="w-2/3 bg-black/30 border-gray-600 p-1 text-sm" placeholder="Image URL">
                        <button onclick="Controller.removeExtraPortrait('${char.id}', ${index})" class="text-red-400 hover:text-red-300">X</button>
                    </div>
                    <div class="flex items-center justify-between">
                        <label class="text-sm text-gray-400" for="${fileInputId}">Upload local image for <span class="font-semibold">${emo}</span>:</label>
                        <span id="${labelId}" class="text-xs text-gray-400">${hint}</span>
                    </div>
                    <input id="${fileInputId}" type="file" accept="image/*" onchange="Controller.handleLocalEmotionImageUpload(event, '${char.id}', ${index})" class="block w-full text-sm text-gray-400 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer">
                </div>`;
        }).join('');

        const tagsValue = (char.tags || []).join(', ');
        const color = char.color || { base: '#334155', bold: '#94a3b8' };

        const modalHTML = `
            <div class="p-6 border-b border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 class="text-2xl font-semibold" data-char-id="${char.id}">${UTILITY.escapeHTML(char.name)}</h2>
                    <div class="flex items-center space-x-2 mt-1">
                        <span class="text-sm text-gray-400">Active in this chat</span>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" class="sr-only peer" ${char.is_active ? 'checked' : ''} onchange="Controller.toggleCharacterActive(event, '${char.id}')">
                            <div class="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>
                </div>
                
                <div class="flex bg-black/40 rounded-lg p-1">
                    <button onclick="Controller.setCharacterRole('${char.id}', 'user')" class="px-3 py-1 rounded-md text-sm font-bold transition-colors ${currentRole === 'user' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}">User</button>
                    <button onclick="Controller.setCharacterRole('${char.id}', 'none')" class="px-3 py-1 rounded-md text-sm font-bold transition-colors ${currentRole === 'none' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}">NPC</button>
                    <button onclick="Controller.setCharacterRole('${char.id}', 'narrator')" class="px-3 py-1 rounded-md text-sm font-bold transition-colors ${currentRole === 'narrator' ? 'bg-teal-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}">Narrator</button>
                </div>
            </div>

            <div class="p-6 overflow-y-auto space-y-4">
                <details open>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Primary Info</summary>
                    <div class="p-4 space-y-4 bg-black/20 rounded-b-lg">
                        <input type="text" value="${UTILITY.escapeHTML(char.name)}" oninput="Controller.updateCharacterField('${char.id}', 'name', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded text-lg" placeholder="Character Name">
                        <div><label class="text-sm text-gray-400">Short Description (for roster card)</label><input type="text" value="${UTILITY.escapeHTML(char.short_description)}" oninput="Controller.updateCharacterField('${char.id}', 'short_description', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded"></div>
                        <div>
                            <label class="text-sm text-gray-400">Default Image</label>
                            <input type="text" value="${UTILITY.escapeHTML(char.image_url)}" oninput="Controller.updateCharacterField('${char.id}', 'image_url', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded mb-2" placeholder="Paste URL...">
                            <input type="file" accept="image/*" onchange="Controller.handleLocalImageUpload(event, '${char.id}')" class="block w-full text-sm text-gray-400 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 cursor-pointer">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div><label class="text-sm text-gray-400">Bubble Base Color</label><input type="color" value="${color.base}" oninput="Controller.updateCharacterColor('${char.id}', 'base', this.value)" class="w-full h-10 p-1 bg-black/30 border-gray-600 rounded"></div>
                            <div><label class="text-sm text-gray-400">Name Color</label><input type="color" value="${color.bold}" oninput="Controller.updateCharacterColor('${char.id}', 'bold', this.value)" class="w-full h-10 p-1 bg-black/30 border-gray-600 rounded"></div>
                        </div>
                        <div><label class="text-sm text-gray-400">Tags (comma-separated)</label><input type="text" value="${tagsValue}" oninput="Controller.updateCharacterTags('${char.id}', this.value)" class="w-full bg-black/30 border-gray-600 p-2 rounded"><button onclick="Controller.generateTagsForCharacter(event, '${char.id}')" class="text-xs text-sky-400 hover:text-sky-300 mt-1 p-1 bg-sky-600/80 rounded">${this.getAIGenIcon()}</button></div>
                    </div>
                </details>
                <details>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Persona</summary>
                    <div class="p-4 space-y-4 bg-black/20 rounded-b-lg">
                         <textarea id="persona-description-${char.id}" oninput="Controller.updateCharacterField('${char.id}', 'description', this.value); UIManager.updateTokenCount('${char.id}', this.value)" class="w-full h-48 bg-black/30 border-gray-600 p-2 resize-y rounded">${UTILITY.escapeHTML(char.description)}</textarea>
                         <div class="flex justify-between items-center"><span class="text-right text-sm text-gray-400" id="token-counter-${char.id}">~${Math.round((char.description || '').length / 4)} tokens</span><button onclick="Controller.enhancePersonaWithAI(event, '${char.id}')" class="text-sm bg-sky-600/80 hover:bg-sky-500/80 font-semibold py-2 px-3 rounded-lg">${this.getAIGenIcon()}</button></div>
                    </div>
                </details>
                <details>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Model Instructions</summary>
                    <div class="p-4 space-y-4 bg-black/20 rounded-b-lg">
                         <textarea oninput="Controller.updateCharacterField('${char.id}', 'model_instructions', this.value)" class="w-full h-48 bg-black/30 border-gray-600 p-2 resize-y rounded">${UTILITY.escapeHTML(char.model_instructions)}</textarea>
                         <div class="text-right"><button onclick="Controller.generateModelInstructions(event, '${char.id}')" class="text-sm bg-sky-600/80 hover:bg-sky-700/80 font-semibold py-2 px-3 rounded-lg">${this.getAIGenIcon()}</button></div>
                    </div>
                </details>
                <details>
                    <summary class="font-semibold text-lg cursor-pointer hover:text-indigo-300">Emotional Portraits</summary>
                    <div class="p-4 space-y-2 bg-black/20 rounded-b-lg">
                        <div id="extra-portraits-${char.id}">${extraPortraitsHTML}</div>
                        <button onclick="Controller.addExtraPortrait('${char.id}')" class="text-sm text-sky-400 hover:text-sky-300 mt-2">+ Add Emotional Portrait</button>
                    </div>
                </details>
            </div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-between">
                <button onclick="if(confirm('Are you sure you want to delete this character?')) Controller.deleteCharacter('${char.id}')" class="bg-red-600/80 hover:bg-red-700/80 font-bold py-2 px-4 rounded-lg">Delete</button>
                <button onclick="Controller.closeModal('character-detail-modal')" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Done</button>
            </div>
        `;
        container.innerHTML = modalHTML;

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

    updateAICharacterSelector() {
        const state = StateManager.getState();
        const selector = document.getElementById('ai-character-selector');
        if (!state || !state.characters) {
            selector.innerHTML = '';
            return;
        }

        const activeAiChars = state.characters.filter(c => !c.is_user && c.is_active);
        
        if (activeAiChars.length <= 1) {
            selector.style.display = 'none';
        } else {
            selector.style.display = 'block';
        }

        const currentValue = selector.value;
        let optionsHTML = `<option value="any">Any</option>`;
        optionsHTML += activeAiChars.map(c => `<option value="${c.id}">${UTILITY.escapeHTML(c.name)}</option>`).join('');
        selector.innerHTML = optionsHTML;
        
        if (currentValue && selector.querySelector(`option[value="${currentValue}"]`)) {
            selector.value = currentValue;
        }
    },

    // --- NEW & MODIFIED UI Functions for Import/Export ---

    /**
     * Renders the centralized Import/Export Hub modal.
     */
/**
     * Renders the centralized Import/Export Hub modal.
     * [REVISED] This now points the main library I/O buttons to
     * the new ZIP-based Controller functions.
     */
    renderIOHubModal() {
        // Get the container for the modal content
        const modalContent = document.getElementById('io-hub-modal-content');
        
        // Get all stories from the StateManager's in-memory list for the dropdown
        const library = StateManager.getLibrary();
        const storyOptions = library.stories
            .map(s => `<option value="${s.id}">${UTILITY.escapeHTML(s.name)}</option>`)
            .join('');

        // Define the inner HTML for the modal
        const hubHTML = `
            <div class="p-6 border-b border-gray-700">
                <h2 class="text-2xl font-semibold">Import / Export Hub</h2>
            </div>
            <div class="p-6 overflow-y-auto">
                <div class="grid md:grid-cols-2 gap-8">
                    
                    <!-- === IMPORT COLUMN === -->
                    <div class="space-y-6">
                        <h3 class="text-xl font-bold border-b pb-2 border-gray-600">Import</h3>
                        
                        <!-- Single Story Import (Unchanged) -->
                        <div>
                            <p class="text-sm text-gray-300 mb-2">Import a single Story from a V2 PNG, BYAF, or Ellipsis JSON file.</p>
                            <label for="single-file-upload" class="cursor-pointer">
                                <div class="border-2 border-dashed border-gray-500 rounded-lg p-6 text-center bg-black/20 hover:bg-black/40">
                                    <p class="font-semibold text-indigo-300">Click to upload a file</p>
                                    <p class="text-xs text-gray-400 mt-1">.png, .byaf, .zip, .json</p>
                                </div>
                            </label>
                            <input id="single-file-upload" type="file" class="hidden" accept=".png,.byaf,.zip,.json" onchange="Controller.handleFileUpload(event)">
                        </div>

                        <!-- Bulk Import (Unchanged) -->
                        <div>
                            <p class="text-sm text-gray-300 mb-2">Import an entire folder of V2 PNG or BYAF files at once.</p>
                            <button onclick="Controller.handleBulkImport()" class="w-full mt-2 bg-teal-600/80 hover:bg-teal-700/80 text-white font-bold py-2 px-4 rounded-lg">Select Folder to Import</button>
                        </div>

                        <!-- [REVISED] Full Library Import -->
                        <div>
                            <p class="text-sm text-gray-300 mb-2">Replace your current library with an Ellipsis Library ZIP file. <span class="font-bold text-red-400">Warning: This is a destructive action.</span></p>
                            <label class="w-full mt-2 bg-red-800/80 hover:bg-red-900/80 text-white font-bold py-2 px-4 rounded-lg inline-block text-center cursor-pointer">
                                <span>Import Library (ZIP)</span>
                                <!-- We accept .zip and point to the new Controller.importLibrary function -->
                                <input type="file" class="hidden" accept=".zip" onchange="Controller.importLibrary(event)">
                            </label>
                        </div>
                    </div>

                    <!-- === EXPORT COLUMN === -->
                    <div class="space-y-4">
                        <h3 class="text-xl font-bold border-b pb-2 border-gray-600">Export</h3>
                        
                        <!-- Single Story/Narrative Export (Unchanged) -->
                        <div>
                            <label for="story-export-selector" class="block text-sm font-medium text-gray-300">1. Select Story to Export</label>
                            <select id="story-export-selector" class="w-full mt-1 bg-black/30 p-2 rounded-lg border-gray-600" onchange="UIManager.populateNarrativeSelector()">
                                <option value="">-- Select a Story --</option>
                                ${storyOptions}
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
                                <button onclick="Controller.exportStoryAs('json')" class="bg-indigo-600/80 hover:bg-indigo-700/80 text-white font-bold py-2 px-3 rounded-lg">JSON</button>
                                <button onclick="Controller.exportStoryAs('png')" class="bg-sky-600/80 hover:bg-sky-700/80 text-white font-bold py-2 px-3 rounded-lg">V2 PNG</button>
                                <button onclick="Controller.exportStoryAs('byaf')" class="bg-emerald-600/80 hover:bg-emerald-700/80 text-white font-bold py-2 px-3 rounded-lg">BYAF</button>
                            </div>
                        </div>
                         
                         <!-- [REVISED] Full Library Export -->
                         <hr class="border-gray-600 !mt-8">
                        <div>
                            <p class="text-sm text-gray-300 mb-2">Save a backup of your entire library, including all images.</p>
                            <!-- This button now points to the new Controller.exportLibrary function -->
                            <button onclick="Controller.exportLibrary()" class="w-full mt-2 bg-gray-600/80 hover:bg-gray-700/80 text-white font-bold py-2 px-4 rounded-lg">Export Library (ZIP)</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-end">
                <button onclick="Controller.closeModal('io-hub-modal')" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Close</button>
            </div>
        `;
        
        // Set the modal content and populate the first dropdown
        modalContent.innerHTML = hubHTML;
        this.populateNarrativeSelector();
    },

    /** Populates the narrative selector dropdown based on the selected story. */
    populateNarrativeSelector() {
        const storyId = document.getElementById('story-export-selector').value;
        const narrativeSelector = document.getElementById('narrative-export-selector');
        narrativeSelector.innerHTML = '';
        if (storyId) {
            const story = StateManager.getLibrary().stories.find(s => s.id === storyId);
            if (story && story.narratives) {
                narrativeSelector.innerHTML = story.narratives.map(n => `<option value="${n.id}">${UTILITY.escapeHTML(n.name)}</option>`).join('');
            }
        }
        this.populateCharacterSelector();
    },

    /** Populates the character selector dropdown for V2/BYAF exports. */
    populateCharacterSelector() {
        const storyId = document.getElementById('story-export-selector').value;
        const charContainer = document.getElementById('character-export-selector-container');
        const charSelector = document.getElementById('character-export-selector');
        charSelector.innerHTML = '';
        if (storyId) {
            const story = StateManager.getLibrary().stories.find(s => s.id === storyId);
            const aiChars = story.characters.filter(c => !c.is_user);
            if (aiChars.length > 0) {
                charSelector.innerHTML = aiChars.map(c => `<option value="${c.id}">${UTILITY.escapeHTML(c.name)}</option>`).join('');
                charContainer.classList.remove('hidden');
            } else {
                charContainer.classList.add('hidden');
            }
        } else {
            charContainer.classList.add('hidden');
        }
    },

    /**
     * Displays a confirmation modal that returns a Promise, allowing for async/await usage.
     * @param {string} message - The message to display.
     * @returns {Promise<boolean>} - A promise that resolves to true if confirmed, false if canceled.
     */
    showConfirmationPromise(message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmation-modal');
            const messageEl = document.getElementById('confirmation-modal-message');
            const confirmBtn = document.getElementById('confirmation-modal-confirm-button');
            const cancelBtn = modal.querySelector('button:not(#confirmation-modal-confirm-button)');
            
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
                modal.querySelector('.modal-overlay').removeEventListener('click', cancelClickHandler);
                Controller.closeModal('confirmation-modal');
            };
            
            confirmBtn.addEventListener('click', confirmClickHandler, { once: true });
            cancelBtn.addEventListener('click', cancelClickHandler, { once: true });
            modal.querySelector('.modal-overlay').addEventListener('click', cancelClickHandler, { once: true });

            Controller.openModal('confirmation-modal');
        });
    },

    /** Displays a full-screen loading spinner with a message. */
    showLoadingSpinner(message = 'Loading...') {
        let spinner = document.getElementById('loading-spinner');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.id = 'loading-spinner';
            spinner.className = 'fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center';
            spinner.innerHTML = `
                <div class="w-16 h-16 border-4 border-t-indigo-500 border-gray-600 rounded-full animate-spin"></div>
                <p id="spinner-message" class="mt-4 text-white font-semibold"></p>
            `;
            document.body.appendChild(spinner);
        }
        document.getElementById('spinner-message').textContent = message;
        spinner.style.display = 'flex';
    },

    /** Hides the loading spinner. */
    hideLoadingSpinner() {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
            spinner.style.display = 'none';
        }
    },

    /**
     * Displays a report modal after a bulk import is complete.
     * @param {string[]} importedStoryNames - A list of names of successfully imported stories.
     * @param {Array<{name: string, reason: string}>} failedFiles - A list of files that failed to import.
     */
    showBulkImportReport(importedStoryNames, failedFiles) {
        const container = document.getElementById('report-modal-content');
        let reportHTML = `
            <div class="p-6 border-b border-gray-700"><h2 class="text-2xl font-semibold">Bulk Import Report</h2></div>
            <div class="p-6 overflow-y-auto space-y-4">
                <div>
                    <h3 class="font-bold text-lg text-green-400">Success (${importedStoryNames.length})</h3>
                    <ul class="list-disc list-inside text-sm mt-2 max-h-40 overflow-y-auto bg-black/20 p-2 rounded-md">
                        ${importedStoryNames.map(name => `<li>${UTILITY.escapeHTML(name)}</li>`).join('') || '<li>No stories were imported successfully.</li>'}
                    </ul>
                </div>
        `;

        if (failedFiles.length > 0) {
            const logContent = failedFiles.map(f => `File: ${f.name}\nReason: ${f.reason}\n---`).join('\n');
            const logBlob = new Blob([logContent], { type: 'text/plain' });
            const logUrl = URL.createObjectURL(logBlob);

            reportHTML += `
                <div>
                    <h3 class="font-bold text-lg text-red-400">Failures (${failedFiles.length})</h3>
                    <p class="text-sm mt-2">Some files could not be imported. <a href="${logUrl}" download="import_error_log.txt" class="text-indigo-400 hover:underline">Download Error Log</a> for details.</p>
                </div>
            `;
        }
        
        reportHTML += `</div>
            <div class="p-4 bg-black/20 border-t border-gray-700 flex justify-end">
                <button onclick="Controller.closeModal('report-modal')" class="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded-lg">Done</button>
            </div>
        `;
        
        container.innerHTML = reportHTML;
        Controller.openModal('report-modal');
    },

    /**
     * Displays a generic confirmation modal. (Kept for simple, non-async confirmations).
     * @param {string} message - The message to display in the modal body.
     * @param {function} onConfirmCallback - The function to execute when the confirm button is clicked.
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
                Controller.closeModal('confirmation-modal');
            };
            Controller.openModal('confirmation-modal');
        } else {
            console.error("Confirmation modal elements not found.");
        }
    },

    /**
     * Changes the primary action button to "Stop Generation" mode.
     */
    setButtonToStopMode() {
        const button = document.getElementById('primary-action-btn');
        if (!button) return;
        button.onclick = () => Controller.stopGeneration();
        button.title = "Stop Generation";
        button.classList.remove('bg-indigo-600/50', 'hover:bg-indigo-600/80');
        button.classList.add('bg-red-700/60', 'hover:bg-red-700/80');
        button.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 0h8v8H6V4z" clip-rule="evenodd" /></svg>`;
		
        // [FIX] Use setTimeout to defer attaching the new event handler.
        // This prevents a race condition where the initial click also triggers the stop function.
        setTimeout(() => {
            button.onclick = () => Controller.stopGeneration();
        }, 0);
    },

    /**
     * Reverts the primary action button to its default "Send / Write for Me" mode.
     */
    setButtonToSendMode() {
        const button = document.getElementById('primary-action-btn');
        if (!button) return;
        button.onclick = () => Controller.handlePrimaryAction();
        button.title = "Send / Write for Me";
        button.classList.remove('bg-red-700/60', 'hover:bg-red-700/80');
        button.classList.add('bg-indigo-600/50', 'hover:bg-indigo-600/80');
        button.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>`;
    },
};
