        const ImportExportService = {
            /**
             * Parses an uploaded file based on its extension.
             * @param {File} file - The uploaded file.
             * @param {boolean} [skipImages=false] - Whether to skip image processing.
             * @returns {Promise<Object>} - The parsed story object and optional image blob.
             */
            async parseUploadedFile(file, skipImages = false) {
                const lowerCaseName = file.name.toLowerCase();
                if (lowerCaseName.endsWith('.png')) {
                    return this._parseV2Card(file, skipImages);
                } else if (lowerCaseName.endsWith('.zip') || lowerCaseName.endsWith('.byaf')) {
                    return this._parseBYAF(file, skipImages);
                } else if (lowerCaseName.endsWith('.json')) {
                    return this._parseEllipsisJSON(file);
                } else {
                    throw new Error("Unsupported file type. Please use .png, .byaf, .zip, or .json.");
                }
            },

            /**
             * Exports a story as a JSON blob.
             * @param {Object} story - The story object.
             * @returns {Blob} - The JSON blob.
             */
            exportStoryAsJSON(story) {
                const storyExport = JSON.parse(JSON.stringify(story));
                return new Blob([JSON.stringify(storyExport, null, 2)], { type: 'application/json' });
            },

            /**
             * Ensures all characters in the chat history exist in the story.
             * @param {Object} story - The story object.
             * @param {Array} chatHistory - The chat history.
             * @returns {Array<string>} - The list of active character IDs.
             * @private
             */
            _ensureCharactersExist(story, chatHistory) {
                const registeredIds = new Set(story.characters.map(c => c.id));
                const activeIds = new Set(story.characters.filter(c => c.is_active).map(c => c.id));

                // Map names to IDs for existing chars to avoid duplicates if ID is missing but name matches
                const nameToId = {};
                story.characters.forEach(c => nameToId[c.name] = c.id);

                chatHistory.forEach(msg => {
                    if (msg.type === 'chat' && !registeredIds.has(msg.character_id)) {
                        // We found a message with an ID that isn't in the roster.
                        // This is a "Ghost". We must manifest a body for it.

                        // 1. Check if we can recover it by name (common in V2 imports)
                        // (Assuming content might have name prefix, or we just create a generic one)
                        // Since V2/BYAF often don't give us the ID in the message, we might have generated a random UUID 
                        // for the message that has no matching char. 

                        // Actually, for V2/BYAF, the previous logic often maps names to IDs. 
                        // If the mapping failed, we need a fallback.

                        const ghostChar = {
                            id: msg.character_id, // Use the ID the message is already pointing to
                            name: msg.name || "Unknown Speaker", // Fallback name
                            description: "Imported from group chat history.",
                            short_description: "Imported.",
                            model_instructions: "Act as this character.",
                            tags: ["imported"],
                            image_url: "",
                            extra_portraits: [],
                            is_user: false,
                            is_active: true, // Keep active so they show up
                            is_narrator: false,
                            color: { base: '#475569', bold: '#94a3b8' } // Slate
                        };

                        story.characters.push(ghostChar);
                        registeredIds.add(ghostChar.id);
                        activeIds.add(ghostChar.id);
                    }
                });

                return Array.from(activeIds);
            },

            /**
             * Exports a story as a V2 Character Card (PNG).
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @returns {Promise<Uint8Array>} - The PNG buffer with embedded data.
             */
            async exportStoryAsV2(story, narrative, primaryCharId) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                if (!primaryChar) throw new Error("V2 export requires a selected primary character.");
                let originalImageBlob = null;
                try { originalImageBlob = await DBService.getImage(primaryChar.id); } catch (dbError) { }
                if (!originalImageBlob && primaryChar.image_url && !primaryChar.image_url.startsWith('local_idb_')) {
                    try {
                        const response = await fetch(primaryChar.image_url);
                        if (response.ok) originalImageBlob = await response.blob();
                    } catch (fetchError) { }
                }
                if (!originalImageBlob) throw new Error("V2 export requires the primary character to have a valid image.");

                let pngBlob;
                try {
                    if (originalImageBlob.type === 'image/png') pngBlob = originalImageBlob;
                    else pngBlob = await ImageProcessor.convertBlobToPNGBlob(originalImageBlob);
                } catch (conversionError) { throw new Error("Failed to convert character image to PNG format for export."); }

                const v2Object = this._convertEllipsistoV2(story, narrative, primaryCharId);
                const pngImageBuffer = await pngBlob.arrayBuffer();
                return this._injectDataIntoPng(pngImageBuffer, v2Object);
            },

            /**
             * Exports a story as a BYAF (Backyard AI Format) ZIP.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @returns {Promise<Blob>} - The ZIP blob.
             */
            async exportStoryAsBYAF(story, narrative, primaryCharId) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                if (!primaryChar) throw new Error("BYAF export requires a selected primary character.");
                let imageBlob = null;
                let imageExtension = 'png';
                let imageFilename = null;
                try {
                    const blob = await DBService.getImage(primaryChar.id);
                    if (blob) {
                        imageBlob = blob;
                        const typeParts = blob.type.split('/');
                        if (typeParts.length === 2 && ['png', 'jpeg', 'jpg', 'webp'].includes(typeParts[1])) {
                            imageExtension = typeParts[1] === 'jpeg' ? 'jpg' : typeParts[1];
                        }
                    }
                } catch (dbError) { }
                if (!imageBlob && primaryChar.image_url && !primaryChar.image_url.startsWith('local_idb_')) {
                    try {
                        const response = await fetch(primaryChar.image_url);
                        if (response.ok) {
                            imageBlob = await response.blob();
                            const contentType = response.headers.get('content-type');
                            if (contentType) {
                                const typeParts = contentType.split('/');
                                if (typeParts.length === 2 && ['png', 'jpeg', 'jpg', 'webp'].includes(typeParts[1])) {
                                    imageExtension = typeParts[1] === 'jpeg' ? 'jpg' : typeParts[1];
                                }
                            } else {
                                const urlParts = primaryChar.image_url.split('.').pop()?.toLowerCase();
                                if (urlParts && ['png', 'jpg', 'jpeg', 'webp'].includes(urlParts)) imageExtension = urlParts === 'jpeg' ? 'jpg' : urlParts;
                            }
                        }
                    } catch (fetchError) { }
                }
                if (imageBlob) imageFilename = `${primaryChar.id}.${imageExtension}`;
                const byafArchiveData = this._convertEllipsistoBYAF(story, narrative, primaryCharId, imageFilename);
                if (!byafArchiveData || !byafArchiveData.manifest) throw new Error("Failed to generate BYAF data structure.");
                const zip = new JSZip();
                zip.file("manifest.json", JSON.stringify(byafArchiveData.manifest, null, 2));
                const charFolder = zip.folder(`characters/${primaryChar.id}`);
                charFolder.file("character.json", JSON.stringify(byafArchiveData.character, null, 2));
                if (imageBlob && imageFilename) charFolder.file(`images/${imageFilename}`, imageBlob);
                zip.file(`scenarios/scenario1.json`, JSON.stringify(byafArchiveData.scenario, null, 2));
                // Background Image: Include in ZIP for BYAF format compatibility
                if (story.backgroundImageURL === 'local_idb_background') {
                    try {
                        const bgBlob = await DBService.getImage(`bg_${story.id}`);
                        if (bgBlob) {
                            zip.file("images/story_background.png", bgBlob);
                        }
                    } catch (e) { console.warn("Failed to add background to BYAF:", e); }
                }

                return zip.generateAsync({ type: "blob" });
            },

            /**
             * Parses an Ellipsis JSON file.
             * @param {File} file - The JSON file.
             * @returns {Promise<Object>} - The parsed story object.
             * @private
             */
            async _parseEllipsisJSON(file) {
                const jsonString = await file.text();
                const story = JSON.parse(jsonString);
                if (!story.id || !story.name || !story.characters) throw new Error("Invalid Ellipsis JSON file.");

                story.id = UTILITY.uuid();

                // ID Remapping: Ensure unique IDs for imported characters to prevent collisions
                const charIdMap = {};
                (story.characters || []).forEach(c => {
                    const oldId = c.id;
                    const newId = UTILITY.uuid();
                    c.id = newId;
                    charIdMap[oldId] = newId;
                });

                // Helper to remap IDs in history
                const remapHistory = (history) => {
                    if (!Array.isArray(history)) return;
                    history.forEach(msg => {
                        if (msg.character_id && charIdMap[msg.character_id]) {
                            msg.character_id = charIdMap[msg.character_id];
                        }
                    });
                };

                // Scenario Updates: Update example dialogue references to match new character IDs
                (story.scenarios || []).forEach(s => {
                    s.id = UTILITY.uuid();
                    remapHistory(s.example_dialogue);
                    if (s.active_character_ids) {
                        s.active_character_ids = (s.active_character_ids || []).map(id => charIdMap[id] || id);
                    }
                });

                // Narrative Handling: Process both legacy stubs and full narrative objects for DB storage
                // We need to prepare them for the DB
                story.narratives.forEach(n => {
                    // Ensure ID is unique/remapped (already handled by ID remapping logic previously applied)

                    // If this is a FULL narrative (has state), we must allow it to be passed 
                    // back to the controller to be saved to the 'narratives' store.
                    // However, LibraryController.handleFileUpload expects the story object 
                    // to contain the full narratives in the .narratives array so it can loop and save them.

                    // Ensure IDs are consistent
                    if (n.state?.static_entries) {
                        n.state.static_entries.forEach(e => e.id = UTILITY.uuid());
                    }
                });

                (story.dynamic_entries || []).forEach(e => e.id = UTILITY.uuid());

                return { story, imageBlob: null };
            },

            /**
             * Parses a V2 Character Card (PNG).
             * @param {File} file - The PNG file.
             * @param {boolean} skipImages - Whether to skip image processing.
             * @returns {Promise<Object>} - The parsed story object.
             * @private
             */
            async _parseV2Card(file, skipImages) {
                const arrayBuffer = await file.arrayBuffer();
                const v2DataString = await this._extractV2Data(arrayBuffer);
                if (!v2DataString) throw new Error("No character data found in PNG file.");
                const v2RawData = JSON.parse(this._b64_to_utf8(v2DataString));
                const v2Data = v2RawData.data || v2RawData;
                let imageBlob = null;
                if (!skipImages) imageBlob = await ImageProcessor.processImageAsBlob(file);
                return { story: this._convertV2toEllipsis(v2Data), imageBlob };
            },

            /**
             * Parses a BYAF ZIP file.
             * @param {File} file - The ZIP file.
             * @param {boolean} skipImages - Whether to skip image processing.
             * @returns {Promise<Object>} - The parsed story object.
             * @private
             */
            async _parseBYAF(file, skipImages) {
                const zip = await JSZip.loadAsync(file);
                const characterFile = zip.file(/character\.json$/i)[0];
                const scenarioFile = zip.file(/scenario\d*\.json$/i)[0];
                const imageFile = zip.file(/\.png$/i)[0];
                if (!characterFile || !scenarioFile) throw new Error("Archive is missing character.json or scenario.json.");
                const byafData = {
                    character: JSON.parse(await characterFile.async('string')),
                    scenario: JSON.parse(await scenarioFile.async('string')),
                };
                let imageBlob = null;
                if (!skipImages && imageFile) {
                    const imageFileBlob = await imageFile.async('blob');
                    imageBlob = await ImageProcessor.processImageAsBlob(imageFileBlob);
                }
                // Check for Background Image (BYAF Only)
                let backgroundImageBlob = null;
                const bgFile = zip.file("images/story_background.png");
                if (bgFile) {
                    try {
                        const bgData = await bgFile.async('blob');
                        backgroundImageBlob = await ImageProcessor.processImageAsBlob(bgData);
                    } catch (e) { console.warn("Failed to extract BYAF background:", e); }
                }

                return { story: this._convertBYAFtoEllipsis(byafData), imageBlob };
            },

            /**
             * Converts BYAF data to Ellipsis format.
             * @param {Object} byafData - The BYAF data.
             * @returns {Object} - The Ellipsis story object.
             * @private
             */
            _convertBYAFtoEllipsis(byafData) {
                const { character, scenario } = byafData;
                const story = this._createEmptyEllipsisStory();
                story.name = character.displayName || character.name || "Imported Character";
                story.tags = character.tags || [];

                const userChar = { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "User.", model_instructions: "Act as User.", is_user: true, is_active: true, image_url: '', tags: [], is_narrator: false };
                const aiChar = {
                    id: UTILITY.uuid(),
                    name: character.displayName || character.name,
                    description: character.persona || "",
                    short_description: (character.persona || "").split('.')[0] + '.',
                    model_instructions: scenario.formattingInstructions || "Act as {character}.",
                    image_url: '',
                    extra_portraits: [],
                    tags: character.tags || [],
                    is_user: false,
                    is_active: true,
                    is_narrator: false
                };

                story.characters = [userChar, aiChar];
                const nameToId = {
                    'user': userChar.id,
                    'character': aiChar.id,
                    [userChar.name.toLowerCase()]: userChar.id,
                    [aiChar.name.toLowerCase()]: aiChar.id
                };

                // Helper to get or create character ID for a name
                const resolveCharacter = (name) => {
                    const lower = name.toLowerCase();
                    if (nameToId[lower]) return nameToId[lower];

                    // Create Ghost
                    const newId = UTILITY.uuid();
                    const newChar = {
                        id: newId, name: name, description: "Imported character.", short_description: "Imported.",
                        model_instructions: `Act as ${name}.`, image_url: '', tags: [], is_user: false, is_active: true, is_narrator: false
                    };
                    story.characters.push(newChar);
                    nameToId[lower] = newId;
                    return newId;
                };

                // Parse Chat History / Examples
                const parseMessages = (msgs, isHidden) => {
                    const output = [];
                    if (!msgs) return output;

                    // BYAF/SillyTavern text format often is "Name: Message" or just Message
                    // If it's structured data (BYAF), it might have characterID or name fields?
                    // Standard BYAF scenario.exampleMessages is array of { text: "..." }

                    msgs.forEach(msg => {
                        let content = msg.text || "";
                        let charId = aiChar.id; // Default to main char

                        // Regex for "Name: Content" patterns common in logs
                        // We look for the start of the string
                        const match = content.match(/^(.+?):/);
                        if (match) {
                            const name = match[1].trim();
                            // Special BYAF placeholders
                            if (name === '#{user}' || name === '{{user}}') charId = userChar.id;
                            else if (name === '#{character}' || name === '{{char}}') charId = aiChar.id;
                            else {
                                // It's a named speaker (e.g. "Alice: Hello")
                                charId = resolveCharacter(name);
                            }
                            // Strip the prefix for clean display
                            content = content.substring(match[0].length).trim();
                        }

                        output.push({
                            character_id: charId,
                            content: content,
                            type: 'chat',
                            emotion: 'neutral',
                            timestamp: new Date().toISOString(),
                            isHidden: isHidden
                        });
                    });
                    return output;
                };

                const exampleDialogue = parseMessages(scenario.exampleMessages, true);

                // Static Entries
                const staticEntries = [];
                if (scenario.narrative) {
                    staticEntries.push({ id: UTILITY.uuid(), title: "Starting Scenario", content: scenario.narrative });
                }

                // Scenarios
                const activeIDs = story.characters.map(c => c.id);
                const firstMes = (scenario.firstMessages && scenario.firstMessages[0]?.text) || `The story of ${aiChar.name} begins.`;

                story.scenarios.push({
                    id: UTILITY.uuid(),
                    name: "Imported Start",
                    message: firstMes,
                    active_character_ids: activeIDs,
                    dynamic_entries: [], // (Populate from loreItems if present)
                    example_dialogue: exampleDialogue,
                    static_entries: staticEntries,
                    worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] },
                    prompts: UTILITY.getDefaultSystemPrompts()
                });

                // Narrative
                const narrative = this._createEmptyEllipsisNarrative("Imported Chat");
                narrative.active_character_ids = activeIDs;
                narrative.state.static_entries = JSON.parse(JSON.stringify(staticEntries));
                narrative.state.chat_history.push(...exampleDialogue);

                if (firstMes) {
                    narrative.state.chat_history.push({
                        character_id: aiChar.id,
                        content: firstMes,
                        type: 'chat',
                        emotion: 'neutral',
                        timestamp: new Date().toISOString(),
                        isHidden: false
                    });
                    narrative.state.messageCounter = 1;
                }

                // Lore Items (Dynamic Entries)
                if (character.loreItems) {
                    story.dynamic_entries = character.loreItems.map(item => ({
                        id: UTILITY.uuid(),
                        title: item.key || "Lore",
                        triggers: item.key || "",
                        content_fields: [item.value || ""],
                        current_index: 0,
                        triggered_at_turn: null
                    }));
                }

                story.narratives.push(narrative);
                return story;
            },

            /**
             * Converts V2 data to Ellipsis format.
             * @param {Object} v2Data - The V2 data.
             * @returns {Object} - The Ellipsis story object.
             * @private
             */
            _convertV2toEllipsis(v2Data) {
                const story = this._createEmptyEllipsisStory();
                story.name = v2Data.name || "Imported Character";
                story.tags = v2Data.tags || [];
                const userChar = { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "The main character.", model_instructions: "Write a response for {user} in a creative and descriptive style.", is_user: true, is_active: true, image_url: '', tags: [], is_narrator: false };
                const aiChar = {
                    id: UTILITY.uuid(),
                    name: v2Data.name || "Imported Character",
                    ...UTILITY.getDefaultStorySettings(),
                    description: (v2Data.description || "").replace(/{{char}}/g, v2Data.name || "Imported Character").replace(/{{user}}/g, "{user}"),
                    short_description: (v2Data.description || "").split('.')[0] + '.',
                    model_instructions: (v2Data.system_prompt || "Act as {character}. Be descriptive and engaging.").replace(/{{char}}/g, "{character}").replace(/{{user}}/g, "{user}"),
                    image_url: '',
                    extra_portraits: [],
                    tags: v2Data.tags || [],
                    is_user: false,
                    is_active: true,
                    is_narrator: false
                };
                story.characters = [userChar, aiChar];
                const activeIDs = [userChar.id, aiChar.id];
                if (v2Data.character_book && v2Data.character_book.entries) {
                    story.dynamic_entries = v2Data.character_book.entries.map(entry => ({
                        id: UTILITY.uuid(),
                        title: (entry.keys || []).join(', ') || "Imported Lore",
                        triggers: (entry.keys || []).join(', '),
                        content_fields: [entry.content || ""],
                        current_index: 0,
                        triggered_at_turn: null
                    }));
                }
                const promptSnapshot = {
                    system_prompt: story.system_prompt,
                    event_master_base_prompt: story.event_master_base_prompt,
                    prompt_persona_gen: story.prompt_persona_gen,
                    prompt_world_map_gen: story.prompt_world_map_gen,
                    prompt_location_gen: story.prompt_location_gen,
                    prompt_entry_gen: story.prompt_entry_gen,
                    prompt_location_memory_gen: story.prompt_location_memory_gen,
                    font: story.font,
                    bubbleOpacity: story.bubbleOpacity,
                    chatTextColor: story.chatTextColor
                };
                const exampleDialogue = [];
                if (v2Data.mes_example) {
                    const charNameIdMap = { '{{user}}': userChar.id, '{{char}}': aiChar.id };
                    const regex = /({{user}}|{{char}}):([\s\S]*?)(?={{user}}:|{{char}}:|$)/g;
                    let cleanedText = v2Data.mes_example.replace(/<START>/g).trim();
                    for (const match of cleanedText.matchAll(regex)) {
                        const speakerPrefix = match[1];
                        const messageContent = match[2].trim().replace(/{{char}}/g, aiChar.name).replace(/{{user}}/g, "{user}");
                        const speakerId = charNameIdMap[speakerPrefix];
                        if (speakerId && messageContent) {
                            exampleDialogue.push({
                                character_id: speakerId,
                                content: messageContent,
                                type: 'chat',
                                isHidden: true,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                }
                const allGreetings = [v2Data.first_mes || `The story of ${aiChar.name} begins.`];
                if (Array.isArray(v2Data.alternate_greetings)) allGreetings.push(...v2Data.alternate_greetings);
                story.scenarios = [];
                allGreetings.forEach((greeting, index) => {
                    const scenarioName = index === 0 ? "Imported Start" : `Alternate Start ${index}`;
                    const messageContent = (greeting || "").replace(/{{char}}/g, aiChar.name).replace(/{{user}}/g, "{user}");
                    story.scenarios.push({
                        id: UTILITY.uuid(),
                        name: scenarioName,
                        message: messageContent,
                        active_character_ids: activeIDs,
                        dynamic_entries: JSON.parse(JSON.stringify(story.dynamic_entries)),
                        prompts: JSON.parse(JSON.stringify(promptSnapshot)),
                        example_dialogue: JSON.parse(JSON.stringify(exampleDialogue)),
                        static_entries: [],
                        worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] }
                    });
                });
                const narrative = this._createEmptyEllipsisNarrative("Imported Chat");
                narrative.active_character_ids = activeIDs;
                if (exampleDialogue.length > 0) narrative.state.chat_history.push(...JSON.parse(JSON.stringify(exampleDialogue)));
                const firstScenario = story.scenarios[0];
                if (firstScenario && firstScenario.message) {
                    narrative.state.chat_history.push({
                        character_id: aiChar.id,
                        content: firstScenario.message,
                        type: 'chat',
                        isHidden: false,
                        timestamp: new Date().toISOString()
                    });
                    narrative.state.messageCounter = 1;
                }
                story.narratives.push(narrative);
                return story;
            },

            /**
             * Converts Ellipsis format to V2 data.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @returns {Object} - The V2 data object.
             * @private
             */
            _convertEllipsistoV2(story, narrative, primaryCharId) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                const activeIDs = narrative.active_character_ids || story.characters.map(c => c.id);
                const otherAiChars = story.characters.filter(c => !c.is_user && c.id !== primaryCharId && activeIDs.includes(c.id));
                if (!primaryChar) throw new Error("Primary character not found.");
                let fullDescription = primaryChar.description || "";
                if (otherAiChars.length > 0) {
                    fullDescription += "\n\n--- Other Characters ---\n";
                    otherAiChars.forEach(char => {
                        fullDescription += `\nName: ${char.name || 'Unnamed Character'}\nDescription: ${char.description || '(No description)'}\n`;
                    });
                }
                const bookEntries = [];
                let insertionCounter = 0;
                (story.dynamic_entries || []).forEach(entry => {
                    bookEntries.push({
                        keys: (entry.triggers || entry.title || "").split(',').map(t => t.trim()).filter(Boolean),
                        content: entry.content || "",
                        enabled: true, insertion_order: insertionCounter++, extensions: {}, case_sensitive: false,
                    });
                });
                (narrative.state.worldMap?.grid || []).filter(loc => loc.name).forEach(loc => {
                    bookEntries.push({
                        keys: [loc.name],
                        content: `Location Description: ${loc.description || '(No description)'}\n\nLocation Prompt: ${loc.prompt || '(No prompt)'}`,
                        enabled: true, insertion_order: insertionCounter++, extensions: {}, case_sensitive: false,
                    });
                });
                const currentLocCoords = narrative.state.worldMap?.currentLocation;
                if (currentLocCoords) {
                    const currentLocData = narrative.state.worldMap.grid.find(l => l.coords.x === currentLocCoords.x && l.coords.y === currentLocCoords.y);
                    if (currentLocData && currentLocData.local_static_entries) {
                        currentLocData.local_static_entries.forEach(entry => {
                            bookEntries.push({
                                keys: [(entry.title || "Local Lore").toLowerCase()],
                                content: entry.content || "",
                                enabled: true, insertion_order: insertionCounter++, extensions: {}, case_sensitive: false,
                            });
                        });
                    }
                }
                const replacePlaceholdersV2 = (text) => {
                    if (typeof text !== 'string') return '';
                    let processed = text.replace(/{character}/gi, '{{char}}');
                    processed = processed.replace(/{user}/gi, '{{user}}');
                    processed = processed.replace(/\{\{char\}\}/gi, '{{char}}');
                    processed = processed.replace(/\{\{user\}\}/gi, '{{user}}');
                    return processed;
                }
                const mesExample = (narrative.state.chat_history || []).filter(m => m.isHidden && m.type === 'chat').map(m => {
                    const speaker = story.characters.find(c => c.id === m.character_id);
                    if (speaker) {
                        const prefix = speaker.is_user ? '{{user}}:' : '{{char}}:';
                        return `${prefix}\n${replacePlaceholdersV2(m.content)}`;
                    }
                    return replacePlaceholdersV2(m.content);
                }).join('\n');
                const firstMessageEntry = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
                const firstMes = firstMessageEntry ? replacePlaceholdersV2(firstMessageEntry.content) : replacePlaceholdersV2(`The story of ${primaryChar.name} begins.`);
                const scenarioText = (narrative.state.static_entries || []).map(entry => `[${entry.title || 'Untitled Entry'}]\n${entry.content || '(No content)'}`).join('\n\n---\n\n');
                const v2Data = {
                    name: primaryChar.name || "",
                    description: replacePlaceholdersV2(fullDescription),
                    personality: "",
                    scenario: replacePlaceholdersV2(scenarioText),
                    first_mes: firstMes,
                    mes_example: mesExample,
                    creator_notes: "",
                    system_prompt: replacePlaceholdersV2(primaryChar.model_instructions || ""),
                    post_history_instructions: "",
                    alternate_greetings: [],
                    character_book: {
                        name: "", description: "", scan_depth: 100, token_budget: 2048, recursive_scanning: false, extensions: {}, entries: bookEntries
                    },
                    tags: primaryChar.tags || [],
                    creator: "", character_version: "", extensions: {}
                };
                return { spec: 'chara_card_v2', spec_version: '2.0', data: v2Data };
            },

            /**
             * Converts Ellipsis format to BYAF data.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @param {string} [imageFilename=null] - The filename of the character image.
             * @returns {Object} - The BYAF data object.
             * @private
             */
            /**
             * Converts Ellipsis format to BYAF data.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @param {string} [imageFilename=null] - The filename of the character image.
             * @returns {Object} - The BYAF data object.
             * @private
             */
            /**
             * Converts an Ellipsis story object to the BYAF (Backyard AI Format) structure.
             * @param {Object} story - The story object.
             * @param {Object} narrative - The narrative object.
             * @param {string} primaryCharId - The ID of the primary character.
             * @param {string|null} [imageFilename=null] - Optional filename for the character image.
             * @returns {Object} The BYAF manifest, character, and scenario objects.
             * @private
             */
            _convertEllipsistoBYAF(story, narrative, primaryCharId, imageFilename = null) {
                const primaryChar = story.characters.find(c => c.id === primaryCharId);
                if (!primaryChar) return { manifest: {}, character: {}, scenario: {} };
                const now = new Date().toISOString();
                const loreItems = [
                    ...(story.dynamic_entries || []),
                    ...(narrative.state.worldMap?.grid || []).filter(loc => loc.name).map(loc => ({
                        id: UTILITY.uuid(), title: loc.name, triggers: loc.name, content: `Description: ${loc.description || '(no description)'}\n\nPrompt: ${loc.prompt || '(no prompt)'}`
                    }))
                ].map((entry, index) => ({
                    id: entry.id || UTILITY.uuid(),
                    order: Math.random().toString(36).substring(2, 12),
                    key: entry.triggers || entry.title || `Imported Lore ${index + 1}`,
                    value: entry.content || "",
                    createdAt: entry.created_date || now,
                    updatedAt: entry.last_modified || now
                }));
                const character = {
                    schemaVersion: 1, name: primaryChar.name || "", displayName: primaryChar.name || "",
                    images: imageFilename ? [{ path: `images/${imageFilename}`, label: "" }] : [],
                    createdAt: primaryChar.created_date || now, updatedAt: primaryChar.last_modified || now,
                    id: primaryChar.id, isNSFW: false, persona: primaryChar.description || "", loreItems: loreItems, tags: primaryChar.tags || []
                };
                const firstMessageEntry = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
                const firstMessageText = firstMessageEntry ? firstMessageEntry.content : `The story of ${primaryChar.name} begins.`;
                const exampleMessages = (narrative.state.chat_history || []).filter(m => m.isHidden && m.type === 'chat').map(m => {
                    const speaker = story.characters.find(c => c.id === m.character_id);
                    let byafFormattedText = m.content || "";
                    let msgCharId = null;
                    if (speaker) {
                        if (speaker.is_user) {
                            byafFormattedText = `#{user}:\n${byafFormattedText}`;
                        } else if (speaker.id === primaryChar.id) {
                            byafFormattedText = `#{character}:\n${byafFormattedText}`;
                            msgCharId = primaryChar.id;
                        }
                    }
                    return { text: byafFormattedText, characterID: msgCharId };
                });
                const scenario = {
                    schemaVersion: 1, title: narrative.name || "Exported Scenario", canDeleteExampleMessages: true, exampleMessages: exampleMessages,
                    model: "", temperature: 1.0, topP: 0.9, minP: 0.1,
                    firstMessages: [{ text: firstMessageText, characterID: primaryChar.id }],
                    formattingInstructions: primaryChar.model_instructions || "", grammar: "", repeatPenalty: 1.05, repeatLastN: 256, topK: 30, minPEnabled: false,
                    narrative: (narrative.state.static_entries || []).find(e => e.title === "Starting Scenario")?.content || "",
                    promptTemplate: null, messages: []
                };
                const manifest = {
                    schemaVersion: 1, createdAt: now, characters: [`characters/${primaryChar.id}/character.json`], scenarios: [`scenarios/scenario1.json`]
                };
                return { manifest, character, scenario };
            },

            /**
             * Creates an empty Ellipsis story object.
             * @returns {Object}
             * @private
             */
            _createEmptyEllipsisStory() {
                return {
                    id: UTILITY.uuid(), name: "New Imported Story", last_modified: new Date().toISOString(), created_date: new Date().toISOString(),
                    ...UTILITY.getDefaultApiSettings(), ...UTILITY.getDefaultUiSettings(), ...UTILITY.getDefaultSystemPrompts(),
                    characters: [], dynamic_entries: [], scenarios: [], narratives: []
                };
            },

            /**
             * Creates an empty Ellipsis narrative object.
             * @param {string} name - The narrative name.
             * @returns {Object}
             * @private
             */
            _createEmptyEllipsisNarrative(name) {
                return {
                    id: UTILITY.uuid(), name: name, last_modified: new Date().toISOString(),
                    state: {
                        chat_history: [], messageCounter: 0, static_entries: [],
                        worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] }
                    }
                };
            },

            _b64_to_utf8(str) { return decodeURIComponent(escape(atob(str))); },
            _utf8_to_b64(str) { return btoa(unescape(encodeURIComponent(str))); },

            /**
             * Extracts V2 data from a PNG buffer.
             * @param {ArrayBuffer} arrayBuffer - The PNG buffer.
             * @returns {Promise<string|null>} - The extracted data string or null.
             * @private
             */
            async _extractV2Data(arrayBuffer) {
                const dataView = new DataView(arrayBuffer);
                const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
                for (let i = 0; i < PNG_SIGNATURE.length; i++) { if (dataView.getUint8(i) !== PNG_SIGNATURE[i]) throw new Error("Invalid PNG signature."); }
                let offset = 8;
                while (offset < arrayBuffer.byteLength) {
                    const length = dataView.getUint32(offset);
                    const type = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer, offset + 4, 4));
                    if (['tEXt', 'zTXt'].includes(type)) {
                        let keywordEnd = -1;
                        for (let i = 0; i < length; i++) { if (dataView.getUint8(offset + 8 + i) === 0) { keywordEnd = i; break; } }
                        if (keywordEnd !== -1) {
                            const keyword = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset + 8, keywordEnd));
                            if (keyword === 'chara') {
                                if (type === 'tEXt') return new TextDecoder().decode(new Uint8Array(arrayBuffer, offset + 8 + keywordEnd + 1, length - keywordEnd - 1));
                                if (type === 'zTXt') return new TextDecoder().decode(pako.inflate(new Uint8Array(arrayBuffer, offset + 8 + keywordEnd + 2, length - keywordEnd - 2)));
                            }
                        }
                    }
                    if (type === 'IEND') break;
                    offset += 12 + length;
                }
                return null;
            },

            /**
             * Injects V2 data into a PNG buffer.
             * @param {ArrayBuffer} imageBuffer - The source PNG buffer.
             * @param {Object} v2Object - The V2 data object.
             * @returns {Promise<Uint8Array>} - The new PNG buffer.
             * @private
             */
            async _injectDataIntoPng(imageBuffer, v2Object) {
                const _CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); return c; });
                const _crc32 = (bytes) => { let crc = -1; for (const byte of bytes) crc = (crc >>> 8) ^ _CRC_TABLE[(crc ^ byte) & 0xff]; return (crc ^ -1) >>> 0; };
                const jsonDataString = JSON.stringify(v2Object);
                const base64Data = this._utf8_to_b64(jsonDataString);
                const base64Bytes = new TextEncoder().encode(base64Data);
                const compressedData = pako.deflate(base64Bytes);
                const keyword = 'chara';
                const keywordBytes = new TextEncoder().encode(keyword);
                const chunkData = new Uint8Array(keywordBytes.length + 1 + 1 + compressedData.length);
                chunkData.set(keywordBytes);
                chunkData[keywordBytes.length] = 0;
                chunkData[keywordBytes.length + 1] = 0;
                chunkData.set(compressedData, keywordBytes.length + 2);
                const chunkType = new TextEncoder().encode('zTXt');
                const dataForCrc = new Uint8Array(chunkType.length + chunkData.length);
                dataForCrc.set(chunkType);
                dataForCrc.set(chunkData, chunkType.length);
                const crc = _crc32(dataForCrc);
                const originalPng = new Uint8Array(imageBuffer);
                const dataView = new DataView(originalPng.buffer);
                let iendOffset = -1;
                let offset = 8;
                while (offset < originalPng.length) {
                    const length = dataView.getUint32(offset);
                    const type = String.fromCharCode.apply(null, originalPng.slice(offset + 4, offset + 8));
                    if (type === 'IEND') {
                        iendOffset = offset;
                        break;
                    }
                    offset += 12 + length;
                }
                if (iendOffset === -1) throw new Error('Could not find IEND chunk.');
                const newChunkLength = chunkData.length;
                const newPngSize = iendOffset + (12 + newChunkLength) + 12;
                const newPng = new Uint8Array(newPngSize);
                const newPngView = new DataView(newPng.buffer);
                newPng.set(originalPng.slice(0, iendOffset));
                let writeOffset = iendOffset;
                newPngView.setUint32(writeOffset, newChunkLength);
                writeOffset += 4;
                newPng.set(chunkType, writeOffset);
                writeOffset += chunkType.length;
                newPng.set(chunkData, writeOffset);
                writeOffset += chunkData.length;
                newPngView.setUint32(writeOffset, crc);
                writeOffset += 4;
                newPng.set(originalPng.slice(iendOffset, iendOffset + 12), writeOffset);
                return new Blob([newPng], { type: 'image/png' });
            }
        };