/**
 * EllipsisLM Server
 *
 * A Node.js/Express server that serves the EllipsisLM frontend and provides
 * API proxy routes for AI backends (Gemini, OpenRouter, KoboldCPP, LM Studio).
 *
 * Features:
 * - Serves static files (index.html, images, etc.)
 * - Proxies API calls to avoid CORS issues
 * - Supports environment variables for API keys
 * - Configurable port via environment variable
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// =============================================================================
// API PROXY ROUTES
// =============================================================================

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

/**
 * Server configuration endpoint
 * Returns available API keys (existence only, not values)
 */
app.get('/api/config', (req, res) => {
    res.json({
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
        defaultKoboldUrl: process.env.KOBOLDCPP_URL || 'http://localhost:5001',
        defaultLMStudioUrl: process.env.LMSTUDIO_URL || 'http://localhost:1234'
    });
});

// =============================================================================
// GEMINI API PROXY
// =============================================================================

/**
 * Proxy for Gemini API - List Models
 */
app.get('/api/gemini/models', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(400).json({ error: 'Gemini API key not provided' });
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('Gemini models error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy for Gemini API - Generate Content
 */
app.post('/api/gemini/generate', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
    const { model, contents } = req.body;

    if (!apiKey) {
        return res.status(400).json({ error: 'Gemini API key not provided' });
    }

    if (!model || !contents) {
        return res.status(400).json({ error: 'Model and contents are required' });
    }

    // Strip "models/" prefix if present
    const modelId = model.startsWith('models/') ? model.replace('models/', '') : model;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('Gemini generate error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// OPENROUTER API PROXY
// =============================================================================

/**
 * Proxy for OpenRouter API - List Models
 */
app.get('/api/openrouter/models', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || process.env.OPENROUTER_API_KEY;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            method: 'GET',
            headers
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('OpenRouter models error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy for OpenRouter API - Chat Completions
 */
app.post('/api/openrouter/chat', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || process.env.OPENROUTER_API_KEY;
    const { model, messages } = req.body;

    if (!apiKey) {
        return res.status(400).json({ error: 'OpenRouter API key not provided' });
    }

    if (!model || !messages) {
        return res.status(400).json({ error: 'Model and messages are required' });
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': req.headers.referer || 'http://localhost:3000',
                'X-Title': 'EllipsisLM'
            },
            body: JSON.stringify({ model, messages })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('OpenRouter chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy for OpenRouter API - Image Generation (DALL-E etc.)
 */
app.post('/api/openrouter/image', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        return res.status(400).json({ error: 'OpenRouter API key not provided' });
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': req.headers.referer || 'http://localhost:3000',
                'X-Title': 'EllipsisLM'
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('OpenRouter image error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// KOBOLDCPP API PROXY
// =============================================================================

/**
 * Proxy for KoboldCPP - Check Connection
 */
app.get('/api/kobold/check', async (req, res) => {
    const baseUrl = req.headers['x-kobold-url'] || process.env.KOBOLDCPP_URL || 'http://localhost:5001';

    try {
        const response = await fetch(`${baseUrl}/api/v1/model`);
        const data = await response.json();
        res.json({ connected: true, ...data });
    } catch (error) {
        res.json({ connected: false, error: error.message });
    }
});

/**
 * Proxy for KoboldCPP - Generate
 */
app.post('/api/kobold/generate', async (req, res) => {
    const baseUrl = req.headers['x-kobold-url'] || process.env.KOBOLDCPP_URL || 'http://localhost:5001';

    try {
        const response = await fetch(`${baseUrl}/api/v1/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('KoboldCPP generate error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy for KoboldCPP - Check Generation Status (polling)
 */
app.get('/api/kobold/check-generation', async (req, res) => {
    const baseUrl = req.headers['x-kobold-url'] || process.env.KOBOLDCPP_URL || 'http://localhost:5001';

    try {
        const response = await fetch(`${baseUrl}/api/extra/generate/check`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy for KoboldCPP SDAPI - Options (image generation check)
 */
app.get('/api/kobold/sdapi/options', async (req, res) => {
    const baseUrl = req.headers['x-kobold-url'] || process.env.KOBOLDCPP_URL || 'http://localhost:5001';

    try {
        const response = await fetch(`${baseUrl}/sdapi/v1/options`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy for KoboldCPP SDAPI - Text to Image
 */
app.post('/api/kobold/sdapi/txt2img', async (req, res) => {
    const baseUrl = req.headers['x-kobold-url'] || process.env.KOBOLDCPP_URL || 'http://localhost:5001';

    try {
        const response = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('KoboldCPP SDAPI error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// LM STUDIO API PROXY
// =============================================================================

/**
 * Proxy for LM Studio - Chat Completions
 */
app.post('/api/lmstudio/chat', async (req, res) => {
    const baseUrl = req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234';

    try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...req.body,
                stream: false
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('LM Studio chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy for LM Studio - Check Connection
 */
app.get('/api/lmstudio/check', async (req, res) => {
    const baseUrl = req.headers['x-lmstudio-url'] || process.env.LMSTUDIO_URL || 'http://localhost:1234';

    try {
        const response = await fetch(`${baseUrl}/v1/models`);
        const data = await response.json();
        res.json({ connected: true, ...data });
    } catch (error) {
        res.json({ connected: false, error: error.message });
    }
});

// =============================================================================
// FALLBACK ROUTE
// =============================================================================

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                     EllipsisLM Server                         ║
╠═══════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT.toString().padEnd(24)}║
║                                                               ║
║  API Endpoints:                                               ║
║  • GET  /api/health          - Health check                   ║
║  • GET  /api/config          - Server configuration           ║
║  • GET  /api/gemini/models   - List Gemini models             ║
║  • POST /api/gemini/generate - Gemini text generation         ║
║  • GET  /api/openrouter/models - List OpenRouter models       ║
║  • POST /api/openrouter/chat - OpenRouter chat completion     ║
║  • POST /api/kobold/generate - KoboldCPP text generation      ║
║  • POST /api/lmstudio/chat   - LM Studio chat completion      ║
║                                                               ║
║  Environment Variables (optional):                            ║
║  • PORT             - Server port (default: 3000)             ║
║  • GEMINI_API_KEY   - Default Gemini API key                  ║
║  • OPENROUTER_API_KEY - Default OpenRouter API key            ║
║  • KOBOLDCPP_URL    - KoboldCPP URL (default: localhost:5001) ║
║  • LMSTUDIO_URL     - LM Studio URL (default: localhost:1234) ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});
