// Practice exams from a question bank (data/questions/<id>.json; the bank describes its own exam:
// length and domain weights). Draws a weighted set, preferring questions seen least, scores
// choose-two all-or-nothing, and keeps a per-bank history: stored under exam:<bankId>.

import { shuffle } from './progress.js';

export const EXAM_SCHEMA_VERSION = 1;
const ATTEMPTS_KEPT = 50;

// Questions per domain for an exam of `length`, by weight, rounded so they add up exactly
// (largest remainder; ties go to the earlier domain).
export function domainQuota(domains, length) {
  const total = domains.reduce((a, d) => a + d.weight, 0);
  if (!(total > 0)) return domains.map(() => 0);
  const exact = domains.map((d) => (length * d.weight) / total);
  const quota = exact.map(Math.floor);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const short = length - quota.reduce((a, b) => a + b, 0);
  for (let k = 0; k < short; k++) quota[order[k][1]] += 1;
  return quota;
}

// A question's family: the question it rewords (rewords: a new scenario, the answer worded
// differently, new wrong answers) or is a near-duplicate of (variantOf), or itself.
export const familyOf = (q) => q.rewords || q.variantOf || q.id;

// The other questions in a question's family (its rewordings, or the one it rewords) -> ids
export function kinOf(bank, id) {
  const q = bank.questions.find((x) => x.id === id);
  if (!q) return [];
  return bank.questions.filter((x) => x.id !== id && familyOf(x) === familyOf(q)).map((x) => x.id);
}

// Never met first, then a rewording of an idea you have met, then exact repeats (least seen
// first); equal ranks in random order, so which rewording you get is random too.
function leastSeen(questions, seen, random, metFamilies) {
  const rank = (q) => ((seen[q.id] || 0) > 0 ? 2 : metFamilies.has(familyOf(q)) ? 1 : 0);
  return shuffle(questions, random).sort((a, b) => rank(a) - rank(b) || (seen[a.id] || 0) - (seen[b.id] || 0));
}

// Question ids for one practice exam, in random order.
export function drawExam(bank, { length = bank.exam.length, seen = {}, random = Math.random } = {}) {
  // One question per family: two wordings of one idea never appear in the same exam.
  const metFamilies = new Set(bank.questions.filter((q) => (seen[q.id] || 0) > 0).map(familyOf));
  const usedFamilies = new Set();
  const picked = new Set();
  const take = (q) => {
    if (picked.has(q.id) || usedFamilies.has(familyOf(q))) return false;
    picked.add(q.id);
    usedFamilies.add(familyOf(q));
    return true;
  };
  const n = Math.min(length, bank.questions.length);
  const quota = domainQuota(bank.exam.domains, n);
  bank.exam.domains.forEach((d, i) => {
    let left = quota[i];
    for (const q of leastSeen(bank.questions.filter((x) => x.domain === d.id), seen, random, metFamilies)) {
      if (left <= 0) break;
      if (take(q)) left -= 1;
    }
  });
  // a domain short of questions is made up from the rest of the bank
  for (const q of leastSeen(bank.questions, seen, random, metFamilies)) {
    if (picked.size >= n) break;
    take(q);
  }
  return shuffle([...picked], random);
}

// The same question with its options in a new order; answers and reasons move with them.
export function shuffleOptions(q, random = Math.random) {
  const order = shuffle(q.options.map((_, i) => i), random);
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    whyWrong: order.map((i) => q.whyWrong[i]),
    answer: q.answer.map((a) => order.indexOf(a)).sort((a, b) => a - b),
  };
}

// Right only when the picks are exactly the right answers (choose-two needs both).
export function isCorrect(q, selected) {
  const picks = [...new Set(selected)].sort((a, b) => a - b);
  return picks.length === q.answer.length && picks.every((p, i) => p === [...q.answer].sort((a, b) => a - b)[i]);
}

const pct = (right, total) => (total ? Math.round((right / total) * 100) : 0);

// results: [{ id, correct }] -> overall and per-domain scores (domains with no questions left out)
export function scoreExam(bank, results) {
  const domainOf = new Map(bank.questions.map((q) => [q.id, q.domain]));
  const right = results.filter((r) => r.correct).length;
  const byDomain = bank.exam.domains.map((d) => {
    const mine = results.filter((r) => domainOf.get(r.id) === d.id);
    const r = mine.filter((x) => x.correct).length;
    return { id: d.id, name: d.name, right: r, total: mine.length, percent: pct(r, mine.length) };
  }).filter((d) => d.total > 0);
  return { right, total: results.length, percent: pct(right, results.length), byDomain };
}

export function newExamRecord(bankId) {
  // firstTry: questionId -> right the first time it was ever answered (in an exam or a Learn scenario)
  // log: the latest practice-question answers as given ({ q, ok, fresh, at }), fresh = first time met
  return { schemaVersion: EXAM_SCHEMA_VERSION, bankId, attempts: [], seen: {}, firstTry: {}, log: [] };
}

const isPlainObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const isAttempt = (a) => isPlainObject(a)
  && ['length', 'right', 'percent'].every((k) => Number.isFinite(a[k]));

