// The study game for one collection: rounds per day, the streak, the daily goal ring, and the
// comeback round. Plan: docs/design/2026-10-19-study-game-plan.md.
//
// Only the rounds per day are stored; freezes and restores are worked out from them, so two
// devices can never disagree about which day used the week's freeze.
//   streak   one round keeps it. A missed day uses that week's freeze (weeks start Monday); a
//            second miss is restored by 2 rounds the next day. A frozen or restored day keeps the
//            streak without adding to it. Otherwise a new streak starts: never a "lost" message.
//   goal     rounds a day (1, 2, 3 or 5). The day after a missed day, one round fills it.
// Dates are local 'YYYY-MM-DD' strings (core/dom.js localToday).

export const GOALS = [1, 2, 3, 5];
export const MARGINS = ['just', 'some', 'lots'];
const RESTORE_ROUNDS = 2;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function newGame(collectionId) {
  return { schemaVersion: 1, collectionId, days: {}, points: {}, phaseReached: 0, checks: [], settings: { goal: 3, margin: 'some', cue: '' }, settingsAt: '' };
}

// Shape a stored or received record, dropping anything damaged.
export function migrateGame(body, collectionId) {
  const g = newGame(collectionId);
  if (!body || typeof body !== 'object') return g;
  for (const [day, n] of Object.entries(body.days || {})) {
    if (DAY.test(day) && Number.isInteger(n) && n > 0) g.days[day] = n;
  }
  for (const [day, r] of Object.entries(body.points || {})) {
    if (DAY.test(day) && r && typeof r.at === 'string' && Number.isFinite(r.n)) {
      const by = Object.fromEntries(Object.entries(r.by || {}).filter(([, v]) => Number.isFinite(v)));
      g.points[day] = { at: r.at, n: r.n, by };
    }
  }
  if (Number.isInteger(body.phaseReached) && body.phaseReached >= 0 && body.phaseReached <= 3) g.phaseReached = body.phaseReached;
  const RESULT = ['pass', 'close', 'miss'];
  for (const c of Array.isArray(body.checks) ? body.checks : []) {
    if (!c || typeof c.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(c.at) || !RESULT.includes(c.result)) continue;
    const marks = Object.fromEntries(Object.entries(c.marks || {}).filter(([id, m]) => /^\d+$/.test(id) && (m === 'strong' || m === 'weak')));
    g.checks.push({ at: c.at, result: c.result, marks, calibration: Number.isFinite(c.calibration) && c.calibration >= 0 ? c.calibration : 0 });
  }
  g.checks.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  const s = body.settings || {};
  if (GOALS.includes(s.goal)) g.settings.goal = s.goal;
  if (MARGINS.includes(s.margin)) g.settings.margin = s.margin;
  if (typeof s.cue === 'string') g.settings.cue = s.cue.slice(0, 200);
  if (typeof body.settingsAt === 'string') g.settingsAt = body.settingsAt;
  if (typeof body.updatedAt === 'string') g.updatedAt = body.updatedAt;
  const base = body.stepBase;
  if (base && typeof base.at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(base.at) && base.cards && typeof base.cards === 'object') {
    g.stepBase = { at: base.at, cards: Object.fromEntries(Object.entries(base.cards).filter(([, n]) => Number.isInteger(n) && n > 0)) };
  }
  return g;
}

// The starting line for points per Learn step (core/readiness.js): the step each card part-way up
// stood on when the rule began, so only steps climbed after it count. Taken once, never retaken.
// progress: deckId -> deck progress; learned: the step that means learned.
export function markStepBase(game, at, progress, learned) {
  if (game.stepBase) return game;
  const cards = {};
  for (const [deckId, p] of Object.entries(progress)) {
    for (const [cardId, n] of Object.entries(p?.learn || {})) if (n > 0 && n < learned) cards[`${deckId}/${cardId}`] = n;
  }
  game.stepBase = { at, cards };
  return game;
}

export function recordRound(game, today) {
  game.days[today] = (game.days[today] || 0) + 1;
  return game;
}

// Road-to-ready points (core/road.js) as of a moment: one reading a day, the later one wins.
export function recordPoints(game, day, at, road) {
  const had = game.points[day];
  if (!had || had.at <= at) game.points[day] = { at, n: road.points, by: Object.fromEntries(road.byDomain.map((d) => [d.id, d.points])) };
  return game;
}

export function latestPoints(game) {
  const day = Object.keys(game.points || {}).sort().at(-1);
  return day ? game.points[day] : null;
}

export function setSettings(game, changes, at) {
  if ('goal' in changes && !GOALS.includes(changes.goal)) throw new Error('Daily goal must be 1, 2, 3 or 5 rounds');
  if ('margin' in changes && !MARGINS.includes(changes.margin)) throw new Error('Unknown margin');
  game.settings = { ...game.settings, ...changes };
  game.settingsAt = at;
  return game;
}

// Calendar arithmetic on date strings, done in UTC so time zones and clock changes can't shift a day.
const toTime = (day) => Date.parse(day + 'T00:00:00Z');
const fromTime = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (day, n) => fromTime(toTime(day) + n * 86400000);
export const weekOf = (day) => addDays(day, -((new Date(toTime(day)).getUTCDay() + 6) % 7)); // that week's Monday

