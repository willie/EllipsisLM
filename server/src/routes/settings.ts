import { Hono } from 'hono';
import { UserService } from '../services/user.service.js';
import type { UpdateSettingsRequest, CreateUserPersonaRequest } from '../types/index.js';

const settings = new Hono();

// Get settings
settings.get('/', (c) => {
  const userId = c.get('userId') as string;
  const userSettings = UserService.getOrCreateSettings(userId);

  // Don't expose raw API keys - mask them
  return c.json({
    ...userSettings,
    gemini_api_key: userSettings.gemini_api_key ? '***' + userSettings.gemini_api_key.slice(-4) : null,
    open_router_key: userSettings.open_router_key ? '***' + userSettings.open_router_key.slice(-4) : null,
    ui_preferences: JSON.parse(userSettings.ui_preferences || '{}')
  });
});

// Update settings
settings.put('/', async (c) => {
  const userId = c.get('userId') as string;
  const data = await c.req.json<UpdateSettingsRequest>();

  const userSettings = UserService.updateSettings(userId, data);

  return c.json({
    ...userSettings,
    gemini_api_key: userSettings.gemini_api_key ? '***' + userSettings.gemini_api_key.slice(-4) : null,
    open_router_key: userSettings.open_router_key ? '***' + userSettings.open_router_key.slice(-4) : null,
    ui_preferences: JSON.parse(userSettings.ui_preferences || '{}')
  });
});

// Get raw API keys (separate endpoint for security)
settings.get('/api-keys', (c) => {
  const userId = c.get('userId') as string;
  const userSettings = UserService.getSettings(userId);

  if (!userSettings) {
    return c.json({ error: 'Settings not found' }, 404);
  }

  return c.json({
    gemini_api_key: userSettings.gemini_api_key,
    open_router_key: userSettings.open_router_key,
    koboldcpp_url: userSettings.koboldcpp_url,
    lmstudio_url: userSettings.lmstudio_url
  });
});

// Get active story/narrative
settings.get('/active', (c) => {
  const userId = c.get('userId') as string;
  const userSettings = UserService.getSettings(userId);

  return c.json({
    active_story_id: userSettings?.active_story_id || null,
    active_narrative_id: userSettings?.active_narrative_id || null
  });
});

// Set active story/narrative
settings.put('/active', async (c) => {
  const userId = c.get('userId') as string;
  const data = await c.req.json<{ active_story_id?: string; active_narrative_id?: string }>();

  UserService.updateSettings(userId, data);

  return c.json({
    active_story_id: data.active_story_id,
    active_narrative_id: data.active_narrative_id
  });
});

// User personas routes
settings.get('/personas', (c) => {
  const userId = c.get('userId') as string;
  const personas = UserService.getPersonas(userId);

  return c.json(personas.map(p => ({
    ...p,
    tags: JSON.parse(p.tags || '[]')
  })));
});

settings.post('/personas', async (c) => {
  const userId = c.get('userId') as string;
  const data = await c.req.json<CreateUserPersonaRequest>();

  if (!data.name || !data.description) {
    return c.json({ error: 'Name and description are required' }, 400);
  }

  const persona = UserService.createPersona(userId, data);
  return c.json({
    ...persona,
    tags: JSON.parse(persona.tags || '[]')
  }, 201);
});

settings.get('/personas/:id', (c) => {
  const id = c.req.param('id');
  const persona = UserService.getPersonaById(id);

  if (!persona) {
    return c.json({ error: 'Persona not found' }, 404);
  }

  return c.json({
    ...persona,
    tags: JSON.parse(persona.tags || '[]')
  });
});

settings.put('/personas/:id', async (c) => {
  const id = c.req.param('id');
  const data = await c.req.json<Partial<CreateUserPersonaRequest>>();

  const persona = UserService.updatePersona(id, data);

  if (!persona) {
    return c.json({ error: 'Persona not found' }, 404);
  }

  return c.json({
    ...persona,
    tags: JSON.parse(persona.tags || '[]')
  });
});

settings.delete('/personas/:id', (c) => {
  const id = c.req.param('id');
  const deleted = UserService.deletePersona(id);

  if (!deleted) {
    return c.json({ error: 'Persona not found' }, 404);
  }

  return c.json({ success: true });
});

export default settings;
