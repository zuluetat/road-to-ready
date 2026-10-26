// The path to exam day, in four phases, each with its pool of study options. Options are never
// locked: the tracker only shows which phase you're in and what Continue should start.
//   learn    — get through every card            (done: every card learned)
//   practice — apply it and fix weak spots         (done: every exam domain 70% ready)
//   mock     — prove it under exam conditions      (done: a full-length practice exam at the target)
// Two bars, each measuring what it can. Readiness discounts questions you've seen, so 70% on practice
// questions already takes about 85% right. The full mock, on exam-style questions you haven't met
// where the bank has them, must reach the target 1,000 points stands for: the pass mark plus your
// margin (75% when no target is given).
//   fresh    — keep it fresh until exam day        (where you stay once the rest is done)

import { learnStage, LEARNED } from './learn.js';

export const PHASES = [
  { id: 'learn', label: 'Learn', goal: 'Get through every card', options: ['learn', 'flashcards', 'match'] },
  { id: 'practice', label: 'Practice', goal: 'Apply it and fix weak spots', options: ['drill', 'exam-short', 'quiz', 'retake', 'study-next'] },
  { id: 'mock', label: 'Full mock', goal: 'Prove it under exam conditions', options: ['exam-full'] },
  { id: 'fresh', label: 'Keep it fresh', goal: 'Hold it until exam day', options: ['review', 'pass'] },
];

const DOMAIN_READY = 0.7;
const MOCK_PASS = 75;
const FOCUS = 7; // practice questions per weak-spot drill

// target: the full mock's bar as a share right (road.js readyTarget), or null for 75%
// -> { phases: [{ id, label, goal, options, done, progress, detail }], current, next }
// next: what Continue starts: { kind: 'learn', deckId } | { kind: 'drill', domainId, length } (weak-spot
// practice questions) | { kind: 'exam', length } (the full mock, once every domain is ready) | { kind: 'review' }
export function journeyFor({ bank, decks, progress, record, plan, target = null }) {
  const domainReady = DOMAIN_READY;
  const mockPass = target ? Math.round(target * 100) : MOCK_PASS;
  const pct = Math.round(domainReady * 100);
  let total = 0;
  let learned = 0;
  const unlearned = {};
  for (const deck of decks) {
    const p = progress[deck.id];
    unlearned[deck.id] = 0;
    for (const c of deck.cards) {
      total += 1;
      if (p && learnStage(p, c.id) >= LEARNED) learned += 1;
      else unlearned[deck.id] += 1;
    }
  }
  const learnDone = total > 0 && learned === total;

  const domains = plan.domains;
  const readyCount = domains.filter((d) => (d.readiness ?? 0) >= domainReady).length;
  const practiceProgress = domains.length
    ? domains.reduce((s, d) => s + Math.min(1, (d.readiness ?? 0) / domainReady), 0) / domains.length : 0;
  const practiceDone = domains.length > 0 && readyCount === domains.length;

  const full = (record?.attempts || []).filter((a) => a.length >= bank.exam.length);
  const best = full.reduce((m, a) => Math.max(m, a.percent), 0);
  const mockDone = best >= mockPass;

  const status = {
    learn: { done: learnDone, progress: total ? learned / total : 0, detail: `${learned} of ${total} cards learned` },
    practice: { done: practiceDone, progress: practiceProgress, detail: `${readyCount} of ${domains.length} exam domains ready (${pct}%+)` },
    mock: { done: mockDone, progress: Math.min(1, best / mockPass), detail: full.length ? `Best full exam: ${best}% (${mockPass}% to pass this step)` : `No full ${bank.exam.length}-question exam yet` },
    fresh: { done: false, progress: learnDone && practiceDone && mockDone ? 1 : 0, detail: 'A few minutes of spaced review until exam day' },
  };
  const current = ['learn', 'practice', 'mock'].find((id) => !status[id].done) ?? 'fresh';
  const phases = PHASES.map((ph) => ({ ...ph, ...status[ph.id] }));

  let next;
  if (current === 'learn') {
    const fallback = [...decks].sort((a, b) => unlearned[b.id] - unlearned[a.id])[0]?.id ?? null;
    const pick = plan.next?.deckId && unlearned[plan.next.deckId] ? plan.next.deckId : fallback;
    next = { kind: 'learn', deckId: pick };
  } else if (current === 'practice') {
    // weak spots, never a mixed exam: among domains still short of the bar, the one the plan ranks
    // first, else the least ready
    const short = domains.filter((d) => (d.readiness ?? 0) < domainReady);
    const ranked = short.some((d) => d.id === plan.next?.domainId) ? plan.next.domainId : null;
    const weakest = [...short].sort((a, b) => (a.readiness ?? 0) - (b.readiness ?? 0))[0];
    next = { kind: 'drill', domainId: ranked ?? weakest?.id ?? null, length: FOCUS };
  }
  else if (current === 'mock') next = { kind: 'exam', length: bank.exam.length };
  else next = { kind: 'review' };
  return { phases, current, next };
}
