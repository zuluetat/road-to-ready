// Collections: the reason a set of decks and practice exams was put together ("studying for the
// AWS AI Practitioner exam"). Listed in data/index.json; a deck or exam in no collection is shown
// on its own.

// -> { collections: [{ id, title, purpose, badges, decks, exams }], otherDecks, otherExams }
export function groupLibrary({ decks = [], exams = [], collections = [] }) {
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const examById = new Map(exams.map((e) => [e.id, e]));
  const placed = new Set();
  const grouped = collections.map((c) => {
    const ids = (c.decks || []).filter((id) => deckById.has(id));
    const examIds = (c.exams || []).filter((id) => examById.has(id));
    for (const id of [...ids, ...examIds]) placed.add(id);
    return {
      id: c.id, title: c.title, purpose: c.purpose || '', badges: c.badges || [],
      decks: ids.map((id) => deckById.get(id)), exams: examIds.map((id) => examById.get(id)),
    };
  });
  const otherDecks = decks.filter((d) => !placed.has(d.id));
  return {
    collections: grouped,
    otherDecks: [...otherDecks.filter((d) => d.source === 'uploaded'), ...otherDecks.filter((d) => d.source !== 'uploaded')],
    otherExams: exams.filter((e) => !placed.has(e.id)),
  };
}

// The collection a deck belongs to, or null.
export function collectionOf({ collections = [] }, deckId) {
  return collections.find((c) => (c.decks || []).includes(deckId)) || null;
}
