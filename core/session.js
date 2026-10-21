// A study session: which cards to show, in what order, and where each answer goes.
// Modes ask a session for the next card and report answers back; they never pick cards themselves.

import { nextCard } from './picker.js';
import {
  applyResult, startPass, passRemaining, startRetakeRound, dueCards, shuffle as defaultShuffle,
} from './progress.js';
import { learnRound, learnStage, applyLearnResult, STAGES } from './learn.js';

const CONTEXT = { pass: 'pass', retake: 'retake', review: 'review', sample: 'review', learn: 'learn' };
const RECENT_KEPT = 20;
const LEARN_ROUND = 7; // a round fits a few spare minutes
const LEARN_SCENARIOS = 3; // scenario questions take longest; at most this many per round

// kind: 'pass' (one full pass), 'retake' (one retake round), 'review' (due cards),
// 'sample' (count random cards), 'learn' (one Learn round of count cards, 7 by default).
// lastStep(cardId): a card's final Learn step (2 with a scenario question, else 1); Learn only.
export function createSession({
  kind, deck, progress: p, today, shuffle = defaultShuffle, count = 'all', newLimit = 20, save = () => {},
  now = () => new Date().toISOString(), lastStep = () => STAGES.length - 1,
}) {
  const ids = deck.cards.map((c) => c.id);
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  // Multiple choice needs at least two wrong answers to be more than a coin flip; a deck too small
  // for that gets one self-check card per card instead.
  const fairChoice = new Set(deck.cards.map((c) => c.definition)).size >= 3;
  const finalStep = (id) => (fairChoice ? Math.min(lastStep(id), STAGES.length - 1) : 0);
  const requeued = new Set(); // Learn: a missed card comes back once more in the same round
  const shownAs = new Map(); // Learn: cardId -> the step kind it was last asked as
  const learnKind = (id) => (fairChoice ? STAGES[Math.min(learnStage(p, id), finalStep(id))] : 'recall');
  let list = null;

  if (kind === 'pass') startPass(p, ids, today, shuffle);
  else if (kind === 'retake') list = startRetakeRound(p, shuffle, ids);
  else if (kind === 'review') list = dueCards(p, ids, today, { newLimit });
  else if (kind === 'sample') list = shuffle(ids).slice(0, count === 'all' ? ids.length : count);
  else if (kind === 'learn') list = shuffle(pickLearnRound(learnRound(p, ids, { size: ids.length, shuffle: (xs) => xs }),
    count === 'all' ? LEARN_ROUND : count, (id) => learnKind(id) === 'scenario'));
  else throw new Error('Unknown session kind: ' + kind);

  // the deck may have lost cards since they were queued
  if (list) list = list.filter((id) => byId.has(id));
  const queue = () => (kind === 'pass' ? passRemaining(p).filter((id) => byId.has(id)) : list);

  return {
    kind,
    progress: p,
    remaining: () => queue().length,

    next() {
      // A Learn round is short and every card in it is due, so spacer cards would only get in the way.
      const pool = kind === 'learn' ? queue() : ids;
      const pick = nextCard(queue(), p.recent, { window: p.recentWindow, pool, lastSeen: p.lastShown });
      if (!pick) return null;
      p.seq += 1;
      p.lastShown[pick.id] = p.seq;
      p.recent = [...p.recent, pick.id].slice(-RECENT_KEPT);
      const step = { card: byId.get(pick.id), context: pick.filler ? 'review' : CONTEXT[kind], filler: pick.filler };
      if (kind === 'learn') {
        step.stage = Math.min(learnStage(p, pick.id), finalStep(pick.id));
        step.steps = finalStep(pick.id) + 1;
        step.kind = learnKind(pick.id);
        shownAs.set(pick.id, step.kind);
      }
      return step;
    },

    // The PRD's recordResult(cardId, correct, context): the only way a mode reports an answer.
    // In Learn it returns { before, after }: the step the card was asked at and the one it is on now.
    // askedAs: what the mode actually asked, when it had to ask something easier than the step
    // (no fresh scenario this round, or the question bank didn't load).
    recordResult(cardId, correct, context, { askedAs = null } = {}) {
      const firstEver = !p.cards[cardId];
      const before = Math.min(learnStage(p, cardId), finalStep(cardId));
      const scenarioAsked = shownAs.get(cardId) === 'scenario' && (!askedAs || askedAs === 'scenario');
      // An easier stand-in for a scenario can't earn the scenario step: right holds the card there.
      const heldBack = shownAs.get(cardId) === 'scenario' && !scenarioAsked;
      // A missed scenario is a hard application question: it moves the Learn step, not spaced review.
      const applied = kind === 'learn' && context === CONTEXT.learn && scenarioAsked ? 'learn-apply' : context;
      applyResult(p, { cardId, correct, context: applied, today, at: now() });
      if (kind === 'learn' && !(heldBack && correct)) {
        applyLearnResult(p, cardId, correct, { lastStep: finalStep(cardId), firstEver });
      }
      if (list && context === CONTEXT[kind]) {
        const i = list.indexOf(cardId);
        if (i >= 0) list.splice(i, 1);
      }
      // a miss comes back once later in the round; not straight away when it is the last card left
      if (kind === 'learn' && !correct && !requeued.has(cardId) && list.length > 0) {
        requeued.add(cardId);
        list.push(cardId);
      }
      save(p);
      return kind === 'learn' ? { before, after: learnStage(p, cardId) } : undefined;
    },
  };
}

// Up to size cards in priority order, with at most LEARN_SCENARIOS on the scenario step.
function pickLearnRound(candidates, size, isScenario) {
  const picked = [];
  let scenarios = 0;
  for (const id of candidates) {
    if (picked.length >= size) break;
    if (isScenario(id)) { if (scenarios >= LEARN_SCENARIOS) continue; scenarios += 1; }
    picked.push(id);
  }
  return picked;
}
