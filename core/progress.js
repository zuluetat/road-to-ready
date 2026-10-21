// Per-deck progress: card boxes, the retake queue and full-pass tracking.
// Every function takes the progress record and mutates it in place; callers save it afterwards.

import { schedule, dueFor } from '../adapters/scheduler.js';

export const SCHEMA_VERSION = 1;
export const MASTERED_BOX = 4;
const RETAKE_BOX_CAP = 2;

export function newProgress(deckId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    deckId,
    cards: {},
    matchBestSeconds: null,
    passTarget: 3,
    passesCompleted: 0,
    retakeCorrectNeeded: 2,
    recentWindow: 3,
    retakeQueue: {},
    currentPass: null,
    passHistory: [],
    recent: [],
    lastShown: {},
    seq: 0,
    learn: {},
  };
}

// Fills anything an older or partial record is missing, so stored data never breaks a newer app.
export function migrate(stored, deckId) {
  if (!stored) return newProgress(deckId);
  const p = { ...newProgress(deckId), ...stored };
  // A damaged field (a hand-edited backup, a bad sync) is replaced, never trusted.
  const plain = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  for (const field of ['cards', 'learn', 'retakeQueue', 'lastShown']) if (!plain(p[field])) p[field] = {};
  for (const field of ['recent', 'passHistory']) if (!Array.isArray(p[field])) p[field] = [];
  if (p.currentPass !== null && !plain(p.currentPass)) p.currentPass = null;
  if (p.currentPass) for (const list of ['order', 'answered', 'missed']) if (!Array.isArray(p.currentPass[list])) p.currentPass[list] = [];
  p.cards = Object.fromEntries(Object.entries(p.cards).filter(([, c]) => plain(c)));
  if (p.currentPass) {
    const answered = p.currentPass.answered || [];
    p.currentPass = {
      order: [...answered],
      missed: [],
      retakeRounds: 0,
      ...p.currentPass,
      answered,
    };
  }
  return p;
}

export function shuffle(xs, random = Math.random) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The one place answers land. context is 'pass', 'retake', 'review' or 'learn'.
// at: the moment of the answer (ISO time), so two devices' copies of a card merge by the true order.
export function applyResult(p, { cardId, correct, context, today, at = null }) {
  const prev = p.cards[cardId];
  const next = schedule(prev, correct, today);
  if (at) next.lastStudiedAt = at;
  if (context === 'retake' && correct) {
    const prevBox = prev ? prev.box : 1;
    next.box = Math.max(prevBox, Math.min(prevBox + 1, RETAKE_BOX_CAP));
    next.due = dueFor(next.box, today);
  }
  // Learn asks the same cards again within minutes; that is cramming, not spaced recall, so a
  // card climbs at most one review box a day from Learn. Misses still count in full.
  // A missed Learn scenario (learn-apply) leaves the review box where it was.
  if (context === 'learn-apply' && !correct && prev) {
    next.box = prev.box;
    next.due = prev.due;
  }
  if ((context === 'learn' || context === 'learn-apply') && correct && prev && prev.lastStudied === today) {
    next.box = prev.box;
    next.due = prev.due;
  }
  p.cards[cardId] = next;

  if (!correct && context !== 'learn-apply') {
    p.retakeQueue[cardId] = 0;
  } else if (context === 'retake' && cardId in p.retakeQueue) {
    p.retakeQueue[cardId] += 1;
    if (p.retakeQueue[cardId] >= p.retakeCorrectNeeded) delete p.retakeQueue[cardId];
  }

  if (context === 'pass') recordPassAnswer(p, cardId, correct, today);
  return p;
}

function recordPassAnswer(p, cardId, correct, today) {
  const pass = p.currentPass;
  if (!pass || pass.answered.includes(cardId) || !pass.order.includes(cardId)) return;
  pass.answered.push(cardId);
  if (!correct) pass.missed.push(cardId);
  if (pass.answered.length < pass.order.length) return;
  p.passHistory.push({
    number: pass.number,
    completedAt: today,
    firstAttemptCorrect: pass.answered.length - pass.missed.length,
    total: pass.order.length,
    retakeRounds: pass.retakeRounds,
    missed: [...pass.missed],
  });
  p.passesCompleted += 1;
  p.currentPass = null;
}

