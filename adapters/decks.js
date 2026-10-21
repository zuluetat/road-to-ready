// Deck source adapter: loadIndex, loadDeck, saveDeck, deleteDeck, and loadExam for practice exams.
// Built-in decks are static JSON in data/. Uploaded decks live on the server (/api/decks), synced
// across devices, with a copy cached on this device so they still open when the network drops.
// With api: null (the public copy, no server) uploaded decks live in this browser only.
// The server copy is the master: it replaces the cached copy whenever it answers, and a deck the
// server says is gone is removed from this device too.

const SIGNED_OUT = 'Your sign-in has expired. Reload the page to sign in again.';

export function createDecks({ base = 'data/', api = '/api/decks', storage, fetchImpl = (...a) => fetch(...a) } = {}) {
  const builtInCache = new Map(); // built-in decks only change with a deploy, so keep them for the session
  let staticIndex = null;

  async function getJson(url, init) {
    // redirect: 'manual' so an expired Access session shows up as a redirect we can name,
    // instead of a confusing cross-site failure.
    const res = await fetchImpl(url, { cache: 'no-cache', redirect: 'manual', ...init });
    if (res.type === 'opaqueredirect') {
      const err = new Error(SIGNED_OUT);
      err.code = 'signed-out';
      throw err;
    }
    if (res.status === 204) return null; // success with nothing to read
    const type = res.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await res.json() : null;
    if (!res.ok || !body) {
      const err = new Error(body?.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // Worth falling back to this device's copy: no network, a server hiccup, or an expired sign-in.
  // Not worth it: the server answered that the deck doesn't exist.
  const transient = (err) => err.code === 'signed-out' || !err.status || err.status >= 500;

  // no server: uploaded decks are kept in this browser, listed under deckcache:index
  const local = {
    list: async () => (await storage?.get('deckcache:index')) || [],
    async save(deck) {
      const entry = { id: deck.id, title: deck.title, cardCount: (deck.cards || []).length };
      await storage?.set('deckcache:' + deck.id, deck);
      await storage?.set('deckcache:index', [...(await local.list()).filter((d) => d.id !== deck.id), entry]);
    },
    async remove(id) {
      await storage?.set('deckcache:' + id, null);
      await storage?.set('deckcache:index', (await local.list()).filter((d) => d.id !== id));
    },
  };

  async function loadStatic() {
    if (!staticIndex) staticIndex = await getJson(base + 'index.json');
    return staticIndex;
  }

  return {
    // { siteTitle, decks: [{ id, title, cardCount, source }], exams: [{ id, title, questionCount }],
    //   collections: [{ id, title, purpose, decks: [ids], exams: [ids] }],
    //   uploads: 'synced' | 'cached' | 'signed-out' | 'unavailable' }
    async loadIndex() {
      const index = await loadStatic();
      const builtIn = index.decks.map((d) => ({ ...d, source: 'built-in' }));
      let uploaded = [];
      let uploads = 'synced';
      if (api === null) uploaded = await local.list();
      else try {
        uploaded = (await getJson(api)).decks;
        await storage?.set('deckcache:index', uploaded);
      } catch (err) {
        uploaded = (await storage?.get('deckcache:index')) || [];
        uploads = err.code === 'signed-out' ? 'signed-out' : uploaded.length ? 'cached' : 'unavailable';
      }
      return {
        siteTitle: index.siteTitle,
        decks: [...builtIn, ...uploaded.map((d) => ({ ...d, source: 'uploaded' }))],
        exams: index.exams || [],
        collections: index.collections || [],
        uploads,
      };
    },

    async loadDeck(id) {
      if (builtInCache.has(id)) return builtInCache.get(id);
      const entry = (await loadStatic()).decks.find((d) => d.id === id);
      if (entry) {
        const deck = await getJson(base + entry.file);
        builtInCache.set(id, deck);
        return deck;
      }
      if (api === null) {
        const saved = await storage?.get('deckcache:' + id);
        if (saved) return saved;
        throw new Error(`No deck called ${id}`);
      }
      try {
        const deck = await getJson(`${api}/${encodeURIComponent(id)}`);
        await storage?.set('deckcache:' + id, deck);
        return deck;
      } catch (err) {
        if (transient(err)) {
          const cached = await storage?.get('deckcache:' + id);
          if (cached) return cached;
          throw err;
        }
        await storage?.set('deckcache:' + id, null);
        throw err.status === 404 ? new Error(`No deck called ${id}`) : err;
      }
    },

    // Collections from the built-in index only (no server call), for screens that just need them.
    async loadCollections() {
      return { collections: (await loadStatic()).collections || [] };
    },

    // A practice exam's question bank, listed under exams in data/index.json.
    async loadExam(id) {
      const entry = ((await loadStatic()).exams || []).find((e) => e.id === id);
      if (!entry) throw new Error(`No practice exam called ${id}`);
      return getJson(base + entry.file);
    },

    async saveDeck(deck) {
      if (api === null) return local.save(deck);
      await getJson(`${api}/${encodeURIComponent(deck.id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(deck),
      });
      await storage?.set('deckcache:' + deck.id, deck);
    },

    async deleteDeck(id) {
      if (api === null) return local.remove(id);
      await getJson(`${api}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await storage?.set('deckcache:' + id, null);
    },
  };
}
