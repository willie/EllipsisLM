        const DOM = {
            SafeString: class {
                constructor(str) { this.str = str; }
                toString() { return this.str; }
            },
            html(strings, ...values) {
                let result = "";
                strings.forEach((string, i) => {
                    result += string;
                    if (i < values.length) {
                        const val = values[i];
                        if (Array.isArray(val)) {
                            // Recursively join arrays
                            result += val.join('');
                        } else if (val instanceof DOM.SafeString) {
                            result += val;
                        } else if (val !== null && val !== undefined) {
                            // Securely escape unsafe values
                            result += String(val)
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                                .replace(/'/g, "&#039;");
                        }
                    }
                });
                return new DOM.SafeString(result);
            },
            unsafe(str) {
                return new DOM.SafeString(str);
            }
        };

        const ActionHandler = {
            actions: {},

            // Register an action name to a function
            /**
             * Registers an action handler.
             * @param {string} name - The action name (data-action value).
             * @param {Function} fn - The callback function.
             */
            register(name, fn) {
                this.actions[name] = fn;
            },

            // Initialize the global listener
            /**
             * Initializes the global click and change listeners.
             */
            init() {
                // We attach one listener to the body to catch ALL bubbled clicks
                document.body.addEventListener('click', (e) => {
                    // 1. Find the closest element with a data-action attribute
                    const target = e.target.closest('[data-action]');
                    if (!target) return;

                    const actionName = target.dataset.action;
                    const handler = this.actions[actionName];

                    if (handler) {
                        // 2. Prevent default browser behavior for links/buttons if handled
                        if (target.tagName === 'A' || target.tagName === 'BUTTON') {
                            e.preventDefault();
                        }

                        // 3. Pass the element's dataset (data-id, data-type, etc.) and the event
                        handler(target.dataset, e);
                    } else {
                        console.warn(`No handler registered for action: ${actionName}`);
                    }
                });

                // Handle 'change' events for inputs using data-action-change
                document.body.addEventListener('change', (e) => {
                    const target = e.target.closest('[data-action-change]');
                    if (!target) return;

                    const actionName = target.dataset.actionChange;
                    const handler = this.actions[actionName];
                    if (handler) handler(target.dataset, target.value, e);
                });
            }
        };

        const UTILITY = {
            /**
             * Generates a UUID v4.
             * @returns {string}
             */
            uuid() {
                return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
            },
            /**
             * Escapes HTML characters to prevent XSS.
             * @param {string} str - The string to escape.
             * @returns {string}
             */
            escapeHTML(str) {
                if (typeof str !== 'string') return '';
                const p = document.createElement("p");
                p.textContent = str;
                return p.innerHTML;
            },

            /**
             * Safely extracts and parses JSON from a string, handling markdown code blocks.
             * @param {string} str - The string containing JSON.
             * @returns {Object|null} - The parsed object or null.
             */
            extractAndParseJSON(str) {
                if (!str) return null;
                // Remove markdown
                let clean = str.replace(/```json\s*/g, '').replace(/```/g, '').trim();
                try {
                    return JSON.parse(clean);
                } catch (e) {
                    // Regex fallback
                    const match = str.match(/\{[\s\S]*\}/);
                    if (match) {
                        try { return JSON.parse(match[0]); } catch (e2) { return null; }
                    }
                    return null;
                }
            },

            /**
             * Converts a hex color to RGBA.
             * @param {string} hex - The hex color string.
             * @param {number} alpha - The alpha value (0-1).
             * @returns {string}
             */
            hexToRgba(hex, alpha) {
                let r = 0, g = 0, b = 0;
                if (hex.length == 4) { r = "0x" + hex[1] + hex[1]; g = "0x" + hex[2] + hex[2]; b = "0x" + hex[3] + hex[3]; }
                else if (hex.length == 7) { r = "0x" + hex[1] + hex[2]; g = "0x" + hex[3] + hex[4]; b = "0x" + hex[5] + hex[6]; }
                return `rgba(${+r},${+g},${+b},${alpha})`;
            },
            /**
             * Darkens a hex color by a percentage.
             * @param {string} hex - The hex color string.
             * @param {number} percent - The percentage to darken (0-100).
             * @returns {string}
             */
            darkenHex(hex, percent) {
                const num = parseInt(hex.replace("#", ""), 16);
                const amt = Math.round(2.55 * percent);
                const R = (num >> 16) - amt;
                const G = (num >> 8 & 0x00FF) - amt;
                const B = (num & 0x0000FF) - amt;
                return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
            },
            /**
             * Returns default API settings.
             * @returns {Object}
             */
            getDefaultApiSettings() {
                return {
                    apiProvider: 'gemini',
                    geminiApiKey: '',
                    geminiModel: 'gemini-1.5-flash',
                    openRouterKey: '',
                    openRouterModel: 'google/gemini-flash-1.5',
                    koboldcpp_url: 'http://localhost:5001',
                    koboldcpp_template: 'none',
                    koboldcpp_min_p: 0.1,
                    koboldcpp_dry: 0.25,
                    lmstudio_url: 'http://localhost:1234',
                    userPersonas: [],
                    savedOpenRouterModels: []
                };
            },
            /**
             * Returns default UI settings.
             * @returns {Object}
             */
            getDefaultUiSettings() {
                return {
                    font: "'Inter', sans-serif", backgroundImageURL: '', bubbleOpacity: 0.85,
                    chatTextColor: '#e5e7eb', characterImageMode: 'none',
                    backgroundBlur: 5, textSize: 16, bubbleImageSize: 100,
                    showPortraitPanel: true,
                    // ... markdown colors ...
                    md_h1_color: '#818cf8', md_h2_color: '#a5b4fc', md_h3_color: '#c7d2fe',
                    md_bold_color: '#ffffff', md_italic_color: '#9ca3af', md_quote_color: '#9ca3af',
                    md_h1_font: '', md_h2_font: '', md_h3_font: '', md_bold_font: '', md_italic_font: '', md_quote_font: ''
                };
            },
            /**
             * Returns default story settings.
             * @returns {Object}
             */
            getDefaultStorySettings() {
                return {
                    creator_notes: "",
                    tags: [],
                    event_master_probability: 15,
                    enableAnalysis: true
                };
            },
            /**
             * Returns default system prompts.
             * @returns {Object}
             */
            getDefaultSystemPrompts() {
                return {
                    system_prompt: 'You are a master storyteller. Follow instructions precisely.',
                    event_master_base_prompt: 'You are a secret Event Master. Read the chat. Generate a brief, secret instruction for AI characters to introduce a logical but unexpected event.',
                    event_master_prompt: 'You are a secret Event Master. Read the chat. Generate a brief, secret instruction for AI characters to introduce a logical but unexpected event.',
                    prompt_persona_gen: "Embellish this character concept into a rich, detailed, and compelling persona description, focusing on detailed appearance, personality, goals, relationships, and backstory. CONCEPT: \"{concept}\"",
                    prompt_world_map_gen: "Based on the following story context, generate a genre-appropriate 8x8 grid of interconnected fantasy locations. The central location (4,4) should be a neutral starting point. Attempt to include locations mentioned in the context.\nCONTEXT:\nCHARACTERS:\n{characters}\n\nSTATIC LORE:\n{static}\n\nRECENT EVENTS:\n{recent}\n\nRespond with a valid JSON object: { \"grid\": [ { \"coords\": {\"x\":int, \"y\":int}, \"name\": \"string\", \"description\": \"string (one-line summary)\", \"prompt\": \"string (a rich, detailed paragraph for the AI)\", \"imageUrl\": \"\" } ] }. The grid must contain exactly 64 locations.",
                    prompt_location_gen: "Generate a rich, detailed, and evocative paragraph-long prompt for a fantasy location named '{name}' which is briefly described as '{description}'. This prompt will be given to an AI storyteller to describe the scene.",
                    prompt_entry_gen: "Generate a detailed and informative encyclopedia-style entry for a lore topic titled '{title}'. If relevant, use the following triggers as context: '{triggers}'.",
                    prompt_location_memory_gen: "You are an archivist. Read the following chat transcript that occurred at a specific location. Summarize the key events, character developments, and important facts into a concise, single paragraph. This will serve as a memory for what happened at that location.\n\nTRANSCRIPT:\n{transcript}",
                    prompt_story_notes_gen: "Based on the following story context (characters, lore), generate a brief, 1-2 sentence creator's note or 'blurb' for this story to show in a library.\n\nCONTEXT:\n{context}",
                    prompt_story_tags_gen: "Based on the following story context (characters, lore), generate 3-5 relevant, one-word, comma-separated tags for this story (e.g., fantasy, sci-fi, mystery, horror, romance).\n\nCONTEXT:\n{context}"
                };
            },
            /**
             * Creates a default 8x8 map grid.
             * @returns {Array<Object>}
             */
            createDefaultMapGrid() {
                const grid = [];
                for (let y = 0; y < 8; y++) {
                    for (let x = 0; x < 8; x++) {
                        grid.push({
                            coords: { x, y },
                            name: "",
                            description: "",
                            prompt: "",
                            imageUrl: "",
                            local_static_entries: []
                        });
                    }
                }
                return grid;
            },
            /**
             * Finds a path between two coordinates on the grid using A*.
             * @param {Array<Object>} grid - The map grid.
             * @param {Object} startCoords - The starting coordinates.
             * @param {Object} endCoords - The ending coordinates.
             * @returns {Array<Object>} - The path coordinates.
             */
            findPath(grid, startCoords, endCoords) {
                const toKey = ({ x, y }) => `${x},${y}`;
                const nodes = grid.map(loc => ({
                    ...loc,
                    g: Infinity,
                    h: Infinity,
                    f: Infinity,
                    parent: null,
                }));

                const startNode = nodes.find(n => n.coords.x === startCoords.x && n.coords.y === startCoords.y);
                const endNode = nodes.find(n => n.coords.x === endCoords.x && n.coords.y === endCoords.y);
                if (!startNode || !endNode) return [];

                const heuristic = (a, b) => Math.abs(a.coords.x - b.coords.x) + Math.abs(a.coords.y - b.coords.y);

                let openSet = [startNode];
                let closedSet = new Set();

                startNode.g = 0;
                startNode.h = heuristic(startNode, endNode);
                startNode.f = startNode.h;

                while (openSet.length > 0) {
                    openSet.sort((a, b) => a.f - b.f);
                    let currentNode = openSet.shift();

                    if (currentNode === endNode) {
                        let path = [];
                        let temp = currentNode;
                        while (temp) {
                            path.push(temp.coords);
                            temp = temp.parent;
                        }
                        return path.reverse();
                    }

                    closedSet.add(toKey(currentNode.coords));

                    const neighbors = nodes.filter(n => {
                        const dx = Math.abs(n.coords.x - currentNode.coords.x);
                        const dy = Math.abs(n.coords.y - currentNode.coords.y);
                        return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
                    });

                    for (let neighbor of neighbors) {
                        if (closedSet.has(toKey(neighbor.coords))) continue;
                        let tentativeG = currentNode.g + 1;
                        if (tentativeG < neighbor.g) {
                            neighbor.parent = currentNode;
                            neighbor.g = tentativeG;
                            neighbor.h = heuristic(neighbor, endNode);
                            neighbor.f = neighbor.g + neighbor.h;
                            if (!openSet.includes(neighbor)) openSet.push(neighbor);
                        }
                    }
                }
                return [];
            },
            /**
             * Selects an item from a list based on weights.
             * @param {Array} characters - The items to choose from.
             * @param {Array<number>} weights - The weights for each item.
             * @returns {*} - The selected item.
             */
            weightedChoice(characters, weights) {
                if (characters.length !== weights.length || characters.length === 0) return null;
                const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
                if (totalWeight <= 0) return characters[Math.floor(Math.random() * characters.length)];
                let random = Math.random() * totalWeight;
                for (let i = 0; i < characters.length; i++) {
                    random -= weights[i];
                    if (random <= 0) return characters[i];
                }
                return characters[characters.length - 1];
            },
            /**
             * Checks if there is enough localStorage quota.
             * @param {number} estimatedSize - The estimated size of data to save.
             * @returns {boolean} - True if quota is sufficient.
             */
            checkLocalStorageQuota(estimatedSize) {
                try {
                    const testKey = 'quota-check';
                    const existingDataSize = JSON.stringify(localStorage).length;
                    const availableSpace = (5 * 1024 * 1024) - existingDataSize;
                    if (estimatedSize > availableSpace) return false;
                    localStorage.setItem(testKey, '1');
                    localStorage.removeItem(testKey);
                    return true;
                } catch (e) { return false; }
            }
        };