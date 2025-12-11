/**
 * Utility function to prevent a function from being called too frequently.
 */
const debounce = (func, wait) => {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
};

/**
 * UTILITY Module
 * Common helper functions used throughout the application.
 */
const UTILITY = {
  uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  },

  escapeHTML(str) {
    if(typeof str !== 'string') return '';
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
  },

  hexToRgba(hex, alpha) {
    let r = 0, g = 0, b = 0;
    if (hex.length == 4) {
      r = "0x" + hex[1] + hex[1];
      g = "0x" + hex[2] + hex[2];
      b = "0x" + hex[3] + hex[3];
    } else if (hex.length == 7) {
      r = "0x" + hex[1] + hex[2];
      g = "0x" + hex[3] + hex[4];
      b = "0x" + hex[5] + hex[6];
    }
    return `rgba(${+r},${+g},${+b},${alpha})`;
  },

  darkenHex(hex, percent) {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = (num >> 8 & 0x00FF) - amt;
    const B = (num & 0x0000FF) - amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
  },

  getDefaultApiSettings() {
    return {
      apiProvider: 'gemini',
      geminiApiKey: '',
      openRouterKey: '',
      openRouterModel: 'google/gemini-flash-1.5',
      koboldcpp_url: 'http://localhost:5001',
      koboldcpp_template: 'none',
      koboldcpp_min_p: 0.1,
      koboldcpp_dry: 0.25,
      lmstudio_url: 'http://localhost:1234',
    };
  },

  getDefaultUiSettings() {
    return {
      font: "'Inter', sans-serif",
      backgroundImageURL: '',
      bubbleOpacity: 0.85,
      chatTextColor: '#e5e7eb',
      characterImageMode: 'none',
      backgroundBlur: 5,
      textSize: 16,
      bubbleImageSize: 100,
    };
  },

  getDefaultStorySettings() {
    return {
      creator_notes: "",
      tags: [],
    };
  },

  getDefaultSystemPrompts() {
    return {
      system_prompt: 'You are a master storyteller. Follow instructions precisely.',
      event_master_base_prompt: 'You are a secret Event Master. Read the chat. Generate a brief, secret instruction for AI characters to introduce a logical but unexpected event.',
      event_master_prompt: '',
      prompt_persona_gen: "Embellish this character concept into a rich, detailed, and compelling persona description. CONCEPT: \"{concept}\"",
      prompt_world_map_gen: "Based on the following story context, generate a genre-appropriate 8x8 grid of interconnected fantasy locations. The central location (4,4) should be a neutral starting point. Attempt to include locations mentioned in the context.\nCONTEXT:\nCHARACTERS:\n{characters}\n\nSTATIC LORE:\n{static}\n\nRECENT EVENTS:\n{recent}\n\nRespond with a valid JSON object: { \"grid\": [ { \"coords\": {\"x\":int, \"y\":int}, \"name\": \"string\", \"description\": \"string (one-line summary)\", \"prompt\": \"string (a rich, detailed paragraph for the AI)\", \"imageUrl\": \"\" } ] }. The grid must contain exactly 64 locations.",
      prompt_location_gen: "Generate a rich, detailed, and evocative paragraph-long prompt for a fantasy location named '{name}' which is briefly described as '{description}'. This prompt will be given to an AI storyteller to describe the scene.",
      prompt_entry_gen: "Generate a detailed and informative encyclopedia-style entry for a lore topic titled '{title}'. If relevant, use the following triggers as context: '{triggers}'.",
      prompt_location_memory_gen: "You are an archivist. Read the following chat transcript that occurred at a specific location. Summarize the key events, character developments, and important facts into a concise, single paragraph. This will serve as a memory for what happened at that location.\n\nTRANSCRIPT:\n{transcript}",
      prompt_story_notes_gen: "Based on the following story context (characters, lore), generate a brief, 1-2 sentence creator's note or 'blurb' for this story to show in a library.\n\nCONTEXT:\n{context}",
      prompt_story_tags_gen: "Based on the following story context (characters, lore), generate 3-5 relevant, one-word, comma-separated tags for this story (e.g., fantasy, sci-fi, mystery, horror, romance).\n\nCONTEXT:\n{context}"
    };
  },

  createDefaultMapGrid() {
    const grid = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        grid.push({
          coords: { x, y },
          name: "",
          description: "",
          prompt: "",
          imageUrl: "",
          local_static_entries: []
        });
      }
    }
    return grid;
  },

  findPath(grid, startCoords, endCoords) {
    const toKey = ({ x, y }) => `${x},${y}`;
    const fromKey = (key) => { const [x, y] = key.split(',').map(Number); return { x, y }; };

    const nodes = grid.map(loc => ({
      ...loc,
      g: Infinity,
      h: Infinity,
      f: Infinity,
      parent: null,
    }));

    const startNode = nodes.find(n => n.coords.x === startCoords.x && n.coords.y === startCoords.y);
    const endNode = nodes.find(n => n.coords.x === endCoords.x && n.coords.y === endCoords.y);

    if (!startNode || !endNode) return [];

    const heuristic = (a, b) => Math.abs(a.coords.x - b.coords.x) + Math.abs(a.coords.y - b.coords.y);

    let openSet = [startNode];
    let closedSet = new Set();

    startNode.g = 0;
    startNode.h = heuristic(startNode, endNode);
    startNode.f = startNode.h;

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      let currentNode = openSet.shift();

      if (currentNode === endNode) {
        let path = [];
        let temp = currentNode;
        while (temp) {
          path.push(temp.coords);
          temp = temp.parent;
        }
        return path.reverse();
      }

      closedSet.add(toKey(currentNode.coords));

      const neighbors = nodes.filter(n => {
        const dx = Math.abs(n.coords.x - currentNode.coords.x);
        const dy = Math.abs(n.coords.y - currentNode.coords.y);
        return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
      });

      for (let neighbor of neighbors) {
        if (closedSet.has(toKey(neighbor.coords))) continue;

        let tentativeG = currentNode.g + 1;

        if (tentativeG < neighbor.g) {
          neighbor.parent = currentNode;
          neighbor.g = tentativeG;
          neighbor.h = heuristic(neighbor, endNode);
          neighbor.f = neighbor.g + neighbor.h;
          if (!openSet.includes(neighbor)) {
            openSet.push(neighbor);
          }
        }
      }
    }
    return [];
  },

  weightedChoice(characters, weights, controller) {
    if (controller) {
      const scoresDataForModal = characters.map((char, index) => ({
        name: char.name,
        score: weights[index]
      })).sort((a, b) => b.score - a.score);
    }

    if (characters.length !== weights.length || characters.length === 0) {
      return null;
    }

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight <= 0) {
      return characters[Math.floor(Math.random() * characters.length)];
    }
    let random = Math.random() * totalWeight;

    for (let i = 0; i < characters.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return characters[i];
      }
    }

    return characters[characters.length - 1];
  },

  /**
   * Checks if there is enough space in localStorage for an estimated import size.
   * @param {number} estimatedSize - The estimated size of the import in bytes.
   * @returns {boolean} - True if there is likely enough space, false otherwise.
   */
  checkLocalStorageQuota(estimatedSize) {
    try {
      const testKey = 'quota-check';
      const existingDataSize = JSON.stringify(localStorage).length;
      const availableSpace = (5 * 1024 * 1024) - existingDataSize; // Assuming 5MB limit

      if (estimatedSize > availableSpace) {
        return false;
      }

      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }
};
