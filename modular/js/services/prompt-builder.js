        const PromptBuilder = {
            /**
             * Creates a replacement function for template strings.
             * @param {Object} contextCharacter - The character context.
             * @returns {Function} - The replacer function.
             * @private
             */
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

            /**
             * Retrieves a slice of chat history, filtering out hidden messages.
             * @param {Array} history - The chat history.
             * @param {number} chatMessageCount - The number of messages to retrieve.
             * @returns {Array} - The history slice.
             * @private
             */
            _getSmartHistorySlice(history, chatMessageCount) {
                if (!Array.isArray(history)) return [];

                let chatCount = 0;
                let startIndex = history.length;

                // Loop backwards
                for (let i = history.length - 1; i >= 0; i--) {
                    const msg = history[i];

                    // Safety check for undefined/null messages
                    if (!msg) continue;

                    startIndex = i;
                    if (msg.type === 'chat' && !msg.isHidden) chatCount++;
                    if (chatCount >= chatMessageCount) break;
                }
                return history.slice(startIndex);
            },

            /**
             * Builds the main prompt for the AI.
             * @param {string} charToActId - The ID of the character acting.
             * @param {boolean} [isForUser=false] - Whether the prompt is for the user.
             * @returns {string} - The constructed prompt.
             */
            buildPrompt(charToActId, isForUser = false) {
                const state = StateManager.getState();
                const charToAct = state.characters.find(c => c.id === charToActId);
                if (!charToAct) return "";

                const replacer = this._getReplacer(charToAct);
                const modelInstructions = charToAct.model_instructions || state.system_prompt;

                let locationContext = '';
                if (state.worldMap && state.worldMap.grid.length > 0) {
                    const { grid, currentLocation, path } = state.worldMap;
                    const currentLoc = grid.find(l => l.coords.x === currentLocation.x && l.coords.y === currentLocation.y);

                    if (currentLoc && currentLoc.name) {
                        locationContext += `CURRENT LOCATION: ${currentLoc.name}\n`;
                        if (currentLoc.prompt) locationContext += `${currentLoc.prompt}\n\n`;
                        else locationContext += `(No detailed description available.)\n\n`;

                        if (currentLoc.local_static_entries && currentLoc.local_static_entries.length > 0) {
                            locationContext += "--- LOCATION-SPECIFIC KNOWLEDGE ---\n";
                            locationContext += currentLoc.local_static_entries
                                .map(l => `Title: ${l.title}\nContent: ${replacer(l.content)}`)
                                .join('\n\n') + "\n\n";
                        }
                    }

                    if (currentLoc) {
                        const directions = [
                            { dir: 'North', x: 0, y: -1 }, { dir: 'South', x: 0, y: 1 },
                            { dir: 'East', x: 1, y: 0 }, { dir: 'West', x: -1, y: 0 },
                            { dir: 'Northeast', x: 1, y: -1 }, { dir: 'Northwest', x: -1, y: -1 },
                            { dir: 'Southeast', x: 1, y: 1 }, { dir: 'Southwest', x: -1, y: 1 }
                        ];
                        const validAdjacentLocations = directions
                            .map(({ dir, x, y }) => {
                                const adjLoc = grid.find(l => l.coords.x === currentLocation.x + x && l.coords.y === currentLocation.y + y);
                                if (adjLoc && adjLoc.name && adjLoc.description) {
                                    return `- (${dir}): ${adjLoc.name} - ${adjLoc.description}`;
                                }
                                return null;
                            })
                            .filter(Boolean);
                        if (validAdjacentLocations.length > 0) {
                            locationContext += 'ADJACENT LOCATIONS:\n' + validAdjacentLocations.join('\n') + '\n\n';
                        }
                    }

                    if (path && path.length > 0) {
                        const pathNames = path.map(p => grid.find(l => l.coords.x === p.x && l.coords.y === p.y)?.name).filter(Boolean).join(' -> ');
                        if (pathNames) locationContext += `TRAVEL PATH TO DESTINATION: ${pathNames}\n`;
                    }
                }

                const components = {
                    system_prompt: replacer(modelInstructions),
                    event_master_prompt: replacer(state.event_master_prompt),
                    static_entries: (state.static_entries || []).map(l => `### ${l.title}\n${replacer(l.content)}`).join('\n\n'),
                    // Only include Narrator description if THAT Narrator is the one acting.
                    // Standard characters are always included if active.
                    characters: (state.characters || [])
                        .filter(c => c.is_active)
                        .filter(c => {
                            if (c.is_narrator) {
                                return c.id === charToActId;
                            }
                            return true;
                        })
                        .map(c => `### Character: ${c.name}\n\n${replacer(c.description)}`)
                        .join('\n\n'), history: this._getSmartHistorySlice(state.chat_history || [], 10),
                    charToAct: charToAct,
                    isForUser: isForUser,
                    location_context: locationContext,
                    dynamic_entries: '' // If needed, pull from state logic or remove if handled elsewhere
                };

                // Simple auto-consume logic for event master
                if (state.event_master_prompt) {
                    state.event_master_prompt = '';
                    StateManager.saveState();
                }

                if (state.apiProvider === 'koboldcpp') {
                    return this.buildKoboldTemplatedPrompt(components, replacer);
                }
                return this.buildDefaultPrompt(components, replacer);
            },

            /**
             * Builds the default prompt format.
             * @param {Object} components - The prompt components.
             * @param {Function} replacer - The replacer function.
             * @returns {string}
             */
            buildDefaultPrompt(components, replacer) {
                const state = StateManager.getState();
                let p = components.system_prompt + "\n\n";
                if (components.event_master_prompt) p += "--- SECRET EVENT MASTER INSTRUCTION ---\n" + components.event_master_prompt + "\n\n";
                if (components.location_context) p += "## LOCATION CONTEXT\n" + components.location_context + "\n\n";
                p += "## WORLD KNOWLEDGE\n" + components.static_entries + "\n\n";
                // Note: Dynamic entries usually injected into chat history as 'lore_reveal', but can be added here if architectural preference changes.
                p += "## CHARACTERS\n" + components.characters + "\n\n";

                const exampleDialogue = (state.chat_history || []).filter(m => m && m.isHidden);
                if (exampleDialogue.length > 0) {
                    p += "## EXAMPLE DIALOGUE\n";
                    exampleDialogue.forEach(msg => {
                        // Safety Check
                        if (!msg) return;
                        const char = state.characters.find(c => c.id === msg.character_id);
                        if (char) p += `${char.name}: ${replacer(msg.content)}\n`;
                    });
                    p += "\n";
                }

                p += "## RECENT CONVERSATION & EVENTS\n";
                components.history.forEach(msg => {
                    // Safety Checks
                    if (!msg) return;
                    if (msg.type === 'chat' && msg.isHidden) return;

                    if (msg.type === 'chat') {
                        const char = state.characters.find(c => c.id === msg.character_id);
                        if (char) p += `[${char.name}:]\n${replacer(msg.content)}\n\n`;
                    } else if (msg.type === 'lore_reveal') {
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

            /**
             * Builds a prompt formatted for KoboldCPP templates.
             * @param {Object} components - The prompt components.
             * @param {Function} replacer - The replacer function.
             * @returns {string}
             */
            buildKoboldTemplatedPrompt(components, replacer) {
                const state = StateManager.getState();
                const template = state.koboldcpp_template || 'none';

                // 1. Construct System/Context Block
                let system = [components.system_prompt];
                if (components.event_master_prompt) system.push("SECRET EVENT INSTRUCTION:\n" + components.event_master_prompt);
                if (components.location_context) system.push("LOCATION CONTEXT:\n" + components.location_context);
                system.push("STATIC KNOWLEDGE:\n" + components.static_entries);
                system.push("CHARACTERS:\n" + components.characters);
                const system_prompt_str = system.join('\n\n');

                let instruction = components.isForUser
                    ? `Write the next chat message for the user's character, ${components.charToAct.name}.`
                    : `Write the next chat message for ${components.charToAct.name}. Stay in character.`;
                instruction += " Do not write any prefix like 'Character Name:'.";

                if (template === 'none') return this.buildDefaultPrompt(components, replacer);

                // --- LLAMA 3 ---
                if (template === 'llama3') {
                    const history_llama3 = components.history.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        let role = 'user';
                        let content = '';
                        if (msg.type === 'chat') {
                            const char = state.characters.find(c => c.id === msg.character_id);
                            if (!char) return null;
                            role = char.is_user ? 'user' : 'assistant';
                            content = `${char.name}:\n${replacer(msg.content)}`;
                        } else if (msg.type === 'lore_reveal') {
                            role = 'system';
                            content = `[Dynamic Entry Revealed - ${msg.title}]\n${replacer(msg.content)}`;
                        } else if (msg.type === 'system_event') {
                            role = 'system';
                            content = `[System Event: ${replacer(msg.content)}]`;
                        } else { return null; }
                        return `<|start_header_id|>${role}<|end_header_id|>\n\n${content}<|eot_id|>`;
                    }).filter(Boolean).join('\n');

                    return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${system_prompt_str}<|eot_id|>\n${history_llama3}\n<|start_header_id|>user<|end_header_id|>\n\n${instruction}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n${components.charToAct.name}:\n`;
                }

                // --- GEMMA (Google) ---
                if (template === 'gemma') {
                    // Gemma often prefers system prompts to be part of the first user turn or a distinct user turn
                    // We will format the system prompt as a user turn for maximum compatibility
                    const history_gemma = components.history.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;

                        let role = 'user';
                        let content = '';

                        if (msg.type === 'chat') {
                            const char = state.characters.find(c => c.id === msg.character_id);
                            if (!char) return null;
                            role = char.is_user ? 'user' : 'model'; // Gemma uses 'model', not 'assistant'
                            content = `${char.name}:\n${replacer(msg.content)}`;
                        } else if (msg.type === 'lore_reveal' || msg.type === 'system_event') {
                            // System events injected as user context
                            return `<start_of_turn>user\n[System Note: ${replacer(msg.content)}]<end_of_turn>`;
                        } else { return null; }

                        return `<start_of_turn>${role}\n${content}<end_of_turn>`;
                    }).filter(Boolean).join('\n');

                    return `<start_of_turn>user\n${system_prompt_str}<end_of_turn>\n${history_gemma}\n<start_of_turn>user\n${instruction}<end_of_turn>\n<start_of_turn>model\n${components.charToAct.name}:\n`;
                }

                // --- PHI-3 (Microsoft) ---
                if (template === 'phi3') {
                    const history_phi = components.history.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;

                        let role = 'user';
                        let content = '';
                        if (msg.type === 'chat') {
                            const char = state.characters.find(c => c.id === msg.character_id);
                            if (!char) return null;
                            role = char.is_user ? 'user' : 'assistant';
                            content = `${char.name}:\n${replacer(msg.content)}`;
                        } else if (msg.type === 'lore_reveal') {
                            return `<|system|>\n[Dynamic Entry: ${replacer(msg.content)}]<|end|>`;
                        } else if (msg.type === 'system_event') {
                            return `<|system|>\n${replacer(msg.content)}<|end|>`;
                        } else { return null; }

                        return `<|${role}|>\n${content}<|end|>`;
                    }).filter(Boolean).join('\n');

                    return `<|system|>\n${system_prompt_str}<|end|>\n${history_phi}\n<|user|>\n${instruction}<|end|>\n<|assistant|>\n${components.charToAct.name}:\n`;
                }

                // --- MISTRAL ---
                if (template === 'mistral') {
                    const history_str = components.history.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        if (msg.type === 'chat') {
                            const char = state.characters.find(c => c.id === msg.character_id);
                            if (char) return `${char.is_user ? 'user' : 'assistant'}:${char.name}:\n${replacer(msg.content)}`;
                        } else if (msg.type === 'lore_reveal') {
                            return `system:Dynamic Entry Revealed - ${msg.title}:\n${replacer(msg.content)}`;
                        } else if (msg.type === 'system_event') {
                            return `system:System Event:\n${replacer(msg.content)}`;
                        }
                        return null;
                    }).filter(Boolean).join('\n');
                    return `<s>[INST] ${system_prompt_str}\n\n${history_str}\n\n${instruction} [/INST]`;
                }

                // --- CHATML ---
                if (template === 'chatml') {
                    const history_chatml = components.history.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
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
                        } else { return null; }
                        return `<|im_start|>${role}\n${content}<|im_end|>`;
                    }).filter(Boolean).join('\n');
                    return `<|im_start|>system\n${system_prompt_str}<|im_end|>\n${history_chatml}\n<|im_start|>user\n${instruction}<|im_end|>\n<|im_start|>assistant\n${components.charToAct.name}:\n`;
                }

                // --- ALPACA ---
                if (template === 'alpaca') {
                    const history_str = components.history.map(msg => {
                        if (!msg || (msg.type === 'chat' && msg.isHidden)) return null;
                        const char = state.characters.find(c => c.id === msg.character_id);
                        return char ? `${char.name}: ${replacer(msg.content)}` : null;
                    }).filter(Boolean).join('\n');
                    return `### Instruction:\n${system_prompt_str}\n\n${history_str}\n\n${instruction}\n\n### Response:\n`;
                }

                return this.buildDefaultPrompt(components, replacer);
            }
        };