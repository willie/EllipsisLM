import { Router } from 'express';
import { DBService } from '../db.js';

const router = Router();

// Get all image keys
router.get('/keys', (req, res) => {
  try {
    const keys = DBService.getAllImageKeys();
    res.json(keys);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single image (returns as binary)
router.get('/:id', (req, res) => {
  try {
    const image = DBService.getImage(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.set('Content-Type', image.mimeType);
    res.send(image.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save image (expects raw binary body with content-type header)
router.post('/:id', (req, res) => {
  try {
    const mimeType = req.get('Content-Type') || 'image/png';
    DBService.saveImage(req.params.id, req.body, mimeType);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete image
router.delete('/:id', (req, res) => {
  try {
    DBService.deleteImage(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all images
router.delete('/', (req, res) => {
  try {
    DBService.clearImages();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
