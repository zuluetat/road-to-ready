// Where the next few minutes of study earn the most exam points.
//
// Readiness per exam domain comes from your most recent answers to its practice questions (the
// last 20): an answer to a question met for the first time counts fully, a rewording of one met
// before three-quarters, a repeat half
// (familiarity flatters). A few answers are pulled toward a cautious default so one answer can't
// swing it, and the result is scaled by how much of the domain's cards you have covered, so acing a
// handful of questions with most of the material untouched doesn't read as ready.
// Priority = exam weight × distance from ready. A foundation domain ranks first until half its cards
// have been worked in Learn (coverage only grows, so this can't flip-flop), then gets a boost that
// fades smoothly as readiness nears the floor; a stuck foundation gets neither. Lots of practice with readiness still low means "try a different
// approach", not "leave". No clock: effort is answers. Cards name their domain "domain:<bankId>:<n>".
// Before an area has enough practice answers, its estimate is half the share of its cards learned,
// where each Learn step climbed since the starting line (stepBase: "deckId/cardId" -> step; none
// given: steps don't count) counts a third of a card, so a good round always shows.
// An area the official practice exam marked weak (weak: [{ domainId, since }]) is capped and goes
// first until enough new practice in it shows it has moved: the outside check outranks our estimate.

import { learnStage, LEARNED } from './learn.js';

const RECENT = 20;        // answers per domain that make up readiness
const MIN_EVIDENCE = 5;   // fewer answers than this: readiness unknown
const PRIOR = 0.4;        // the cautious default small samples are pulled toward
const PRIOR_WEIGHT = 5;   // how strongly (in answers)
const TARGET = 0.8;       // "ready" for planning purposes
const FLOOR = 0.5;        // a foundation's boost fades out as readiness reaches this
const FOUNDATION_COVERAGE = 0.5; // a foundation ranks first until this share of its cards is worked
const FADE = 1.5;         // size of the fading boost at zero readiness
const STUCK_EVIDENCE = 15;
const STUCK_COVERAGE = 0.6;
const SWITCH_RATIO = 1.5; // another deck must be this much more valuable to nudge…
const SWITCH_GAP = 0.03;  // …and by at least this much
const WEAK_CAP = 0.6;     // an area the official check marked weak reads no higher than this…
const WEAK_LIFT = 10;     // …until this many new practice answers in it since the check
const WEAK_BOOST = 3;     // and it goes first meanwhile, ahead of foundations: the outside check wins

// How much one answer says about readiness: a question met for the first time counts fully, a
// rewording of one met before (new scenario and wording, same idea) three-quarters, a repeat half.
const weightOf = (x) => (x.fresh ? (x.familiar ? 0.75 : 1) : 0.5);

export const domainOf = (card, bankId) => {
  const tag = (card.tags || []).find((t) => t.startsWith(`domain:${bankId}:`));
  return tag ? Number(tag.split(':')[2]) : null;
};

