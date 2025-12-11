# EllipsisLM Architecture Documentation

This document provides exhaustive documentation of how EllipsisLM works internally, including data models, context construction, character handling, location systems, AI agents, and state management.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Data Model Hierarchy](#2-data-model-hierarchy)
3. [Context Construction System](#3-context-construction-system)
4. [Character System](#4-character-system)
5. [Location & World Map System](#5-location--world-map-system)
6. [AI Agents](#6-ai-agents)
7. [State Management](#7-state-management)
8. [Service Architecture](#8-service-architecture)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [Import/Export System](#10-importexport-system)

---

## 1. Executive Summary

EllipsisLM is a browser-based AI roleplay frontend that runs entirely from a single HTML file (~8400 lines). It requires no installation, works offline after initial load, and stores all data locally in the browser.

### Core Architecture Principles

```
┌─────────────────────────────────────────────────────────────────┐
│                        index.html                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  External Libraries: Tailwind, JSZip, Marked, Pako       │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  CSS Styles (~750 lines)                                 │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  HTML Structure (~10 lines)                              │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  JavaScript Services (~7600 lines)                       │   │
│  │    • DBService, StoryService, StateManager               │   │
│  │    • APIService, PromptBuilder, UIManager                │   │
│  │    • Controller, ImportExportService, UTILITY            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Supported AI Backends

| Backend | Type | Authentication | Default Endpoint |
|---------|------|----------------|------------------|
| Gemini | Cloud API | API Key | Google servers |
| OpenRouter | Cloud API | API Key | OpenRouter servers |
| Koboldcpp | Local | None | http://localhost:5001 |
| LM Studio | Local | None | http://localhost:1234 |

### Storage Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      IndexedDB                               │
│  Database: "EllipsisLM"                                      │
│  ┌─────────────────┬─────────────────┬───────────────────┐  │
│  │ stories         │ narratives      │ characterImages   │  │
│  │ (keyPath: id)   │ (keyPath: id)   │ (manual keys)     │  │
│  └─────────────────┴─────────────────┴───────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      localStorage                            │
│  • active_story_id      - Currently loaded story            │
│  • active_narrative_id  - Currently active playthrough      │
│  • STATE                - Serialized current state          │
│  • LIBRARY              - Cached story list                 │
│  • SETTINGS             - API keys, model config            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Data Model Hierarchy

EllipsisLM uses a unique four-level data hierarchy that separates reusable content from play-specific state.

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                            STORY                                     │
│  (Top-level container, equivalent to "character card")              │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ characters[]│  │ scenarios[] │  │ narratives[]│ (stubs only)    │
│  │   (master)  │  │ (templates) │  │             │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
│         │                │                │                         │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐                 │
│  │dynamic_     │  │prompts,     │  │ References  │                 │
│  │entries[]    │  │UI settings  │  │ to IDB      │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐
│    SCENARIO     │  │    SCENARIO     │  │       NARRATIVE         │
│   (Template)    │  │   (Template)    │  │  (Active Playthrough)   │
│                 │  │                 │  │                         │
│ • message       │  │ • message       │  │ • chat_history[]        │
│ • static_       │  │ • static_       │  │ • messageCounter        │
│   entries[]     │  │   entries[]     │  │ • static_entries[]      │
│ • worldMap      │  │ • worldMap      │  │ • worldMap (evolving)   │
│ • example_      │  │ • active_       │  │ • active_character_ids  │
│   dialogue      │  │   character_ids │  │                         │
│                 │  │                 │  │ Stored in IndexedDB     │
│ Embedded in     │  │ Embedded in     │  │ 'narratives' store      │
│ story.scenarios │  │ story.scenarios │  │                         │
└─────────────────┘  └─────────────────┘  └─────────────────────────┘
```

### 2.1 Story Object Structure

The Story is the master container that holds all reusable content:

```javascript
{
  // === Identity ===
  id: "uuid",
  name: "My Adventure",
  created_date: "2024-12-10T...",
  last_modified: "2024-12-10T...",
  creator_notes: "A brief description for the library",
  tags: ["fantasy", "adventure", "solo"],

  // === Characters (Master List) ===
  characters: [
    { id, name, description, is_user, is_narrator, is_active, ... }
  ],

  // === Scenarios (Reusable Templates) ===
  scenarios: [
    { id, name, message, static_entries, worldMap, example_dialogue, ... }
  ],

  // === Narrative References (Stubs) ===
  narratives: [
    { id: "narrative-uuid", name: "Playthrough 1" }
  ],

  // === Dynamic Knowledge (Lorebook) ===
  dynamic_entries: [
    { id, title, triggers, content_fields, current_index }
  ],

  // === Prompt Templates ===
  system_prompt: "You are a master storyteller...",
  event_master_base_prompt: "You are a secret Event Master...",
  prompt_persona_gen: "Embellish this character concept...",
  prompt_world_map_gen: "Generate an 8x8 grid of locations...",
  prompt_location_gen: "Generate a rich location description...",
  prompt_entry_gen: "Generate an encyclopedia entry...",
  prompt_location_memory_gen: "Summarize the events at this location...",

  // === UI Appearance ===
  font: "Inter",
  backgroundImageURL: "",
  bubbleOpacity: 0.8,
  chatTextColor: "#ffffff",
  backgroundBlur: 5,
  textSize: "base",
  bubbleImageSize: "large",
  characterImageMode: "portrait"
}
```

### 2.2 Scenario Object Structure

Scenarios are templates embedded within a story. They capture a starting point that can be used to create multiple narratives:

```javascript
{
  id: "uuid",
  name: "The Beginning",

  // First visible message when narrative starts
  message: "The story begins in the ancient tavern...",

  // Hidden example messages for AI context
  example_dialogue: [
    {
      character_id: "char-uuid",
      content: "Example of how Alice speaks",
      type: "chat",
      isHidden: true,
      emotion: "neutral"
    }
  ],

  // World knowledge snapshot
  static_entries: [
    { id: "uuid", title: "World Overview", content: "A high-fantasy realm..." }
  ],

  // Optional: Dynamic entries snapshot
  dynamic_entries: [...],

  // World map snapshot
  worldMap: {
    grid: [/* 64 location objects */],
    currentLocation: { x: 4, y: 4 },
    destination: null,
    path: []
  },

  // Which characters are active in this template
  active_character_ids: ["char-uuid-1", "char-uuid-2"],

  // Optional: Prompt overrides
  prompts: {
    system_prompt: "...",
    event_master_base_prompt: "..."
  }
}
```

### 2.3 Narrative Object Structure

Narratives are active play sessions stored separately in IndexedDB. They evolve independently from their source scenario:

```javascript
{
  id: "uuid",
  name: "The Beginning - Playthrough",
  last_modified: "2024-12-10T...",

  // Which characters can respond in THIS playthrough
  active_character_ids: ["char-uuid-1", "char-uuid-2"],

  // All mutable play state
  state: {
    // Chat grows with each message
    chat_history: [
      {
        character_id: "char-uuid",
        content: "Hello, traveler!",
        type: "chat",           // 'chat' | 'lore_reveal' | 'system_event'
        emotion: "happy",       // Detected by sentiment analysis
        timestamp: "...",
        isHidden: false,        // Hidden = example dialogue
        isNew: true             // UI indicator for animations
      }
    ],

    // Turn counter
    messageCounter: 42,

    // World knowledge (may diverge from scenario)
    static_entries: [...],

    // World map with location memories
    worldMap: {
      grid: [/* 64 locations with local_static_entries */],
      currentLocation: { x: 5, y: 3 },
      destination: { x: 7, y: 6 },
      path: [{ x: 5, y: 4 }, { x: 6, y: 5 }, { x: 7, y: 6 }]
    }
  }
}
```

### 2.4 Character Object Structure

Characters are defined in the story and referenced by ID in scenarios/narratives:

```javascript
{
  id: "uuid",
  name: "Alice",

  // For AI context
  description: "A brave adventurer with a mysterious past...",
  short_description: "Brave adventurer",
  model_instructions: "You are Alice. Respond with courage and wit.",

  // Role flags
  is_user: false,      // Is this the player character?
  is_narrator: false,  // Special narrator behavior?
  is_active: true,     // Can respond in current narrative?

  // Visuals
  image_url: "",       // Base portrait URL (or empty for IDB)
  extra_portraits: [
    { emotion: "happy", url: "" },
    { emotion: "sad", url: "" },
    { emotion: "angry", url: "" },
    { emotion: "surprised", url: "" }
  ],

  // Metadata
  tags: ["adventurer", "protagonist"],
  color: {
    base: "#4f46e5",   // Chat bubble background
    bold: "#6366f1"    // Character name color
  }
}
```

### 2.5 Dynamic Entry (Lorebook) Structure

Dynamic entries are triggered based on keywords in chat:

```javascript
{
  id: "uuid",
  title: "The Ancient Curse",

  // Trigger conditions (see Section 3.4 for syntax)
  triggers: "curse, forbidden AND magic, 25%",

  // Sequential content (rotates on each trigger)
  content_fields: [
    "First revelation about the curse...",
    "Second revelation, revealed on next trigger...",
    "Final revelation..."
  ],

  // Which content to show next
  current_index: 0,

  // When last triggered (for de-duplication)
  triggered_at_turn: null
}
```

---

## 3. Context Construction System

The `PromptBuilder` object orchestrates how all content is assembled into prompts for the AI.

### 3.1 Prompt Structure Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      FINAL PROMPT STRUCTURE                      │
├─────────────────────────────────────────────────────────────────┤
│ 1. SYSTEM PROMPT                                                 │
│    Character's model_instructions OR story's system_prompt       │
├─────────────────────────────────────────────────────────────────┤
│ 2. EVENT MASTER INSTRUCTION (if present)                         │
│    --- SECRET EVENT MASTER INSTRUCTION ---                       │
│    "Introduce an unexpected event where..."                      │
├─────────────────────────────────────────────────────────────────┤
│ 3. ## LOCATION CONTEXT                                           │
│    CURRENT LOCATION: The Tavern                                  │
│    [Rich description...]                                         │
│    ADJACENT LOCATIONS:                                           │
│    - (North): Town Square - A bustling marketplace               │
│    TRAVEL PATH TO DESTINATION: Tavern -> Square -> Forest        │
├─────────────────────────────────────────────────────────────────┤
│ 4. ## WORLD KNOWLEDGE                                            │
│    ### Entry Title                                               │
│    Entry content...                                              │
├─────────────────────────────────────────────────────────────────┤
│ 5. ## CHARACTERS                                                 │
│    ### Character: Alice                                          │
│    A brave adventurer with a mysterious past...                  │
├─────────────────────────────────────────────────────────────────┤
│ 6. ## EXAMPLE DIALOGUE (if present)                              │
│    Alice: Example of how Alice speaks                            │
│    Narrator: Example of narrative style                          │
├─────────────────────────────────────────────────────────────────┤
│ 7. ## RECENT CONVERSATION & EVENTS                               │
│    [You:]                                                        │
│    I approach the mysterious stranger.                           │
│                                                                  │
│    [System Note:                                                 │
│    The ancient curse has been revealed...]                       │
│                                                                  │
│    [Alice:]                                                      │
│    "Welcome, traveler. I've been expecting you."                 │
├─────────────────────────────────────────────────────────────────┤
│ 8. FINAL INSTRUCTION                                             │
│    Generate the next response for Alice. Stay in character.      │
│    [CHARACTER_TO_ACT]: Alice                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Prompt Building Flow

```
PromptBuilder.buildPrompt(charToActId, isForUser)
    │
    ├─► Get character to act
    │
    ├─► Create text replacer function
    │   • {character} → Character name
    │   • {user} → User character name
    │
    ├─► Get character instructions
    │   • Use character.model_instructions if defined
    │   • Fall back to story.system_prompt
    │
    ├─► Build location context
    │   ├─► Current location (name + prompt + local entries)
    │   ├─► Adjacent locations (8 directions)
    │   └─► Travel path (if destination set)
    │
    ├─► Assemble components object
    │   • system_prompt
    │   • event_master_prompt
    │   • location_context
    │   • static_entries (formatted)
    │   • characters (formatted)
    │   • chat_history
    │
    └─► Route to formatter
        ├─► buildDefaultPrompt() - For Gemini, OpenRouter, LM Studio
        └─► buildKoboldPrompt() - For Koboldcpp with template variants
```

### 3.3 Smart History Slicing

The `_getSmartHistorySlice()` function ensures only relevant recent messages are included:

```
Full chat_history (100+ messages)
        │
        ▼
┌───────────────────────────────────────┐
│ Walk backward through history         │
│                                       │
│ Count only VISIBLE messages:          │
│ • type: 'chat' AND isHidden: false    │
│                                       │
│ Ignore:                               │
│ • type: 'lore_reveal'                 │
│ • type: 'system_event'                │
│ • isHidden: true                      │
│                                       │
│ Stop when 10 visible messages found   │
└───────────────────────────────────────┘
        │
        ▼
Last 10 visible messages (plus inline lore reveals)
```

### 3.4 Dynamic Knowledge Trigger System

Dynamic entries are evaluated via `checkDynamicEntryTriggers()` after each message:

#### Trigger Syntax

| Syntax | Meaning | Example |
|--------|---------|---------|
| `keyword` | Any occurrence triggers | `curse` |
| `word1, word2` | OR - Either triggers | `curse, hex` |
| `word1 AND word2` | Both must appear | `forbidden AND magic` |
| `word1 XOR word2` | Exactly one must appear | `light XOR dark` |
| `25%` | Random chance | `dragon, 25%` |
| Combined | Mix syntax | `curse, forbidden AND magic, 10%` |

#### Trigger Evaluation Flow

```
User submits message
        │
        ▼
checkDynamicEntryTriggers()
        │
        ├─► For each dynamic_entry:
        │   │
        │   ├─► Parse trigger string
        │   │
        │   ├─► Check de-duplication
        │   │   • Look back 20 messages
        │   │   • Skip if already revealed this content
        │   │
        │   ├─► Evaluate keywords against last message
        │   │   • OR: Any keyword matches
        │   │   • AND: All keywords match
        │   │   • XOR: Exactly one matches
        │   │
        │   ├─► Check percentage (if present)
        │   │   • Random roll against percentage
        │   │
        │   └─► If triggered:
        │       • Get content_fields[current_index]
        │       • Increment current_index (wraps around)
        │       • Add to chat_history as type: 'lore_reveal'
        │       • Mark isHidden: true (not shown in UI)
        │
        └─► Lore reveals appear in prompt as:
            [System Note:
            The revealed content...]
```

### 3.5 Text Replacement System

The `_getReplacer()` function creates a replacer that substitutes placeholders:

```javascript
// Template with placeholders
"Write a response for {character} considering what {user} said."

// After replacement (character=Alice, user=You)
"Write a response for Alice considering what You said."
```

Applied to:
- Model instructions
- Static entry content
- Dynamic entry content
- Location descriptions
- System prompts

---

## 4. Character System

### 4.1 Character Types

```
┌─────────────────────────────────────────────────────────────────┐
│                     CHARACTER TYPES                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ USER         │  │ NARRATOR     │  │ REGULAR NPC  │          │
│  │ CHARACTER    │  │              │  │              │          │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤          │
│  │ is_user:true │  │is_narrator:  │  │is_user:false │          │
│  │is_narrator:  │  │   true       │  │is_narrator:  │          │
│  │   false      │  │is_user:false │  │   false      │          │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤          │
│  │ • Single per │  │ • Responds   │  │ • Standard   │          │
│  │   story      │  │   after      │  │   AI char    │          │
│  │ • Player-    │  │   location   │  │ • Multiple   │          │
│  │   controlled │  │   moves      │  │   allowed    │          │
│  │ • Always     │  │ • Never 2x   │  │ • Higher     │          │
│  │   active     │  │   in a row   │  │   priority   │          │
│  │ • Required   │  │ • Lower base │  │   than       │          │
│  │   to chat    │  │   priority   │  │   narrator   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Response Selection Algorithm

When "Any" is selected in the character dropdown, `determineNextSpeaker()` uses weighted scoring:

```
┌─────────────────────────────────────────────────────────────────┐
│            RESPONSE SELECTION SCORING                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BASE SCORES:                                                    │
│  • Narrator characters: 0                                        │
│  • Regular NPCs: 1                                               │
│                                                                  │
│  BONUSES:                                                        │
│  ┌─────────────────────────────────────┬──────────┐             │
│  │ Condition                           │ Bonus    │             │
│  ├─────────────────────────────────────┼──────────┤             │
│  │ Was last speaker                    │ +1.0     │             │
│  │ Was second-to-last speaker          │ +0.5     │             │
│  │ Name mentioned in last 2 messages   │ +0.5     │             │
│  │ Name mentioned in last 4 messages   │ +0.5     │             │
│  │ Narrator: per turn since last spoke │ +0.2     │             │
│  └─────────────────────────────────────┴──────────┘             │
│                                                                  │
│  SPECIAL RULES:                                                  │
│  • After location move → Narrator responds                       │
│  • Narrator just spoke → Remove from pool                        │
│  • No active non-user chars → Skip AI response                   │
│                                                                  │
│  FINAL SELECTION:                                                │
│  Weighted random choice based on accumulated scores              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Sentiment Analysis

After each AI response, `analyzeTurn()` analyzes the user's message:

```
User message: "I smile and wave at Alice happily"
                          │
                          ▼
               ┌─────────────────────┐
               │   analyzeTurn()     │
               │                     │
               │ AI Prompt:          │
               │ "Analyze for        │
               │  sentiment and      │
               │  location intent"   │
               └──────────┬──────────┘
                          │
                          ▼
               ┌─────────────────────┐
               │ AI Response (JSON): │
               │ {                   │
               │   emotion: "happy", │
               │   locationName:     │
               │     null            │
               │ }                   │
               └──────────┬──────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
        ▼                                   ▼
┌───────────────────┐             ┌───────────────────┐
│ Portrait Selection│             │ Location Movement │
│                   │             │                   │
│ Look up:          │             │ If locationName   │
│ ${charId}::       │             │ is valid:         │
│   emotion::happy  │             │ • Move player     │
│                   │             │ • Update worldMap │
│ Fall back to base │             │ • Trigger narrator│
│ portrait if none  │             │   response        │
└───────────────────┘             └───────────────────┘
```

**Valid Emotions:** `neutral`, `happy`, `sad`, `angry`, `surprised`

### 4.4 Character Portrait System

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMAGE STORAGE KEYS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  IndexedDB 'characterImages' store:                             │
│                                                                  │
│  ┌─────────────────────────────────────┬─────────────────────┐  │
│  │ Key Format                          │ Purpose             │  │
│  ├─────────────────────────────────────┼─────────────────────┤  │
│  │ ${characterId}                      │ Base portrait       │  │
│  │ ${characterId}::emotion::happy      │ Happy portrait      │  │
│  │ ${characterId}::emotion::sad        │ Sad portrait        │  │
│  │ ${characterId}::emotion::angry      │ Angry portrait      │  │
│  │ ${characterId}::emotion::surprised  │ Surprised portrait  │  │
│  │ ${characterId}::emotion::neutral    │ Neutral portrait    │  │
│  │ location::${x},${y}                 │ Location image      │  │
│  └─────────────────────────────────────┴─────────────────────┘  │
│                                                                  │
│  Runtime cache: UIManager.RUNTIME.characterImageCache           │
│  • Object URLs created from blobs                               │
│  • Populated at app startup via image hydration                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 Active/Inactive Toggle

Characters can be toggled active/inactive per narrative:

```
┌───────────────────────────────────────────────────────┐
│ Character: Alice                                      │
│ ┌─────────────────────────────────────────────────┐  │
│ │ [✓] Active in this chat                         │  │
│ └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
         │
         │ is_active: true
         │
         ▼
┌────────────────────────────────────┐
│ Effects of is_active: true         │
│                                    │
│ • Included in response pool        │
│ • Shown in character selector      │
│ • Description in AI context        │
│ • Full opacity in roster           │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ Effects of is_active: false        │
│                                    │
│ • Excluded from response pool      │
│ • Hidden from character selector   │
│ • NOT in AI context                │
│ • 50% opacity + grayscale in UI    │
│ • "Inactive" badge shown           │
└────────────────────────────────────┘
```

---

## 5. Location & World Map System

### 5.1 World Map Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        8x8 WORLD GRID                            │
│                                                                  │
│    0   1   2   3   4   5   6   7                                │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┐                              │
│ 0│   │   │   │   │   │   │   │   │                              │
│  ├───┼───┼───┼───┼───┼───┼───┼───┤                              │
│ 1│   │   │   │   │   │   │   │   │                              │
│  ├───┼───┼───┼───┼───┼───┼───┼───┤                              │
│ 2│   │   │   │   │   │   │   │   │                              │
│  ├───┼───┼───┼───┼───┼───┼───┼───┤                              │
│ 3│   │   │   │   │   │   │   │   │                              │
│  ├───┼───┼───┼───┼───┼───┼───┼───┤                              │
│ 4│   │   │   │   │ @ │ → │ → │ ★ │  @ = Current (4,4)           │
│  ├───┼───┼───┼───┼───┼───┼───┼───┤  ★ = Destination (7,4)       │
│ 5│   │   │   │   │   │   │   │   │  → = Path                    │
│  ├───┼───┼───┼───┼───┼───┼───┼───┤                              │
│ 6│   │   │   │   │   │   │   │   │                              │
│  ├───┼───┼───┼───┼───┼───┼───┼───┤                              │
│ 7│   │   │   │   │   │   │   │   │                              │
│  └───┴───┴───┴───┴───┴───┴───┴───┘                              │
│                                                                  │
│  worldMap: {                                                     │
│    grid: [64 location objects],                                  │
│    currentLocation: { x: 4, y: 4 },                             │
│    destination: { x: 7, y: 4 },                                 │
│    path: [{x:5,y:4}, {x:6,y:4}, {x:7,y:4}]                      │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Location Tile Structure

Each of the 64 grid cells contains:

```javascript
{
  coords: { x: 4, y: 4 },
  name: "The Ancient Tavern",
  description: "A weathered inn at the crossroads",    // Short summary
  prompt: "The tavern's oak beams creak with age...",  // Rich paragraph for AI
  imageUrl: "",                                         // Location image
  local_static_entries: [                              // Location memories
    {
      id: "uuid",
      title: "Events from turn 5 to 12",
      content: "The party met a mysterious stranger who..."
    }
  ]
}
```

### 5.3 Location Context in Prompts

When generating AI responses, location information is structured as:

```
## LOCATION CONTEXT

CURRENT LOCATION: The Ancient Tavern
The tavern's oak beams creak with age. Firelight dances across
worn wooden tables where travelers share tales and ale. A grizzled
barkeep polishes glasses behind the counter, watching newcomers
with knowing eyes.

--- LOCATION-SPECIFIC KNOWLEDGE ---
Title: Events from turn 5 to 12
Content: The party met a mysterious stranger who warned them
about the approaching storm.

ADJACENT LOCATIONS:
- (North): Town Square - A bustling marketplace with vendors
- (East): The Stables - Horses neigh in wooden enclosures
- (South): Forest Road - A dirt path leading into dense woods
- (Southwest): The Mill - A water wheel turns slowly by the river

TRAVEL PATH TO DESTINATION: Tavern -> Town Square -> East Gate ->
Forest Edge -> Deep Woods
```

### 5.4 Location Memory System

When the player moves to a new location, memories are auto-generated:

```
Player at Tavern (turns 5-12)
              │
              │ Player moves to Town Square
              ▼
┌─────────────────────────────────────────┐
│     summarizeActivityForLocation()       │
│                                          │
│ 1. Extract chat from turn 5 to 12       │
│ 2. Build transcript:                     │
│    "Alice: Let's ask about the curse"   │
│    "Barkeep: I know nothing of such..." │
│ 3. AI summarizes events                  │
│ 4. Create local_static_entry:            │
│    title: "Events from turn 5 to 12"    │
│    content: "The party investigated..."  │
│ 5. Save to location.local_static_entries │
└─────────────────────────────────────────┘
              │
              ▼
Player returns to Tavern later
              │
              ▼
┌─────────────────────────────────────────┐
│ Location context now includes:           │
│                                          │
│ "--- LOCATION-SPECIFIC KNOWLEDGE ---    │
│  Title: Events from turn 5 to 12        │
│  Content: The party investigated the    │
│  mysterious curse, speaking with the    │
│  barkeep who claimed ignorance..."      │
└─────────────────────────────────────────┘
```

### 5.5 Pathfinding (A* Algorithm)

The `UTILITY.findPath()` function calculates routes between locations:

```
Start: (4,4)  Destination: (7,6)

    4   5   6   7
  ┌───┬───┬───┬───┐
 4│ S │ → │   │   │   S = Start
  ├───┼───┼───┼───┤   D = Destination
 5│   │ ↘ │ → │   │   Arrows = Path
  ├───┼───┼───┼───┤
 6│   │   │ ↘ │ D │
  └───┴───┴───┴───┘

Algorithm:
• A* search with Manhattan distance heuristic
• 8-directional movement (N, S, E, W, NE, NW, SE, SW)
• Returns: [{x:5,y:4}, {x:5,y:5}, {x:6,y:5}, {x:7,y:6}]

Path displayed in prompt as:
"TRAVEL PATH TO DESTINATION: Start -> Location1 -> Location2 -> Destination"
```

### 5.6 Location Detection from Chat

The sentiment analyzer also detects location intent:

```
User: "I head towards the old mill by the river"
                    │
                    ▼
            analyzeTurn()
                    │
                    ├─► Extract valid location names from worldMap.grid
                    │   ["The Mill", "Town Square", "Forest Road", ...]
                    │
                    ├─► AI analyzes message against location list
                    │
                    └─► Returns: { emotion: "neutral", locationName: "The Mill" }
                                          │
                                          ▼
                            ┌─────────────────────────┐
                            │ If locationName valid:  │
                            │ • moveToLocation()      │
                            │ • Update currentLocation│
                            │ • Summarize old location│
                            │ • Add system_event msg  │
                            │ • Narrator responds     │
                            └─────────────────────────┘
```

---

## 6. AI Agents

EllipsisLM includes several AI-powered agents that run alongside the main chat:

### 6.1 Event Master

Generates unexpected events to keep roleplay dynamic:

```
┌─────────────────────────────────────────────────────────────────┐
│                     EVENT MASTER AGENT                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRIGGER: Every 6 turns (messageCounter % 6 === 0)              │
│                                                                  │
│  INPUT:                                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Base Prompt (customizable):                                 │ │
│  │ "You are a secret Event Master. Read the chat. Generate    │ │
│  │  a brief, secret instruction for AI characters to          │ │
│  │  introduce a logical but unexpected event."                │ │
│  │                                                             │ │
│  │ + Last 12 visible chat messages                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  OUTPUT:                                                         │
│  "A messenger arrives with urgent news about the curse."        │
│                                                                  │
│  USAGE:                                                          │
│  • Stored in state.event_master_prompt                          │
│  • Included ONCE in next AI prompt under:                       │
│    "--- SECRET EVENT MASTER INSTRUCTION ---"                    │
│  • Cleared after being used                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Sentiment Analyzer

Determines character mood for portrait selection:

```
┌─────────────────────────────────────────────────────────────────┐
│                   SENTIMENT ANALYZER AGENT                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRIGGER: After each AI response                                │
│                                                                  │
│  INPUT: User's last message                                      │
│                                                                  │
│  OUTPUT: { emotion: "happy", locationName: "The Mill" }         │
│                                                                  │
│  VALID EMOTIONS:                                                 │
│  • neutral (default/fallback)                                   │
│  • happy                                                         │
│  • sad                                                           │
│  • angry                                                         │
│  • surprised                                                     │
│                                                                  │
│  USES:                                                           │
│  • Portrait selection (emotion-specific images)                 │
│  • Automatic location movement (if location detected)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 AI-Generate (Field-Level Generation)

Many text fields have a "magic wand" button for AI generation:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI-GENERATE AGENT                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  AVAILABLE ON:                                                   │
│  • Character persona (prompt_persona_gen)                       │
│  • Character model instructions                                  │
│  • Location prompts (prompt_location_gen)                       │
│  • Dynamic entry content (prompt_entry_gen)                     │
│  • Story notes/tags                                             │
│                                                                  │
│  EXAMPLE - Persona Generation:                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ User input: "Sarah is a brunette with a cat named Bob"     │ │
│  │                                                             │ │
│  │ Template: "Embellish this character concept into a rich,   │ │
│  │           detailed, and compelling persona description."   │ │
│  │                                                             │ │
│  │ Context: {concept}                                         │ │
│  │                                                             │ │
│  │ Output: "Sarah is a sharp-witted young woman with warm     │ │
│  │         chestnut hair that falls past her shoulders.       │ │
│  │         Her constant companion is Bob, a mischievous       │ │
│  │         orange tabby who seems to understand her every     │ │
│  │         word..."                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 World Map Generator

Creates the entire 8x8 grid of locations from story context:

```
┌─────────────────────────────────────────────────────────────────┐
│                  WORLD MAP GENERATOR AGENT                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRIGGER: User clicks "Generate World Map" button               │
│                                                                  │
│  INPUT:                                                          │
│  • Character descriptions                                        │
│  • Static knowledge entries                                      │
│  • Recent chat history                                           │
│                                                                  │
│  TEMPLATE (prompt_world_map_gen):                               │
│  "Based on the following story context, generate an 8x8 grid   │
│   of fantasy locations with names and descriptions..."          │
│                                                                  │
│  OUTPUT:                                                         │
│  JSON array of 64 location objects with:                        │
│  • coords: { x, y }                                             │
│  • name: "Location Name"                                        │
│  • description: "Short summary"                                 │
│  • prompt: "Rich paragraph for AI context"                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.5 Static Memory Creator

Generates persistent world knowledge from chat:

```
┌─────────────────────────────────────────────────────────────────┐
│                 STATIC MEMORY CREATOR AGENT                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRIGGER: User clicks "Update Static Knowledge" button          │
│                                                                  │
│  INPUT: Recent chat history + existing static entries           │
│                                                                  │
│  PROCESS:                                                        │
│  1. AI analyzes chat for important events                       │
│  2. Identifies new facts, relationships, developments           │
│  3. Creates new static entries or updates existing              │
│                                                                  │
│  OUTPUT: New static_entries[] for persistent context            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. State Management

### 7.1 StateManager Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      StateManager                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ data = {                                                 │   │
│  │   library: [                                             │   │
│  │     { id, name, ... },  // Story summaries               │   │
│  │     { id, name, ... }                                    │   │
│  │   ],                                                     │   │
│  │   activeStoryId: "uuid",                                │   │
│  │   activeNarrativeId: "uuid",                            │   │
│  │   activeNarrativeState: {                               │   │
│  │     // Merged view: Story + Narrative                   │   │
│  │     characters: [...],      // From story               │   │
│  │     chat_history: [...],    // From narrative           │   │
│  │     worldMap: {...},        // From narrative           │   │
│  │     system_prompt: "...",   // From story               │   │
│  │     // ... all other fields                             │   │
│  │   }                                                      │   │
│  │ }                                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  KEY METHODS:                                                    │
│  • getState() - Returns activeNarrativeState                    │
│  • saveState() - Persists to localStorage                       │
│  • loadState() - Restores from localStorage                     │
│  • setActiveStoryId(id) - Switch active story                   │
│  • setActiveNarrativeId(id) - Switch active narrative           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Data Hydration Flow (App Startup)

```
┌─────────────────┐
│   App Loads     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ StoryService.loadLibrary()                                       │
│                                                                  │
│ 1. Load all stories from IndexedDB 'stories' store              │
│    └─► stories[] = await DBService.getAllStories()              │
│                                                                  │
│ 2. Build library list (summaries only)                          │
│    └─► library = stories.map(s => ({id, name, tags, ...}))      │
│                                                                  │
│ 3. Get active IDs from localStorage                             │
│    └─► activeStoryId = localStorage.active_story_id             │
│    └─► activeNarrativeId = localStorage.active_narrative_id     │
│                                                                  │
│ 4. Load active narrative from IndexedDB                         │
│    └─► narrative = await DBService.getNarrative(activeNarrId)   │
│                                                                  │
│ 5. Merge story + narrative into unified state                   │
│    ┌────────────────────────────────────────────────────────┐  │
│    │ activeNarrativeState = {                                │  │
│    │   ...story,                    // Characters, prompts   │  │
│    │   ...narrative.state,          // Chat, worldMap        │  │
│    │   characters: hydrateActiveFlags(story.characters,      │  │
│    │                                  narrative.active_ids)  │  │
│    │ }                                                       │  │
│    └────────────────────────────────────────────────────────┘  │
│                                                                  │
│ 6. Hydrate character images into memory cache                   │
│    └─► Load blobs from IndexedDB, create object URLs            │
│                                                                  │
│ 7. Initialize UI                                                 │
│    └─► UIManager.init()                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Save Flow

```
┌───────────────────────────────────────────────────────────────┐
│                        SAVE TRIGGERS                           │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│  Immediate saves:                                              │
│  • Chat message sent/received                                  │
│  • Character toggled active/inactive                           │
│  • Location changed                                            │
│  • Modal closed with changes                                   │
│                                                                │
│  Debounced saves (300ms):                                      │
│  • Text input changes (names, descriptions)                    │
│  • UI setting changes                                          │
│                                                                │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────────────────────────────┐
│ StateManager.saveState()                                       │
│                                                                │
│ 1. Serialize activeNarrativeState to JSON                     │
│ 2. Save to localStorage.STATE                                  │
│                                                                │
│ If story data changed:                                         │
│ 3. await DBService.saveStory(story)                           │
│                                                                │
│ If narrative data changed:                                     │
│ 4. await DBService.saveNarrative(narrative)                   │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

---

## 8. Service Architecture

### 8.1 Service Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     SERVICE DEPENDENCY GRAPH                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                       ┌────────────┐                            │
│                       │ Controller │ ◄─── User Events            │
│                       └─────┬──────┘                            │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ StoryService│    │  UIManager  │    │APIService  │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         ▼                  │                  │                 │
│  ┌─────────────┐           │                  │                 │
│  │ DBService   │           │                  │                 │
│  └──────┬──────┘           │                  │                 │
│         │                  │                  │                 │
│         ▼                  ▼                  │                 │
│  ┌─────────────────────────────────────┐     │                 │
│  │          StateManager               │◄────┘                 │
│  └─────────────────────────────────────┘                        │
│         │                  │                                    │
│         ▼                  ▼                                    │
│    IndexedDB          localStorage                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Service Responsibilities

| Service | Responsibility |
|---------|----------------|
| **DBService** | IndexedDB CRUD operations. All methods fail-soft (return null/false on error, never throw). Manages stories, narratives, and characterImages object stores. |
| **StoryService** | High-level story/narrative orchestration. Creates stories, scenarios, narratives. Handles library loading, cascading deletes, and backup/restore. |
| **StateManager** | Global state container. Maintains LIBRARY and active STATE. Auto-saves to localStorage. Provides getState()/saveState() API. |
| **APIService** | LLM API integration. Supports Gemini, OpenRouter, Koboldcpp, LM Studio. Handles streaming responses and error recovery. |
| **PromptBuilder** | Context/prompt construction. Builds prompts from state components. Handles text replacement and template formatting. |
| **ModalManager** | UI modal system. Opens/closes modal dialogs. Manages modal state and animations. |
| **UTILITY** | Helper functions. UUID generation, HTML sanitization, markdown setup, A* pathfinding, weighted random choice. |
| **ImportExportService** | Card import/export. Parses V2 PNG cards (extracts JSON from chunks). Handles BYAF format. ZIP-based library backup. |
| **UIManager** | UI rendering. Renders chat, characters, world map. Handles responsive layout, image caching, appearance customization. |
| **Controller** | User action handlers. Event handlers for all UI interactions. Coordinates between services. Main entry point for user actions. |

### 8.3 DBService Error Handling

```
┌─────────────────────────────────────────────────────────────────┐
│                    FAIL-SOFT PATTERN                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  All DBService methods:                                          │
│  • Never throw exceptions                                        │
│  • Return null (for get operations) or false (for write ops)    │
│  • Log errors to console                                         │
│                                                                  │
│  Example:                                                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ async getStory(id) {                                        │ │
│  │   try {                                                     │ │
│  │     const db = await this.getDB();                         │ │
│  │     const tx = db.transaction('stories', 'readonly');      │ │
│  │     const store = tx.objectStore('stories');               │ │
│  │     return await store.get(id);                            │ │
│  │   } catch (error) {                                         │ │
│  │     console.error("DBService.getStory error:", error);     │ │
│  │     return null;  // Fail-soft                             │ │
│  │   }                                                         │ │
│  │ }                                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Callers must handle null/false returns gracefully              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Data Flow Diagrams

### 9.1 Chat Generation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHAT GENERATION FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User types message and clicks Send                              │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Controller.sendChat()               │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ checkDynamicEntryTriggers()         │                        │
│  │ • Evaluate keywords against message │                        │
│  │ • Add lore_reveal if triggered      │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Add user message to chat_history    │                        │
│  │ • type: 'chat'                      │                        │
│  │ • character_id: userCharacter.id    │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ determineNextSpeaker()              │                        │
│  │ • If "Any" selected, use algorithm  │                        │
│  │ • Otherwise use selected character  │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ PromptBuilder.buildPrompt()         │                        │
│  │ • Assemble all context components   │                        │
│  │ • Apply text replacements           │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ APIService.callAI()                 │                        │
│  │ • Send to selected backend          │                        │
│  │ • Stream response tokens            │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ UIManager.streamResponse()          │                        │
│  │ • Display tokens as they arrive     │                        │
│  │ • Show "thinking" indicator         │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ analyzeTurn()                       │                        │
│  │ • Detect emotion from user message  │                        │
│  │ • Detect location intent            │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Add AI message to chat_history      │                        │
│  │ • type: 'chat'                      │                        │
│  │ • emotion: detected emotion         │                        │
│  │ • character_id: responder.id        │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Check Event Master                  │                        │
│  │ • If messageCounter % 6 === 0       │                        │
│  │ • Generate secret instruction       │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ StateManager.saveState()            │                        │
│  │ • Persist to localStorage           │                        │
│  │ • Update IndexedDB narrative        │                        │
│  └─────────────────────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Narrative Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 NARRATIVE CREATION FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User clicks (+) on a scenario                                   │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ StoryService.createNarrativeFrom-   │                        │
│  │ Scenario(storyId, scenarioId)       │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Load parent story from IndexedDB    │                        │
│  │ story = await DBService.getStory()  │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Find scenario template              │                        │
│  │ scenario = story.scenarios.find()   │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Restore story state from snapshot   │                        │
│  │ • Copy dynamic_entries              │                        │
│  │ • Copy prompts (if present)         │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Determine active characters         │                        │
│  │ • Use scenario.active_character_ids │                        │
│  │ • Or default to all characters      │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Create narrative object             │                        │
│  │ {                                   │                        │
│  │   id: uuid(),                       │                        │
│  │   name: scenario.name + " - Chat",  │                        │
│  │   active_character_ids: [...],      │                        │
│  │   state: {                          │                        │
│  │     chat_history: [],               │                        │
│  │     messageCounter: 0,              │                        │
│  │     static_entries: deepCopy(...),  │                        │
│  │     worldMap: deepCopy(...)         │                        │
│  │   }                                 │                        │
│  │ }                                   │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Inject example dialogue (hidden)    │                        │
│  │ • Copy scenario.example_dialogue    │                        │
│  │ • Mark all as isHidden: true        │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Add first visible message           │                        │
│  │ • character_id: narrator.id         │                        │
│  │ • content: scenario.message         │                        │
│  │ • type: 'chat', isHidden: false     │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Save narrative to IndexedDB         │                        │
│  │ await DBService.saveNarrative()     │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Update story with narrative stub    │                        │
│  │ story.narratives.push({id, name})   │                        │
│  │ await DBService.saveStory()         │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Load new narrative as active        │                        │
│  │ StateManager.setActiveNarrativeId() │                        │
│  │ UIManager.init()                    │                        │
│  └─────────────────────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.3 Location Movement Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  LOCATION MOVEMENT FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Location change detected (auto or manual)                       │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ moveToLocation(x, y)                │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Summarize activity at old location  │                        │
│  │ summarizeActivityForLocation()      │                        │
│  │ • Extract chat since arrival        │                        │
│  │ • AI generates summary              │                        │
│  │ • Save to local_static_entries      │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Update worldMap.currentLocation     │                        │
│  │ { x: newX, y: newY }                │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Recalculate path if destination set │                        │
│  │ path = UTILITY.findPath(...)        │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Add system event to chat            │                        │
│  │ "You have moved to [Location Name]" │                        │
│  │ type: 'system_event'                │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Record arrival turn                 │                        │
│  │ RUNTIME.turnOfArrival = counter     │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Trigger narrator response           │                        │
│  │ determineNextSpeaker(isAfterMove)   │                        │
│  │ • Narrator gets priority            │                        │
│  └─────────────────────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Import/Export System

### 10.1 Supported Formats

| Format | Description | Import | Export |
|--------|-------------|--------|--------|
| V2 Tavern PNG | Character card with embedded JSON | Yes | Yes |
| BYAF | Alternative JSON format | Yes | No |
| EllipsisLM JSON | Native format | Yes | Yes |
| Library ZIP | Full backup with images | Yes | Yes |

### 10.2 V2 PNG Card Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                      V2 PNG CARD                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PNG File Structure:                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ PNG Header                                               │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ IHDR Chunk (Image header)                               │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ tEXt Chunk: "chara" = base64(JSON)  ◄── Character data  │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ IDAT Chunks (Image data)                                │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ IEND Chunk                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Embedded JSON (V2 spec):                                        │
│  {                                                               │
│    spec: "chara_card_v2",                                       │
│    data: {                                                       │
│      name: "Character Name",                                    │
│      description: "...",                                        │
│      personality: "...",                                        │
│      scenario: "...",                                           │
│      first_mes: "...",                                          │
│      mes_example: "...",                                        │
│      creator_notes: "...",                                      │
│      tags: [...],                                               │
│      character_book: {                                          │
│        entries: [...]  // Lorebook                              │
│      }                                                          │
│    }                                                            │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.3 Import Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     IMPORT FLOW                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User selects file(s)                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────────────────────┐                        │
│  │ Detect format by extension/content  │                        │
│  │ • .png → V2 Tavern Card            │                        │
│  │ • .json → BYAF or EllipsisLM       │                        │
│  │ • .zip → Library backup            │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│        ┌───────────┼───────────┐                                │
│        │           │           │                                │
│        ▼           ▼           ▼                                │
│  ┌──────────┐┌──────────┐┌──────────┐                          │
│  │ Parse    ││ Parse    ││ Extract  │                          │
│  │ PNG      ││ JSON     ││ ZIP      │                          │
│  │ chunks   ││ directly ││ contents │                          │
│  └────┬─────┘└────┬─────┘└────┬─────┘                          │
│       │           │           │                                 │
│       └───────────┼───────────┘                                │
│                   │                                             │
│                   ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Convert to EllipsisLM structure     │                        │
│  │ • Create story object               │                        │
│  │ • Create user + AI characters       │                        │
│  │ • Create default scenario           │                        │
│  │ • Import lorebook → dynamic_entries │                        │
│  └─────────────────┬───────────────────┘                        │
│                    │                                             │
│                    ▼                                             │
│  ┌─────────────────────────────────────┐                        │
│  │ Save to IndexedDB                   │                        │
│  │ • Story → 'stories' store           │                        │
│  │ • Images → 'characterImages' store  │                        │
│  └─────────────────────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.4 Library Backup Structure

```
library_backup_2024-12-10.zip
│
├── stories/
│   ├── story_uuid1.json      # Full story object
│   └── story_uuid2.json
│
├── narratives/
│   ├── narrative_uuid1.json  # Full narrative object
│   └── narrative_uuid2.json
│
├── images/
│   ├── char_uuid1.png        # Base portraits
│   ├── char_uuid1::emotion::happy.png
│   ├── char_uuid2.png
│   └── location::4,4.png     # Location images
│
└── manifest.json             # Backup metadata
    {
      version: "1.0",
      created: "2024-12-10T...",
      storyCount: 2,
      narrativeCount: 3
    }
```

---

## Appendix: Quick Reference

### Key Functions by Feature

| Feature | Primary Function | Service |
|---------|-----------------|---------|
| Send chat | `sendChat()` | Controller |
| Build prompt | `buildPrompt()` | PromptBuilder |
| Check lorebook | `checkDynamicEntryTriggers()` | Controller |
| Select responder | `determineNextSpeaker()` | Controller |
| Detect emotion | `analyzeTurn()` | Controller |
| Move location | `moveToLocation()` | Controller |
| Create narrative | `createNarrativeFromScenario()` | StoryService |
| Save state | `saveState()` | StateManager |
| Import card | `importPNG()` | ImportExportService |
| Export library | `exportLibrary()` | StoryService |

### localStorage Keys

| Key | Contents |
|-----|----------|
| `active_story_id` | UUID of currently loaded story |
| `active_narrative_id` | UUID of active playthrough |
| `STATE` | Serialized activeNarrativeState |
| `LIBRARY` | Array of story summaries |
| `SETTINGS` | API keys, model configuration |

### IndexedDB Object Stores

| Store | Key | Contents |
|-------|-----|----------|
| `stories` | `id` (UUID) | Full story objects |
| `narratives` | `id` (UUID) | Full narrative objects |
| `characterImages` | Manual keys | Image blobs |

---

*This documentation reflects the EllipsisLM codebase as of December 2024.*
