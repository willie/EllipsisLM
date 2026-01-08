import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { getDatabase, closeDatabase } from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import stories from './routes/stories.js';
import narratives from './routes/narratives.js';
import settings from './routes/settings.js';
import images from './routes/images.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*', // In production, restrict this
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Initialize database
getDatabase();

// Auth middleware for all API routes
app.use('/api/*', authMiddleware);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API Routes
app.route('/api/stories', stories);
app.route('/api/narratives', narratives);
app.route('/api/settings', settings);
app.route('/api/images', images);

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  closeDatabase();
  process.exit(0);
});

// Start server
const port = parseInt(process.env.PORT || '3000');

console.log(`Starting EllipsisLM server on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
  console.log('\nAvailable endpoints:');
  console.log('  GET  /health');
  console.log('  GET  /api/stories');
  console.log('  GET  /api/stories/:id');
  console.log('  GET  /api/stories/:id/full');
  console.log('  POST /api/stories');
  console.log('  PUT  /api/stories/:id');
  console.log('  DELETE /api/stories/:id');
  console.log('  POST /api/stories/:id/duplicate');
  console.log('  GET  /api/stories/:id/characters');
  console.log('  POST /api/stories/:id/characters');
  console.log('  GET  /api/stories/:id/scenarios');
  console.log('  GET  /api/stories/:id/dynamic-entries');
  console.log('  GET  /api/stories/:id/narratives');
  console.log('  GET  /api/narratives/:id');
  console.log('  GET  /api/narratives/:id/full');
  console.log('  POST /api/narratives');
  console.log('  PUT  /api/narratives/:id');
  console.log('  DELETE /api/narratives/:id');
  console.log('  GET  /api/narratives/:id/messages');
  console.log('  POST /api/narratives/:id/messages');
  console.log('  GET  /api/narratives/:id/static-entries');
  console.log('  GET  /api/narratives/:id/world-map');
  console.log('  GET  /api/settings');
  console.log('  PUT  /api/settings');
  console.log('  GET  /api/settings/personas');
  console.log('  GET  /api/images/characters/:charId/image');
  console.log('  ... and more');
});

export default app;
