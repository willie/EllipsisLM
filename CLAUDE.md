# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EllipsisLM is an open-source, single-file HTML front-end for AI-powered roleplay and interactive storytelling. The entire application (~12,500 lines) lives in `index.html` and runs entirely in the browser with IndexedDB for persistence.

## Development

**No build system required.** Open `index.html` directly in a browser to run the app. All changes are made to the single `index.html` file.

## Architecture

### Module System

The app uses 19 singleton JavaScript objects as modules, all defined within script tags in index.html:

**Core Services:**
- `DBService` - IndexedDB wrapper with fail-soft behavior
- `StoryService` - Story/Scenario/Narrative CRUD operations
- `StateManager` - Application state and localStorage persistence
- `APIService` - AI provider integration (Gemini, OpenRouter, Koboldcpp, LM Studio)
- `PromptBuilder` - Context assembly and prompt generation
- `ReactiveStore` - Reactive state for real-time UI updates

**UI Layer:**
- `UIManager` - Main rendering orchestration
- `UIComponents` - Reusable UI building blocks
- `ModalManager` - Modal dialog management

**Controllers:**
- `AppController` - Global app actions
- `LibraryController` - Story library management
- `NarrativeController` - Chat/roleplay session control
- `WorldController` - World map and location management

**Event System:**
- `ActionHandler` - Centralized event delegation via `data-action` attributes
- `ActionDispatcher` - Routes DOM clicks to controller methods

### Data Model Hierarchy

```
Story (like a character card)
  └── Scenario (template for playthroughs)
        └── Narrative (actual playthrough with messages)
              └── Characters (multiple per narrative)
```

### Key Patterns

1. **Event Delegation**: UI interactions use `data-action="controller:method"` attributes. Register handlers with `ActionHandler.register()`.

2. **State Flow**: `ReactiveStore.state` is the single source of truth. Changes propagate to UI via reactive subscriptions.

3. **Persistence Split**: User preferences in localStorage, all data (stories, characters, messages) in IndexedDB.

4. **Module Discovery**: Search for `const ModuleName = {` to find module definitions.

## AI Backend Integration

The app supports four AI backends configured in `APIService`:
- Gemini API (cloud)
- OpenRouter API (cloud, multiple models)
- Koboldcpp (local, GGUF models)
- LM Studio (local)

## External Dependencies (CDN)

- Tailwind CSS - Styling
- marked.js - Markdown rendering
- jszip - ZIP file handling for import/export
- pako - Compression

## Code Style

- All modules use JSDoc comments for documentation
- HTML sanitization through `DOM` utility module (XSS protection)
- Debounced input handlers for performance
- Mobile-first responsive design (vertical vs horizontal layouts)
