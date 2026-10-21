// Question generator adapter: multiple choice with wrong answers drawn from the same deck.
// A later version can swap in generated questions behind the same generate(deck, options).
//
// Wrong answers are the cards most like the right one, so a question can't be answered by
// ruling out the obviously unrelated: first cards sharing a look-alike group tag ("group:..."),
// then cards whose term and definition share words with it. Cards tagged "same:..." are never
// offered against each other, nor is a card against the broader idea it is a kind of ("kind-of:...").
// Ties break at random, so a card with many close neighbours meets different ones each time.

import { shuffle } from '../core/progress.js';

const OPTIONS = 4;
const GROUP_WEIGHT = 100;
const STOP = new Set(('a an and are as at be by for from in into is it its of on or that the their them this '
  + 'to was were what when which with without you your can than then such each more most')
  .split(' '));

function words(card) {
  return new Set(`${card.term} ${card.definition}`.toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w)));
}

// "Speech to text" and "speech to text." are one answer; never offer both.
const sameText = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') || text;

const tagged = (card, prefix) => (card.tags || []).filter((t) => t.startsWith(prefix));
const groups = (card) => tagged(card, 'group:');
// Cards tagged with the same "same:..." are one idea in two decks; both answers would be right.
const twins = (card, other) => tagged(other, 'same:').some((t) => tagged(card, 'same:').includes(t));
// A card tagged "kind-of:<id>" is one kind of that card (LoRA is a kind of PEFT): the broader
// card's definition is true of it too, so the two are never offered against each other.
const kin = (card, other) => tagged(card, 'kind-of:').includes(`kind-of:${other.id}`)
  || tagged(other, 'kind-of:').includes(`kind-of:${card.id}`);

function closeness(card, other, cardWords) {
  const shared = groups(other).filter((g) => groups(card).includes(g)).length;
  let overlap = 0;
  for (const w of words(other)) if (cardWords.has(w)) overlap += 1;
  return shared * GROUP_WEIGHT + overlap;
}

// direction 'term' shows the term and asks for the definition; 'definition' is the reverse.
export function questionFor(deck, card, { direction = 'term', random = Math.random } = {}) {
  const ask = direction === 'term' ? 'definition' : 'term';
  const prompt = direction === 'term' ? card.term : card.definition;
  const right = card[ask];
  const cardWords = words(card);
  // never a card that shares this card's prompt text: its answer would be right too
  const shown = direction === 'term' ? 'term' : 'definition';
  const ranked = shuffle(deck.cards.filter((c) => sameText(c[ask]) !== sameText(right)
    && sameText(c[shown]) !== sameText(card[shown]) && !twins(card, c) && !kin(card, c)), random)
    .map((c) => ({ text: c[ask], score: closeness(card, c, cardWords) }))
    .sort((a, b) => b.score - a.score); // stable, so equal scores keep their shuffled order
  const seen = new Set();
  const wrong = ranked.map((r) => r.text)
    .filter((text) => !seen.has(sameText(text)) && seen.add(sameText(text)))
    .slice(0, OPTIONS - 1);
  const options = shuffle([right, ...wrong], random);
  return { cardId: card.id, prompt, options, answerIndex: options.indexOf(right) };
}

export function generate(deck, { count = 'all', direction = 'term', random = Math.random } = {}) {
  const n = count === 'all' ? deck.cards.length : count;
  return shuffle(deck.cards, random).slice(0, n).map((card) => questionFor(deck, card, { direction, random }));
}
