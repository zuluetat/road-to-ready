// Cards learned in one deck but listed in another: a card tagged home:<deckId> is studied only in
// its own deck (one progress record, so nothing is learned twice) and shown, with how far it has
// got, on the deck whose topic it belongs to.

import { MASTERED_BOX } from './progress.js';
import { learnStage, LEARNED } from './learn.js';

// -> [{ deckId, deckTitle, card }] for every card in another deck whose home is deckId
export function borrowedCards(deckId, decks) {
  return decks
    .filter((d) => d.id !== deckId)
    .flatMap((d) => d.cards
      .filter((c) => (c.tags || []).includes('home:' + deckId))
      .map((card) => ({ deckId: d.id, deckTitle: d.title, card })));
}

// How far a card has got, read from the progress of the deck it is learned in.
export function cardState(p, cardId) {
  if ((p.cards[cardId]?.box ?? 0) >= MASTERED_BOX) return 'mastered';
  const step = learnStage(p, cardId);
  if (step >= LEARNED) return 'learned';
  return cardId in p.learn ? 'learning' : 'new';
}
