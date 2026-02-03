import { Router } from 'express';
import { DBService } from '../db.js';

const router = Router();

// Get all narratives
router.get('/', (req, res) => {
  try {
    const narratives = DBService.getAllNarratives();
    res.json(narratives);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single narrative
router.get('/:id', (req, res) => {
  try {
    const narrative = DBService.getNarrative(req.params.id);
    if (!narrative) return res.status(404).json({ error: 'Narrative not found' });
    res.json(narrative);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save narrative (create or update)
router.post('/', (req, res) => {
  try {
    const narrative = req.body;
    if (!narrative.id) return res.status(400).json({ error: 'Narrative must have an id' });
    DBService.saveNarrative(narrative);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete narrative
router.delete('/:id', (req, res) => {
  try {
    DBService.deleteNarrative(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
