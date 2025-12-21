# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EllipsisLM is an open-source front-end for AI-powered roleplay. This `modular/` directory contains a refactored version with separate files for easier development. The root `index.html` is the original monolithic version synced from upstream.

**Key Features:**
- Offline-first with IndexedDB for data persistence
- Supports multiple AI backends: Gemini API, OpenRouter API, local Koboldcpp, or LM Studio
- Import/export functionality for V2 Tavern Card PNG and BYAF format cards
- Complex roleplay system with Stories, Scenarios, Narratives, and Characters
- Optional location/world map system with 8x8 grid
- Static and dynamic knowledge management (lorebook system)
- AI agents for event generation, sentiment analysis, and content generation

## Development

### Running the Modular Version

```bash
# From repository root, serve with Go
go run modular/local.go
# Then visit http://localhost:8080/modular/

# Or serve with Python
python3 -m http.server 8000
# Then visit http://localhost:8000/modular/
```

### Project Structure

```
modular/
├── index.html              # Entry point
├── css/styles.css          # All CSS
├── js/
│   ├── preamble.js         # Standalone code (APP_BUILD_TIMESTAMP, debounce)
│   ├── services/           # Core services
│   │   ├── utility.js      # DOM, ActionHandler, UTILITY helpers
│   │   ├── db-service.js   # IndexedDB (fail-soft pattern)
│   │   ├── story-service.js
│   │   ├── state-manager.js
│   │   ├── api-service.js  # LLM integrations + ModalManager
│   │   ├── prompt-builder.js
│   │   ├── image-processor.js
│   │   └── import-export-service.js
│   ├── ui/ui-manager.js    # All UI rendering
│   ├── controller.js       # Event handlers, business logic
│   └── app.js              # Initialization, migrations
├── CLAUDE.md               # This file
└── ARCHITECTURE.md         # Detailed architecture documentation
```

**Script load order matters:** preamble → utility → db-service → story-service → state-manager → api-service → prompt-builder → image-processor → import-export-service → ui-manager → controller → app

## Architecture

See `ARCHITECTURE.md` for detailed documentation. Key points:

### Data Model Hierarchy

1. **Stories** (top level) - Equivalent to character cards
   - Contains: characters, scenarios, dynamic_entries, system prompts, UI settings
   - Stored in IndexedDB 'stories' object store

2. **Scenarios** - Templates for playthroughs
   - Embedded within story objects (not separate DB records)

3. **Narratives** - Actual play-throughs
   - Stored separately in IndexedDB 'narratives' object store
   - Created from a scenario template but evolves independently

4. **Characters** - Stored within story objects, referenced by ID

### Core Services

| Service | File | Responsibility |
|---------|------|----------------|
| DBService | `db-service.js` | IndexedDB ops (fail-soft: returns null/false, never throws) |
| StoryService | `story-service.js` | Story/narrative orchestration, import/export |
| StateManager | `state-manager.js` | Global state, maintains LIBRARY and active STATE |
| APIService | `api-service.js` | LLM integration (Gemini, OpenRouter, Koboldcpp, LM Studio) |
| PromptBuilder | `prompt-builder.js` | Constructs prompts with text replacement |
| UIManager | `ui-manager.js` | UI rendering, responsive layout, image caching |
| Controller | `controller.js` | Event handlers, coordinates services |
| ImportExportService | `import-export-service.js` | V2 PNG parsing, BYAF, ZIP backup |

### Data Storage

**IndexedDB (Database: "EllipsisLM"):**
- `stories` - Story objects (keyPath: 'id')
- `narratives` - Narrative objects (keyPath: 'id')
- `characterImages` - Image blobs (keys: `characterId` or `characterId::emotion::emotionName`)

**LocalStorage:**
- `active_story_id`, `active_narrative_id` - Currently loaded session
- `aiStorytellerGlobalSettings` - API keys, model config

## Implementation Notes

**State Management:**
- STATE saved via `StateManager.saveState()` after every change
- Use `debounce()` from utility.js for text input handlers

**Image Handling:**
- Character images stored as blobs in IndexedDB
- Runtime cache: `UIManager.RUNTIME.characterImageCache` (object URLs)

**Error Handling:**
- DBService methods never throw - return null/false on error
- UI operations show spinner via `UIManager.showLoadingSpinner()` / `hideLoadingSpinner()`

**Prompt Building:**
- Context: system_prompt, location info, static_entries, characters, chat_history
- Text replacement: `{character}` → character name, `{user}` → user name

## AI Backend Comparison

| Feature | Gemini | OpenRouter | Koboldcpp | LM Studio |
|---------|--------|------------|-----------|-----------|
| Type | Cloud | Cloud | Local | Local |
| API Key | Yes | Yes | No | No |
| CORS Config | No | No | No | Yes |
| Default Port | N/A | N/A | 5001 | 1234 |