// Opens a new pass, or resumes the open one, reconciled with the deck's current cards.
export function startPass(p, cardIds, today, shuffleFn = shuffle) {
  const pass = p.currentPass;
  if (pass) {
    const inDeck = new Set(cardIds);
    pass.order = pass.order.filter((id) => inDeck.has(id));
    pass.order.push(...cardIds.filter((id) => !pass.order.includes(id)));
    pass.answered = pass.answered.filter((id) => inDeck.has(id));
    pass.missed = pass.missed.filter((id) => inDeck.has(id));
    return p;
  }
  if (cardIds.length === 0) return p;
  p.currentPass = {
    number: p.passesCompleted + 1,
    startedAt: today,
    order: shuffleFn(cardIds),
    answered: [],
    missed: [],
    retakeRounds: 0,
  };
  return p;
}

// What the deck screen shows: "Pass 2 of 3", the progress bar, and "Target reached".
export function passStatus(p, cardIds) {
  const pass = p.currentPass;
  return {
    number: pass ? pass.number : p.passesCompleted + 1,
    answered: pass ? pass.answered.length : 0,
    total: pass ? pass.order.length : cardIds.length,
    completed: p.passesCompleted,
    target: p.passTarget,
    targetReached: p.passesCompleted >= p.passTarget,
  };
}

export function passRemaining(p) {
  if (!p.currentPass) return [];
  const done = new Set(p.currentPass.answered);
  return p.currentPass.order.filter((id) => !done.has(id));
}

// Queued cards that are still in the deck.
export function retakeIds(p, cardIds) {
  const inDeck = new Set(cardIds);
  return Object.keys(p.retakeQueue).filter((id) => inDeck.has(id));
}

// Rounds count against the open pass, or against the pass just finished when the round retakes
// that pass's own misses (they are usually retaken after its last card closes it).
// Cards since removed from the deck are dropped from the queue. An empty round is not counted.
export function startRetakeRound(p, shuffleFn = shuffle, cardIds = null) {
  if (cardIds) {
    const keep = new Set(retakeIds(p, cardIds));
    for (const id of Object.keys(p.retakeQueue)) if (!keep.has(id)) delete p.retakeQueue[id];
  }
  const ids = Object.keys(p.retakeQueue);
  const last = p.passHistory[p.passHistory.length - 1];
  const owner = p.currentPass
    || (last && (last.missed || []).some((id) => id in p.retakeQueue) ? last : null);
  if (owner && ids.length) owner.retakeRounds += 1;
  return shuffleFn(ids);
}

// Cards due today or earlier (lowest box first), then never-studied cards up to newLimit.
export function dueCards(p, cardIds, today, { newLimit = 20 } = {}) {
  const due = cardIds
    .filter((id) => p.cards[id] && p.cards[id].due <= today)
    .sort((a, b) => p.cards[a].box - p.cards[b].box);
  const fresh = cardIds.filter((id) => !p.cards[id]).slice(0, newLimit);
  return [...due, ...fresh];
}

export function mastery(p, cardIds) {
  if (cardIds.length === 0) return 0;
  const mastered = cardIds.filter((id) => p.cards[id] && p.cards[id].box >= MASTERED_BOX).length;
  return Math.round((mastered / cardIds.length) * 100);
}

export function weakest(p, cardIds, n = 8) {
  const accuracy = (id) => p.cards[id].correct / p.cards[id].seen;
  return cardIds
    .filter((id) => p.cards[id] && p.cards[id].seen > 0 && p.cards[id].correct < p.cards[id].seen)
    .sort((a, b) => accuracy(a) - accuracy(b) || p.cards[b].seen - p.cards[a].seen)
    .slice(0, n);
}
