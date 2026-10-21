// Merging two copies of the same progress record, one per device. Used by the browser when it
// pulls and by the Worker when a device pushes, so both sides agree. Every merge is
// order-independent and safe to repeat. Rules: docs/design/2026-10-14-progress-sync.md.

import { migrate } from './progress.js';
import { migrateExam } from './exam.js';
import { migrateGame, mergeGame } from './game.js';

const ATTEMPTS_KEPT = 50;
const LOG_KEPT = 400;

// Shape a stored or received record the way this app version expects, dropping anything damaged.
// key is "deck:<deckId>", "exam:<bankId>" or "game:<collectionId>".
export function normaliseRecord(key, body) {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'deck') return { ...migrate(body, id), deckId: id };
  if (kind === 'exam') return migrateExam(body, id);
  if (kind === 'game') return migrateGame(body, id);
  if (kind === 'profile') return migrateProfile(body);
  throw new Error('Unknown progress key: ' + key);
}

// A total order, so ties never depend on which copy came first.
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const tieBreak = (a, b) => cmp(JSON.stringify(a), JSON.stringify(b));
const later = (x, y) => (cmp(x || '', y || '') >= 0 ? x : y);

// Choose between the two copies for one group of fields, looking only at that group: first by
// `rank` (higher wins), then by the group's own content. Deciding each group on its own data is
// what keeps a merge order-independent and repeatable (deciding by the whole record is not: a
// merged record compares differently from either input).
function pick(a, b, rank, group) {
  const order = cmp(rank(a), rank(b)) || tieBreak(group(a), group(b));
  return order >= 0 ? a : b;
}

// When a card was last answered: the exact time, or the start of the day for older records.
const answeredAt = (c) => (c ? c.lastStudiedAt || (c.lastStudied ? c.lastStudied + 'T00:00:00.000Z' : '') : '');

const SETTINGS = ['passTarget', 'retakeCorrectNeeded', 'recentWindow'];
const PASS_FIELDS = ['passesCompleted', 'passHistory', 'currentPass'];
const MEMORY_FIELDS = ['recent', 'lastShown', 'seq'];
const fields = (names) => (p) => Object.fromEntries(names.map((k) => [k, p[k] ?? null]));

// Both devices answered cards in the same open pass: combine them, and close the pass if together
// they answered every card.
function combinePasses(merged, p, q) {
  const union = (xs, ys) => [...xs, ...ys.filter((id) => !xs.includes(id))];
  const pass = {
    ...structuredClone(p),
    startedAt: [p.startedAt, q.startedAt].filter(Boolean).sort()[0] ?? null,
    // cards on both orders, plus any answered on either; a card removed from the deck on one
    // device (and never answered) stays out
    order: union(p.order.filter((id) => q.order.includes(id) || q.answered.includes(id) || p.answered.includes(id)),
      q.answered.filter((id) => !p.order.includes(id))),
    answered: union(p.answered, q.answered),
    missed: union(p.missed, q.missed),
    retakeRounds: Math.max(p.retakeRounds || 0, q.retakeRounds || 0),
  };
  if (pass.answered.length < pass.order.length) { merged.currentPass = pass; return; }
  merged.passHistory.push({
    number: pass.number,
    // the last study day among its cards (local dates, like every other pass)
    completedAt: pass.answered.map((id) => merged.cards[id]?.lastStudied).filter(Boolean).sort().at(-1) || pass.startedAt,
    firstAttemptCorrect: pass.answered.length - pass.missed.length,
    total: pass.order.length,
    retakeRounds: pass.retakeRounds,
    missed: [...pass.missed],
  });
  merged.passesCompleted += 1;
  merged.currentPass = null;
}

