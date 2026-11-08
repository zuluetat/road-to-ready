// The row of round study-set icons at the top of home, like pinned contacts in Messages: tap one to
// see only that set, tap it again to see them all. The pick is remembered per browser; if storage is
// blocked or damaged, every set simply shows.

export const FOCUS_KEY = 'study.focusSet';

// sets: collections from data/index.json -> [{ id, label, image, initials }]
// The image is the set's own icon, else its first badge; with neither, the circle shows initials.
export function shortcutsFor(sets) {
  return sets.map((s) => ({
    id: s.id,
    label: s.short || s.title,
    image: s.icon || s.badges?.[0]?.image || null,
    initials: (s.short || s.title).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''),
  }));
}

// Which sets the home page shows: the picked one alone, or all of them when nothing (or a set that
// no longer exists) is picked.
export function setsShown(ids, focus) {
  return ids.includes(focus) ? [focus] : ids;
}

export function readFocus(store) {
  try { return store?.getItem(FOCUS_KEY) || null; } catch { return null; }
}

// Picking the set already picked clears the pick. -> the pick now in force (null: every set)
export function setFocus(store, id) {
  const next = readFocus(store) === id ? null : id;
  try {
    if (next) store?.setItem(FOCUS_KEY, next);
    else store?.removeItem(FOCUS_KEY);
  } catch { /* not kept */ }
  return next;
}

// ids: the sets in index order; settingsById: each set's settings (status, subscribed); nothing
// stored means subscribed and being studied.
// -> { shown: subscribed sets being studied, then those kept fresh; hidden: the unsubscribed ones }
export function arrangeSets(ids, settingsById) {
  const on = (id) => settingsById[id]?.subscribed !== false;
  const resting = (id) => settingsById[id]?.status === 'maintenance';
  return {
    shown: [...ids.filter((id) => on(id) && !resting(id)), ...ids.filter((id) => on(id) && resting(id))],
    hidden: ids.filter((id) => !on(id)),
  };
}

// The My study sets page: every set, ticked when subscribed, with the same icon as its shortcut.
export function setsChecklist(sets, settingsById) {
  return shortcutsFor(sets).map(({ id, image, initials }, i) => ({
    id, title: sets[i].title, image, initials,
    subscribed: settingsById[id]?.subscribed !== false,
    passed: settingsById[id]?.status === 'maintenance',
  }));
}
