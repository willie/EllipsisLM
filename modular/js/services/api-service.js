        const APIService = {
            async callAI(prompt, isJson = false, signal = null) {
                const state = StateManager.getState();
                let text = "";
                try {
                    if (state.apiProvider === 'gemini') {
                        text = await this.callGemini(prompt, signal);
                    } else if (state.apiProvider === 'openrouter') {
                        text = await this.callOpenRouter(prompt, signal);
                    } else if (state.apiProvider === 'koboldcpp') {
                        text = await this.callKoboldCPP(prompt, signal);
                    } else if (state.apiProvider === 'lmstudio') {
                        text = await this.callLMStudio(prompt, signal);
                    }

                    if (isJson) {
                        const jsonMatch = text.match(/\{[\s\S]*\}/);
                        if (jsonMatch && jsonMatch[0]) return jsonMatch[0];
                        throw new Error("AI response was not in the expected JSON format.");
                    }
                    return text.trim();
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    console.error(`AI call failed (${state.apiProvider}):`, error);
                    throw error;
                }
            },

            /**
             * Fetches available models from the Gemini API.
             */
            async getGeminiModels() {
                // Check Global Settings first, then State
                const globalKey = StateManager.data.globalSettings.geminiApiKey;
                const stateKey = StateManager.getState().geminiApiKey;
                const apiKey = globalKey || stateKey;

                if (!apiKey) {
                    console.warn("getGeminiModels: No API key found.");
                    return [];
                }

                try {
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                    if (!res.ok) {
                        console.error("Gemini List Models Failed:", res.status, res.statusText);
                        return [];
                    }
                    const data = await res.json();

                    // Filter for models that support generating content
                    return (data.models || []).filter(m =>
                        m.supportedGenerationMethods &&
                        m.supportedGenerationMethods.includes('generateContent')
                    );
                } catch (e) {
                    console.error("Failed to fetch Gemini models:", e);
                    return [];
                }
            },

            /**
             * Calls the Gemini API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callGemini(prompt, signal) {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const apiKey = global.geminiApiKey || state.geminiApiKey;

                if (!apiKey) throw new Error("Gemini API key not set.");

                // 1. Resolve Model Name
                // State might hold "gemini-1.5-flash" OR "models/gemini-1.5-flash".
                // Global setting might hold the fallback.
                let rawModel = state.geminiModel || global.geminiModel || 'gemini-1.5-flash';

                // Strip "models/" prefix if present to ensure clean base ID
                if (rawModel.startsWith('models/')) {
                    rawModel = rawModel.replace('models/', '');
                }

                // 2. Construct Endpoint
                // The correct format is: models/{model_id}:generateContent
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${rawModel}:generateContent?key=${apiKey}`;

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                    signal
                });

                if (!res.ok) {
                    let errorMsg = `Status ${res.status}`;
                    try {
                        const errData = await res.json();
                        errorMsg += `: ${errData.error.message}`;
                    } catch (e) {
                        errorMsg += `: ${await res.text()}`;
                    }
                    throw new Error(`Gemini API Error: ${errorMsg}`);
                }

                const data = await res.json();
                return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            },

            /**
             * Calls the OpenRouter API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callOpenRouter(prompt, signal) {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const apiKey = global.openRouterKey || state.openRouterKey;
                const model = state.openRouterModel || global.openRouterModel;
                if (!apiKey || !model) throw new Error("OpenRouter API key or model not set.");
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }] }), signal });
                if (!res.ok) { let errorDetails = `Status: ${res.status} ${res.statusText}.`; try { const errorJson = await res.json(); errorDetails += ` Message: ${errorJson.error.message || JSON.stringify(errorJson.error)}`; } catch (e) { errorDetails += ` Response body: ${await res.text()}`; } throw new Error(`API Error: ${errorDetails}`); }
                const data = await res.json();
                return data.choices[0].message.content;
            },
            /**
             * Fetches available models from OpenRouter API.
             * @returns {Promise<Array>} Array of model objects with id, name, pricing, context_length, etc.
             */
            async fetchOpenRouterModels() {
                const state = StateManager.getState();
                const global = StateManager.data.globalSettings;
                const apiKey = global.openRouterKey || state.openRouterKey;
                const headers = { 'Content-Type': 'application/json' };
                if (apiKey) {
                    headers['Authorization'] = `Bearer ${apiKey}`;
                }
                const res = await fetch('https://openrouter.ai/api/v1/models', { method: 'GET', headers });
                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try {
                        const errorJson = await res.json();
                        errorDetails += ` Message: ${errorJson.error?.message || JSON.stringify(errorJson.error)}`;
                    } catch (e) {
                        errorDetails += ` Response body: ${await res.text()}`;
                    }
                    throw new Error(`Failed to fetch OpenRouter models: ${errorDetails}`);
                }
                const data = await res.json();
                return data.data || [];
            },
            /**
             * Calls the KoboldCPP API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callKoboldCPP(prompt, signal) {
                const state = StateManager.getState();

                const payload = {
                    prompt: prompt,
                    use_story: false, use_memory: false, use_authors_note: false, use_world_info: false,
                    max_context_length: 16384,
                    max_length: 512, // Updated to 512 as per your snippet
                    quiet: true,

                    // Sampling Settings
                    temperature: 1.0,
                    min_p: state.koboldcpp_min_p,
                    top_p: 1.0, // Disabled when using Min-P/DRY for pure results, or keep 0.92 if preferred
                    top_k: 0,
                    tfs: 1,
                    typical: 1,

                    // Disable Legacy Repetition Penalty (Conflict avoidance)
                    rep_pen: 1.0,
                    rep_pen_range: 2048,
                    rep_pen_slope: 0.7,

                    // Disable Mirostat to prevent interference with other samplers.
                    mirostat: 0,
                    mirostat_tau: 4,
                    mirostat_eta: 0.1,

                    // Configure DRY (Don't Repeat Yourself) sampler.
                    dry_multiplier: state.koboldcpp_dry,
                    dry_base: 1.75,
                    dry_allowed_length: 2,
                    dry_penalty_last_n: -1, // Scan entire context

                    sampler_order: [6, 0, 1, 2, 3, 4, 5]
                };

                const res = await fetch(`${state.koboldcpp_url}/api/v1/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal
                });

                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try { errorDetails += ` Message: ${(await res.json()).error.message}`; } catch (e) { errorDetails += ` Response body: ${await res.text()}`; }
                    throw new Error(`KoboldCPP API Error: ${errorDetails}`);
                }

                const data = await res.json();
                return data.results[0].text.trim();
            },

            /**
             * Streams a response from KoboldCPP using polling.
             * @param {string} prompt - The prompt.
             * @param {Function} onChunk - Callback for each text chunk.
             * @param {AbortSignal} signal - AbortSignal.
             */
            async streamKoboldPolled(prompt, onChunk, signal) {
                const state = StateManager.getState();

                // Identical Payload to callKoboldCPP to ensure consistency
                const payload = {
                    prompt: prompt,
                    use_story: false, use_memory: false, use_authors_note: false, use_world_info: false,
                    max_context_length: 16384,
                    max_length: 512, // Updated to 512 as per your snippet
                    quiet: true,

                    // Sampling Settings
                    temperature: 1.0,
                    min_p: state.koboldcpp_min_p,
                    top_p: 1.0, // Disabled when using Min-P/DRY for pure results, or keep 0.92 if preferred
                    top_k: 0,
                    tfs: 1,
                    typical: 1,

                    // Disable Legacy Repetition Penalty (Conflict avoidance)
                    rep_pen: 1.0,
                    rep_pen_range: 2048,
                    rep_pen_slope: 0.7,

                    // Disable Mirostat.
                    mirostat: 0,
                    mirostat_tau: 4,
                    mirostat_eta: 0.1,

                    // Configure DRY sampler.
                    dry_multiplier: state.koboldcpp_dry,
                    dry_base: 1.75,
                    dry_allowed_length: 2,
                    dry_penalty_last_n: -1, // Scan entire context

                    sampler_order: [6, 0, 1, 2, 3, 4, 5]
                };

                // 1. Start Generation
                await fetch(`${state.koboldcpp_url}/api/v1/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal
                });

                let finished = false;

                // 2. Poll for Tokens
                while (!finished) {
                    if (signal.aborted) break;

                    try {
                        const check = await fetch(`${state.koboldcpp_url}/api/extra/generate/check`, { signal });
                        const data = await check.json();

                        if (data.results && data.results[0]) {
                            onChunk(data.results[0].text);
                        }

                        if (data.done) finished = true;
                    } catch (e) {
                        if (e.name !== 'AbortError') console.warn("Polling error:", e);
                        // Don't break loop on transient network error, wait and retry
                    }

                    if (!finished) await new Promise(r => setTimeout(r, 100));
                }
            },

            /**
             * Calls the LM Studio API.
             * @param {string} prompt - The prompt.
             * @param {AbortSignal} signal - AbortSignal.
             * @returns {Promise<string>}
             */
            async callLMStudio(prompt, signal) {
                const state = StateManager.getState();
                if (!state.lmstudio_url) throw new Error("LM Studio URL not set.");
                const endpoint = `${state.lmstudio_url}/v1/chat/completions`;
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.7,
                        stream: false
                    }),
                    signal
                });

                if (!res.ok) {
                    let errorDetails = `Status: ${res.status} ${res.statusText}.`;
                    try {
                        const errorJson = await res.json();
                        errorDetails += ` Message: ${errorJson.error?.message || JSON.stringify(errorJson)}`;
                    } catch (e) {
                        errorDetails += ` Response body: ${await res.text()}`;
                    }
                    throw new Error(`LM Studio API Error: ${errorDetails}`);
                }
                const data = await res.json();
                return data.choices[0].message.content;
            },
        };

        const ModalManager = {
            RUNTIME: { carousel_interval: null },
            /**
             * Opens a modal by ID.
             * @param {string} modalId - The ID of the modal element.
             */
            open(modalId) {
                const modal = document.getElementById(modalId);
                if (modal) modal.style.display = 'flex';
            },
            /**
             * Closes a modal by ID and cleans up any intervals.
             * @param {string} modalId - The ID of the modal element.
             */
            close(modalId) {
                if (this.RUNTIME.carousel_interval) {
                    clearInterval(this.RUNTIME.carousel_interval);
                    this.RUNTIME.carousel_interval = null;
                }
                const modal = document.getElementById(modalId);
                if (modal) modal.style.display = 'none';
            }
        };