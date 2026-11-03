// Practice exams from a question bank (data/questions/<id>.json; the bank describes its own exam:
// length and domain weights). Draws a weighted set, preferring questions seen least, scores
// choose-two all-or-nothing, and keeps a per-bank history: stored under exam:<bankId>.

import { shuffle } from './progress.js';
import { linkText } from './vocab.js';

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
// preferExamOnly: within a rank, exam-style questions first
function leastSeen(questions, seen, random, metFamilies, preferExamOnly = false) {
  const rank = (q) => ((seen[q.id] || 0) > 0 ? 2 : metFamilies.has(familyOf(q)) ? 1 : 0);
  const style = (q) => (preferExamOnly && !q.examOnly ? 1 : 0);
  return shuffle(questions, random).sort((a, b) => rank(a) - rank(b) || style(a) - style(b) || (seen[a.id] || 0) - (seen[b.id] || 0));
}

// Question ids for one practice exam, in random order.
// Exam-style questions (examOnly: never shown in Learn) are kept for the mocks:
//   examOnly: draw only those, as the half exam does
//   practice: a drill; leave them out unless the rest of the bank runs short
//   preferExamOnly: the full exam; unseen ones first
// domain: a weak-spot drill on that domain only
// On a scenario bank, questions written for a scenario are left out: they need it shown above them.
export function drawExam(bank, { length = bank.exam.length, seen = {}, random = Math.random, examOnly = false, practice = false, preferExamOnly = false, domain = null } = {}) {
  const usable = isScenarioBank(bank) ? bank.questions.filter((q) => !q.scenario) : bank.questions;
  const all = domain ? usable.filter((q) => q.domain === domain) : usable;
  const pool = examOnly ? all.filter((q) => q.examOnly)
    : practice ? all.filter((q) => !q.examOnly) : all;
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
  // a mixed drill short of practice questions tops up with exam-style ones; a one-domain drill stops at
  // its practice questions (it only uses exam-style ones when that domain has none)
  const n = Math.min(length, practice && !(domain && pool.length) ? all.length : pool.length);
  const quota = domain ? [] : domainQuota(bank.exam.domains, n);
  if (!domain) bank.exam.domains.forEach((d, i) => {
    let left = quota[i];
    for (const q of leastSeen(pool.filter((x) => x.domain === d.id), seen, random, metFamilies, preferExamOnly)) {
      if (left <= 0) break;
      if (take(q)) left -= 1;
    }
  });
  // a domain short of questions is made up from the rest of the bank
  for (const q of leastSeen(pool, seen, random, metFamilies, preferExamOnly)) {
    if (picked.size >= n) break;
    take(q);
  }
  // a mixed drill longer than the practice questions left takes exam-style ones after all
  if (practice && !(domain && pool.length)) {
    for (const q of leastSeen(all, seen, random, metFamilies)) {
      if (picked.size >= n) break;
      take(q);
    }
  }
  return shuffle([...picked], random);
}

// How many mocks are left on exam-style questions whose idea you have never met, in any wording:
// each domain needs its share, so the domain that runs out first decides.
// -> { half, full, questions } (half is 0 when the bank has no half exam)
// On a scenario bank, a mock is blocks from different scenarios, so it counts fresh blocks instead.
export function freshMocks(bank, seen = {}) {
  const met = new Set(bank.questions.filter((q) => (seen[q.id] || 0) > 0).map(familyOf));
  // one per idea: an exam takes one wording of each, and the others are then met
  const fresh = [...new Map(bank.questions.filter((q) => q.examOnly && !met.has(familyOf(q)))
    .map((q) => [familyOf(q), q])).values()];
  const scenarios = isScenarioBank(bank);
  const count = (length) => {
    if (!length || !fresh.length) return 0;
    if (scenarios) return freshScenarioMocks(bank, fresh.filter((q) => q.scenario), length);
    const quota = domainQuota(bank.exam.domains, length);
    return Math.min(...bank.exam.domains.map((d, i) => (quota[i]
      ? Math.floor(fresh.filter((q) => q.domain === d.id).length / quota[i]) : Infinity)));
  };
  return { half: count(bank.exam.half), full: count(bank.exam.length), questions: fresh.length };
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
  return { right, total: results.length, percent: pct(right, results.length), byDomain, ...scoreScenarios(bank, results) };
}

