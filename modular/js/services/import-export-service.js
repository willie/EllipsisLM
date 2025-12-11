/**
 * ImportExportService Module
 * Manages all data conversion and file handling for importing and exporting stories.
 */
const ImportExportService = {
    // --- Public High-Level API ---

    /**
     * Main entry point for file imports. Determines file type and routes to the correct parser.
     * @param {File} file - The uploaded file object.
     * @param {boolean} [skipImages=false] - If true, image processing will be skipped to save storage space.
     * @returns {Promise<object>} A promise that resolves with a fully formed Ellipsis story object.
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
     * Exports a narrative to a native Ellipsis JSON file.
     * @param {object} story - The story object containing the narrative.
     * @returns {Blob} A Blob containing the JSON data.
     */
    exportStoryAsJSON(story) {
        const storyExport = JSON.parse(JSON.stringify(story));
        return new Blob([JSON.stringify(storyExport, null, 2)], { type: 'application/json' });
    },

    /**
     * Exports a narrative to the V2 PNG Card format.
     * @param {object} story - The story object.
     * @param {object} narrative - The narrative to export.
     * @param {string} primaryCharId - The ID of the character to feature on the card.
     * @returns {Promise<Blob>} A promise that resolves with a Blob of the final PNG file.
     */
    async exportStoryAsV2(story, narrative, primaryCharId) {
        const primaryChar = story.characters.find(c => c.id === primaryCharId);
        if (!primaryChar) {
             throw new Error("V2 export requires a selected primary character.");
        }

        let originalImageBlob = null;

        try {
            originalImageBlob = await DBService.getImage(primaryChar.id);
        } catch (dbError) {
            console.warn(`Could not get image from IDB for ${primaryChar.id}:`, dbError);
        }
        if (!originalImageBlob && primaryChar.image_url && !primaryChar.image_url.startsWith('local_idb_')) {
            try {
                const response = await fetch(primaryChar.image_url);
                if (response.ok) {
                    originalImageBlob = await response.blob();
                } else {
                     console.warn(`Failed to fetch legacy image URL for ${primaryChar.id}: ${response.statusText}`);
                }
            } catch (fetchError) {
                console.warn(`Error fetching legacy image URL for ${primaryChar.id}:`, fetchError);
            }
        }

        if (!originalImageBlob) {
            throw new Error("V2 export requires the primary character to have a valid image (either uploaded locally or via URL).");
        }

        let pngBlob;
        try {
            if (originalImageBlob.type === 'image/png') {
                pngBlob = originalImageBlob;
                console.log("Image is already PNG, skipping conversion.");
            } else {
                console.log(`Converting image from ${originalImageBlob.type} to PNG...`);
                pngBlob = await ImageProcessor.convertBlobToPNGBlob(originalImageBlob);
            }
        } catch (conversionError) {
            console.error("PNG Conversion failed:", conversionError);
            throw new Error("Failed to convert character image to PNG format for export.");
        }

        const v2Object = this._convertEllipsistoV2(story, narrative, primaryCharId);
        const pngImageBuffer = await pngBlob.arrayBuffer();
        return this._injectDataIntoPng(pngImageBuffer, v2Object);
    },

    /**
     * Exports a narrative to the BYAF format.
     * @param {object} story - The story object.
     * @param {object} narrative - The narrative to export.
     * @param {string} primaryCharId - The ID of the primary character.
     * @returns {Promise<Blob>} A promise that resolves with a Blob of the final .byaf (zip) file.
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
                console.log(`BYAF Export: Found local image (${imageBlob.type}), using extension: ${imageExtension}`);
            }
        } catch (dbError) {
            console.warn(`Could not get image from IDB for BYAF export ${primaryChar.id}:`, dbError);
        }

        if (!imageBlob && primaryChar.image_url && !primaryChar.image_url.startsWith('local_idb_')) {
            try {
                const response = await fetch(primaryChar.image_url);
                if (response.ok) {
                    const blob = await response.blob();
                    imageBlob = blob;
                    let determinedExt = 'png';
                    const contentType = response.headers.get('content-type');
                    if (contentType) {
                        const typeParts = contentType.split('/');
                        if (typeParts.length === 2 && ['png', 'jpeg', 'jpg', 'webp'].includes(typeParts[1])) {
                            determinedExt = typeParts[1] === 'jpeg' ? 'jpg' : typeParts[1];
                        }
                    } else {
                        const urlParts = primaryChar.image_url.split('.').pop()?.toLowerCase();
                        if (urlParts && ['png', 'jpg', 'jpeg', 'webp'].includes(urlParts)) {
                            determinedExt = urlParts === 'jpeg' ? 'jpg' : urlParts;
                        }
                    }
                    imageExtension = determinedExt;
                    console.log(`BYAF Export: Fetched legacy image (${contentType || 'unknown type'}), using extension: ${imageExtension}`);
                } else {
                    console.warn(`Failed to fetch legacy image URL for BYAF export ${primaryChar.id}: ${response.statusText}`);
                }
            } catch (fetchError) {
                console.warn(`Error fetching legacy image URL for BYAF export ${primaryChar.id}:`, fetchError);
            }
        }

        if (imageBlob) {
            imageFilename = `${primaryChar.id}.${imageExtension}`;
        }

        const byafArchiveData = this._convertEllipsistoBYAF(story, narrative, primaryCharId, imageFilename);

        if (!byafArchiveData || !byafArchiveData.manifest || !byafArchiveData.character || !byafArchiveData.scenario) {
            throw new Error("Failed to generate BYAF data structure (converter returned invalid data).");
        }

        const zip = new JSZip();

        zip.file("manifest.json", JSON.stringify(byafArchiveData.manifest, null, 2));

        const charFolder = zip.folder(`characters/${primaryChar.id}`);
        charFolder.file("character.json", JSON.stringify(byafArchiveData.character, null, 2));

        if (imageBlob && imageFilename) {
            charFolder.file(`images/${imageFilename}`, imageBlob);
            console.log(`BYAF Export: Added image blob as images/${imageFilename}`);
        } else {
            console.log("BYAF Export: No image blob found or added.");
        }

        zip.file(`scenarios/scenario1.json`, JSON.stringify(byafArchiveData.scenario, null, 2));

        return zip.generateAsync({ type: "blob" });
    },


    // --- Internal Parsing & Data Mapping Logic ---

    async _parseEllipsisJSON(file) {
        const jsonString = await file.text();
        const story = JSON.parse(jsonString);

        if (!story.id || !story.name || !story.characters) {
            throw new Error("Invalid Ellipsis JSON file. Missing required fields.");
        }
        story.id = UTILITY.uuid();
        (story.characters || []).forEach(c => c.id = UTILITY.uuid());
        (story.scenarios || []).forEach(s => s.id = UTILITY.uuid());
        (story.narratives || []).forEach(n => {
            n.id = UTILITY.uuid();
            (n.state?.static_entries || []).forEach(e => e.id = UTILITY.uuid());
        });
        (story.dynamic_entries || []).forEach(e => e.id = UTILITY.uuid());

        return { story, imageBlob: null };
    },

    async _parseV2Card(file, skipImages) {
        const arrayBuffer = await file.arrayBuffer();
        const v2DataString = await this._extractV2Data(arrayBuffer);
        if (!v2DataString) throw new Error("No character data found in PNG file.");

        const v2RawData = JSON.parse(this._b64_to_utf8(v2DataString));
        const v2Data = v2RawData.data || v2RawData;

        let imageBlob = null;
        if (!skipImages) {
            imageBlob = await ImageProcessor.processImageAsBlob(file);
        }
        return { story: this._convertV2toEllipsis(v2Data), imageBlob };
    },

    async _parseBYAF(file, skipImages) {
        const zip = await JSZip.loadAsync(file);

        const characterFile = zip.file(/character\.json$/i)[0];
        const scenarioFile = zip.file(/scenario\d*\.json$/i)[0];
        const imageFile = zip.file(/\.png$/i)[0];

        if (!characterFile || !scenarioFile) {
            throw new Error("Archive is missing character.json or scenario.json.");
        }

        const byafData = {
            character: JSON.parse(await characterFile.async('string')),
            scenario: JSON.parse(await scenarioFile.async('string')),
        };

        let imageBlob = null;
        if (!skipImages && imageFile) {
            const imageFileBlob = await imageFile.async('blob');
            imageBlob = await ImageProcessor.processImageAsBlob(imageFileBlob);
        }
        return { story: this._convertBYAFtoEllipsis(byafData), imageBlob };
    },

    // --- Data Conversion Helpers (Import) ---

    _convertBYAFtoEllipsis(byafData) {
        const { character, scenario } = byafData;
        const story = this._createEmptyEllipsisStory();
        story.name = character.displayName || character.name || "Imported Character";
        story.tags = character.tags || [];

        const userChar = { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "The main character.", model_instructions: "Write a response for {character} in a creative and descriptive style.", is_user: true, is_active: true, image_url: '', tags:[], is_narrator: false };
        const aiChar = {
            id: UTILITY.uuid(),
            name: character.displayName || character.name,
            description: character.persona || "",
            short_description: (character.persona || "").split('.')[0] + '.',
            model_instructions: scenario.formattingInstructions || "Act as {character}. Be descriptive and engaging.",
            image_url: '',
            extra_portraits: [],
            tags: character.tags || [],
            is_user: false,
            is_active: true,
            is_narrator: false
        };
        story.characters = [userChar, aiChar];

        const activeIDs = [userChar.id, aiChar.id];

        if (character.loreItems) {
            story.dynamic_entries = character.loreItems.map(item => ({
                id: UTILITY.uuid(),
                title: item.key || "Imported Lore",
                triggers: item.key || "",
                content_fields: [item.value || ""],
                current_index: 0,
                triggered_at_turn: null
            }));
        }

        const exampleDialogue = [];
        if (scenario.exampleMessages && scenario.exampleMessages.length > 0) {
            const charNameIdMap = { '#{character}:': aiChar.id, '#{user}:': userChar.id };
            const regex = /(#\{(?:character|user)\}:)([\s\S]*?)(?=#\{|$)/g;

            scenario.exampleMessages.forEach(msg => {
                const exampleText = msg.text || "";
                for (const match of exampleText.matchAll(regex)) {
                    const speakerPrefix = match[1];
                    const messageContent = match[2].trim();
                    const speakerId = charNameIdMap[speakerPrefix];

                    if (speakerId && messageContent) {
                        exampleDialogue.push({
                            character_id: speakerId,
                            content: messageContent,
                            type: 'chat',
                            emotion: 'neutral',
                            timestamp: new Date().toISOString(),
                            isHidden: true
                        });
                    }
                }
            });
        }

        const staticEntries = [];
        if (scenario.narrative) {
            staticEntries.push({ id: UTILITY.uuid(), title: "Starting Scenario", content: scenario.narrative });
        }

        const firstMes = (scenario.firstMessages && scenario.firstMessages[0]?.text) || `The story of ${aiChar.name} begins.`;
        const newScenario = {
            id: UTILITY.uuid(),
            name: "Imported Start",
            message: firstMes,
            active_character_ids: activeIDs,
            dynamic_entries: JSON.parse(JSON.stringify(story.dynamic_entries)),
            example_dialogue: JSON.parse(JSON.stringify(exampleDialogue)),
            static_entries: staticEntries,
            worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: { x: null, y: null }, path: [] },
            prompts: UTILITY.getDefaultSystemPrompts()
        };
        story.scenarios.push(newScenario);

        const narrative = this._createEmptyEllipsisNarrative("Imported Chat");
        narrative.active_character_ids = activeIDs;
        narrative.state.static_entries = JSON.parse(JSON.stringify(staticEntries));

        if (exampleDialogue.length > 0) {
            narrative.state.chat_history.push(...JSON.parse(JSON.stringify(exampleDialogue)));
        }

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

        story.narratives.push(narrative);
        return story;
    },

    _convertV2toEllipsis(v2Data) {
        const story = this._createEmptyEllipsisStory();
        story.name = v2Data.name || "Imported Character";
        story.tags = v2Data.tags || [];

        const userChar = { id: UTILITY.uuid(), name: "You", description: "The protagonist.", short_description: "The main character.", model_instructions: "Write a response for {user} in a creative and descriptive style.", is_user: true, is_active: true, image_url: '', tags:[], is_narrator: false };
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
        if (Array.isArray(v2Data.alternate_greetings)) {
            allGreetings.push(...v2Data.alternate_greetings);
        }

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

        if (exampleDialogue.length > 0) {
            narrative.state.chat_history.push(...JSON.parse(JSON.stringify(exampleDialogue)));
        }

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

    // --- Data Conversion Helpers (Export) ---

    _convertEllipsistoV2(story, narrative, primaryCharId) {
        const primaryChar = story.characters.find(c => c.id === primaryCharId);
        const userChar = story.characters.find(c => c.is_user);

        const activeIDs = narrative.active_character_ids || story.characters.map(c => c.id);

        const otherAiChars = story.characters.filter(c =>
            !c.is_user &&
            c.id !== primaryCharId &&
            activeIDs.includes(c.id)
        );

        if (!primaryChar) throw new Error("Primary character not found during V2 conversion.");

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
                enabled: true,
                insertion_order: insertionCounter++,
                extensions: {},
                case_sensitive: false,
            });
        });

        (narrative.state.worldMap?.grid || [])
            .filter(loc => loc.name)
            .forEach(loc => {
                bookEntries.push({
                    keys: [loc.name],
                    content: `Location Description: ${loc.description || '(No description)'}\n\nLocation Prompt: ${loc.prompt || '(No prompt)'}`,
                    enabled: true,
                    insertion_order: insertionCounter++,
                    extensions: {},
                    case_sensitive: false,
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
                        enabled: true,
                        insertion_order: insertionCounter++,
                        extensions: {},
                        case_sensitive: false,
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

        const mesExample = (narrative.state.chat_history || [])
            .filter(m => m.isHidden && m.type === 'chat')
            .map(m => {
                const speaker = story.characters.find(c => c.id === m.character_id);
                if (speaker) {
                    const prefix = speaker.is_user ? '{{user}}:' : '{{char}}:';
                    return `${prefix}\n${replacePlaceholdersV2(m.content)}`;
                }
                return replacePlaceholdersV2(m.content);
            })
            .join('\n');

        const firstMessageEntry = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
        const firstMes = firstMessageEntry ? replacePlaceholdersV2(firstMessageEntry.content) : replacePlaceholdersV2(`The story of ${primaryChar.name} begins.`);

        const scenarioText = (narrative.state.static_entries || [])
            .map(entry => `[${entry.title || 'Untitled Entry'}]\n${entry.content || '(No content)'}`)
            .join('\n\n---\n\n');

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
                name: "",
                description: "",
                scan_depth: 100,
                token_budget: 2048,
                recursive_scanning: false,
                extensions: {},
                entries: bookEntries
            },
            tags: primaryChar.tags || [],
            creator: "",
            character_version: "",
            extensions: {}
        };

        const v2Object = {
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: v2Data
        };

        return v2Object;
    },

    _convertEllipsistoBYAF(story, narrative, primaryCharId, imageFilename = null) {
        const primaryChar = story.characters.find(c => c.id === primaryCharId);
        const userChar = story.characters.find(c => c.is_user);

        if (!primaryChar) {
            console.error("Primary character not found in _convertEllipsistoBYAF");
            return { manifest: {}, character: {}, scenario: {} };
        }
        const now = new Date().toISOString();

        const loreItems = [
            ...(story.dynamic_entries || []),
            ...(narrative.state.worldMap?.grid || [])
                .filter(loc => loc.name)
                .map(loc => ({
                    id: UTILITY.uuid(),
                    title: loc.name,
                    triggers: loc.name,
                    content: `Description: ${loc.description || '(no description)'}\n\nPrompt: ${loc.prompt || '(no prompt)'}`
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
            schemaVersion: 1,
            name: primaryChar.name || "",
            displayName: primaryChar.name || "",
            images: imageFilename ? [{ path: `images/${imageFilename}`, label: "" }] : [],
            createdAt: primaryChar.created_date || now,
            updatedAt: primaryChar.last_modified || now,
            id: primaryChar.id,
            isNSFW: false,
            persona: primaryChar.description || "",
            loreItems: loreItems,
            tags: primaryChar.tags || []
        };

        const firstMessageEntry = (narrative.state.chat_history || []).find(m => !m.isHidden && m.type === 'chat');
        const firstMessageText = firstMessageEntry ? firstMessageEntry.content : `The story of ${primaryChar.name} begins.`;

        const exampleMessages = (narrative.state.chat_history || [])
            .filter(m => m.isHidden && m.type === 'chat')
            .map(m => {
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

                return {
                    text: byafFormattedText,
                    characterID: msgCharId
                };
            });

        const scenario = {
            schemaVersion: 1,
            title: narrative.name || "Exported Scenario",
            canDeleteExampleMessages: true,
            exampleMessages: exampleMessages,
            model: "",
            temperature: 1.0,
            topP: 0.9,
            minP: 0.1,
            firstMessages: [{ text: firstMessageText, characterID: primaryChar.id }],
            formattingInstructions: primaryChar.model_instructions || "",
            grammar: "",
            repeatPenalty: 1.05,
            repeatLastN: 256,
            topK: 30,
            minPEnabled: false,
            narrative: (narrative.state.static_entries || []).find(e => e.title === "Starting Scenario")?.content || "",
            promptTemplate: null,
            messages: []
        };

        const manifest = {
            schemaVersion: 1,
            createdAt: now,
            characters: [ `characters/${primaryChar.id}/character.json` ],
            scenarios: [ `scenarios/scenario1.json` ]
        };

        return { manifest, character, scenario };
    },

    // --- Low-Level File and Helper Functions ---

    _createEmptyEllipsisStory() {
        return {
            id: UTILITY.uuid(),
            name: "New Imported Story",
            last_modified: new Date().toISOString(),
            created_date: new Date().toISOString(),
            ...UTILITY.getDefaultApiSettings(),
            ...UTILITY.getDefaultUiSettings(),
            ...UTILITY.getDefaultSystemPrompts(),
            characters: [],
            dynamic_entries: [],
            scenarios: [],
            narratives: []
        };
    },

    _createEmptyEllipsisNarrative(name) {
        return {
            id: UTILITY.uuid(), name: name,
            last_modified: new Date().toISOString(),
            state: {
                chat_history: [], messageCounter: 0, static_entries: [],
                worldMap: { grid: UTILITY.createDefaultMapGrid(), currentLocation: { x: 4, y: 4 }, destination: {x:null, y:null}, path:[] }
            }
        };
    },

    _b64_to_utf8(str) {
        return decodeURIComponent(escape(atob(str)));
    },

    _utf8_to_b64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    },

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


        if (iendOffset === -1) {
            console.error("Original PNG Data (first 50 bytes):", originalPng.slice(0, 50));
            throw new Error('Could not find IEND chunk using proper iteration. The image data might be corrupted or not a valid PNG.');
        }

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
