# EllipsisLM Server

A server-based backend for EllipsisLM AI Roleplay application, built with Hono and SQLite.

## Features

- **RESTful API**: Full CRUD operations for stories, characters, narratives, and more
- **SQLite Storage**: Persistent storage with better-sqlite3
- **Single-user Mode**: Simple auth for personal use (expandable to multi-user)
- **Binary Image Storage**: Character portraits stored in database
- **Full Export/Import**: Compatible with existing JSON export format

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or build and run production
npm run build
npm start
```

The server will start on `http://localhost:3000` by default.

## Configuration

Environment variables:

- `PORT`: Server port (default: 3000)
- `DB_PATH`: Path to SQLite database file (default: `./data/ellipsislm.db`)

## API Endpoints

### Stories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stories` | List all stories |
| GET | `/api/stories?q=search` | Search stories |
| GET | `/api/stories/:id` | Get story by ID |
| GET | `/api/stories/:id/full` | Get full story with characters, scenarios, etc. |
| POST | `/api/stories` | Create new story |
| PUT | `/api/stories/:id` | Update story |
| DELETE | `/api/stories/:id` | Delete story |
| POST | `/api/stories/:id/duplicate` | Duplicate story |

### Characters

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stories/:id/characters` | List characters for story |
| POST | `/api/stories/:id/characters` | Create character |
| GET | `/api/stories/:storyId/characters/:charId` | Get character |
| PUT | `/api/stories/:storyId/characters/:charId` | Update character |
| DELETE | `/api/stories/:storyId/characters/:charId` | Delete character |

### Scenarios

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stories/:id/scenarios` | List scenarios |
| POST | `/api/stories/:id/scenarios` | Create scenario |
| PUT | `/api/stories/:storyId/scenarios/:scenarioId` | Update scenario |
| DELETE | `/api/stories/:storyId/scenarios/:scenarioId` | Delete scenario |

### Dynamic Entries

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stories/:id/dynamic-entries` | List dynamic entries |
| POST | `/api/stories/:id/dynamic-entries` | Create dynamic entry |
| PUT | `/api/stories/:storyId/dynamic-entries/:entryId` | Update dynamic entry |
| DELETE | `/api/stories/:storyId/dynamic-entries/:entryId` | Delete dynamic entry |

### Narratives

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stories/:id/narratives` | List narratives for story |
| GET | `/api/narratives/:id` | Get narrative |
| GET | `/api/narratives/:id/full` | Get full narrative with messages, world map |
| POST | `/api/narratives` | Create narrative |
| PUT | `/api/narratives/:id` | Update narrative |
| DELETE | `/api/narratives/:id` | Delete narrative |
| POST | `/api/narratives/:id/duplicate` | Duplicate narrative |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/narratives/:id/messages` | List messages |
| POST | `/api/narratives/:id/messages` | Create message |
| PUT | `/api/narratives/:narrativeId/messages/:msgId` | Update message |
| DELETE | `/api/narratives/:narrativeId/messages/:msgId` | Delete message |
| POST | `/api/narratives/:id/messages/undo/:sortOrder` | Undo (delete messages after sortOrder) |
| POST | `/api/narratives/:id/messages/mark-read` | Mark all messages as read |

### Static Entries

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/narratives/:id/static-entries` | List static entries |
| POST | `/api/narratives/:id/static-entries` | Create static entry |
| PUT | `/api/narratives/:narrativeId/static-entries/:entryId` | Update static entry |
| DELETE | `/api/narratives/:narrativeId/static-entries/:entryId` | Delete static entry |

### World Map

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/narratives/:id/world-map` | Get world map with locations |
| PUT | `/api/narratives/:id/world-map` | Update world map position/destination |
| GET | `/api/narratives/:id/world-map/locations/:x/:y` | Get location |
| PUT | `/api/narratives/:id/world-map/locations/:x/:y` | Update location |

### Images

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/images/characters/:charId/image` | Get character image |
| POST | `/api/images/characters/:charId/image` | Upload character image |
| DELETE | `/api/images/characters/:charId/image` | Delete character image |
| GET | `/api/images/characters/:charId/portraits/:emotion` | Get portrait by emotion |
| POST | `/api/images/characters/:charId/portraits/:emotion` | Upload portrait |
| DELETE | `/api/images/characters/:charId/portraits/:emotion` | Delete portrait |
| GET | `/api/images/characters/:charId/all` | List all images for character |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get settings (API keys masked) |
| PUT | `/api/settings` | Update settings |
| GET | `/api/settings/api-keys` | Get raw API keys |
| GET | `/api/settings/active` | Get active story/narrative |
| PUT | `/api/settings/active` | Set active story/narrative |
| GET | `/api/settings/personas` | List user personas |
| POST | `/api/settings/personas` | Create persona |
| PUT | `/api/settings/personas/:id` | Update persona |
| DELETE | `/api/settings/personas/:id` | Delete persona |

## Frontend Integration

The server includes an API client that can be used in the frontend:

```typescript
import { EllipsisAPI } from './server/src/client/api-client';

// Get all stories
const stories = await EllipsisAPI.stories.getAll();

// Create a new story
const story = await EllipsisAPI.stories.create({
  name: 'My Story',
  api_provider: 'gemini'
});

// Get messages for a narrative
const messages = await EllipsisAPI.messages.getByNarrative(narrativeId);

// Create a message
const message = await EllipsisAPI.messages.create(narrativeId, {
  character_id: charId,
  content: 'Hello world!'
});
```

## Database Schema

The SQLite database includes the following tables:

- `users` - User accounts
- `global_settings` - Per-user settings and API keys
- `user_personas` - Reusable character templates
- `stories` - Story metadata and configuration
- `characters` - Characters per story
- `scenarios` - Starting points for narratives
- `dynamic_entries` - Triggered lore entries
- `narratives` - Playthrough sessions
- `chat_messages` - Chat history
- `static_entries` - Always-in-context knowledge
- `narrative_dynamic_entries` - Per-narrative dynamic entry state
- `world_maps` - 8x8 grid maps per narrative
- `world_locations` - Location data for world maps
- `character_images` - Binary image storage

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run database migrations
npm run db:migrate

# Build for production
npm run build
```

## License

MIT
