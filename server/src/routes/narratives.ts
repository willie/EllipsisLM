import { Hono } from 'hono';
import { NarrativeService } from '../services/narrative.service.js';
import type {
  CreateNarrativeRequest,
  CreateMessageRequest,
  UpdateMessageRequest,
  CreateStaticEntryRequest,
  UpdateStaticEntryRequest,
  UpdateWorldMapRequest,
  UpdateWorldLocationRequest
} from '../types/index.js';

const narratives = new Hono();

// Get a single narrative
narratives.get('/:id', (c) => {
  const id = c.req.param('id');
  const narrative = NarrativeService.getNarrativeById(id);

  if (!narrative) {
    return c.json({ error: 'Narrative not found' }, 404);
  }

  return c.json(narrative);
});

// Get full narrative export (with messages, entries, world map)
narratives.get('/:id/full', (c) => {
  const id = c.req.param('id');
  const fullNarrative = NarrativeService.getFullNarrative(id);

  if (!fullNarrative) {
    return c.json({ error: 'Narrative not found' }, 404);
  }

  return c.json(fullNarrative);
});

// Create a new narrative
narratives.post('/', async (c) => {
  const userId = c.get('userId') as string;
  const data = await c.req.json<CreateNarrativeRequest>();

  if (!data.name || !data.story_id) {
    return c.json({ error: 'Name and story_id are required' }, 400);
  }

  const narrative = NarrativeService.createNarrative(userId, data);
  return c.json(narrative, 201);
});

// Update a narrative
narratives.put('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await c.req.json<{ name?: string; active_character_ids?: string[] }>();

  const narrative = NarrativeService.updateNarrative(id, data);

  if (!narrative) {
    return c.json({ error: 'Narrative not found' }, 404);
  }

  return c.json(narrative);
});

// Delete a narrative
narratives.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = NarrativeService.deleteNarrative(id);

  if (!deleted) {
    return c.json({ error: 'Narrative not found' }, 404);
  }

  return c.json({ success: true });
});

// Duplicate a narrative
narratives.post('/:id/duplicate', (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId') as string;

  const narrative = NarrativeService.duplicateNarrative(id, userId);

  if (!narrative) {
    return c.json({ error: 'Narrative not found' }, 404);
  }

  return c.json(narrative, 201);
});

// Messages routes
narratives.get('/:id/messages', (c) => {
  const narrativeId = c.req.param('id');
  const messages = NarrativeService.getMessagesByNarrativeId(narrativeId);
  return c.json(messages);
});

narratives.post('/:id/messages', async (c) => {
  const narrativeId = c.req.param('id');
  const data = await c.req.json<CreateMessageRequest>();

  if (!data.character_id || !data.content) {
    return c.json({ error: 'character_id and content are required' }, 400);
  }

  const message = NarrativeService.createMessage(narrativeId, data);
  return c.json(message, 201);
});

narratives.put('/:narrativeId/messages/:msgId', async (c) => {
  const msgId = c.req.param('msgId');
  const data = await c.req.json<UpdateMessageRequest>();

  const message = NarrativeService.updateMessage(msgId, data);

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  return c.json(message);
});

narratives.delete('/:narrativeId/messages/:msgId', (c) => {
  const msgId = c.req.param('msgId');
  const deleted = NarrativeService.deleteMessage(msgId);

  if (!deleted) {
    return c.json({ error: 'Message not found' }, 404);
  }

  return c.json({ success: true });
});

// Undo - delete messages after a certain point
narratives.post('/:id/messages/undo/:sortOrder', (c) => {
  const narrativeId = c.req.param('id');
  const sortOrder = parseInt(c.req.param('sortOrder'));

  if (isNaN(sortOrder)) {
    return c.json({ error: 'Invalid sortOrder' }, 400);
  }

  const deleted = NarrativeService.deleteMessagesAfter(narrativeId, sortOrder);
  return c.json({ deleted });
});

