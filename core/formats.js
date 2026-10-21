// File formats: Quizlet import text, CSV, deck files and progress backups.

export const DECK_SCHEMA_VERSION = 1;
const BACKUP_KIND = 'study-backup';

const flat = (s) => String(s).replace(/\r?\n/g, ' ');

export function toQuizletText(deck) {
  return deck.cards.map((c) => flat(c.term).replace(/\|/g, '/') + '|' + flat(c.definition).replace(/\|/g, '/')).join('\n');
}

function csvField(s) {
  const v = String(s);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function toCsv(deck) {
  return ['term,definition', ...deck.cards.map((c) => csvField(c.term) + ',' + csvField(c.definition))].join('\n');
}

// One card per line, term and definition split on the first | or, failing that, the first tab
// (Quizlet's default export).
export function parsePipeText(text) {
  return text.split(/\r?\n/)
    .map((line) => {
      const i = line.includes('|') ? line.indexOf('|') : line.indexOf('\t');
      return i < 0 ? null : { term: line.slice(0, i).trim(), definition: line.slice(i + 1).trim() };
    })
    .filter(Boolean);
}

// Deck ids appear in URLs and file names, so they stay plain.
export function isValidDeckId(id) {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

// Two-column CSV with optional term,definition header.
export function parseCsv(text) {
  const cards = parseCsvRows(text).filter((r) => r.length >= 2 && r[0].trim() !== '');
  if (cards.length && cards[0][0].trim().toLowerCase() === 'term' && cards[0][1].trim().toLowerCase() === 'definition') {
    cards.shift();
  }
  return cards.map((r) => ({ term: r[0].trim(), definition: r[1].trim() }));
}

// Raw CSV rows. Handles quoted fields with delimiters, quotes and line breaks.
export function parseCsvRows(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// FNV-1a, 32-bit, in base 36: a short, stable fingerprint of a string. Not for security.
function fingerprint(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// An id that depends only on the text, never on its position, so progress follows a card when
// others are added or removed. Plain text ("F1 score") keeps a readable slug. Text the slug would
// lose information from ("C++" and "C#" both slug to "c", and non-Latin text slugs to nothing)
// gets a fingerprint of the exact text added.
function stableId(text, fallback, max) {
  const slug = slugify(text).slice(0, max).replace(/-+$/, '');
  if (slug && /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(String(text).trim())) return slug;
  return (slug || fallback) + '-' + fingerprint(String(text).trim());
}

// The id for an uploaded deck, from its name. Always starts "u-", so it can't replace a built-in deck.
export function deckIdFor(title) {
  return 'u-' + stableId(title, 'deck', 80);
}

export function makeDeck({ id, title, description = '', tags = [] }, pairs) {
  const used = new Set();
  const cards = pairs.map(({ term, definition }) => {
    // capped so a suffix still fits the 120-character id limit
    const base = stableId(term, 'card', 100);
    let cardId = base;
    for (let n = 2; used.has(cardId); n++) cardId = base + '-' + n;
    used.add(cardId);
    return { id: cardId, term, definition, hint: null, tags: [], media: null };
  });
  return { schemaVersion: DECK_SCHEMA_VERSION, id, title, description, tags, cards };
}

// When a deck is replaced, every card whose term is exactly unchanged keeps its old id, so its
// progress carries over whatever the id rules were when it was first made. Other cards keep their
// new ids, renumbered only if one now clashes with a kept id. A kept card with no tags of its own
// keeps its old tags too (the look-alike groups that pick close wrong answers).
export function keepCardIds(next, old) {
  const oldCards = new Map((old?.cards || []).map((c) => [c.term, c]));
  const used = new Set();
  const cards = next.cards.map((c) => {
    const prev = oldCards.get(c.term);
    const id = prev?.id;
    if (id && !used.has(id)) {
      used.add(id);
      const kept = { ...c, id, tags: c.tags?.length ? c.tags : (prev.tags || []) };
      // the real-world examples stay too
      if (!kept.example && prev.example) kept.example = prev.example;
      if (!kept.mine && prev.mine) kept.mine = prev.mine;
      return kept;
    }
    return { ...c, id: null };
  });
  next.cards.forEach((c, i) => {
    if (cards[i].id) return;
    let id = c.id;
    for (let n = 2; used.has(id); n++) id = c.id + '-' + n;
    used.add(id);
    cards[i].id = id;
  });
  return { ...next, cards };
}

export const LIMITS ={ cards: 2000, term: 500, definition: 4000, title: 200 };
const CARD_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

// Checks a deck before it is stored or saved, and returns a clean copy with only known fields.
// Shared by the upload screen and the server, so both refuse the same things for the same reasons.
export function validateDeck(input, id) {
  const fail = (msg) => { throw new Error(msg); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Deck must be an object');
  if (input.id !== id || !isValidDeckId(id)) fail('Deck id does not match');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > LIMITS.title) fail('Deck needs a title of up to 200 characters');
  if (!Array.isArray(input.cards) || input.cards.length === 0) fail('Deck has no cards');
  if (input.cards.length > LIMITS.cards) fail(`A deck can hold at most ${LIMITS.cards} cards`);
  const seen = new Set();
  const cards = input.cards.map((c, i) => {
    const n = i + 1;
    if (!c || typeof c.term !== 'string' || typeof c.definition !== 'string' || !c.term.trim() || !c.definition.trim()) {
      fail(`Card ${n} needs a term and a definition`);
    }
    if (c.term.length > LIMITS.term || c.definition.length > LIMITS.definition) fail(`Card ${n} is too long`);
    if (typeof c.id !== 'string' || !CARD_ID.test(c.id)) fail(`Card ${n} has an invalid id`);
    if (seen.has(c.id)) fail(`Card id ${c.id} appears twice`);
    seen.add(c.id);
    return { id: c.id, term: c.term.trim(), definition: c.definition.trim(), hint: null, tags: [], media: null };
  });
  const description = typeof input.description === 'string' ? input.description.slice(0, 1000) : '';
  const tags = Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string').slice(0, 20) : [];
  return { schemaVersion: DECK_SCHEMA_VERSION, id, title, description, tags, cards };
}

// data/index.json lists the decks. Returns a new index with this deck added or replaced, keeping order.
export function upsertIndex(index, deck) {
  const base = index || { schemaVersion: 1, siteTitle: 'Study', decks: [] };
  const entry = { id: deck.id, title: deck.title, file: 'decks/' + deck.id + '.json', cardCount: deck.cards.length };
  const at = base.decks.findIndex((d) => d.id === deck.id);
  const decks = at >= 0 ? base.decks.map((d, i) => (i === at ? entry : d)) : [...base.decks, entry];
  return { ...base, decks };
}

// exams: practice exam history by bank id (absent in backups made before practice exams)
export function makeBackup(decks, exportedAt, exams = {}) {
  return { kind: BACKUP_KIND, schemaVersion: 1, exportedAt, decks, exams };
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || data.kind !== BACKUP_KIND || !data.decks || typeof data.decks !== 'object') {
    throw new Error('Not a study backup file');
  }
  const records = (obj) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {})
    .filter(([, rec]) => rec && typeof rec === 'object' && !Array.isArray(rec)));
  return { ...data, exportedAt: data.exportedAt || null, decks: records(data.decks), exams: records(data.exams) };
}
