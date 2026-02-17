# EllipsisLM — Prompt Construction Pipeline

This document exhaustively traces how the final LLM prompt is assembled, from raw inputs through to the API call, in the EllipsisLM roleplay/chat system.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Model & State Assembly](#2-data-model--state-assembly)
3. [The Generation Flow (End-to-End)](#3-the-generation-flow-end-to-end)
4. [System Prompt / Model Instructions](#4-system-prompt--model-instructions)
5. [Character Definitions](#5-character-definitions)
6. [Location Context (World Map)](#6-location-context-world-map)
7. [Static Knowledge (World Lore)](#7-static-knowledge-world-lore)
8. [Dynamic Knowledge (Lorebook)](#8-dynamic-knowledge-lorebook)
9. [Chat History](#9-chat-history)
10. [Example Dialogue (Few-Shot)](#10-example-dialogue-few-shot)
11. [Event Master (Secret Instructions)](#11-event-master-secret-instructions)
12. [User Persona / Profile](#12-user-persona--profile)
13. [Response Length Control](#13-response-length-control)
14. [Final Instruction Block](#14-final-instruction-block)
15. [Variable Substitution / Macros](#15-variable-substitution--macros)
16. [Prompt Format Branching](#16-prompt-format-branching)
17. [Model-Specific Templates (KoboldCPP)](#17-model-specific-templates-koboldcpp)
18. [API Call & Server Routing](#18-api-call--server-routing)
19. [Post-Response Processing](#19-post-response-processing)
20. [Auxiliary Agents & Their Prompts](#20-auxiliary-agents--their-prompts)
21. [Write-for-Me (Bolt Action)](#21-write-for-me-bolt-action)
22. [Character Card Import & Prompt Mapping](#22-character-card-import--prompt-mapping)
23. [Summary: Final Prompt Layout](#23-summary-final-prompt-layout)

---

## 1. Architecture Overview

EllipsisLM is a full-stack roleplay/chat application:

- **Frontend**: Single-page app (~16,000 lines of vanilla JS) with two variants:
  - `index.html` (root) — standalone version with inline `DBService`/`APIService` (IndexedDB + direct API calls)
  - `client/index.html` — server-backed version that loads `client/src/api-client.js` as a module, which overrides `window.DBService`, `window.APIService`, etc. with server-proxied implementations
- **Backend**: Node.js + Express in `server/`, proxying API calls to LLM providers (API keys stay server-side)
- **Storage**: SQLite via `better-sqlite3` (server) + localStorage (client) with cross-device sync
- **AI Providers**: Gemini, OpenRouter, KoboldCPP (local), LM Studio (local)
- **Dev server**: Vite (`client/vite.config.js`) proxies `/api` to the Express server at `localhost:3001`

All prompt construction happens client-side in the `PromptBuilder` module. The server acts as a pass-through proxy that injects API keys and forwards the fully-constructed prompt string.

All line number references in this document refer to `client/index.html` (the server-backed variant). The root `index.html` has the same code offset by -3 lines (missing the api-client.js `<script>` tag).

---

## 2. Data Model & State Assembly

### Hierarchy

```
Library
├── Stories (Character Cards)
│   ├── characters[]           — Character definitions
│   ├── dynamic_entries[]      — Lorebook entries
│   ├── scenarios[]            — Playthrough templates
│   │   ├── message            — First/greeting message
│   │   ├── active_character_ids
│   │   ├── example_dialogue[] — Hidden few-shot messages
│   │   ├── static_entries[]   — World knowledge snapshot
│   │   ├── dynamic_entries[]  — Lorebook snapshot
│   │   ├── worldMap           — Map grid snapshot
│   │   └── prompts            — System prompt overrides
│   └── narratives[]           — Playthrough instances
│       └── state
│           ├── chat_history[]
│           ├── static_entries[]
│           ├── worldMap
│           └── messageCounter
└── Global Settings (API keys, UI prefs, personas)
```

### State Hydration

On load, the active state is assembled by merging Story-level, Global, and Narrative-level data:

**`client/index.html:4247–4254`** — `StateManager.loadLibrary()`:
```javascript
this.data.activeNarrativeState = {
    ...activeStory,               // Story-level settings & characters
    ...this.data.globalSettings,  // Global API keys, UI settings
    ...activeNarrative.state,     // Narrative chat_history, worldMap, etc.
    characters: hydratedCharacters,
    narrativeId: activeNarrative.id,
    narrativeName: activeNarrative.name
};
```

This merged object becomes `ReactiveStore.state` — the single source of truth for all prompt construction. The merge order means narrative state overrides story defaults, and global settings override both for API configuration.

**`client/index.html:15683`** — The state is passed to the reactive store:
```javascript
ReactiveStore.init(state);
```

The `ReactiveStore` (`client/index.html:6856`) wraps the state in a `Proxy` that auto-saves on mutation and notifies UI subscribers.

---

## 3. The Generation Flow (End-to-End)

### Entry Point: `NarrativeController.handlePrimaryAction()` — `client/index.html:12527–12540`

The primary action button has dual behavior:
- **Empty input** → calls `triggerAIResponse(null)` directly (passes turn to AI)
- **Text present** → calls `sendMessage()` (user message flow below)

### `NarrativeController.sendMessage()` — `client/index.html:12857–12899`

```
1. User types message → addMessageToHistory(userChar.id, messageContent)
2. checkDynamicEntryTriggers()       — Scan for lorebook keyword matches
3. await checkEventMaster()          — BLOCKING: Roll dice, maybe generate secret instruction
4. await VisualMaster.checkTrigger() — Maybe generate scene image
5. await triggerAIResponse()         — Build prompt, call API, display response
```

### `NarrativeController.triggerAIResponse()` — `client/index.html:13381–13475`

```
1. Validate active AI characters and model configuration
2. Determine speaker (explicit selection OR Scriptwriter agent)
3. Build prompt:  PromptBuilder.buildPrompt(targetId, false, historyOverride)
4. API call:      APIService.callAI(prompt, false, signal)
5. Analyze response for emotion (sentiment analysis agent)
6. Display response via startStreamingResponse()
7. Post-display: checkAutoStaticKnowledge(), checkDynamicEntryTriggers()
```

---

## 4. System Prompt / Model Instructions

### Source & Priority

The system prompt is resolved per-character with a global fallback:

**`client/index.html:5081`**:
```javascript
const modelInstructions = charToAct.model_instructions || state.system_prompt;
```

- **Per-character**: `character.model_instructions` — set in the character editor
- **Global fallback**: `state.system_prompt` — story-level default

### Default Values

**`client/index.html:4864`** — `UTILITY.getDefaultSystemPrompts()`:
```javascript
system_prompt: 'You are a master storyteller. Follow instructions precisely.'
```

A character's default `model_instructions` varies by type:
- **User character**: `"Write a response for {character} in a creative and descriptive style."` (`client/index.html:3850`)
- **Narrator**: `"Act as a world-class storyteller."` (`client/index.html:3851`)
- **AI character**: `"Act as {character}. Be descriptive and engaging."` (default on creation, `client/index.html:13741`)

### Where It Lands

The system prompt is **always the first element** of the final prompt — Position 1.

**Default format** (`client/index.html:5170`):
```javascript
let p = components.system_prompt + "\n\n";
```

**KoboldCPP templates** (`client/index.html:5231`):
```javascript
let system = [components.system_prompt];
// ... other context appended ...
const system_prompt_str = system.join('\n\n');
```

---

## 5. Character Definitions

### Character Object Structure

**`client/index.html:3850` (example)**:
```javascript
{
    id: uuid(),
    name: "Character Name",
    description: "Full personality, appearance, backstory...",
    short_description: "Brief summary for UI cards.",
    model_instructions: "Act as {character}...",  // Per-character system prompt
    is_user: false,
    is_active: true,
    is_narrator: false,
    image_url: '',
    extra_portraits: [{ emotion: 'happy', image_key: '...' }],
    tags: [],
    color: { base: '#334155', bold: '#94a3b8' }
}
```

### Injection Logic

**`client/index.html:5134–5142`**:
```javascript
characters: (state.characters || [])
    .filter(c => c.is_active)
    .filter(c => {
        if (c.is_narrator) {
            return c.id === charToActId;  // Only include narrator if it's acting
        }
        return true;  // All other active characters always included
    })
    .map(c => `### Character: ${c.name}\n\n${replacer(c.description)}`)
    .join('\n\n'),
```

**Rules**:
- Only **active** characters (`is_active: true`) are included
- **Narrator** characters are only included when they are the one about to speak
- The user character IS included (they're active)
- Each character's `description` is run through the `replacer` for variable substitution
- Format: `### Character: Name\n\nDescription text`

### Where It Lands

Position 5 in the default prompt, under the `## CHARACTERS` header.

---

## 6. Location Context (World Map)

### Data Structure

The world map is an 8×8 grid of locations stored in `state.worldMap`:

```javascript
worldMap: {
    grid: [
        {
            coords: { x: 0, y: 0 },
            name: "Forest Clearing",
            description: "One-line summary",
            prompt: "Rich detailed paragraph for the AI",
            imageUrl: "",
            local_static_entries: [
                { id: uuid(), title: "Events from turn X to Y", content: "..." }
            ]
        },
        // ... 64 locations total
    ],
    currentLocation: { x: 4, y: 4 },
    destination: { x: null, y: null },
    path: []
}
```

### Assembly Logic

**`client/index.html:5083–5126`** — `buildPrompt()`:

```javascript
let locationContext = '';
if (state.worldMap && state.worldMap.grid.length > 0) {
    const currentLoc = grid.find(l => l.coords.x === currentLocation.x && l.coords.y === currentLocation.y);

    if (currentLoc && currentLoc.name) {
        // 1. Current location name and detailed prompt
        locationContext += `CURRENT LOCATION: ${currentLoc.name}\n`;
        if (currentLoc.prompt) locationContext += `${currentLoc.prompt}\n\n`;

        // 2. Location-specific static knowledge entries (memories)
        if (currentLoc.local_static_entries && currentLoc.local_static_entries.length > 0) {
            locationContext += "--- LOCATION-SPECIFIC KNOWLEDGE ---\n";
            locationContext += currentLoc.local_static_entries
                .map(l => `Title: ${l.title}\nContent: ${replacer(l.content)}`)
                .join('\n\n') + "\n\n";
        }
    }

    // 3. Adjacent locations (8 directions)
    const directions = [
        { dir: 'North', x: 0, y: -1 }, { dir: 'South', x: 0, y: 1 },
        { dir: 'East', x: 1, y: 0 },   { dir: 'West', x: -1, y: 0 },
        // ... plus diagonals
    ];
    // → "- (North): Mountain Pass - A narrow path through the peaks"

    // 4. Travel path (if navigating to a destination)
    if (path && path.length > 0) {
        locationContext += `TRAVEL PATH TO DESTINATION: ${pathNames}\n`;
    }
}
```

### Where It Lands

Position 3 in the default prompt, under the `## LOCATION CONTEXT` header.

### Location Memory Generation

When the player leaves a location, the system auto-summarizes what happened there:

**`client/index.html:14728–14763`** — `WorldController.summarizeActivityForLocation()`:
```javascript
const promptTemplate = state.prompt_location_memory_gen || UTILITY.getDefaultSystemPrompts().prompt_location_memory_gen;
const prompt = promptTemplate.replace('{transcript}', chatTranscript);
const summaryContent = await APIService.callAI(prompt);
location.local_static_entries.push({
    id: UTILITY.uuid(),
    title: `Events from turn ${startTurn} to ${endTurn}`,
    content: summaryContent
});
```

These location memories are then injected into the location context on subsequent visits.

---

## 7. Static Knowledge (World Lore)

### Data Structure

```javascript
state.static_entries = [
    { id: uuid(), title: "World Overview", content: "A high-fantasy world." },
    { id: uuid(), title: "Magic System", content: "Magic flows from crystals..." }
]
```

### Injection

**`client/index.html:5131`**:
```javascript
static_entries: (state.static_entries || [])
    .map(l => `### ${l.title}\n${replacer(l.content)}`)
    .join('\n\n'),
```

All static entries are **always included** — there is no filtering or budget management. Each entry is formatted as `### Title\nContent`.

### Where It Lands

Position 4 in the default prompt, under the `## WORLD KNOWLEDGE` header.

### Auto-Generation

Every 6 messages, the system uses an AI call to update static knowledge:

**`client/index.html:12769–12849`** — `checkAutoStaticKnowledge()`:

Trigger condition: `state.messageCounter > 0 && state.messageCounter % 6 === 0`

The auto-archivist prompt (`client/index.html:4877`):
```
You are an automated archivist. Analyze the recent conversation transcript
and the EXISTING static knowledge base. Your goal is to keep the knowledge
base up-to-date and concise.

TASKS:
1. Identify SIGNIFICANT new facts, rules, or lore established in the transcript.
2. Review EXISTING entries to avoid redundancy.
3. If a new fact updates or contradicts an existing entry, propose an update.
4. If a fact is completely new, propose a new entry.

EXISTING KNOWLEDGE:
{existing_knowledge}

TRANSCRIPT:
{transcript}

OUTPUT FORMAT:
Respond with a valid JSON object or array: { "title": "Exact Title", "content": "..." }.
```

---

## 8. Dynamic Knowledge (Lorebook)

### Data Structure

```javascript
state.dynamic_entries = [
    {
        id: uuid(),
        title: "Dragon Lore",
        triggers: "dragon AND fire, 50%",
        content_fields: ["First reveal...", "Second reveal...", "Final reveal..."],
        current_index: 0,
        triggered_at_turn: null
    }
]
```

### Trigger Logic

**`client/index.html:14238–14348`** — `checkDynamicEntryTriggers()`:

Called twice per turn:
1. After user sends message (`client/index.html:12883`)
2. After AI response is displayed (`client/index.html:12977`)

The trigger check looks at the **last chat message** in history.

#### Trigger Parsing

**`client/index.html:14193–14231`** — `parseTriggers(triggersStr)`:

Trigger strings support:
- **Basic keywords**: `"dragon"` — triggers if "dragon" appears (case-insensitive, whole-word)
- **AND logic**: `"house AND garden"` — both keywords must appear
- **XOR logic**: `"day XOR night"` — exactly one must appear
- **Percentage chance**: `"50%"` — 50% chance each check
- **Combined**: `"dragon, 50%"` — keyword match OR 50% chance
- **AND with chance**: `"dragon AND 50%"` — keyword match AND 50% chance
- **Wildcards**: `"*able"` matches "lovable", compiled via `_compileTriggerRegex()` (`client/index.html:14160`)

```javascript
const { groups, chance, chanceOperator } = this.parseTriggers(entry.triggers);
// groups: [{ type: 'OR'|'AND'|'XOR', keywords: [...] }]
// chance: 0-100
// chanceOperator: 'AND'|'OR'
```

#### Trigger Resolution

```javascript
if (groups.length === 0) {
    shouldTrigger = chanceRolled;           // Pure chance (random encounter)
} else {
    if (chanceOperator === 'AND') {
        shouldTrigger = keywordMatch && chanceRolled;
    } else {
        shouldTrigger = keywordMatch || chanceRolled;
    }
}
```

#### Sequential Content Revelation

Dynamic entries have an array of `content_fields`. Each trigger reveals the next field in sequence, clamping at the last:

```javascript
const contentIndex = entry.current_index || 0;
let contentToReveal = entry.content_fields[contentIndex];
entry.current_index = Math.min(contentIndex + 1, entry.content_fields.length - 1);
```

#### Variable Substitution in Content

**`client/index.html:14307`**:
```javascript
contentToReveal = contentToReveal.replace(/\{\{(.+?)\}\}/g, (match, inner) => {
    const options = inner.split(',').map(s => s.trim());
    return options[Math.floor(Math.random() * options.length)];
});
```
Example: `"The weather is {{sunny, rainy, cloudy}}"` → randomly picks one option.

#### De-duplication

Before inserting a new reveal, the system removes any previous reveal for the same entry within the last 20 messages:

```javascript
for (let i = state.chat_history.length - 1; i >= searchWindowStart; i--) {
    const msg = state.chat_history[i];
    if (msg && msg.type === 'lore_reveal' && msg.dynamic_entry_id === entry.id) {
        state.chat_history.splice(foundIndex, 1);  // Remove old
        break;
    }
}
```

#### Injection

Triggered entries are pushed as `lore_reveal` messages into `chat_history`:

```javascript
state.chat_history.push({
    type: 'lore_reveal',
    title: entry.title,
    content: contentToReveal,
    dynamic_entry_id: entry.id,
    timestamp: new Date().toISOString(),
    isHidden: true   // Hidden from UI display, visible in prompt
});
```

### Where It Lands

Dynamic entries appear **inline within the chat history** section, formatted as `[System Note: ...]` (default format) or role-specific tags (templates).

---

## 9. Chat History

### Selection & Budgeting

**`client/index.html:5037–5066`** — `_getSmartHistorySlice(history, maxSpaces = 8000)`:

```javascript
_getSmartHistorySlice(history, maxSpaces = 8000) {
    let currentSpaceCount = 0;
    let startIndex = history.length;

    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        let spacesInMessage = 0;
        if (!msg.isHidden) {
            const content = msg.content || '';
            spacesInMessage = (content.split(" ").length - 1);
        }
        if (currentSpaceCount + spacesInMessage > maxSpaces) break;
        startIndex = i;
        currentSpaceCount += spacesInMessage;
    }
    return history.slice(startIndex);
}
```

**Key behaviors**:
- Budget: **8000 spaces** (word count proxy) — hardcoded default
- Iterates **backwards** from most recent
- **Hidden messages** (`isHidden: true`, i.e., example dialogue and lore reveals) consume **zero budget** — they are always included if within the slice
- No summarization or compression — old messages are simply excluded
- The slice is a contiguous window from `startIndex` to end

### Regeneration Override

When regenerating a response, the history is sliced to exclude the message being replaced:

**`client/index.html:13433`**:
```javascript
const historyOverride = targetMessageIndex !== null
    ? state.chat_history.slice(0, targetMessageIndex)
    : null;
```

### Message Types & Formatting

Three message types exist in `chat_history`:

**`client/index.html:5190–5202`** (default format):

| Type | Format in Prompt | Source |
|------|-----------------|--------|
| `chat` | `[CharacterName:]\nContent\n\n` | User/AI messages |
| `lore_reveal` | `[System Note:\nContent]\n\n` | Dynamic knowledge triggers |
| `system_event` | `[System Event: Content]\n\n` | Location moves, errors, etc. |

Hidden chat messages (`msg.type === 'chat' && msg.isHidden`) are **excluded** from the history section (they go to Example Dialogue instead).

### Where It Lands

Position 7 in the default prompt, under the `## RECENT CONVERSATION & EVENTS` header.

---

## 10. Example Dialogue (Few-Shot)

### Source

Example dialogue messages are chat history entries with `isHidden: true`:

```javascript
{
    character_id: speakerId,
    content: "Example message content",
    type: 'chat',
    isHidden: true,
    timestamp: new Date().toISOString()
}
```

These are created during:
1. **Character card import** from V2 `mes_example` field (`client/index.html:6487–6504`)
2. **Scenario creation** — example dialogue is snapshotted into the scenario

### Extraction & Formatting

**`client/index.html:5177–5186`**:
```javascript
const exampleDialogue = (state.chat_history || []).filter(m => m && m.isHidden);
if (exampleDialogue.length > 0) {
    p += "## EXAMPLE DIALOGUE\n";
    exampleDialogue.forEach(msg => {
        const char = state.characters.find(c => c.id === msg.character_id);
        if (char) p += `${char.name}: ${replacer(msg.content)}\n`;
    });
    p += "\n";
}
```

Note: This iterates **all** hidden messages in the full `chat_history`, not just the budgeted slice. The smart history slice also includes hidden messages (they consume zero budget), but example dialogue gets its own dedicated section.

### Where It Lands

Position 6 in the default prompt, under the `## EXAMPLE DIALOGUE` header (only if examples exist).

---

## 11. Event Master (Secret Instructions)

### Trigger Mechanism

**`client/index.html:12695–12763`** — `checkEventMaster()`:

Called as step 3 of `sendMessage()`, **before** the AI response is generated. This is a blocking call.

```javascript
// Probability check (configurable, default 0 = disabled)
let probability = parseInt(state.event_master_probability);
if (isNaN(probability)) probability = 0;
if (probability <= 0) return;
if (Math.random() * 100 > probability) return;

// Overlap guard: don't trigger if one is already pending
if (state.event_master_prompt) return;
```

### Prompt Construction

**`client/index.html:12724–12744`**:
```javascript
// Context: last 10 non-hidden chat messages
const recentHistory = state.chat_history
    .slice(-10)
    .filter(m => m && m.type === 'chat' && !m.isHidden)
    .map(m => `${char.name}: ${m.content}`)
    .join('\n');

const prompt = `${state.event_master_base_prompt}

RECENT CHAT HISTORY:
${recentHistory}

INSTRUCTION:
Analyze the chat history. Generate a single, concise "System Instruction"
that introduces a plot twist, a sudden event, or a change in tone.

Output ONLY the instruction. Do not write a chat message.
Example Output: "A sudden thunderstorm knocks out the power."`;
```

The base prompt (`client/index.html:4867`):
```
You are a secret Event Master. Read the chat. Generate a brief, secret
instruction for AI characters to introduce a logical but unexpected event.
```

### Injection & Auto-Consumption

The Event Master's instruction is stored in `state.event_master_prompt`. In the next `buildPrompt()` call:

**`client/index.html:5130`**:
```javascript
event_master_prompt: replacer(state.event_master_prompt),
```

**`client/index.html:5171`** (default format):
```javascript
if (components.event_master_prompt)
    p += "--- SECRET EVENT MASTER INSTRUCTION ---\n" + components.event_master_prompt + "\n\n";
```

After being included in the prompt, it is immediately consumed:

**`client/index.html:5151–5154`**:
```javascript
if (state.event_master_prompt) {
    state.event_master_prompt = '';
    StateManager.saveState();
}
```

### Where It Lands

Position 2 in the default prompt, immediately after the system prompt.

---

## 12. User Persona / Profile

### How It Works

The user's self-representation is the **user character** — a regular character with `is_user: true`:

```javascript
{
    name: "You",
    description: "The protagonist.",
    model_instructions: "Write a response for {character} in a creative and descriptive style.",
    is_user: true,
    is_active: true
}
```

The user character's `description` is injected into the prompt via the standard character injection logic (Section 5). The user character is **always active** and **always included** in the characters block.

There is also a global `userPersonas` array in settings (`client/index.html:4827`) that provides stored persona presets, but these are applied by copying their values into the user character, not injected separately.

The user character's `name` is used for the `{user}` variable substitution throughout the prompt (Section 15).

---

## 13. Response Length Control

### Configuration

Stored in `state.responseLength` with options: `'short'`, `'medium'`, `'normal'`, `'long'`, `'novel'`. Default: `'normal'`.

**`client/index.html:4857`**:
```javascript
getDefaultStorySettings() {
    return { responseLength: 'normal', /* ... */ };
}
```

### Injection

Appended to the final instruction block. **Not applied to narrator characters.**

**`client/index.html:5208–5213`** (default format):
```javascript
const responseLength = state.responseLength || 'normal';
if (!components.charToAct.is_narrator) {
    if (responseLength === 'short')  p += " Keep the response concise and under two sentences.";
    if (responseLength === 'medium') p += " Keep the response between two to four sentences.";
    if (responseLength === 'long')   p += " Be descriptive, verbose, and detailed in your response.";
    if (responseLength === 'novel')  p += " Continue writing a long-form addition to the text that builds on the current actions, describes the scene, and contributes to world-building.";
}
```

For `'normal'`, nothing is appended.

### Where It Lands

Embedded in the final instruction block — the very last section of the prompt.

---

## 14. Final Instruction Block

### Default Format

**`client/index.html:5204–5216`**:
```javascript
p += "\n### INSTRUCTION\n";
p += components.isForUser
    ? `Generate the next creative response for the user's character, ${components.charToAct.name}.`
    : `Generate the next response for ${components.charToAct.name}. Stay in character.`;
// ... response length appended here ...
p += " Do not repeat the character's name in the response itself.\n[CHARACTER_TO_ACT]: " + components.charToAct.name;
```

### KoboldCPP Template Format

**`client/index.html:5238–5250`**:
```javascript
let instruction = components.isForUser
    ? `Write the next chat message for the user's character, ${components.charToAct.name}.`
    : `Write the next chat message for ${components.charToAct.name}. Stay in character.`;
instruction += " Do not write any prefix like 'Character Name:'.";
// ... response length appended here ...
```

### Where It Lands

Always the **final position** in the prompt.

---

## 15. Variable Substitution / Macros

### The Replacer Function

**`client/index.html:5017–5028`** — `_getReplacer(contextCharacter)`:
```javascript
_getReplacer(contextCharacter) {
    const userChar = state.characters.find(c => c.is_user);
    const characterName = contextCharacter ? contextCharacter.name : '';
    const userName = userChar ? userChar.name : 'You';
    return (text) => {
        let processedText = text.replace(/{character}/g, characterName);
        processedText = processedText.replace(/{user}/g, userName);
        return processedText;
    };
}
```

| Variable | Replacement | Example |
|----------|------------|---------|
| `{character}` | Name of the character currently acting | `"Luna"` |
| `{user}` | Name of the user character | `"You"` |

The replacer is applied to:
- System prompt / model instructions
- Event master prompt
- Static knowledge content
- Character descriptions
- Chat history message content
- Example dialogue content
- Location-specific knowledge content

### Import-Time Substitution

During V2 character card import, `{{char}}` and `{{user}}` are converted to the internal format:

**`client/index.html:6452–6454`**:
```javascript
description: (v2Data.description || "").replace(/{{char}}/g, v2Data.name).replace(/{{user}}/g, "{user}"),
model_instructions: (v2Data.system_prompt || "...").replace(/{{char}}/g, "{character}").replace(/{{user}}/g, "{user}"),
```

### Dynamic Knowledge Variable Substitution

**`client/index.html:14304–14316`** — `{{option1, option2}}` syntax:
```javascript
contentToReveal = contentToReveal.replace(/\{\{(.+?)\}\}/g, (match, inner) => {
    const options = inner.split(',').map(s => s.trim());
    return options[Math.floor(Math.random() * options.length)];
});
```

This is a **different** substitution from the `{character}`/`{user}` replacer. It randomly selects from comma-separated options within double braces.

---

## 16. Prompt Format Branching

The system supports two prompt format paths:

**`client/index.html:5156–5159`**:
```javascript
if (state.apiProvider === 'koboldcpp') {
    return this.buildKoboldTemplatedPrompt(components, replacer);
}
return this.buildDefaultPrompt(components, replacer);
```

| Provider | Format Used | Function |
|----------|------------|----------|
| `gemini` | Default (plain text) | `buildDefaultPrompt()` |
| `openrouter` | Default (plain text) | `buildDefaultPrompt()` |
| `lmstudio` | Default (plain text) | `buildDefaultPrompt()` |
| `koboldcpp` | Template-based (if template ≠ `'none'`) | `buildKoboldTemplatedPrompt()` |
| `koboldcpp` with `template='none'` | Default (plain text) | Falls back to `buildDefaultPrompt()` |

---

## 17. Model-Specific Templates (KoboldCPP)

When using KoboldCPP with a template, the prompt is formatted with model-specific tokens.

All templates share the same system block construction:

**`client/index.html:5231–5236`**:
```javascript
let system = [components.system_prompt];
if (components.event_master_prompt) system.push("SECRET EVENT INSTRUCTION:\n" + components.event_master_prompt);
if (components.location_context) system.push("LOCATION CONTEXT:\n" + components.location_context);
system.push("STATIC KNOWLEDGE:\n" + components.static_entries);
system.push("CHARACTERS:\n" + components.characters);
const system_prompt_str = system.join('\n\n');
```

### Llama 3 — `client/index.html:5254–5274`

```
<|begin_of_text|><|start_header_id|>system<|end_header_id|>

{system_prompt_str}<|eot_id|>
<|start_header_id|>user<|end_header_id|>     ← user messages
<|start_header_id|>assistant<|end_header_id|> ← AI messages
<|start_header_id|>system<|end_header_id|>    ← lore_reveal / system_event
...
<|start_header_id|>user<|end_header_id|>

{instruction}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

{charName}:
```

### Gemma — `client/index.html:5278–5300`

```
<start_of_turn>user
{system_prompt_str}<end_of_turn>
<start_of_turn>user         ← user messages
<start_of_turn>model        ← AI messages (Gemma uses 'model' not 'assistant')
<start_of_turn>user         ← system notes
...
<start_of_turn>user
{instruction}<end_of_turn>
<start_of_turn>model
{charName}:
```

System prompt is injected as a `user` turn (Gemma has no system role).

### Phi-3 — `client/index.html:5304–5324`

```
<|system|>
{system_prompt_str}<|end|>
<|user|>      / <|assistant|>  ← chat messages
<|system|>                     ← lore / events
...
<|user|>
{instruction}<|end|>
<|assistant|>
{charName}:
```

### Mistral — `client/index.html:5328–5341`

```
<s>[INST] {system_prompt_str}

user:CharName:
{content}
assistant:CharName:
{content}
...

{instruction} [/INST]
```

Everything in a single `[INST]...[/INST]` block.

### ChatML — `client/index.html:5345–5362`

```
<|im_start|>system
{system_prompt_str}<|im_end|>
<|im_start|>user      / <|im_start|>assistant  ← chat
<|im_start|>system                              ← lore / events
...
<|im_start|>user
{instruction}<|im_end|>
<|im_start|>assistant
{charName}:
```

### Alpaca — `client/index.html:5366–5372`

```
### Instruction:
{system_prompt_str}

CharName: Content
CharName: Content
...

{instruction}

### Response:
```

All history flattened into the instruction block.

### Shared Pattern: All Templates End With Character Name Prefix

Every template ends with `{charName}:\n` as a response prefix, priming the model to write as that character.

---

## 18. API Call & Server Routing

### Client Side

The `client/index.html` defines an inline `APIService` that calls provider APIs directly from the browser (`client/index.html:4366`). When the server backend is used, `client/src/api-client.js` overrides `window.APIService` with a proxy version that routes all calls through the Express server. The override happens via `window.APIService = APIService` at module load (`client/src/api-client.js:485`), replacing the inline version since the module script tag loads before the inline `<script>` uses `window.APIService || { ... }` fallback (`client/index.html:4366`).

**`client/src/api-client.js:195–240`** — `APIService.callAI()` (server-proxied version):

```javascript
async callAI(prompt, isJson = false, signal = null) {
    const provider = state.apiProvider || globalSettings.apiProvider || 'gemini';
    const model = state[`${provider}Model`] || globalSettings[`${provider}Model`] || defaultModel;

    const response = await fetch(`${API_BASE}/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, prompt, model, options }),
        signal,
    });

    const data = await response.json();
    let text = data.text || '';

    if (isJson) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return jsonMatch[0];
        throw new Error('AI response was not in the expected JSON format.');
    }
    return text.trim();
}
```

The **entire prompt** is sent as a single string in `body.prompt`. The server then formats it per-provider.

### Server Side

**`server/routes/ai.js:23–46`** — `POST /api/ai/generate`:

```javascript
router.post('/generate', async (req, res) => {
    const { provider, prompt, model, options = {} } = req.body;
    // Route to provider-specific function
    if (provider === 'gemini')     result = await callGemini(prompt, model, keys.geminiApiKey, options);
    if (provider === 'openrouter') result = await callOpenRouter(prompt, model, keys.openRouterKey, options);
    if (provider === 'koboldcpp')  result = await callKoboldCPP(prompt, options);
    if (provider === 'lmstudio')   result = await callLMStudio(prompt, options);
    res.json({ text: result });
});
```

### Provider-Specific API Formatting

#### Gemini — `server/routes/ai.js:123–146`

```javascript
body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }]
})
```

Single `contents` array with one part — the entire prompt as plain text.

#### OpenRouter — `server/routes/ai.js:148–171`

```javascript
body: JSON.stringify({
    model: model,
    messages: [{ role: 'user', content: prompt }]
})
```

Single `user` message containing the entire prompt. No `system` message is used.

#### KoboldCPP — `server/routes/ai.js:173–217`

```javascript
const payload = {
    prompt: prompt,          // Full prompt string (already templated client-side)
    use_story: false,
    use_memory: false,
    use_authors_note: false,
    use_world_info: false,
    max_context_length: 16384,
    max_length: 512,
    temperature: 1.0,
    min_p: options.koboldcpp_min_p ?? 0.1,
    top_p: 1.0,
    top_k: 0,
    rep_pen: 1.0,
    rep_pen_range: 2048,
    dry_multiplier: options.koboldcpp_dry ?? 0.25,
    dry_base: 1.75,
    sampler_order: [6, 0, 1, 2, 3, 4, 5],
    // ...
};
```

KoboldCPP's built-in story/memory/world_info features are **all disabled** (`false`). The prompt is fully pre-constructed client-side.

#### LM Studio — `server/routes/ai.js:219–239`

```javascript
body: JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    stream: false,
})
```

Single `user` message, same as OpenRouter.

### Key Observation

For **all cloud/chat providers** (Gemini, OpenRouter, LM Studio), the entire multi-section prompt is sent as a **single message** with `role: 'user'`. There is no separate `system` message at the API level — the system prompt is embedded within the prompt text itself. Only KoboldCPP uses the raw prompt string with model-specific special tokens.

---

## 19. Post-Response Processing

After the AI response is received and displayed:

### Sentiment Analysis

**`client/index.html:13453–13458`**:
```javascript
const aiAnalysis = await this.analyzeTurn(responseText);
emotion = aiAnalysis.emotion;
```

**`client/index.html:13683–13727`** — `analyzeTurn()`:
```javascript
const prompt = `Analyze the text.
1. Identify the speaker's emotion. Options: 'happy', 'sad', 'angry', 'surprised', 'neutral'.
2. Determine if the text explicitly indicates moving to a location.
IMPORTANT: Only select from: [${locStr}].
TEXT: "${text}"
Return valid JSON: { "emotion": "string", "locationName": "string" or null }`;
```

This triggers:
- **Portrait switching** to match the detected emotion
- **Auto-location movement** if the text indicates travel to an adjacent location

### Post-Display Triggers

**`client/index.html:12970–12982`** — After `startStreamingResponse()`:
```javascript
// Auto static knowledge (every 6 messages)
NarrativeController.checkAutoStaticKnowledge();

// Dynamic entry triggers on AI response
const structureChanged = NarrativeController.checkDynamicEntryTriggers();
```

---

## 20. Auxiliary Agents & Their Prompts

### Scriptwriter (Next Speaker Selection)

**`client/index.html:13504–13561`** — `determineNextSpeaker()`:

Used when the character selector is set to "Any". Makes an AI call to determine who speaks next.

```
You are a scriptwriter responsible for selecting the next character to respond.
Active characters: {activeChars}
Supporting characters: {supportingChars}
Narrators: {narrators}
RELEVANT CONTEXT: The character "{userCharName}" is the User player.
You must NEVER select "{userCharName}" as the next speaker.

RECENT CONVERSATION:
{last 10 messages}

Return JSON: { "active_characters": [...], "top_3_candidates": [...], "selection": "Name" }
```

### Visual Master (Scene Image Generation)

**`client/index.html:12325–12440`**:

Triggered probabilistically after user messages. Uses a two-stage pipeline:

1. **Generate visual description** using the AI:
```javascript
const prompt = `${state.visual_master_base_prompt}

CHARACTERS:
${charPersonas}

SETTING:
${locationContext}

DIALOGUE:
${recentHistory}

Key:`;
```

2. **Generate image** from the description using KoboldCPP SD or OpenRouter image model.

### Auto-Static Knowledge Archivist

See Section 7 above. Runs every 6 messages as a background AI call.

### Location Memory Summarizer

See Section 6 above. Runs when the player leaves a location.

---

## 21. Write-for-Me (Bolt Action)

**`client/index.html:12546–12625`** — `handleBoltAction()`:

A separate prompt path for AI-writing the **user character's** response. Uses similar context assembly but with differences:

```javascript
let prompt = `${replacer(userChar.model_instructions || state.system_prompt)}\n\n`;
if (locationContext) prompt += `## LOCATION CONTEXT\n${locationContext}\n`;
if (knowledge) prompt += `## WORLD KNOWLEDGE\n${knowledge}\n\n`;
prompt += `## RECENT CONVERSATION\n${history}\n\n`;

if (userText.trim().length > 0) {
    prompt += `Begin your response with the following and continue writing for ${userChar.name}:\n${userText}\n\n[${userChar.name}: ] `;
} else {
    prompt += `Generate the next creative response for ${userChar.name}. Stay in character.\n\n[${userChar.name}: ] `;
}
```

Key differences from the standard path:
- Uses last 20 messages (vs 8000-space budgeted slice)
- No example dialogue section
- No Event Master injection
- No character descriptions section
- Result goes into the **text input box**, not directly into chat
- If user has typed partial text, it tells the AI to continue from that

---

## 22. Character Card Import & Prompt Mapping

### V2 Character Card Format

**`client/index.html:6443–6552`** — `_convertV2toEllipsis()`:

| V2 Field | EllipsisLM Field | Notes |
|----------|-----------------|-------|
| `name` | `character.name` | Direct mapping |
| `description` | `character.description` | `{{char}}` → character name, `{{user}}` → `{user}` |
| `system_prompt` | `character.model_instructions` | `{{char}}` → `{character}`, `{{user}}` → `{user}` |
| `scenario` | `static_entries[0]` | Converted to a static knowledge entry titled "Imported Scenario" |
| `first_mes` | `scenario.message` / first chat message | Becomes the greeting/first message |
| `alternate_greetings` | Additional `scenarios[]` | Each creates a separate scenario |
| `mes_example` | `chat_history[]` with `isHidden: true` | Parsed into example dialogue messages |
| `character_book.entries` | `dynamic_entries[]` | `keys[]` → `triggers`, `content` → `content_fields[0]` |
| `tags` | `story.tags` | Direct mapping |

### Example Dialogue Parsing

**`client/index.html:6487–6504`**:
```javascript
const regex = /({{user}}|{{char}}):([\s\S]*?)(?={{user}}:|{{char}}:|$)/g;
let cleanedText = v2Data.mes_example.replace(/<START>/g).trim();
for (const match of cleanedText.matchAll(regex)) {
    const speakerPrefix = match[1];  // {{user}} or {{char}}
    const messageContent = match[2].trim()
        .replace(/{{char}}/g, aiChar.name)
        .replace(/{{user}}/g, "{user}");
    exampleDialogue.push({
        character_id: charNameIdMap[speakerPrefix],
        content: messageContent,
        type: 'chat',
        isHidden: true,     // Marks as example dialogue
    });
}
```

`<START>` tags are stripped. Messages are split by `{{user}}:` and `{{char}}:` prefixes.

### BYAF (Backyard AI) Format

**`client/index.html:6218–6432`** — `_convertBYAFtoEllipsis()`:

| BYAF Field | EllipsisLM Field | Notes |
|------------|-----------------|-------|
| `displayName` / `name` | `character.name` | Direct mapping |
| `persona` | `character.description` | Direct mapping |
| `scenario.formattingInstructions` | `character.model_instructions` | From first scenario; fallback: `"Act as {character}."` |
| `scenario.exampleMessages` | `chat_history[]` with `isHidden: true` | Parsed via `msg.type` (`'human'`/`'ai'`) |
| `scenario.messages` | `chat_history[]` (visible) | Narrative chat history |
| `loreItems` | `dynamic_entries[]` | `key` → `triggers`, `value` → `content_fields[0]` |
| `tags` | `story.tags` | Direct mapping |

BYAF messages use a `type` field (`'human'`/`'ai'`) for speaker identification, with additional name-prefix parsing (`"CharName: text"`) to support multi-character stories. Unknown names auto-create new characters via `resolveCharacter()` (`client/index.html:6255`).

---

## 23. Summary: Final Prompt Layout

### Default Format (Gemini / OpenRouter / LM Studio)

As sent to the API — a single text string:

```
┌──────────────────────────────────────────────────────┐
│ 1. SYSTEM PROMPT / MODEL INSTRUCTIONS                │
│    character.model_instructions || state.system_prompt│
│    (with {character} and {user} replaced)             │
├──────────────────────────────────────────────────────┤
│ 2. EVENT MASTER INSTRUCTION  (if triggered)          │
│    --- SECRET EVENT MASTER INSTRUCTION ---            │
│    "A sudden thunderstorm knocks out the power."     │
├──────────────────────────────────────────────────────┤
│ 3. LOCATION CONTEXT  (if world map exists)           │
│    ## LOCATION CONTEXT                               │
│    CURRENT LOCATION: Forest Clearing                 │
│    {detailed location prompt}                        │
│    --- LOCATION-SPECIFIC KNOWLEDGE ---               │
│    {location memories from previous visits}          │
│    ADJACENT LOCATIONS:                               │
│    - (North): Mountain Pass - A narrow path...       │
│    TRAVEL PATH TO DESTINATION: A -> B -> C           │
├──────────────────────────────────────────────────────┤
│ 4. WORLD KNOWLEDGE  (always present)                 │
│    ## WORLD KNOWLEDGE                                │
│    ### Magic System                                  │
│    Magic flows from crystals...                      │
│    ### World Overview                                │
│    A high-fantasy world...                           │
├──────────────────────────────────────────────────────┤
│ 5. CHARACTERS  (active characters)                   │
│    ## CHARACTERS                                     │
│    ### Character: Luna                               │
│    A mysterious elf mage with silver hair...         │
│    ### Character: You                                │
│    The protagonist...                                │
├──────────────────────────────────────────────────────┤
│ 6. EXAMPLE DIALOGUE  (if any hidden messages)        │
│    ## EXAMPLE DIALOGUE                               │
│    Luna: *adjusts her spectacles* How intriguing...  │
│    You: I approach the tower cautiously.             │
├──────────────────────────────────────────────────────┤
│ 7. CHAT HISTORY  (budgeted to ~8000 words)           │
│    ## RECENT CONVERSATION & EVENTS                   │
│    [You:]                                            │
│    I look around the clearing.                       │
│                                                      │
│    [System Note:                                     │
│    The ancient dragon sleeps beneath the mountain.]  │
│                                                      │
│    [Luna:]                                           │
│    *points to the glowing crystals* Look there...    │
│                                                      │
│    [System Event: You have moved to Mountain Pass.]  │
│                                                      │
│    [You:]                                            │
│    What is this place?                               │
├──────────────────────────────────────────────────────┤
│ 8. FINAL INSTRUCTION                                 │
│    ### INSTRUCTION                                   │
│    Generate the next response for Luna.              │
│    Stay in character.                                │
│    Be descriptive, verbose, and detailed.  (if long) │
│    Do not repeat the character's name.               │
│    [CHARACTER_TO_ACT]: Luna                          │
└──────────────────────────────────────────────────────┘
```

### KoboldCPP Template Format (e.g., Llama 3)

```
┌──────────────────────────────────────────────────────┐
│ <|begin_of_text|>                                    │
│ <|start_header_id|>system<|end_header_id|>           │
│                                                      │
│   {system_prompt}                                    │
│   SECRET EVENT INSTRUCTION: ...                      │
│   LOCATION CONTEXT: ...                              │
│   STATIC KNOWLEDGE: ...                              │
│   CHARACTERS: ...                                    │
│ <|eot_id|>                                           │
├──────────────────────────────────────────────────────┤
│ <|start_header_id|>user<|end_header_id|>             │
│   You: I look around the clearing.<|eot_id|>         │
│ <|start_header_id|>system<|end_header_id|>           │
│   [Dynamic Entry Revealed] Ancient dragon lore...    │
│ <|eot_id|>                                           │
│ <|start_header_id|>assistant<|end_header_id|>        │
│   Luna: *points to the crystals*...<|eot_id|>        │
│ ... more history messages ...                        │
├──────────────────────────────────────────────────────┤
│ <|start_header_id|>user<|end_header_id|>             │
│   {instruction}<|eot_id|>                            │
│ <|start_header_id|>assistant<|end_header_id|>        │
│                                                      │
│   Luna:                                              │
│   ← (model continues from here)                     │
└──────────────────────────────────────────────────────┘
```

### Dataflow Diagram

```
User Input ─────────────────────────────────────────────────────────────────┐
                                                                            │
  ┌─ State Assembly (on app load) ──────────────────────────────────────┐   │
  │  activeStory ──┐                                                    │   │
  │  globalSettings ├─→ merge → ReactiveStore.state                     │   │
  │  narrative.state┘                                                   │   │
  └─────────────────────────────────────────────────────────────────────┘   │
                                                                            │
  sendMessage() ◄───────────────────────────────────────────────────────────┘
       │
       ├─→ addMessageToHistory()         ← user message → chat_history
       ├─→ checkDynamicEntryTriggers()   ← lorebook scan → lore_reveal msgs
       ├─→ checkEventMaster()            ← dice roll → event_master_prompt
       ├─→ VisualMaster.checkTrigger()   ← dice roll → image generation
       │
       └─→ triggerAIResponse()
              │
              ├─→ determineNextSpeaker()  ← Scriptwriter AI call (if "Any")
              │
              ├─→ PromptBuilder.buildPrompt(targetId)
              │      │
              │      ├─→ _getReplacer()           ← {user}, {character}
              │      ├─→ resolve model_instructions or system_prompt
              │      ├─→ build locationContext     ← worldMap.grid
              │      ├─→ collect static_entries    ← always included
              │      ├─→ collect characters        ← active, filtered
              │      ├─→ _getSmartHistorySlice()   ← budget: 8000 spaces
              │      ├─→ consume event_master_prompt
              │      │
              │      ├─→ if koboldcpp: buildKoboldTemplatedPrompt()
              │      │     └─→ llama3 / gemma / phi3 / mistral / chatml / alpaca
              │      └─→ else: buildDefaultPrompt()
              │             └─→ plain text with ## headers
              │
              ├─→ APIService.callAI(prompt)
              │      └─→ POST /api/ai/generate
              │             └─→ server routes to provider
              │                    ├─→ Gemini:     single contents[] part
              │                    ├─→ OpenRouter:  single user message
              │                    ├─→ KoboldCPP:   raw prompt string
              │                    └─→ LM Studio:   single user message
              │
              ├─→ analyzeTurn(responseText)  ← sentiment + location detection
              │
              └─→ startStreamingResponse()
                     │
                     ├─→ push to chat_history
                     ├─→ checkAutoStaticKnowledge()  ← every 6 messages
                     └─→ checkDynamicEntryTriggers()  ← lorebook scan on AI msg
```
