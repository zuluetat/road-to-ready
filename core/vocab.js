// Vocabulary look-up: finds the collection's own terms inside a question's text, so Learn can
// underline them (PEFT in LoRA's definition) and show their definitions on a tap.

// Known to everyone, or so common in these decks that underlining them would mark every line.
const PLAIN = new Set(['ai', 'ml', 'prompt', 'edit', 'skill', 'grep', 'glob', 'feature']);

// "PEFT", "LoRA", "FM": a short form, matched only in capitals.
const isAbbreviation = (s) => /^[A-Z][A-Za-z0-9-]*[A-Z][A-Za-z0-9-]*$/.test(s);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// A term's names: "LoRA (low-rank adaptation)" is both; "Bias (in AI)" is only "Bias", since
// the brackets there qualify the term rather than name it.
function namesOf(term) {
  const m = term.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return [term.trim()];
  const [, base, inner] = m;
  return isAbbreviation(base) || isAbbreviation(inner) ? [base, inner] : [base];
}

// cards -> [{ id, term, definition, names }]; a name two cards share goes to the first.
export function vocabulary(cards) {
  const taken = new Set();
  const out = [];
  for (const c of cards) {
    const names = namesOf(c.term).filter((n) => n && !PLAIN.has(n.toLowerCase()) && !taken.has(n.toLowerCase()));
    if (!names.length) continue;
    for (const n of names) taken.add(n.toLowerCase());
    out.push({ id: c.id, term: c.term, definition: c.definition, names });
  }
  return out;
}

function matcher(name) {
  // whole words only, with a plural allowed; a hyphen or letter on either side is part of a word
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(name)}(?:e?s)?(?![\\p{L}\\p{N}_-])`,
    isAbbreviation(name) ? 'gu' : 'giu');
}

// text -> [string | { text, id }]: each term underlined once, at its first appearance, the
// longest name winning where two overlap. hidden: ids never to underline.
export function linkText(text, vocab, { hidden = new Set() } = {}) {
  const found = [];
  for (const v of vocab) {
    if (hidden.has(v.id)) continue;
    for (const name of v.names) {
      for (const m of text.matchAll(matcher(name))) found.push({ start: m.index, end: m.index + m[0].length, id: v.id });
    }
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const chosen = [];
  const used = new Set();
  for (const f of found) {
    if (used.has(f.id) || chosen.some((c) => f.start < c.end && c.start < f.end)) continue;
    chosen.push(f);
    used.add(f.id);
  }
  chosen.sort((a, b) => a.start - b.start);
  const parts = [];
  let at = 0;
  for (const c of chosen) {
    if (c.start > at) parts.push(text.slice(at, c.start));
    parts.push({ text: text.slice(c.start, c.end), id: c.id });
    at = c.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

// Never underline the card being asked, or a card whose term or definition is a choice on
// screen: its definition would tell you which choice it is.
export function hiddenFor({ cardId, options = [], vocab }) {
  const shown = new Set(options.map(same));
  const hidden = new Set(cardId ? [cardId] : []);
  for (const v of vocab) if (shown.has(same(v.term)) || shown.has(same(v.definition))) hidden.add(v.id);
  return hidden;
}
