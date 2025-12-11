/**
 * DBService (resilient, fail-soft, self-initializing)
 * - Never throws during app init; callers can await methods safely.
 * - Gracefully handles blocked upgrades, missing IDB (private mode), and transient errors.
 * - All public methods resolve to sensible defaults instead of rejecting.
 */
const DBService = {
  db: null,
  DB_NAME: "EllipsisDB",
  OPEN_TIMEOUT_MS: 3000, // soft guard so init can't hang the UI indefinitely

  /**
   * Open the database (version 1) and create the store if needed.
   * Never rejects; resolves to true if usable, false if unavailable.
   */
  _open(version = 1) {
    return new Promise((resolve) => {
      try {
        if (this.db) return resolve(true);
        if (!("indexedDB" in window)) {
          console.warn("IndexedDB not supported in this environment.");
          return resolve(false);
        }

        const request = indexedDB.open(this.DB_NAME, version);

        // Soft timeout so a blocked upgrade can't lock the app
        const timeout = setTimeout(() => {
          console.warn("IDB open timed out (likely blocked). Failing soft.");
          // Let the app continue without image cache
          resolve(false);
        }, this.OPEN_TIMEOUT_MS);

        request.onerror = (event) => {
          clearTimeout(timeout);
          console.warn("IndexedDB open error (fail-soft):", event?.target?.error);
          resolve(false);
        };

        request.onblocked = () => {
          clearTimeout(timeout);
          console.warn(
            "IndexedDB upgrade is blocked by another tab/window. Continuing without cache."
          );
          resolve(false);
        };

        request.onupgradeneeded = (event) => {
          try {
            const db = event.target.result;

            // 1. Create/check characterImages store
            if (!db.objectStoreNames.contains("characterImages")) {
              db.createObjectStore("characterImages");
              console.log("Object store created: characterImages");
            }

            // 2. Create stories store (metadata)
            // We will use the story 'id' (a UUID) as the keyPath.
            // This tells IDB to use the 'id' field on the object as its primary key.
            if (!db.objectStoreNames.contains("stories")) {
              db.createObjectStore("stories", { keyPath: "id" });
              console.log("Object store created: stories");
            }

            // 3. Create narratives store (heavy data)
            // We will also use the narrative 'id' as the keyPath.
            if (!db.objectStoreNames.contains("narratives")) {
              db.createObjectStore("narratives", { keyPath: "id" });
              console.log("Object store created: narratives");
            }
          } catch (e) {
            console.warn("onupgradeneeded failed (fail-soft):", e);
          }
        };

        request.onsuccess = (event) => {
          clearTimeout(timeout);
          try {
            this.db = event.target.result;
            // Close politely if a future upgrade happens elsewhere
            this.db.onversionchange = () => {
              console.warn("IDB version change detected; closing DB.");
              try { this.db.close(); } catch {}
              this.db = null;
            };
            console.log("IndexedDB ready.");
            resolve(true);
          } catch (e) {
            console.warn("IDB onsuccess handler failed (fail-soft):", e);
            resolve(false);
          }
        };
      } catch (err) {
        console.warn("IDB _open threw (fail-soft):", err);
        resolve(false);
      }
    });
  },

  /**
   * Public init. Never throws; resolves to void.
   */
  async init() {
    if (this.db) return;
    const ok = await this._open(2);
    if (!ok) {
      // Keep running without a DB; callers will no-op gracefully.
      return;
    }
  },

  /**
   * Ensure DB is ready. Returns boolean (true if usable).
   */
  async ensure() {
    if (this.db) return true;
    await this.init();
    return !!this.db;
  },

  /**
   * Save a Blob under a string key. Resolves boolean (success).
   */
  async saveImage(id, blob) {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["characterImages"], "readwrite");
        const store = tx.objectStore("characterImages");

        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);

        const req = store.put(blob, id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        console.warn("saveImage failed (fail-soft):", e);
        resolve(false);
      }
    });
  },

  /**
   * Fetch a Blob by id. Resolves Blob|null.
   */
  async getImage(id) {
    if (!(await this.ensure())) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["characterImages"], "readonly");
        const store = tx.objectStore("characterImages");

        tx.onabort = () => resolve(null);
        tx.onerror = () => resolve(null);

        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch (e) {
        console.warn("getImage failed (fail-soft):", e);
        resolve(null);
      }
    });
  },

  /**
   * Delete a key. Resolves boolean (success).
   */
  async deleteImage(id) {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["characterImages"], "readwrite");
        const store = tx.objectStore("characterImages");

        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);

        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        console.warn("deleteImage failed (fail-soft):", e);
        resolve(false);
      }
    });
  },

  /**
   * Clear the store. Resolves boolean (success).
   */
  async clear() {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["characterImages"], "readwrite");
        const store = tx.objectStore("characterImages");

        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);

        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        console.warn("clear failed (fail-soft):", e);
        resolve(false);
      }
    });
  },

  /**
   * Close the DB handle.
   */
  close() {
    try {
      if (this.db) this.db.close();
    } catch (e) {
      console.warn("DB close failed (ignored):", e);
    } finally {
      this.db = null;
    }
  },

  // ===================================================================
  // CRUD METHODS FOR STORIES & NARRATIVES
  // ===================================================================

  /**
   * Saves or updates a single story object in the 'stories' store.
   * @param {object} story - The story object (metadata only).
   * @returns {Promise<boolean>} True on success, false on failure.
   */
  async saveStory(story) {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["stories"], "readwrite");
        const store = tx.objectStore("stories");
        // 'put' will add or update the record based on its keyPath ('id')
        const req = store.put(story);
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => {
          console.warn("saveStory failed (fail-soft):", e.target.error);
          resolve(false);
        };
        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn("saveStory threw (fail-soft):", e);
        resolve(false);
      }
    });
  },

  /**
   * Retrieves a single story by its ID.
   * @param {string} storyId
   * @returns {Promise<object|null>} The story object or null.
   */
  async getStory(storyId) {
    if (!(await this.ensure())) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["stories"], "readonly");
        const store = tx.objectStore("stories");
        const req = store.get(storyId);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
        tx.onerror = () => resolve(null);
      } catch (e) {
        console.warn("getStory threw (fail-soft):", e);
        resolve(null);
      }
    });
  },

  /**
   * Retrieves ALL stories from the 'stories' store.
   * This is for the main library view.
   * @returns {Promise<Array<object>>} An array of story objects.
   */
  async getAllStories() {
    if (!(await this.ensure())) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["stories"], "readonly");
        const store = tx.objectStore("stories");
        const req = store.getAll(); // Efficiently gets all records
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
        tx.onerror = () => resolve([]);
      } catch (e) {
        console.warn("getAllStories threw (fail-soft):", e);
        resolve([]);
      }
    });
  },

  /**
   * Deletes a single story by its ID.
   * @param {string} storyId
   * @returns {Promise<boolean>} True on success.
   */
  async deleteStory(storyId) {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["stories"], "readwrite");
        const store = tx.objectStore("stories");
        const req = store.delete(storyId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn("deleteStory threw (fail-soft):", e);
        resolve(false);
      }
    });
  },

  /**
   * Saves or updates a single narrative object in the 'narratives' store.
   * @param {object} narrative - The narrative object (with chat history).
   * @returns {Promise<boolean>} True on success.
   */
  async saveNarrative(narrative) {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["narratives"], "readwrite");
        const store = tx.objectStore("narratives");
        const req = store.put(narrative);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn("saveNarrative threw (fail-soft):", e);
        resolve(false);
      }
    });
  },

  /**
   * Retrieves a single narrative by its ID.
   * @param {string} narrativeId
   * @returns {Promise<object|null>} The narrative object or null.
   */
  async getNarrative(narrativeId) {
    if (!(await this.ensure())) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["narratives"], "readonly");
        const store = tx.objectStore("narratives");
        const req = store.get(narrativeId);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
        tx.onerror = () => resolve(null);
      } catch (e) {
        console.warn("getNarrative threw (fail-soft):", e);
        resolve(null);
      }
    });
  },

  /**
   * Retrieves ALL narratives from the 'narratives' store.
   * @returns {Promise<Array<object>>} An array of narrative objects.
   */
  async getAllNarratives() {
    if (!(await this.ensure())) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["narratives"], "readonly");
        const store = tx.objectStore("narratives");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
        tx.onerror = () => resolve([]);
      } catch (e) {
        console.warn("getAllNarratives threw (fail-soft):", e);
        resolve([]);
      }
    });
  },

  /**
   * Deletes a single narrative by its ID.
   * @param {string} narrativeId
   * @returns {Promise<boolean>} True on success.
   */
  async deleteNarrative(narrativeId) {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(["narratives"], "readwrite");
        const store = tx.objectStore("narratives");
        const req = store.delete(narrativeId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn("deleteNarrative threw (fail-soft):", e);
        resolve(false);
      }
    });
  },

  /**
   * A generic helper to get all [key, value] pairs from any store.
   * We will use this to export all images.
   * @param {string} storeName - The name of the object store.
   * @returns {Promise<Array<[string, any]>>} An array of [key, value] tuples.
   */
  async getAllEntries(storeName) {
    if (!(await this.ensure())) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([storeName], "readonly");
        const store = tx.objectStore(storeName);
        const entries = [];
        const req = store.openCursor();

        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            entries.push([cursor.key, cursor.value]);
            cursor.continue();
          } else {
            resolve(entries);
          }
        };
        req.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
        tx.onerror = () => resolve([]);
      } catch (e) {
        console.warn(`getAllEntries (${storeName}) threw (fail-soft):`, e);
        resolve([]);
      }
    });
  },

  /**
   * Clears all data from a specific object store.
   * We will use this for a clean import.
   * @param {string} storeName - The name of the object store to clear.
   * @returns {Promise<boolean>} True on success.
   */
  async clearStore(storeName) {
    if (!(await this.ensure())) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([storeName], "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn(`clearStore (${storeName}) threw (fail-soft):`, e);
        resolve(false);
      }
    });
  }
};
