// Which study sets are folded on the home screen, remembered per browser. A convenience: if storage
// is blocked or damaged, every set simply starts open.

export const COLLAPSE_KEY = 'study.collapsedSets';

export function readCollapsed(store) {
  try {
    const list = JSON.parse(store?.getItem(COLLAPSE_KEY) || '[]');
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function setCollapsed(store, id, collapsed) {
  const set = readCollapsed(store);
  if (collapsed) set.add(id);
  else set.delete(id);
  try { store?.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch { /* not kept */ }
  return set;
}
