/**
 * PromptBuilder Module
 * Constructs prompts for AI generation based on the current state.
 */
const PromptBuilder = {
    _getReplacer(contextCharacter) {
        const state = StateManager.getState();
        const userChar = state.characters.find(c => c.is_user);
        const characterName = contextCharacter ? contextCharacter.name : '';
        const userName = userChar ? userChar.name : 'You';
        return (text) => {
            if (typeof text !== 'string') return '';
            let processedText = text.replace(/{character}/g, characterName);
            processedText = processedText.replace(/{user}/g, userName);
            return processedText;
        };
    },

    _getSmartHistorySlice(history, chatMessageCount) {
        let chatCount = 0;
        let startIndex = history.length; // Default to all if history is shorter

        for (let i = history.length - 1; i >= 0; i--) {
            startIndex = i; // Mark the start of the slice
            const msg = history[i];

            // Only count visible chat messages toward the quota
            if (msg.type === 'chat' && !msg.isHidden) {
                chatCount++;
            }

            if (chatCount >= chatMessageCount) {
                break; // We found our 10th chat message
            }
        }
        return history.slice(startIndex);
    },

    buildPrompt(charToActId, isForUser = false) {
        const state = StateManager.getState();
        const charToAct = state.characters.find(c => c.id === charToActId);
        if (!charToAct) {
            console.error("PromptBuilder: Could not find character with ID:", charToActId);
            return ""; // Return empty string to prevent errors
        }
        const replacer = this._getReplacer(charToAct);
        const modelInstructions = charToAct.model_instructions || state.system_prompt;

        let locationContext = '';
        if (state.worldMap && state.worldMap.grid.length > 0) {
            const { grid, currentLocation, path } = state.worldMap;
            const currentLoc = grid.find(l => l.coords.x === currentLocation.x && l.coords.y === currentLocation.y);

            // --- 1. Add Current Location (only if name and prompt exist) ---
            if (currentLoc && currentLoc.name && currentLoc.prompt) {
                locationContext += `CURRENT LOCATION: ${currentLoc.name}\n${currentLoc.prompt}\n\n`;

                // Add local static entries if they exist
                if (currentLoc.local_static_entries && currentLoc.local_static_entries.length > 0) {
                    locationContext += "--- LOCATION-SPECIFIC KNOWLEDGE ---\n";
                    locationContext += currentLoc.local_static_entries
                        .map(l => `Title: ${l.title}\nContent: ${replacer(l.content)}`)
                        .join('\n\n') + "\n\n";
                }
            } else if (currentLoc && currentLoc.name) {
                 // Fallback if only name exists but prompt is missing (optional, remove if unwanted)
                 locationContext += `CURRENT LOCATION: ${currentLoc.name}\n(No detailed description available.)\n\n`;
            }

            // --- 2. Add Adjacent Locations (only if they have name AND description) ---
            if (currentLoc) { // Check currentLoc exists before checking neighbors
                const directions = [
                    { dir: 'North', x: 0, y: -1 }, { dir: 'South', x: 0, y: 1 },
                    { dir: 'East', x: 1, y: 0 }, { dir: 'West', x: -1, y: 0 },
                    { dir: 'Northeast', x: 1, y: -1 }, { dir: 'Northwest', x: -1, y: -1 },
                    { dir: 'Southeast', x: 1, y: 1 }, { dir: 'Southwest', x: -1, y: 1 }
                ];

                const validAdjacentLocations = directions
                    .map(({ dir, x, y }) => {
                        const adjLoc = grid.find(l => l.coords.x === currentLocation.x + x && l.coords.y === currentLocation.y + y);
                        // Require both name and description to be non-empty
                        if (adjLoc && adjLoc.name && adjLoc.description) {
                            return `- (${dir}): ${adjLoc.name} - ${adjLoc.description}`;
                        }
                        return null; // Ignore invalid/incomplete locations
                    })
                    .filter(Boolean); // Remove null entries

                // Only add the section if there are valid neighbors
                if (validAdjacentLocations.length > 0) {
                    locationContext += 'ADJACENT LOCATIONS:\n';
                    locationContext += validAdjacentLocations.join('\n') + '\n\n';
                }
            }

            // --- 3. Add Travel Path (only if path array exists and is not empty) ---
            if (path && path.length > 0) {
                const pathNames = path
                    .map(p => grid.find(l => l.coords.x === p.x && l.coords.y === p.y)?.name)
                    .filter(Boolean) // Filter out any potential undefined names
                    .join(' -> ');
                // Ensure pathNames isn't empty after filtering before adding
                if (pathNames) {
                    locationContext += `TRAVEL PATH TO DESTINATION: ${pathNames}\n`;
                }
            }
        }

        const components = {
            system_prompt: replacer(modelInstructions),
            event_master_prompt: replacer(state.event_master_prompt),
            static_entries: (state.static_entries || []).map(l => `### ${l.title}\n${replacer(l.content)}`).join('\n\n'),
            characters: (state.characters || []).filter(c => c.is_active).map(c => `### Character: ${c.name}\n\n${replacer(c.description)}`).join('\n\n'),
            history: this._getSmartHistorySlice(state.chat_history || [], 10),
            charToAct: charToAct,
            isForUser: isForUser,
            location_context: locationContext,
        };

        if (state.event_master_prompt) {
            state.event_master_prompt = '';
            StateManager.saveState();
        }

        if (state.apiProvider === 'koboldcpp') {
            return this.buildKoboldTemplatedPrompt(components, replacer);
        }
        return this.buildDefaultPrompt(components, replacer);
    },

    buildDefaultPrompt(components, replacer) {
        const state = StateManager.getState();
        let p = components.system_prompt + "\n\n";
        if (components.event_master_prompt) p += "--- SECRET EVENT MASTER INSTRUCTION ---\n" + components.event_master_prompt + "\n\n";
        if (components.location_context) p += "## LOCATION CONTEXT\n" + components.location_context + "\n\n";
        p += "## WORLD KNOWLEDGE\n" + components.static_entries + "\n\n";
        if (components.dynamic_entries) p += "## RECENTLY REVEALED DYNAMIC KNOWLEDGE\n" + components.dynamic_entries + "\n\n";
        p += "## CHARACTERS\n" + components.characters + "\n\n";

        const exampleDialogue = (state.chat_history || []).filter(m => m.isHidden);
        if(exampleDialogue.length > 0){
            p += "## EXAMPLE DIALOGUE\n";
            exampleDialogue.forEach(msg => {
                const char = state.characters.find(c => c.id === msg.character_id);
                if (char) p += `${char.name}: ${replacer(msg.content)}\n`;
            });
            p += "\n";
        }

        p += "## RECENT CONVERSATION & EVENTS\n";
        components.history.forEach(msg => {
            // Skip example dialogue (which is 'chat' AND 'isHidden')
            if (msg.type === 'chat' && msg.isHidden) return;

            if (msg.type === 'chat') {
                const char = state.characters.find(c => c.id === msg.character_id);
                if (char) p += `[${char.name}:]\n${replacer(msg.content)}\n\n`;
            } else if (msg.type === 'lore_reveal') {
                // This is the new part for inline knowledge
                p += `[System Note:\n${replacer(msg.content)}]\n\n`;
            } else if (msg.type === 'system_event') {
                 p += `[System Event: ${replacer(msg.content)}]\n\n`;
            }
        });
        p += "\n### INSTRUCTION\n";
        p += components.isForUser ? `Generate the next creative response for the user's character, ${components.charToAct.name}.` : `Generate the next response for ${components.charToAct.name}. Stay in character.`;
        p += " Do not repeat the character's name in the response itself.\n[CHARACTER_TO_ACT]: " + components.charToAct.name;
        return p;
    },

    buildKoboldTemplatedPrompt(components, replacer) {
        const state = StateManager.getState();
        const template = state.koboldcpp_template;
        if (template === 'none') return this.buildDefaultPrompt(components, replacer);

        let system = [components.system_prompt];
        if (components.event_master_prompt) system.push("SECRET EVENT INSTRUCTION:\n" + components.event_master_prompt);
        if (components.location_context) system.push("LOCATION CONTEXT:\n" + components.location_context);
        system.push("STATIC KNOWLEDGE:\n" + components.static_entries);
        if (components.dynamic_entries) system.push("DYNAMIC KNOWLEDGE:\n" + components.dynamic_entries);
        system.push("CHARACTERS:\n" + components.characters);
        const system_prompt_str = system.join('\n\n');

        const history_str = components.history.map(msg => {
            // Skip example dialogue
            if (msg.type === 'chat' && msg.isHidden) return null;

            if (msg.type === 'chat') {
                const char = state.characters.find(c => c.id === msg.character_id);
                if (char) return `${char.is_user ? 'user' : 'assistant'}:${char.name}:\n${replacer(msg.content)}`;
            } else if (msg.type === 'lore_reveal') {
                return `system:Dynamic Entry Revealed - ${msg.title}:\n${replacer(msg.content)}`;
            } else if (msg.type === 'system_event') {
                return `system:System Event:\n${replacer(msg.content)}`;
            }
            return null; // Fallback for other types
        }).filter(Boolean).join('\n');

        let instruction = components.isForUser ? `Write the next chat message for the user's character, ${components.charToAct.name}.` : `Write the next chat message for ${components.charToAct.name}. Stay in character.`;
        instruction += " Do not write any prefix like 'Character Name:'.";

        switch (template) {
            case 'mistral':
                return `<s>[INST] ${system_prompt_str}\n\n${history_str}\n\n${instruction} [/INST]`;
            case 'chatml':
                const history_chatml = components.history.map(msg => {
                    // Skip example dialogue
                    if (msg.type === 'chat' && msg.isHidden) return null;

                    let role = 'system';
                    let content = '';

                    if (msg.type === 'chat') {
                        const char = state.characters.find(c => c.id === msg.character_id);
                        if (!char) return null;
                        role = char.is_user ? 'user' : 'assistant';
                        content = `${char.name}:\n${replacer(msg.content)}`;
                    } else if (msg.type === 'lore_reveal') {
                        content = `[Dynamic Entry Revealed - ${msg.title}]\n${replacer(msg.content)}`;
                    } else if (msg.type === 'system_event') {
                        content = `[System Event: ${replacer(msg.content)}]`;
                    } else {
                        return null;
                    }

                    return `<|im_start|>${role}\n${content}<|im_end|>`;
                }).filter(Boolean).join('\n');

                return `<|im_start|>system\n${system_prompt_str}<|im_end|>\n${history_chatml}\n<|im_start|>user\n${instruction}<|im_end|>\n<|im_start|>assistant\n${components.charToAct.name}:\n`;
            case 'alpaca':
                 return `### Instruction:\n${system_prompt_str}\n\n${history_str}\n\n${instruction}\n\n### Response:\n`;
            default:
                return this.buildDefaultPrompt(components, replacer);
        }
    },
};
