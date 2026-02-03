import { Router } from 'express';
import { DBService } from '../db.js';

const router = Router();

// Get all stories
router.get('/', (req, res) => {
  try {
    const stories = DBService.getAllStories();
    res.json(stories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single story
router.get('/:id', (req, res) => {
  try {
    const story = DBService.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    res.json(story);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save story (create or update)
router.post('/', (req, res) => {
  try {
    const story = req.body;
    if (!story.id) return res.status(400).json({ error: 'Story must have an id' });
    DBService.saveStory(story);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete story
router.delete('/:id', (req, res) => {
  try {
    DBService.deleteStory(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