// Mark all messages as read
narratives.post('/:id/messages/mark-read', (c) => {
  const narrativeId = c.req.param('id');
  NarrativeService.markMessagesAsRead(narrativeId);
  return c.json({ success: true });
});

// Static entries routes
narratives.get('/:id/static-entries', (c) => {
  const narrativeId = c.req.param('id');
  const entries = NarrativeService.getStaticEntriesByNarrativeId(narrativeId);
  return c.json(entries);
});

narratives.post('/:id/static-entries', async (c) => {
  const narrativeId = c.req.param('id');
  const data = await c.req.json<CreateStaticEntryRequest>();

  if (!data.title || !data.content) {
    return c.json({ error: 'Title and content are required' }, 400);
  }

  const entry = NarrativeService.createStaticEntry(narrativeId, data);
  return c.json(entry, 201);
});

narratives.put('/:narrativeId/static-entries/:entryId', async (c) => {
  const entryId = c.req.param('entryId');
  const data = await c.req.json<UpdateStaticEntryRequest>();

  const entry = NarrativeService.updateStaticEntry(entryId, data);

  if (!entry) {
    return c.json({ error: 'Static entry not found' }, 404);
  }

  return c.json(entry);
});

narratives.delete('/:narrativeId/static-entries/:entryId', (c) => {
  const entryId = c.req.param('entryId');
  const deleted = NarrativeService.deleteStaticEntry(entryId);

  if (!deleted) {
    return c.json({ error: 'Static entry not found' }, 404);
  }

  return c.json({ success: true });
});

// Dynamic entry trigger tracking
narratives.get('/:id/dynamic-entries', (c) => {
  const narrativeId = c.req.param('id');
  const entries = NarrativeService.getNarrativeDynamicEntries(narrativeId);
  return c.json(entries);
});

narratives.post('/:id/dynamic-entries/:entryId/trigger', async (c) => {
  const narrativeId = c.req.param('id');
  const entryId = c.req.param('entryId');
  const { turn } = await c.req.json<{ turn: number }>();

  const entry = NarrativeService.triggerDynamicEntry(narrativeId, entryId, turn);
  return c.json(entry);
});

// World map routes
narratives.get('/:id/world-map', (c) => {
  const narrativeId = c.req.param('id');
  const worldMap = NarrativeService.getWorldMapByNarrativeId(narrativeId);

  if (!worldMap) {
    return c.json({ error: 'World map not found' }, 404);
  }

  // Get locations too
  const locations = NarrativeService.getWorldLocationsByMapId(worldMap.id);

  return c.json({
    ...worldMap,
    locations
  });
});

narratives.put('/:id/world-map', async (c) => {
  const narrativeId = c.req.param('id');
  const data = await c.req.json<UpdateWorldMapRequest>();

  const worldMap = NarrativeService.updateWorldMap(narrativeId, data);

  if (!worldMap) {
    return c.json({ error: 'World map not found' }, 404);
  }

  return c.json(worldMap);
});

// World locations routes
narratives.get('/:id/world-map/locations/:x/:y', (c) => {
  const narrativeId = c.req.param('id');
  const x = parseInt(c.req.param('x'));
  const y = parseInt(c.req.param('y'));

  if (isNaN(x) || isNaN(y)) {
    return c.json({ error: 'Invalid coordinates' }, 400);
  }

  const location = NarrativeService.getWorldLocation(narrativeId, x, y);

  if (!location) {
    return c.json({ error: 'Location not found' }, 404);
  }

  return c.json(location);
});

narratives.put('/:id/world-map/locations/:x/:y', async (c) => {
  const narrativeId = c.req.param('id');
  const x = parseInt(c.req.param('x'));
  const y = parseInt(c.req.param('y'));
  const data = await c.req.json<UpdateWorldLocationRequest>();

  if (isNaN(x) || isNaN(y)) {
    return c.json({ error: 'Invalid coordinates' }, 400);
  }

  const location = NarrativeService.updateWorldLocation(narrativeId, x, y, data);

  if (!location) {
    return c.json({ error: 'Location not found' }, 404);
  }

  return c.json(location);
});

export default narratives;