// -> { domains: [{ id, name, weight, readiness, evidence, coverage, answers, learned, climbed, cards, priority, stuck, weak }],
//      next: { domainId, deckId } | null, deckValue: { deckId: n }, deckDomain: { deckId: domainId } }
export function studyPlan({ bank, decks, progress, record, foundations = [], weak = [], stepBase = null }) {
  const questionDomain = new Map(bank.questions.map((q) => [q.id, q.domain]));
  const log = (record?.log || []).filter((x) => questionDomain.has(x.q));
  const domains = bank.exam.domains.map((d) => {
    const recent = log.filter((x) => questionDomain.get(x.q) === d.id).slice(-RECENT);
    let cards = 0;
    let learned = 0;
    let touched = 0;
    let climbed = 0;
    let answers = log.filter((x) => questionDomain.get(x.q) === d.id).length;
    for (const deck of decks) {
      const p = progress[deck.id];
      for (const card of deck.cards) {
        if (domainOf(card, bank.id) !== d.id) continue;
        cards += 1;
        if (p && learnStage(p, card.id) >= LEARNED) learned += 1;
        else if (p && stepBase) climbed += Math.max(0, learnStage(p, card.id) - (stepBase[`${deck.id}/${card.id}`] || 0)) / LEARNED;
        if (p?.learn && card.id in p.learn) touched += 1; // worked in Learn; a flashcard flip doesn't count
        answers += p?.cards?.[card.id]?.seen || 0;
      }
    }
    const coverage = cards ? touched / cards : 1;
    let readiness = null;
    if (recent.length >= MIN_EVIDENCE) {
      const w = recent.reduce((s, x) => s + weightOf(x), 0);
      const right = recent.reduce((s, x) => s + (x.ok ? weightOf(x) : 0), 0);
      readiness = ((right + PRIOR * PRIOR_WEIGHT) / (w + PRIOR_WEIGHT)) * (0.4 + 0.6 * coverage);
    }
    const mark = weak.find((w) => w.domainId === d.id);
    const isWeak = Boolean(mark) && log.filter((x) => questionDomain.get(x.q) === d.id && x.at > mark.since).length < WEAK_LIFT;
    if (isWeak && readiness !== null) readiness = Math.min(readiness, WEAK_CAP);
    const estimate = readiness ?? (cards ? (learned + climbed) / cards : 0) * 0.5;
    const stuck = readiness !== null && readiness < 0.5 && recent.length >= STUCK_EVIDENCE && coverage >= STUCK_COVERAGE;
    let priority = (d.weight / 100) * Math.max(0, TARGET - estimate);
    if (foundations.includes(d.id) && !stuck) {
      if (coverage < FOUNDATION_COVERAGE) priority += 1; // foundations first
      priority += FADE * Math.max(0, FLOOR - estimate) / FLOOR;
    }
    if (isWeak) priority += WEAK_BOOST;
    return { id: d.id, name: d.name, weight: d.weight, readiness, evidence: recent.length, coverage, answers, learned, climbed, cards, priority, stuck, weak: isWeak };
  });

  // Each deck: its value (mean priority of its cards still to learn) and the domain driving it.
  const byId = new Map(domains.map((d) => [d.id, d]));
  const deckValue = {};
  const deckDomain = {};
  const openIn = {};
  for (const deck of decks) {
    const p = progress[deck.id];
    const open = deck.cards.filter((c) => byId.has(domainOf(c, bank.id)) && !(p && learnStage(p, c.id) >= LEARNED));
    const sums = {};
    for (const c of open) { const id = domainOf(c, bank.id); sums[id] = (sums[id] || 0) + byId.get(id).priority; }
    openIn[deck.id] = Object.fromEntries(Object.keys(sums).map((id) => [id, open.filter((c) => domainOf(c, bank.id) === Number(id)).length]));
    deckValue[deck.id] = open.length ? Object.values(sums).reduce((s, v) => s + v, 0) / open.length : 0;
    const top = Object.entries(sums).sort((a, b) => b[1] - a[1])[0];
    deckDomain[deck.id] = top ? Number(top[0]) : null;
  }

  const top = [...domains].sort((a, b) => b.priority - a.priority || b.weight - a.weight)[0];
  let next = null;
  if (top && top.priority > 0) {
    const count = (id) => openIn[id]?.[top.id] || 0;
    const deck = [...decks].sort((a, b) => count(b.id) - count(a.id) || deckValue[b.id] - deckValue[a.id])[0];
    const deckId = deck && count(deck.id) ? deck.id : null;
    // nothing left to learn in that domain: practice-exam questions are what moves it now
    next = { domainId: top.id, deckId, practiceExam: deckId === null };
  }
  return { domains, next, deckValue, deckDomain };
}

// After a round on deckId -> { nudge, best }. `best` is the deck the plan points to now; keep it
// and pass it back next time as lastBest: a switch nudge needs the same answer two rounds running,
// so the advice doesn't flip-flop. A stuck note shows at most once a day (stuckShown = that date).
export function nudgeAfter(plan, deckId, { lastBest = null, stuckShown = null, today = null } = {}) {
  const best = plan.next?.deckId ?? null;
  if (!(deckId in plan.deckValue)) return { nudge: null, best };
  const here = plan.domains.find((d) => d.id === plan.deckDomain[deckId]);
  if (here?.stuck && stuckShown !== today) {
    return { best, nudge: { kind: 'stuck', deckId, domainId: here.id, domainName: here.name, readiness: here.readiness, answers: here.answers } };
  }
  const hereValue = plan.deckValue[deckId];
  const bestValue = best ? plan.deckValue[best] : 0;
  const worthIt = best && best !== deckId && bestValue >= hereValue * SWITCH_RATIO && bestValue - hereValue >= SWITCH_GAP;
  if (!worthIt || lastBest !== best) return { nudge: null, best };
  const target = plan.domains.find((d) => d.id === plan.next.domainId);
  return {
    best,
    nudge: {
      kind: 'switch', deckId: best, domainId: target.id, domainName: target.name,
      from: here ? { domainName: here.name, weight: here.weight, readiness: here.readiness } : null,
      to: { weight: target.weight, readiness: target.readiness },
    },
  };
}