export function newExamRecord(bankId) {
  // firstTry: questionId -> right the first time it was ever answered (in an exam or a Learn scenario)
  // log: the latest practice-question answers as given ({ q, ok, fresh, at }), fresh = first time met
  return { schemaVersion: EXAM_SCHEMA_VERSION, bankId, attempts: [], seen: {}, firstTry: {}, log: [] };
}

const isPlainObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const isAttempt = (a) => isPlainObject(a)
  && ['length', 'right', 'percent'].every((k) => Number.isFinite(a[k]));

// flagged: the questions flagged for review in a full exam; anything else is dropped
function repairFlags(a) {
  if (!('flagged' in a)) return a;
  const { flagged, ...rest } = a;
  return Array.isArray(flagged) ? { ...rest, flagged: flagged.filter((id) => typeof id === 'string') } : rest;
}

// half: a half exam; anything but true is dropped
function repairHalf(a) {
  if (!('half' in a) || a.half === true) return a;
  const { half, ...rest } = a;
  return rest;
}

// Anything damaged (a bad sync, a hand edit) is dropped or repaired so one record can't break a screen.
export function migrateExam(stored, bankId) {
  const fresh = newExamRecord(bankId);
  if (!stored || typeof stored !== 'object') return fresh;
  return {
    ...fresh,
    ...(typeof stored.updatedAt === 'string' ? { updatedAt: stored.updatedAt } : {}),
    attempts: (Array.isArray(stored.attempts) ? stored.attempts : []).filter(isAttempt).map(repairFlags).map(repairHalf),
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
// flagged: question ids flagged for review (full exams only); kept with that attempt, never carried over
// half: a half exam (exam conditions, exam-difficulty questions), kept as such
export function recordAttempt(record, { date, at = null, ids, results, flagged = [], half = false, bank }) {
  const score = scoreExam(bank, results);
  record.attempts.push({
    ...(at ? { at } : {}),
    date,
    length: ids.length,
    right: score.right,
    percent: score.percent,
    byDomain: score.byDomain.map(({ id, right, total }) => ({ id, right, total })),
    missed: results.filter((r) => !r.correct).map((r) => r.id),
    ...(flagged.length ? { flagged: [...flagged] } : {}),
    ...(half ? { half: true } : {}),
  });
  record.attempts = record.attempts.slice(-ATTEMPTS_KEPT);
  for (const id of ids) record.seen[id] = (record.seen[id] || 0) + 1;
  for (const r of results) recordFirstTry(record, r.id, r.correct); // answers were logged as given
  return record;
}

// How the flagged questions went, and the misses you didn't flag: the ones you felt sure of.
export function flagReport(results, flagged) {
  const marked = new Set(flagged);
  const mine = results.filter((r) => marked.has(r.id));
  const right = mine.filter((r) => r.correct).length;
  return {
    flagged: mine.length,
    right,
    wrong: mine.length - right,
    unflaggedMissed: results.filter((r) => !r.correct && !marked.has(r.id)).length,
  };
}

// The cards behind a question: the ones it tests, then any whose term an option names, so a wrong
// option you ruled out without knowing it (Kiro, say) can still be learned.
// vocab: vocabulary() of the collection's cards, with ids written "deckId/cardId".
// loaded: every "deckId/cardId" that loaded (some cards have no look-up name, so vocab alone misses them)
export function cardsBehind(q, vocab, loaded = new Set(vocab.map((v) => v.id))) {
  const named = (q.options || []).flatMap((o) => linkText(o, optionVocab(vocab)).filter((x) => typeof x !== 'string').map((x) => x.id));
  return [...new Set([...(q.cards || []).filter((ref) => loaded.has(ref)), ...named])];
}

// Card names that are also everyday words in option text ("the model recalls", "answer from
// memory"): an option using them names nothing, so they are never matched there.
const OPTION_PLAIN = new Set(['recall', 'research', 'memory', 'accuracy', 'parameters']);
// A one-word name counts only as written ("Kiro", not "precision"); longer names and short forms
// as usual.
export function optionVocab(vocab) {
  return vocab
    .map((v) => {
      const names = v.names.filter((n) => !OPTION_PLAIN.has(n.toLowerCase()));
      return { ...v, names, exact: new Set(names.filter((n) => !/\s/.test(n))) };
    })
    .filter((v) => v.names.length);
}

// The latest full or half exam's flags, kept with that attempt only: { date, flagged, right, wrong,
// half? }, or null when it had none. A newer exam under exam conditions replaces them; drills have no flags.
export function lastFlags(record, bank) {
  const full = [...(record.attempts || [])].reverse().find((a) => a.half === true || a.length >= bank.exam.length);
  // only questions still in the bank
  const inBank = bank.questions ? new Set(bank.questions.map((q) => q.id)) : null;
  const flagged = (full?.flagged || []).filter((id) => !inBank || inBank.has(id));
  if (!flagged.length) return null;
  const missed = new Set(full.missed || []);
  const wrong = flagged.filter((id) => missed.has(id)).length;
  return { date: full.date, flagged, right: flagged.length - wrong, wrong, ...(full.half === true ? { half: true } : {}) };
}

// "deckId/cardId" refs -> [{ deckId, cardIds }], decks in first-seen order
export function byDeck(refs) {
  const out = new Map();
  for (const ref of refs) {
    const [deckId, cardId] = ref.split('/');
    if (!out.has(deckId)) out.set(deckId, []);
    if (!out.get(deckId).includes(cardId)) out.get(deckId).push(cardId);
  }
  return [...out].map(([deckId, cardIds]) => ({ deckId, cardIds }));
}

const cardCount = (groups) => (groups || []).reduce((n, g) => n + g.cardIds.length, 0);
const cardsWord = (n) => `${n} card${n === 1 ? '' : 's'}`;

// The one button for the cards behind your flags, however many decks they sit in -> text, or null
export function learnFlagsLabel(groups) {
  const n = cardCount(groups);
  return n ? `Learn the ${cardsWord(n)} behind your flags` : null;
}

// After one deck's part of that round: Continue with the cards still to come -> text, or null when
// none are left (the round goes back to the exam)
export function moreToLearn(queue) {
  const n = cardCount(queue);
  return n ? `Continue: ${n} more ${n === 1 ? 'card' : 'cards'}` : null;
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
export const examConditions = (bank, length, { retry = false, half = false } = {}) => !retry && (half || length >= bank.exam.length);

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

// ---------- scenario exams: the bank publishes scenarios and the exam asks a block on each ----------

// The Architect exam draws 4 of 6 published scenarios and asks about 15 questions on each, with the
// scenario shown above them. A bank says so with exam.scenarios ([{ id, title, summary, domains }])
// and exam.scenarioCount (how many a full exam draws). A question written for a scenario names it
// (scenario: id) and is exam-style (examOnly), kept for mocks; questions without one are the
// practice side, for Learn and drills.
export const isScenarioBank = (bank) => Array.isArray(bank?.exam?.scenarios) && bank.exam.scenarios.length > 0;

// How many scenarios an exam of `length` draws: scenarioCount for the full exam, in proportion for
// a shorter one (a half exam takes half as many), at least one.
function blocksFor(bank, length) {
  const full = bank.exam.scenarioCount || bank.exam.scenarios.length;
  return Math.max(1, Math.round((full * length) / bank.exam.length));
}

// One scenario exam -> [{ scenario, ids }], blocks in exam order, each block's questions in random order.
// Scenarios are drawn at random, preferring those with the most questions whose idea you have never
// met; within a block, questions seen least come first. One question per family.
// A block short of questions is made up from the other drawn scenarios, so each block stays one scenario;
// the exam is as long as the drawn scenarios can supply, which is `length` on any bank that passes
// scenarioShortfalls (every scenario fills a block).
export function drawScenarioExam(bank, { length = bank.exam.length, seen = {}, random = Math.random } = {}) {
  const pool = bank.questions.filter((q) => q.scenario);
  const metFamilies = new Set(bank.questions.filter((q) => (seen[q.id] || 0) > 0).map(familyOf));
  const inScenario = (s) => pool.filter((q) => q.scenario === s.id);
  const candidates = bank.exam.scenarios.filter((s) => inScenario(s).length);
  const count = Math.min(blocksFor(bank, length), candidates.length);
  if (!count) return [];
  const n = Math.min(length, pool.length);
  const quota = domainQuota(Array.from({ length: count }, () => ({ weight: 1 })), n);
  const fill = Math.ceil(n / count);
  // never-met ideas in a scenario, counted in whole blocks: a scenario with two fresh blocks goes
  // before one with one (so the next mock still finds enough), any two with as many blocks are
  // equal and chance picks between them; below one block, the one with more unseen goes first
  // A scenario too small to fill a block at all goes after any that can, or the exam comes out short.
  const fresh = (s) => {
    const unseen = new Set(inScenario(s).filter((q) => !metFamilies.has(familyOf(q))).map(familyOf)).size;
    return unseen >= fill ? Math.floor(unseen / fill) : unseen / fill;
  };
  const fits = (s) => (new Set(inScenario(s).map(familyOf)).size >= fill ? 1 : 0);
  const rank = (s) => (fresh(s) >= 1 ? 2 + fresh(s) : fits(s) + fresh(s) / 2);
  const drawn = shuffle(candidates, random).sort((a, b) => rank(b) - rank(a)).slice(0, count);
  const usedFamilies = new Set();
  const take = (block, q) => {
    if (usedFamilies.has(familyOf(q))) return false;
    usedFamilies.add(familyOf(q));
    block.ids.push(q.id);
    return true;
  };
  const blocks = drawn.map((scenario) => ({ scenario, ids: [] }));
  blocks.forEach((block, i) => {
    let left = quota[i];
    for (const q of leastSeen(inScenario(block.scenario), seen, random, metFamilies)) {
      if (left <= 0) break;
      if (take(block, q)) left -= 1;
    }
  });
  let total = blocks.reduce((a, b) => a + b.ids.length, 0);
  for (const block of blocks) {
    for (const q of leastSeen(inScenario(block.scenario), seen, random, metFamilies)) {
      if (total >= n) break;
      if (take(block, q)) total += 1;
    }
  }
  return blocks.map((b) => ({ scenario: b.scenario, ids: shuffle(b.ids, random) }));
}

// Fresh mocks on a scenario bank: each mock needs `blocks` different scenarios with a block of
// never-met questions each. The most mocks k for which the scenarios can supply k × blocks blocks
// with no scenario used twice in one mock (a scenario gives at most one block per mock).
function freshScenarioMocks(bank, fresh, length) {
  const blocks = blocksFor(bank, length);
  const fill = Math.ceil(length / blocks);
  const per = bank.exam.scenarios.map((s) => Math.floor(fresh.filter((q) => q.scenario === s.id).length / fill));
  let k = 0;
  while (per.reduce((a, c) => a + Math.min(c, k + 1), 0) >= blocks * (k + 1)) k += 1;
  return k;
}

// results -> { byScenario: [{ id, title, right, total, percent }] } in the order the exam asked
// them, for a scenario bank; {} for any other
function scoreScenarios(bank, results) {
  if (!isScenarioBank(bank)) return {};
  const scenarioOf = new Map(bank.questions.map((q) => [q.id, q.scenario]));
  const titles = new Map(bank.exam.scenarios.map((s) => [s.id, s.title]));
  const order = [...new Set(results.map((r) => scenarioOf.get(r.id)).filter((id) => titles.has(id)))];
  return {
    byScenario: order.map((id) => {
      const mine = results.filter((r) => scenarioOf.get(r.id) === id);
      const right = mine.filter((r) => r.correct).length;
      return { id, title: titles.get(id), right, total: mine.length, percent: pct(right, mine.length) };
    }),
  };
}

// Scenarios that can't fill a block in an exam that draws blocks (the full exam, and the half when
// the bank has one: a half that rounds to fewer, bigger blocks needs more per scenario) -> [text].
// A question and its rewordings or near-duplicates are one idea: an exam takes only one of them.
export function scenarioShortfalls(bank) {
  if (!isScenarioBank(bank)) return [];
  const out = [];
  const exams = [['full-exam', bank.exam.length], ['half-exam', bank.exam.half]].filter(([, n]) => n);
  for (const s of bank.exam.scenarios) {
    const ideas = new Set(bank.questions.filter((q) => q.scenario === s.id).map(familyOf)).size;
    for (const [what, length] of exams) {
      const fill = Math.ceil(length / blocksFor(bank, length));
      if (ideas < fill) out.push(`scenario ${s.id} has ${ideas} ideas, under a ${what} block of ${fill}`);
    }
  }
  return out;
}

// The real exam's scoring, for the score screen: the bank's own words (exam.scoreNote), or a scaled
// 100-1,000 score passing at its pass share (AWS 700, Anthropic 720).
export function scoreNote(bank) {
  if (bank.exam.scoreNote) return bank.exam.scoreNote;
  return `The real exam reports a scaled score from 100 to 1,000 and passes at ${Math.round((bank.exam.passShare ?? 0.7) * 1000)}. `
    + 'There is no exact percent conversion, so use this to find weak domains, not to predict a pass.';
}

// The share of choose-two questions a bank should hold, [min, max]: none where the exam has none
// (exam.chooseTwo false), the bank's own range where its exam has fewer (exam.multiShare), else 15-20%.
export function chooseTwoRange(exam) {
  if (exam.chooseTwo === false) return [0, 0];
  return exam.multiShare ?? [0.15, 0.2];
}

// How to name a question's checkedAgainst link: by whose documentation it is.
export function sourceName(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return 'this page'; }
  if (host === 'aws.amazon.com' || host.endsWith('.aws.amazon.com')) return 'this AWS page';
  if (host === 'modelcontextprotocol.io') return 'this MCP page';
  if (host === 'www.anthropic.com' || host === 'claude.com' || host.endsWith('.claude.com')) return 'this Anthropic page';
  if (host === 'community.peoplecert.org') return 'this PeopleCert community post';
  if (host === 'itil.com' || host.endsWith('.itil.com') || host === 'peoplecert.org' || host.endsWith('.peoplecert.org')) return 'this ITIL page';
  return 'this page';
}

// How many questions a one-domain drill will really ask: it stops at the domain's practice ideas (a
// question and its rewordings count once), or uses its exam-style ones when it has no practice ones.
export function drillLength(bank, domain, length) {
  const mine = bank.questions.filter((q) => q.domain === domain);
  const practice = mine.filter((q) => !q.examOnly);
  return Math.min(length, new Set((practice.length ? practice : mine).map(familyOf)).size);
}

// What is wrong with a bank's scenarios -> [text], empty when nothing is (or the bank has none)
export function scenarioProblems(bank) {
  const out = [];
  const list = bank.exam?.scenarios ?? [];
  if (!Array.isArray(list)) return ['exam.scenarios is not a list'];
  const domainIds = new Set((bank.exam?.domains || []).map((d) => d.id));
  const c = bank.exam?.scenarioCount;
  if (c !== undefined && !(Number.isInteger(c) && c >= 1 && c <= list.length)) out.push(`exam.scenarioCount must be 1 to ${list.length}, not ${c}`);
  const ids = new Set();
  for (const s of list) {
    const id = s?.id;
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) out.push(`scenario id "${id}" must be lower-case letters, digits and hyphens`);
    if (ids.has(id)) out.push(`duplicate scenario ${id}`);
    ids.add(id);
    if (!s?.title?.trim?.()) out.push(`scenario ${id}: no title`);
    if (!s?.summary?.trim?.()) out.push(`scenario ${id}: no summary`);
    if (!Array.isArray(s?.domains) || !s.domains.length) out.push(`scenario ${id}: no domains`);
    else for (const d of s.domains) if (!domainIds.has(d)) out.push(`scenario ${id}: unknown domain ${d}`);
  }
  for (const q of bank.questions || []) {
    if (q.scenario === undefined) {
      if (list.length && q.examOnly) out.push(`${q.id}: an exam-style question on a scenario bank needs a scenario`);
      continue;
    }
    if (!ids.has(q.scenario)) out.push(`${q.id}: unknown scenario ${q.scenario}`);
    if (q.examOnly !== true) out.push(`${q.id}: a scenario question must be examOnly`);
  }
  return out;
}
