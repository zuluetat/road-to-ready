// Progress sync adapter: keeps this device's progress (progress:<deckId>, exam:<bankId>, game:<collectionId>
// in local storage) in step with the copy on the server (/api/progress), merging with core/sync.js.
//
//   pull()          fetch every record, merge into this device; queue anything this device has newer
//   markDirty(key)  a local record changed; push it on the next flush
//   flush()         push queued records; the server merges and replies with the merged copy
//   update(key, fn) change one stored record; saves and sync take turns on a record, so neither
//                   overwrites the other
//
// Both return { status: 'synced' | 'offline' | 'signed-out' | 'unavailable' | 'rejected' }. Nothing is lost when
// the server can't be reached: the queue lives in storage (sync:dirty) and survives a reload.

import { mergeRecord, normaliseRecord } from '../core/sync.js';

const QUEUE = 'sync:dirty';
const toRemote = (localKey) => (localKey.startsWith('progress:') ? 'deck:' + localKey.slice(9) : localKey);
const toLocal = (remoteKey) => (remoteKey.startsWith('deck:') ? 'progress:' + remoteKey.slice(5) : remoteKey);

// Equal regardless of key order: records pass through JSON and migrate(), which reorder keys.
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])]));
  return x;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// The public copy has no server: the same calls, saving to this browser only.
export function createLocalSync({ storage }) {
  const locks = new Map();
  function update(localKey, fn) {
    const run = (locks.get(localKey) || Promise.resolve()).then(async () => {
      const next = await fn(await storage.get(localKey));
      if (next !== undefined) await storage.set(localKey, next);
      return next;
    });
    locks.set(localKey, run.catch(() => {}));
    return run;
  }
  return {
    pull: async () => ({ status: 'synced', changed: [] }),
    markDirty: () => {},
    flush: async () => ({ status: 'synced' }),
    update,
    status: () => 'synced',
    pending: async () => 0,
  };
}

class SyncError extends Error {
  constructor(status) { super(status); this.status = status; }
}

export function createSync({ api = '/api/progress', storage, fetchImpl = (...a) => fetch(...a) }) {
  const dirty = new Set();
  const locks = new Map(); // localKey -> the last queued change to it
  let saving = Promise.resolve();
  const loaded = storage.get(QUEUE).then((list) => { for (const k of list || []) dirty.add(k); }, () => {});
  let flushing = null;
  let lastStatus = 'synced';

  const persist = () => {
    saving = saving.then(() => storage.set(QUEUE, [...dirty])).catch(() => {});
    return saving;
  };

  async function request(url, init) {
    let res;
    try {
      res = await fetchImpl(url, { cache: 'no-cache', redirect: 'manual', ...init });
    } catch {
      throw new SyncError('offline');
    }
    if (res.type === 'opaqueredirect') throw new SyncError('signed-out');
    if (!res.ok) {
      const err = new SyncError(res.status >= 500 ? 'unavailable' : 'rejected');
      err.code = res.status;
      throw err;
    }
    return res.json();
  }

  const report = (status) => { lastStatus = status; return status; };

  // Read, change and write one record with nobody else changing it in between. fn returns the
  // record to store, or undefined to leave it untouched (no write, so other tabs see no change).
  function withRecord(localKey, fn) {
    const run = (locks.get(localKey) || Promise.resolve()).then(async () => {
      const current = await storage.get(localKey);
      const next = await fn(current);
      if (next !== undefined) await storage.set(localKey, next);
      return next;
    });
    const settled = run.catch(() => {});
    locks.set(localKey, settled);
    settled.then(() => { if (locks.get(localKey) === settled) locks.delete(localKey); });
    return run;
  }

  async function pull() {
    await loaded;
    let records;
    try {
      ({ records } = await request(api));
    } catch (err) {
      return { status: report(err.status === 'rejected' ? 'unavailable' : err.status), changed: [] };
    }
    const changed = [];
    const onServer = new Set();
    for (const { key, body } of records) {
      const localKey = toLocal(key);
      onServer.add(localKey);
      try {
        await withRecord(localKey, (local) => {
          const remote = normaliseRecord(key, body);
          const merged = mergeRecord(key, local && normaliseRecord(key, local), remote);
          if (!same(merged, remote)) dirty.add(localKey); // this device knew something the server didn't
          if (local && same(merged, local)) return undefined;
          changed.push(localKey);
          return merged;
        });
      } catch (err) {
        console.warn('study sync: skipped a record it could not merge', key, err); // the local copy stays as it was
      }
    }
    // progress made on this device before sync existed, or never pushed
    for (const prefix of ['progress:', 'exam:', 'game:', 'profile:']) {
      for (const localKey of await storage.list(prefix)) if (!onServer.has(localKey)) dirty.add(localKey);
    }
    await persist();
    return { status: report('synced'), changed };
  }

  function markDirty(localKey) {
    dirty.add(localKey);
    persist();
  }

  async function pushAll() {
    await loaded;
    await saving;
    if (dirty.size === 0) return lastStatus; // nothing sent, so nothing learned about the connection
    let outcome = 'synced';
    for (const localKey of [...dirty]) {
      const key = toRemote(localKey);
      const sent = await storage.get(localKey);
      if (!sent) { dirty.delete(localKey); continue; }
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      let reply;
      try {
        reply = await request(`${api}/${kind}/${encodeURIComponent(id)}`, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sent),
        });
      } catch (err) {
        // No connection or no sign-in: nothing else will get through either, so stop here.
        if (err.status === 'offline' || err.status === 'signed-out') { await persist(); return report(err.status); }
        // This one record failed (server trouble, or refused: too large, too many); keep it queued,
        // say so, and carry on with the rest. A malformed one (400) can never succeed, so drop it.
        if (err.code === 400) dirty.delete(localKey);
        if (outcome === 'synced' || err.status === 'rejected') outcome = err.status;
        continue;
      }
      // An answer may have been saved while the push was on its way: keep it, and send it next time.
      await withRecord(localKey, (latest) => {
        if (same(latest, sent)) dirty.delete(localKey);
        const final = mergeRecord(key, latest && normaliseRecord(key, latest), normaliseRecord(key, reply.body));
        return latest && same(final, latest) ? undefined : final;
      });
    }
    await persist();
    return report(outcome);
  }

  // One push at a time. A flush asked for while one runs waits for it, then pushes whatever is
  // still queued, so a save made mid-push goes up straight after rather than at the next save.
  async function flush() {
    while (flushing) await flushing.catch(() => {});
    flushing = pushAll().then((status) => ({ status })).finally(() => { flushing = null; });
    return flushing;
  }

  return {
    pull,
    markDirty,
    flush,
    update: (localKey, fn) => withRecord(localKey, fn),
    status: () => lastStatus,
    pending: async () => { await loaded; return dirty.size; },
  };
}
