// Storage adapter: get, set, list, remove and clear, all async. v1 uses this browser's localStorage;
// a later version can put D1 or KV behind the same three calls.

// onWriteError(err) is called once if a save fails (storage full or blocked), so the app can warn
// that progress is now only in memory. After that, everything reads and writes memory, so the
// session stays consistent instead of silently reading back older saved data.
export function createLocalStorage(prefix = 'study:v1:', { onWriteError = () => {} } = {}) {
  let store = (() => {
    try {
      const s = window.localStorage;
      s.getItem(prefix + 'probe');
      return s;
    } catch { return null; }
  })();
  const memory = new Map();

  function fallBackToMemory(err) {
    if (store) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(prefix) && !memory.has(k.slice(prefix.length))) memory.set(k.slice(prefix.length), store.getItem(k));
      }
    }
    store = null;
    api.persistent = false;
    onWriteError(err);
  }

  const api = {
    persistent: Boolean(store),
    async get(key) {
      try {
        const raw = store ? store.getItem(prefix + key) : memory.get(key);
        return raw == null ? null : JSON.parse(raw);
      } catch { return null; }
    },
    async set(key, value) {
      const raw = JSON.stringify(value);
      if (store) {
        try { store.setItem(prefix + key, raw); return; } catch (err) { fallBackToMemory(err); }
      }
      memory.set(key, raw);
    },
    async remove(key) {
      if (store) { try { store.removeItem(prefix + key); } catch { /* nothing to remove */ } }
      memory.delete(key);
    },
    // everything this app keeps in this browser (used when someone signs out or another person signs in)
    async clear() {
      for (const k of await api.list('')) await api.remove(k);
    },
    async list(keyPrefix = '') {
      const keys = store
        ? Array.from({ length: store.length }, (_, i) => store.key(i))
          .filter((k) => k && k.startsWith(prefix + keyPrefix)).map((k) => k.slice(prefix.length))
        : [...memory.keys()].filter((k) => k.startsWith(keyPrefix));
      return keys.sort();
    },
  };
  return api;
}
