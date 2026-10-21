// Learn: a per-card ladder built for how the exam asks. Each card climbs: recognize (pick the
// definition), tell apart (pick the term from look-alikes), then apply (a scenario question that
// tests the card, when the practice bank has one). A right answer moves it up one step; a miss
// drops it one. Stored in progress.learn as cardId -> step.

import { shuffle as defaultShuffle, mastery } from './progress.js';

export const STAGES = ['choice', 'reverse-choice', 'scenario'];
export const LEARNED = STAGES.length;

export function learnStage(p, cardId) {
  return p.learn[cardId] ?? 0;
}

// lastStep: the card's final step (1 when it has no scenario question, 0 for a self-check only).
// Getting the final step right makes it learned.
// firstEver: this was the card's first answer anywhere (not just in Learn).
export function applyLearnResult(p, cardId, correct, { lastStep = STAGES.length - 1, firstEver = true } = {}) {
  // a stored step past this card's last one counts as "learned" for it, so a miss drops just one
  const stage = Math.min(learnStage(p, cardId), lastStep + 1);
  // Right the very first time it is asked: you already know it, so skip "pick the term".
  const firstTry = firstEver && !(cardId in p.learn) && stage === 0;
  const up = stage + (firstTry ? 2 : 1);
  p.learn[cardId] = correct ? (up > lastStep ? LEARNED : up) : Math.max(stage - 1, 0);
  return p;
}

// Up to size cards not yet learned: cards already on the ladder first, then new ones in deck order.
export function learnRound(p, cardIds, { size = 10, shuffle = defaultShuffle } = {}) {
  const open = cardIds.filter((id) => learnStage(p, id) < LEARNED);
  const started = open.filter((id) => id in p.learn);
  const fresh = open.filter((id) => !(id in p.learn));
  return shuffle([...started, ...fresh].slice(0, size));
}

export function learnStatus(p, cardIds) {
  const learned = cardIds.filter((id) => learnStage(p, id) >= LEARNED).length;
  const started = cardIds.filter((id) => id in p.learn && learnStage(p, id) < LEARNED).length;
  return { learned, started, fresh: cardIds.length - learned - started, total: cardIds.length };
}

// What a deck's bar shows: cards learned while Learn is unfinished (it moves every round), then
// mastery (spaced review, which takes days). The text always gives both.
export function deckMeter(p, cardIds) {
  const { learned, total } = learnStatus(p, cardIds);
  const mastered = mastery(p, cardIds);
  const learning = learned < total;
  return {
    measure: learning ? 'learned' : 'mastered',
    percent: learning ? Math.round((learned / total) * 100) : mastered,
    learned, total, mastered,
    text: `${total} cards · ${learning ? learned : 'all'} learned · ${mastered}% mastered`,
  };
}

// at: when (ISO time), so a synced device's older Learn steps don't undo the reset
export function resetLearn(p, at = null) {
  p.learn = {};
  if (at) p.learnResetAt = at;
  return p;
}
