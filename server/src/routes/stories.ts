import { Hono } from 'hono';
import { StoryService } from '../services/story.service.js';
import type { CreateStoryRequest, UpdateStoryRequest, CreateCharacterRequest, CreateScenarioRequest, CreateDynamicEntryRequest } from '../types/index.js';

const stories = new Hono();

// Get all stories
stories.get('/', (c) => {
  const userId = c.get('userId') as string;
  const query = c.req.query('q');

  let storyList;
  if (query) {
    storyList = StoryService.searchStories(userId, query);
  } else {
    storyList = StoryService.getAllStories(userId);
  }

  return c.json(storyList);
});

// Get a single story
stories.get('/:id', (c) => {
  const id = c.req.param('id');
  const story = StoryService.getStoryById(id);

  if (!story) {
    return c.json({ error: 'Story not found' }, 404);
  }

  return c.json(story);
});

// Get full story export (with characters, scenarios, etc.)
stories.get('/:id/full', (c) => {
  const id = c.req.param('id');
  const fullStory = StoryService.getFullStory(id);

  if (!fullStory) {
    return c.json({ error: 'Story not found' }, 404);
  }

  return c.json(fullStory);
});

// Create a new story
stories.post('/', async (c) => {
  const userId = c.get('userId') as string;
  const data = await c.req.json<CreateStoryRequest>();

  if (!data.name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const story = StoryService.createStory(userId, data);
  return c.json(story, 201);
});

// Update a story
stories.put('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await c.req.json<UpdateStoryRequest>();

  const story = StoryService.updateStory(id, data);

  if (!story) {
    return c.json({ error: 'Story not found' }, 404);
  }

  return c.json(story);
});

// Delete a story
stories.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = StoryService.deleteStory(id);

  if (!deleted) {
    return c.json({ error: 'Story not found' }, 404);
  }

  return c.json({ success: true });
});

// Duplicate a story
stories.post('/:id/duplicate', (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId') as string;

  const story = StoryService.duplicateStory(id, userId);

  if (!story) {
    return c.json({ error: 'Story not found' }, 404);
  }

  return c.json(story, 201);
});

// Characters routes
stories.get('/:id/characters', (c) => {
  const storyId = c.req.param('id');
  const characters = StoryService.getCharactersByStoryId(storyId);
  return c.json(characters);
});

stories.post('/:id/characters', async (c) => {
  const storyId = c.req.param('id');
  const data = await c.req.json<CreateCharacterRequest>();

  if (!data.name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const character = StoryService.createCharacter(storyId, data);
  return c.json(character, 201);
});

stories.get('/:storyId/characters/:charId', (c) => {
  const charId = c.req.param('charId');
  const character = StoryService.getCharacterById(charId);

  if (!character) {
    return c.json({ error: 'Character not found' }, 404);
  }

  return c.json(character);
});

stories.put('/:storyId/characters/:charId', async (c) => {
  const charId = c.req.param('charId');
  const data = await c.req.json<Partial<CreateCharacterRequest>>();

  const character = StoryService.updateCharacter(charId, data);

  if (!character) {
    return c.json({ error: 'Character not found' }, 404);
  }

  return c.json(character);
});

stories.delete('/:storyId/characters/:charId', (c) => {
  const charId = c.req.param('charId');
  const deleted = StoryService.deleteCharacter(charId);

  if (!deleted) {
    return c.json({ error: 'Character not found' }, 404);
  }

  return c.json({ success: true });
});

// Scenarios routes
stories.get('/:id/scenarios', (c) => {
  const storyId = c.req.param('id');
  const scenarios = StoryService.getScenariosByStoryId(storyId);
  return c.json(scenarios);
});

stories.post('/:id/scenarios', async (c) => {
  const storyId = c.req.param('id');
  const data = await c.req.json<CreateScenarioRequest>();

  if (!data.name || !data.message) {
    return c.json({ error: 'Name and message are required' }, 400);
  }

  const scenario = StoryService.createScenario(storyId, data);
  return c.json(scenario, 201);
});

stories.put('/:storyId/scenarios/:scenarioId', async (c) => {
  const scenarioId = c.req.param('scenarioId');
  const data = await c.req.json<Partial<CreateScenarioRequest>>();

  const scenario = StoryService.updateScenario(scenarioId, data);

  if (!scenario) {
    return c.json({ error: 'Scenario not found' }, 404);
  }

  return c.json(scenario);
});

stories.delete('/:storyId/scenarios/:scenarioId', (c) => {
  const scenarioId = c.req.param('scenarioId');
  const deleted = StoryService.deleteScenario(scenarioId);

  if (!deleted) {
    return c.json({ error: 'Scenario not found' }, 404);
  }

  return c.json({ success: true });
});

// Dynamic entries routes
stories.get('/:id/dynamic-entries', (c) => {
  const storyId = c.req.param('id');
  const entries = StoryService.getDynamicEntriesByStoryId(storyId);
  return c.json(entries);
});

stories.post('/:id/dynamic-entries', async (c) => {
  const storyId = c.req.param('id');
  const data = await c.req.json<CreateDynamicEntryRequest>();

  if (!data.title || !data.triggers) {
    return c.json({ error: 'Title and triggers are required' }, 400);
  }

  const entry = StoryService.createDynamicEntry(storyId, data);
  return c.json(entry, 201);
});

stories.put('/:storyId/dynamic-entries/:entryId', async (c) => {
  const entryId = c.req.param('entryId');
  const data = await c.req.json<Partial<CreateDynamicEntryRequest>>();

  const entry = StoryService.updateDynamicEntry(entryId, data);

  if (!entry) {
    return c.json({ error: 'Dynamic entry not found' }, 404);
  }

  return c.json(entry);
});

stories.delete('/:storyId/dynamic-entries/:entryId', (c) => {
  const entryId = c.req.param('entryId');
  const deleted = StoryService.deleteDynamicEntry(entryId);

  if (!deleted) {
    return c.json({ error: 'Dynamic entry not found' }, 404);
  }

  return c.json({ success: true });
});

// Narratives list for a story
stories.get('/:id/narratives', (c) => {
  const storyId = c.req.param('id');
  const { NarrativeService } = require('../services/narrative.service.js');
  const narratives = NarrativeService.getNarrativesByStoryId(storyId);
  return c.json(narratives);
});

export default stories;
