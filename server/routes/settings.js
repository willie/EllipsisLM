import { Router } from 'express';
import { DBService } from '../db.js';

const router = Router();

// Get global settings
router.get('/', (req, res) => {
  try {
    const settings = DBService.getSetting('globalSettings') || {};
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save global settings
router.post('/', (req, res) => {
  try {
    DBService.saveSetting('globalSettings', req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active story/narrative IDs
router.get('/active', (req, res) => {
  try {
    const activeStoryId = DBService.getSetting('active_story_id');
    const activeNarrativeId = DBService.getSetting('active_narrative_id');
    res.json({ activeStoryId, activeNarrativeId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save active story/narrative IDs
router.post('/active', (req, res) => {
  try {
    const { activeStoryId, activeNarrativeId } = req.body;
    if (activeStoryId !== undefined) {
      DBService.saveSetting('active_story_id', activeStoryId);
    }
    if (activeNarrativeId !== undefined) {
      DBService.saveSetting('active_narrative_id', activeNarrativeId);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
