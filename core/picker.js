// The one shared picker. Every mode draws cards through nextCard so the no-repeat rule lives here only.

// nextCard(queue, recent, { window, pool, lastSeen }) -> { id, filler } | null
//   queue    card ids still to show, in order
//   recent   card ids already shown, oldest first
//   pool     every card id in the deck, used for filler cards
//   lastSeen card id -> sequence number of when it was last shown
export function nextCard(queue, recent, { window = 3, pool = [], lastSeen = {} } = {}) {
  if (queue.length === 0) return null;
  const head = queue[0];
  if (window <= 0) return { id: head, filler: false };
  const recentWindow = new Set(recent.slice(-window));
  if (!recentWindow.has(head)) return { id: head, filler: false };

  const queued = new Set(queue);
  const seenAt = (id) => (id in lastSeen ? lastSeen[id] : -1);
  // least recently seen first; Array.prototype.sort is stable, so ties keep deck order
  const leastRecent = (ids) => ids.sort((a, b) => seenAt(a) - seenAt(b))[0];

  const fillers = pool.filter((id) => !recentWindow.has(id) && !queued.has(id));
  if (fillers.length > 0) return { id: leastRecent(fillers), filler: true };

  // Small deck: the whole window can't be honoured, but never show the same card twice in a row.
  const last = recent[recent.length - 1];
  const otherQueued = queue.find((id) => id !== last);
  if (otherQueued) return { id: otherQueued, filler: false };
  const anyOther = pool.filter((id) => id !== last && !queued.has(id));
  if (anyOther.length > 0) return { id: leastRecent(anyOther), filler: true };
  return { id: head, filler: false };
}