export function mergeProgress(a, b) {
  if (!a) return b;
  if (!b) return a;
  const merged = structuredClone(pick(a, b, () => 0, (p) => ({ schemaVersion: p.schemaVersion, deckId: p.deckId })));
  merged.updatedAt = later(a.updatedAt, b.updatedAt) || undefined;
  if (!merged.updatedAt) delete merged.updatedAt;

  // Cards: the copy answered most recently, then answered more; its Learn step and retake entry
  // come with it, so one card's state never mixes two devices.
  merged.cards = {};
  merged.learn = {};
  merged.retakeQueue = {};
  const ids = new Set([...Object.keys(a.cards || {}), ...Object.keys(b.cards || {})]);
  ids.delete('__proto__'); // never a real card id (ids are slugs); would rewrite the object's prototype
  const resetAt = later(a.learnResetAt, b.learnResetAt);
  for (const id of ids) {
    const from = pick(a, b,
      (p) => (p.cards[id] ? `${answeredAt(p.cards[id])}|${String(p.cards[id].seen || 0).padStart(9, '0')}` : ''),
      (p) => [p.cards[id] ?? null, p.learn?.[id] ?? null, p.retakeQueue?.[id] ?? null]);
    merged.cards[id] = structuredClone(from.cards[id]);
    // a Learn step earned before "Start Learn over" on either device does not survive the reset
    const earnedBeforeReset = resetAt && cmp(answeredAt(from.cards[id]), resetAt) < 0;
    if (from.learn && id in from.learn && !earnedBeforeReset) merged.learn[id] = from.learn[id];
    else {
      // the winning copy never did Learn on this card (answered in review there): keep the other's step
      const other = from === a ? b : a;
      const otherBeforeReset = resetAt && cmp(answeredAt(other.cards[id]), resetAt) < 0;
      if (!(from.learn && id in from.learn) && other.learn && id in other.learn && other.cards[id] && !otherBeforeReset) {
        merged.learn[id] = other.learn[id];
      }
    }
    if (from.retakeQueue && id in from.retakeQueue) merged.retakeQueue[id] = from.retakeQueue[id];
  }
  // Learn steps or queue entries without a card record (not expected, but never lose them).
  for (const field of ['learn', 'retakeQueue']) {
    const extra = pick(a, b, () => 0, (p) => p[field] || {});
    for (const src of [extra, extra === a ? b : a]) {
      for (const [id, v] of Object.entries(src[field] || {})) {
        if (id !== '__proto__' && !ids.has(id) && !(id in merged[field])) merged[field][id] = v;
      }
    }
  }
  if (resetAt) merged.learnResetAt = resetAt; else delete merged.learnResetAt;

  // Passes: from the copy further along (more passes done, then more answered, then one that has
  // a pass open at all); the same open pass on both is combined.
  const pad = (n) => String(n || 0).padStart(6, '0');
  const rounds = (p) => (p.passHistory || []).reduce((s, h) => s + (h.retakeRounds || 0), 0) + (p.currentPass?.retakeRounds || 0);
  const progressRank = (p) => [pad(p.passesCompleted), pad(p.currentPass ? p.currentPass.answered.length : 0), p.currentPass ? 1 : 0, pad(rounds(p))].join('|');
  const lead = pick(a, b, progressRank, fields(PASS_FIELDS));
  const trail = lead === a ? b : a;
  merged.passesCompleted = lead.passesCompleted || 0;
  merged.passHistory = structuredClone(lead.passHistory || []);
  merged.currentPass = structuredClone(lead.currentPass ?? null);
  if (lead.currentPass && trail.currentPass && lead.currentPass.number === trail.currentPass.number
    && (lead.passesCompleted || 0) === (trail.passesCompleted || 0)) {
    const [p, q] = tieBreak(lead.currentPass, trail.currentPass) >= 0
      ? [lead.currentPass, trail.currentPass] : [trail.currentPass, lead.currentPass];
    combinePasses(merged, p, q);
  }

  // Settings follow the copy whose settings changed last (settingsAt), not whichever saved last.
  const settingsFrom = pick(a, b, (p) => p.settingsAt || '', fields(SETTINGS));
  for (const k of SETTINGS) if (k in settingsFrom) merged[k] = settingsFrom[k]; else delete merged[k];
  if (settingsFrom.settingsAt) merged.settingsAt = settingsFrom.settingsAt; else delete merged.settingsAt;

  // The no-repeat memory follows the copy saved last.
  const memoryFrom = pick(a, b, (p) => p.updatedAt || '', fields(MEMORY_FIELDS));
  for (const k of MEMORY_FIELDS) merged[k] = structuredClone(memoryFrom[k]);

  const times = [a.matchBestSeconds, b.matchBestSeconds].filter((t) => typeof t === 'number');
  merged.matchBestSeconds = times.length ? Math.min(...times) : null;
  return merged;
}

const attemptKey = (x) => x.at || JSON.stringify(x);

export function mergeExam(a, b) {
  if (!a) return b;
  if (!b) return a;
  const merged = structuredClone(pick(a, b, (p) => p.updatedAt || '', (p) => ({ bankId: p.bankId, schemaVersion: p.schemaVersion })));
  const byKey = new Map();
  for (const x of [...(a.attempts || []), ...(b.attempts || [])]) byKey.set(attemptKey(x), x);
  merged.attempts = [...byKey.values()]
    .sort((x, y) => cmp(x.at || x.date || '', y.at || y.date || '') || cmp(attemptKey(x), attemptKey(y)))
    .slice(-ATTEMPTS_KEPT)
    .map((x) => structuredClone(x));
  // first tries: a question first met on two devices counts as right only if right on both
  merged.firstTry = {};
  for (const src of [a.firstTry || {}, b.firstTry || {}]) {
    for (const [id, v] of Object.entries(src)) merged.firstTry[id] = id in merged.firstTry ? merged.firstTry[id] && v : v;
  }
  // the answer log: both devices' answers, once each, in time order, newest kept
  const entries = new Map();
  for (const x of [...(a.log || []), ...(b.log || [])]) entries.set(`${x.at}|${x.q}`, x);
  merged.log = [...entries.entries()].sort((x, y) => cmp(x[0], y[0])).map(([, x]) => structuredClone(x)).slice(-LOG_KEPT);
  merged.seen = {};
  for (const src of [a.seen || {}, b.seen || {}]) {
    for (const [id, n] of Object.entries(src)) merged.seen[id] = Math.max(merged.seen[id] || 0, n);
  }
  return merged;
}

// Your profile (profile:me): the name the app greets you by. The newer change wins.
const NAME_MAX = 40;
function migrateProfile(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : '';
  return { name, at: typeof body?.at === 'string' ? body.at : '' };
}
function mergeProfile(a, b) {
  if (!a) return b;
  if (!b) return a;
  return structuredClone(pick(a, b, (p) => p.at || '', (p) => p));
}

// key is "deck:<deckId>", "exam:<bankId>", "game:<collectionId>" or "profile:me", the names used on the server.
export function mergeRecord(key, a, b) {
  if (key.startsWith('deck:')) return mergeProgress(a, b);
  if (key.startsWith('exam:')) return mergeExam(a, b);
  if (key.startsWith('game:')) return mergeGame(a, b);
  if (key.startsWith('profile:')) return mergeProfile(a, b);
  throw new Error('Unknown progress key: ' + key);
}
