import { Router } from 'express';

const router = Router();

// Get API keys from environment (never expose these to client)
const getKeys = () => ({
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openRouterKey: process.env.OPENROUTER_API_KEY || '',
  imageGenOpenRouterKey: process.env.IMAGE_GEN_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY || '',
});

// Check which providers are configured (without exposing keys)
router.get('/providers', (req, res) => {
  const keys = getKeys();
  res.json({
    gemini: !!keys.geminiApiKey,
    openrouter: !!keys.openRouterKey,
    imageGen: !!keys.imageGenOpenRouterKey,
  });
});

// Main AI generation endpoint
router.post('/generate', async (req, res) => {
  const { provider, prompt, model, options = {} } = req.body;
  const keys = getKeys();

  try {
    let result;

    if (provider === 'gemini') {
      result = await callGemini(prompt, model, keys.geminiApiKey, options);
    } else if (provider === 'openrouter') {
      result = await callOpenRouter(prompt, model, keys.openRouterKey, options);
    } else if (provider === 'koboldcpp') {
      result = await callKoboldCPP(prompt, options);
    } else if (provider === 'lmstudio') {
      result = await callLMStudio(prompt, options);
    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    res.json({ text: result });
  } catch (error) {
    console.error('AI generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available Gemini models
router.get('/models/gemini', async (req, res) => {
  const keys = getKeys();
  if (!keys.geminiApiKey) {
    return res.json([]);
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${keys.geminiApiKey}`
    );
    if (!response.ok) {
      return res.json([]);
    }
    const data = await response.json();
    const models = (data.models || []).filter(m =>
      m.supportedGenerationMethods?.includes('generateContent')
    );
    res.json(models);
  } catch (error) {
    console.error('Failed to fetch Gemini models:', error);
    res.json([]);
  }
});

// Get available OpenRouter models
router.get('/models/openrouter', async (req, res) => {
  const keys = getKeys();
  const headers = { 'Content-Type': 'application/json' };
  if (keys.openRouterKey) {
    headers['Authorization'] = `Bearer ${keys.openRouterKey}`;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers
    });
    if (!response.ok) {
      return res.json([]);
    }
    const data = await response.json();
    res.json(data.data || []);
  } catch (error) {
    console.error('Failed to fetch OpenRouter models:', error);
    res.json([]);
  }
});

// Image generation endpoint
router.post('/image', async (req, res) => {
  const { provider, prompt, negativePrompt = '', options = {} } = req.body;
  const keys = getKeys();

  try {
    let imageBase64;

    if (provider === 'koboldcpp') {
      imageBase64 = await generateKoboldCPP(prompt, negativePrompt, options);
    } else if (provider === 'openrouter') {
      imageBase64 = await generateOpenRouter(prompt, keys.imageGenOpenRouterKey, options);
    } else {
      return res.status(400).json({ error: `Unknown image provider: ${provider}` });
    }

    res.json({ image: imageBase64 });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Provider implementations ---

async function callGemini(prompt, model, apiKey, options) {
  if (!apiKey) throw new Error('Gemini API key not configured on server');

  let modelId = model || 'gemini-1.5-flash';
  if (modelId.startsWith('models/')) {
    modelId = modelId.replace('models/', '');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Gemini API Error: ${response.status} - ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenRouter(prompt, model, apiKey, options) {
  if (!apiKey) throw new Error('OpenRouter API key not configured on server');
  if (!model) throw new Error('OpenRouter model not specified');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`OpenRouter API Error: ${response.status} - ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callKoboldCPP(prompt, options) {
  const url = options.koboldcpp_url || 'http://localhost:5001';

  const payload = {
    prompt: prompt,
    use_story: false,
    use_memory: false,
    use_authors_note: false,
    use_world_info: false,
    max_context_length: 16384,
    max_length: 512,
    quiet: true,
    temperature: 1.0,
    min_p: options.koboldcpp_min_p ?? 0.1,
    top_p: 1.0,
    top_k: 0,
    tfs: 1,
    typical: 1,
    rep_pen: 1.0,
    rep_pen_range: 2048,
    rep_pen_slope: 0.7,
    mirostat: 0,
    mirostat_tau: 4,
    mirostat_eta: 0.1,
    dry_multiplier: options.koboldcpp_dry ?? 0.25,
    dry_base: 1.75,
    dry_allowed_length: 2,
    dry_penalty_last_n: -1,
    sampler_order: [6, 0, 1, 2, 3, 4, 5],
  };

  const response = await fetch(`${url}/api/v1/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`KoboldCPP API Error: ${response.status} - ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.results[0].text.trim();
}

async function callLMStudio(prompt, options) {
  const url = options.lmstudio_url || 'http://localhost:1234';

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`LM Studio API Error: ${response.status} - ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function generateKoboldCPP(prompt, negativePrompt, options) {
  const url = options.koboldImageGenUrl || 'http://localhost:5001';

  const payload = {
    prompt: prompt,
    negative_prompt: negativePrompt || '',
    width: options.width || 512,
    height: options.height || 512,
    steps: options.steps || 20,
    cfg_scale: options.cfg_scale || 7,
  };

  const response = await fetch(`${url}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`KoboldCPP Image API Error: ${response.status}`);
  }

  const data = await response.json();
  return data.images?.[0] || '';
}

async function generateOpenRouter(prompt, apiKey, options) {
  if (!apiKey) throw new Error('OpenRouter image API key not configured on server');

  const model = options.model || 'openai/dall-e-3';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`OpenRouter Image API Error: ${response.status} - ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  // OpenRouter image models return base64 in the content
  return data.choices[0].message.content;
}

export default router;
