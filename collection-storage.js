/**
 * IndexedDB-backed storage for collection and graph state (avoids localStorage quota).
 * Keys: lennings_collection, lennings_object_nodes, lennings_graph_positions,
 *       lennings_graph_zoom, lennings_graph_threshold, lennings_graph_object_edges.
 */
(function () {
    const DB_NAME = 'lennings_db';
    const STORE_NAME = 'store';
    const GAME_STORAGE_KEYS = [
        'lennings_collection',
        'lennings_object_nodes',
        'lennings_graph_positions',
        'lennings_graph_zoom',
        'lennings_graph_threshold',
        'lennings_graph_object_edges'
    ];

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
        });
    }

    /**
     * Get a value by key. If missing in IDB, try localStorage and migrate (then return).
     * @param {string} key
     * @returns {Promise<*>} Parsed value or null
     */
    function getItem(key) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(key);
                req.onsuccess = () => {
                    let value = req.result;
                    if (value === undefined) {
                        try {
                            const raw = localStorage.getItem(key);
                            if (raw !== null) {
                                value = key === 'lennings_graph_threshold' ? raw : JSON.parse(raw);
                                const putReq = store.put(value, key);
                                putReq.onsuccess = () => {
                                    localStorage.removeItem(key);
                                    db.close();
                                    resolve(value);
                                };
                                putReq.onerror = () => {
                                    db.close();
                                    resolve(value);
                                };
                                return;
                            } else {
                                value = null;
                            }
                        } catch (e) {
                            value = null;
                        }
                    }
                    db.close();
                    resolve(value);
                };
                req.onerror = () => {
                    db.close();
                    reject(req.error);
                };
            });
        }).catch(err => {
            console.warn('[LenningsStorage] getItem failed:', err);
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) return null;
                return key === 'lennings_graph_threshold' ? raw : JSON.parse(raw);
            } catch (e) {
                return null;
            }
        });
    }

    /**
     * Set a value by key (stored as-is in IDB).
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    function setItem(key, value) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.put(value, key);
                req.onsuccess = () => {
                    db.close();
                    resolve();
                };
                req.onerror = () => {
                    db.close();
                    reject(req.error);
                };
            });
        }).catch(err => {
            console.warn('Could not save to storage:', err);
        });
    }

    /**
     * Clear all six game storage keys from IDB and localStorage.
     * @returns {Promise<void>}
     */
    function clearGameStorage() {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                GAME_STORAGE_KEYS.forEach(k => store.delete(k));
                tx.oncomplete = () => {
                    db.close();
                    GAME_STORAGE_KEYS.forEach(k => {
                        try { localStorage.removeItem(k); } catch (e) {}
                    });
                    resolve();
                };
                tx.onerror = () => {
                    db.close();
                    reject(tx.error);
                };
            });
        }).catch(err => {
            console.warn('[LenningsStorage] clearGameStorage failed:', err);
            GAME_STORAGE_KEYS.forEach(k => {
                try { localStorage.removeItem(k); } catch (e) {}
            });
        });
    }

    function loadCollection() {
        return getItem('lennings_collection').then(val => Array.isArray(val) ? val : []);
    }

    function saveCollection(collection) {
        return setItem('lennings_collection', collection);
    }

    window.LenningsStorage = {
        getItem,
        setItem,
        clearGameStorage,
        loadCollection,
        saveCollection,
        GAME_STORAGE_KEYS
    };
})();