// -> { streak, studiedToday, rounds, goal, comeback, ring: { done, of, complete, text }, freezeLeft,
//      restore: { needed } | null, restored }
export function todayStatus(game, today) {
  const rounds = (day) => game.days[day] || 0;
  const studied = Object.keys(game.days).filter((d) => d < today).sort();
  const frozenWeeks = new Set();
  const yesterday = addDays(today, -1);
  let streak = 0;
  let restore = null;
  let restored = false;
  if (studied.length) {
    for (let day = studied[0]; day < today; day = addDays(day, 1)) {
      if (rounds(day)) { streak += 1; continue; }
      if (!frozenWeeks.has(weekOf(day))) { frozenWeeks.add(weekOf(day)); continue; }
      const next = addDays(day, 1);
      if (rounds(next) >= RESTORE_ROUNDS) { if (next === today) restored = true; continue; }
      if (next === today) { restore = { needed: RESTORE_ROUNDS - rounds(today) }; continue; }
      streak = 0;
    }
  }
  const done = rounds(today);
  if (done) streak += 1;
  const comeback = studied.length > 0 && !rounds(yesterday);
  const goal = game.settings.goal;
  const of = comeback ? 1 : goal;
  const filled = Math.min(done, of);
  const complete = filled >= of;
  const text = complete ? 'Done' : filled > 0 && of - filled === 1 ? '1 to go' : `${filled} of ${of}`;
  return {
    streak, studiedToday: done > 0, rounds: done, goal, comeback,
    ring: { done: filled, of, complete, text },
    freezeLeft: frozenWeeks.has(weekOf(today)) ? 0 : 1,
    restore, restored,
  };
}

// Two devices' copies: each day keeps the larger count, settings the newer change. Order-independent.
export function mergeGame(a, b) {
  if (!a) return b;
  if (!b) return a;
  const merged = newGame(a.collectionId || b.collectionId);
  for (const src of [a, b]) {
    for (const [day, n] of Object.entries(src.days || {})) merged.days[day] = Math.max(merged.days[day] || 0, n);
  }
  merged.days = Object.fromEntries(Object.entries(merged.days).sort());
  for (const src of [a, b]) {
    for (const [day, r] of Object.entries(src.points || {})) {
      const had = merged.points[day];
      if (!had || had.at < r.at || (had.at === r.at && JSON.stringify(r) > JSON.stringify(had))) merged.points[day] = structuredClone(r);
    }
  }
  merged.points = Object.fromEntries(Object.entries(merged.points).sort());
  merged.phaseReached = Math.max(a.phaseReached || 0, b.phaseReached || 0);
  // official checks: from both devices, once each (by when they were reported), oldest first
  const checks = new Map();
  for (const c of [...(a.checks || []), ...(b.checks || [])]) {
    const had = checks.get(c.at);
    if (!had || JSON.stringify(c) > JSON.stringify(had)) checks.set(c.at, structuredClone(c));
  }
  merged.checks = [...checks.values()].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  const sa = `${a.settingsAt || ''}|${JSON.stringify(a.settings)}`;
  const sb = `${b.settingsAt || ''}|${JSON.stringify(b.settings)}`;
  const from = sa >= sb ? a : b;
  merged.settings = { ...from.settings };
  merged.settingsAt = from.settingsAt || '';
  // the starting line for Learn steps: the first one taken, on whichever device
  const base = [a.stepBase, b.stepBase].filter(Boolean).sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : JSON.stringify(x) < JSON.stringify(y) ? -1 : 1))[0];
  if (base) merged.stepBase = structuredClone(base);
  const updated = [a.updatedAt, b.updatedAt].filter(Boolean).sort().at(-1);
  if (updated) merged.updatedAt = updated;
  return merged;
}

const streakText = (s) => (s.streak ? `${s.streak}-day streak` : 'Start a streak today');

// The home screen's today card: { streak, ring, note }, with one plain next-step sentence.
export function describeToday(s) {
  let note;
  if (s.restored) note = 'Streak restored.';
  else if (s.restore) {
    note = s.restore.needed === 1 ? '1 more round today restores your streak.' : `${s.restore.needed} rounds today restore your streak.`;
  } else if (s.ring.complete) note = 'Today\'s goal is done. Anything more is a bonus.';
  else if (s.comeback) note = 'Welcome back. One round today counts as the whole goal.';
  else note = `One round keeps your streak; ${s.goal} is the goal. ${s.freezeLeft ? '1 freeze left this week.' : 'This week\'s freeze is used.'}`;
  if ((s.restore || s.restored) && s.comeback && !s.ring.complete) note += ' One round today also counts as the whole goal.';
  return { streak: streakText(s), ring: s.ring.text, note };
}

// The end screen's line about today, after a round.
export function afterRound(s) {
  const today = s.ring.complete ? 'Today\'s goal is done' : `Round ${s.rounds} today · ${s.ring.of - s.ring.done} to go`;
  return `${today} · ${streakText(s)}`;
}

// The study plan: an if-then cue ("When I…, I'll do one round"), asked once per collection.
export const CUES = ['I pour my morning coffee', 'I sit down for lunch', 'I finish work for the day', 'I get into bed'];

// Not asked yet: no setting has ever been saved (saving or skipping the plan stamps settingsAt).
export const needsPlan = (game) => !game.settingsAt;

export function planSentence({ cue, goal }) {
  const goalText = `Goal: ${goal} round${goal === 1 ? '' : 's'} a day, until I reach 1,000 points.`;
  return cue ? `When ${cue}, I'll do one round. ${goalText}` : goalText;
}
