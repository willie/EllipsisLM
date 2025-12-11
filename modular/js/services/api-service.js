/**
 * APIService Module
 * Handles all AI provider integrations (Gemini, OpenRouter, KoboldCPP, LM Studio).
 */
const APIService = {
    /**
     * Calls the configured AI provider with a given prompt.
     * @param {string} prompt - The prompt to send to the AI.
     * @param {boolean} [isJson=false] - Whether to expect a JSON response.
     * @param {AbortSignal|null} [signal=null] - An AbortSignal to cancel the request.
     * @returns {Promise<string>} The AI's response text.
     */
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
                if (jsonMatch && jsonMatch[0]) {
                    return jsonMatch[0];
                }
                console.error("AI did not return valid JSON for a JSON-expected call. Response:", text);
                throw new Error("AI response was not in the expected JSON format.");
            }
            return text.trim();
        } catch (error) {
            // Don't re-throw abort errors, as they are intentional.
            if (error.name === 'AbortError') {
                console.log("Fetch aborted by user.");
                throw error; // Re-throw to be caught by the controller
            }
            console.error(`AI call failed for provider ${state.apiProvider}:`, error);
            throw error;
        }
    },

    async callGemini(prompt, signal) {
        const state = StateManager.getState();
        if (!state.geminiApiKey) throw new Error("Gemini API key not set.");
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${state.geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            signal
        });
        if (!res.ok) {
            let errorDetails = `Status: ${res.status} ${res.statusText}.`;
            try { errorDetails += ` Message: ${(await res.json()).error.message}`; } catch (e) { errorDetails += ` Response body: ${await res.text()}`; }
            throw new Error(`API Error: ${errorDetails}`);
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    },

    async callOpenRouter(prompt, signal) {
        const state = StateManager.getState();
        if (!state.openRouterKey || !state.openRouterModel) throw new Error("OpenRouter API key or model not set.");
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.openRouterKey}`},
            body: JSON.stringify({ model: state.openRouterModel, messages: [{ role: 'user', content: prompt }] }),
            signal
        });
        if (!res.ok) {
            let errorDetails = `Status: ${res.status} ${res.statusText}.`;
            try { const errorJson = await res.json(); errorDetails += ` Message: ${errorJson.error.message || JSON.stringify(errorJson.error)}`; } catch (e) { errorDetails += ` Response body: ${await res.text()}`; }
            throw new Error(`API Error: ${errorDetails}`);
        }
        const data = await res.json();
        return data.choices[0].message.content;
    },

    async callKoboldCPP(prompt, signal) {
        const state = StateManager.getState();
        const payload = {
            prompt: prompt,
            use_story: false,
            use_memory: false,
            use_authors_note: false,
            use_world_info: false,
            max_context_length: 4096,
            max_length: 200,
            min_p: state.koboldcpp_min_p,
            rep_pen: 1.1,
            rep_pen_range: 2048,
            rep_pen_slope: 0.7,
            temperature: 0.65,
            tfs: 1,
            top_p: 0.92,
            top_k: 0,
            typical: 1,
            sampler_order: [6, 0, 1, 2, 3, 4, 5],
            mirostat: 2,
            mirostat_tau: 4,
            mirostat_eta: 0.1,
            dry: state.koboldcpp_dry,
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

    async callLMStudio(prompt, signal) {
        const state = StateManager.getState();
        if (!state.lmstudio_url) throw new Error("LM Studio URL not set.");
        const endpoint = `${state.lmstudio_url}/v1/chat/completions`;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, stream: false }),
            signal
        });
        if (!res.ok) {
            let errorDetails = `Status: ${res.status} ${res.statusText}.`;
            try { const errorJson = await res.json(); errorDetails += ` Message: ${errorJson.error?.message || JSON.stringify(errorJson.error)}`; } catch (e) { errorDetails += ` Response body: ${await res.text()}`; }
            throw new Error(`LM Studio API Error: ${errorDetails}`);
        }
        const data = await res.json();
        return data.choices[0].message.content;
    },
};


/**
 * ModalManager Module
 * Simple modal open/close utilities.
 */
const ModalManager = {
    RUNTIME: {
        carousel_interval: null,
    },
    open(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        }
    },
    close(modalId) {
        if (this.RUNTIME.carousel_interval) {
            clearInterval(this.RUNTIME.carousel_interval);
            this.RUNTIME.carousel_interval = null;
        }
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }
};
