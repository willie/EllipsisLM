import { Hono } from 'hono';
import { ImageService } from '../services/image.service.js';

const images = new Hono();

// Get character's main image
images.get('/characters/:charId/image', (c) => {
  const charId = c.req.param('charId');
  const image = ImageService.getCharacterImage(charId);

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  return new Response(image.data, {
    headers: {
      'Content-Type': image.mime_type,
      'Cache-Control': 'public, max-age=31536000'
    }
  });
});

// Upload character's main image
images.post('/characters/:charId/image', async (c) => {
  const charId = c.req.param('charId');
  const contentType = c.req.header('Content-Type') || 'image/png';

  const body = await c.req.arrayBuffer();
  const buffer = Buffer.from(body);

  const image = ImageService.saveCharacterImage(charId, buffer, contentType);
  return c.json({ id: image.id, character_id: image.character_id }, 201);
});

// Delete character's main image
images.delete('/characters/:charId/image', (c) => {
  const charId = c.req.param('charId');
  const deleted = ImageService.deleteCharacterImage(charId);

  if (!deleted) {
    return c.json({ error: 'Image not found' }, 404);
  }

  return c.json({ success: true });
});

// Get character's portrait by emotion
images.get('/characters/:charId/portraits/:emotion', (c) => {
  const charId = c.req.param('charId');
  const emotion = c.req.param('emotion');
  const image = ImageService.getCharacterImage(charId, emotion);

  if (!image) {
    return c.json({ error: 'Portrait not found' }, 404);
  }

  return new Response(image.data, {
    headers: {
      'Content-Type': image.mime_type,
      'Cache-Control': 'public, max-age=31536000'
    }
  });
});

// Upload character's portrait by emotion
images.post('/characters/:charId/portraits/:emotion', async (c) => {
  const charId = c.req.param('charId');
  const emotion = c.req.param('emotion');
  const contentType = c.req.header('Content-Type') || 'image/png';

  const body = await c.req.arrayBuffer();
  const buffer = Buffer.from(body);

  const image = ImageService.saveCharacterImage(charId, buffer, contentType, emotion);
  return c.json({ id: image.id, character_id: image.character_id, emotion: image.emotion }, 201);
});

// Delete character's portrait by emotion
images.delete('/characters/:charId/portraits/:emotion', (c) => {
  const charId = c.req.param('charId');
  const emotion = c.req.param('emotion');
  const deleted = ImageService.deleteCharacterImage(charId, emotion);

  if (!deleted) {
    return c.json({ error: 'Portrait not found' }, 404);
  }

  return c.json({ success: true });
});

// Get all images for a character
images.get('/characters/:charId/all', (c) => {
  const charId = c.req.param('charId');
  const images = ImageService.getCharacterImages(charId);

  // Return metadata only, not binary data
  return c.json(images.map(img => ({
    id: img.id,
    character_id: img.character_id,
    emotion: img.emotion,
    mime_type: img.mime_type,
    created_at: img.created_at
  })));
});

// Delete all images for a character
images.delete('/characters/:charId/all', (c) => {
  const charId = c.req.param('charId');
  const count = ImageService.deleteAllCharacterImages(charId);
  return c.json({ deleted: count });
});

export default images;
