import { Router } from 'express';
import { DBService } from '../db.js';

const router = Router();

// Export all data (for backup)
router.get('/export', (req, res) => {
  try {
    const stories = DBService.getAllStories();
    const narratives = DBService.getAllNarratives();
    const imageKeys = DBService.getAllImageKeys();

    // Images are exported as base64
    const images = imageKeys.map(key => {
      const img = DBService.getImage(key);
      return {
        key,
        data: img ? img.data.toString('base64') : null,
        mimeType: img?.mimeType || 'image/png'
      };
    }).filter(img => img.data);

    res.json({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      stories,
      narratives,
      images
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import data (restore from backup)
router.post('/import', async (req, res) => {
  try {
    const { stories, narratives, images, clearExisting } = req.body;

    // Optionally clear existing data
    if (clearExisting) {
      DBService.clearStore('stories');
      DBService.clearStore('narratives');
      DBService.clearStore('characterImages');
    }

    // Import stories
    if (stories && Array.isArray(stories)) {
      for (const story of stories) {
        DBService.saveStory(story);
      }
    }

    // Import narratives
    if (narratives && Array.isArray(narratives)) {
      for (const narrative of narratives) {
        DBService.saveNarrative(narrative);
      }
    }

    // Import images
    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.key && img.data) {
          const buffer = Buffer.from(img.data, 'base64');
          DBService.saveImage(img.key, buffer, img.mimeType || 'image/png');
        }
      }
    }

    res.json({
      success: true,
      imported: {
        stories: stories?.length || 0,
        narratives: narratives?.length || 0,
        images: images?.length || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all data
router.post('/clear', (req, res) => {
  try {
    const { stores } = req.body;

    if (!stores || stores.includes('stories')) {
      DBService.clearStore('stories');
    }
    if (!stores || stores.includes('narratives')) {
      DBService.clearStore('narratives');
    }
    if (!stores || stores.includes('characterImages')) {
      DBService.clearStore('characterImages');
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