// Anything damaged (a bad sync, a hand edit) is dropped or repaired so one record can't break a screen.
export function migrateExam(stored, bankId) {
  const fresh = newExamRecord(bankId);
  if (!stored || typeof stored !== 'object') return fresh;
  return {
    ...fresh,
    ...(typeof stored.updatedAt === 'string' ? { updatedAt: stored.updatedAt } : {}),
    attempts: (Array.isArray(stored.attempts) ? stored.attempts : []).filter(isAttempt),
    seen: Object.fromEntries(Object.entries(isPlainObject(stored.seen) ? stored.seen : {})
      .map(([id, n]) => [id, Number(n) || 0])),
    firstTry: Object.fromEntries(Object.entries(isPlainObject(stored.firstTry) ? stored.firstTry : {})
      .filter(([, v]) => typeof v === 'boolean')),
    log: (Array.isArray(stored.log) ? stored.log : [])
      .filter((x) => isPlainObject(x) && typeof x.q === 'string' && typeof x.ok === 'boolean' && typeof x.at === 'string')
      .map((x) => ({ q: x.q, ok: x.ok, fresh: x.fresh === true, ...(x.familiar === true ? { familiar: true } : {}), at: x.at })),
  };
}

// at: the moment it finished (ISO time); it tells attempts apart when two devices' histories merge
export function recordAttempt(record, { date, at = null, ids, results, bank }) {
  const score = scoreExam(bank, results);
  record.attempts.push({
    ...(at ? { at } : {}),
    date,
    length: ids.length,
    right: score.right,
    percent: score.percent,
    byDomain: score.byDomain.map(({ id, right, total }) => ({ id, right, total })),
    missed: results.filter((r) => !r.correct).map((r) => r.id),
  });
  record.attempts = record.attempts.slice(-ATTEMPTS_KEPT);
  for (const id of ids) record.seen[id] = (record.seen[id] || 0) + 1;
  for (const r of results) recordFirstTry(record, r.id, r.correct); // answers were logged as given
  return record;
}

export const LOG_KEPT = 400;

// One practice-question answer, as it is given (in an exam or a Learn scenario).
// kin: the question's family (kinOf). A first answer to a rewording of a question already answered
// is marked familiar: it counts for more than a repeat, less than an idea met for the first time.
export function recordAnswer(record, questionId, correct, at, { kin = [] } = {}) {
  record.firstTry ||= {};
  record.log ||= [];
  const fresh = !(questionId in record.firstTry);
  const familiar = fresh && kin.some((k) => k in record.firstTry);
  record.log.push({ q: questionId, ok: Boolean(correct), fresh, ...(familiar ? { familiar: true } : {}), at });
  record.log = record.log.slice(-LOG_KEPT);
  recordFirstTry(record, questionId, correct);
  return record;
}

// Keeps only the first answer ever given to a question; later answers never change it.
export function recordFirstTry(record, questionId, correct) {
  record.firstTry ||= {};
  if (!(questionId in record.firstTry)) record.firstTry[questionId] = Boolean(correct);
  return record;
}

// Scenario questions by the flashcard they test ("deckId/cardId" -> questions), across banks.
// Learn uses the original wording only: rewordings are kept for practice exams, whose questions,
// like the real exam's, are written by someone other than the study material's author. Questions
// marked examOnly are never shown in Learn either, so the mock still holds some you haven't seen.
export function questionsByCard(banks) {
  const map = new Map();
  for (const bank of banks) {
    for (const q of bank.questions || []) {
      if (q.rewords || q.examOnly) continue;
      for (const ref of q.cards || []) map.set(ref, [...(map.get(ref) || []), { ...q, bankId: bank.id }]);
    }
  }
  return map;
}

// ---------- exam conditions: the full-length exam, no feedback until you submit ----------

// The full-length exam is the dress rehearsal; shorter exams (and retrying missed questions) are
// learning drills with feedback after each answer.
export const examConditions = (bank, length, { retry = false } = {}) => !retry && length >= bank.exam.length;

// qs: the exam's questions in order; picks[i]: option indices chosen for question i; flagged: Set of i.
// A question counts as answered once it has as many picks as it needs.
// -> { items: [{ n, answered, flagged }], answered, unanswered: [n], flagged: [n] }  (n counts from 1)
export function reviewList(qs, picks, flagged) {
  const items = qs.map((q, i) => ({ n: i + 1, answered: (picks[i] || []).length === q.answer.length, flagged: flagged.has(i) }));
  return {
    items,
    answered: items.filter((x) => x.answered).length,
    unanswered: items.filter((x) => !x.answered).map((x) => x.n),
    flagged: items.filter((x) => x.flagged).map((x) => x.n),
  };
}

// Grade everything at submit -> [{ id, correct, chose: [option text] }]; an unanswered question is wrong.
export function gradeAll(qs, picks) {
  return qs.map((q, i) => {
    const p = picks[i] || [];
    return { id: q.id, correct: p.length === q.answer.length && isCorrect(q, p), chose: p.map((x) => q.options[x]) };
  });
}
