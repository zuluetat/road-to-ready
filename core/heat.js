// A study set's heat, for the marks on its shortcut icon: a fire while the set is on a hot streak
// (studied day after day), ice once it has gone cold, nothing before it's started; and, apart from
// that, where today stands: cards due and untouched, started with cards still due, or nothing due.
// A missed day is forgiven, as one miss doesn't undo a habit (Lally et al., 2010) and a broken
// streak is when people give up (Silverman & Barasch, 2023); two missed days in a row end it.

import { addDays } from './game.js';

export const HOT_STREAK = 2; // days in a row that make a set hot

// days: the dates a set was studied (any order, repeats allowed) -> how many study days in the run
// that's still going, walking back from today past single missed days
export function studyStreak(days, today) {
  const studied = new Set(days);
  let streak = studied.has(today) ? 1 : 0; // today isn't missed until it's over
  let missed = 0;
  for (let day = addDays(today, -1); missed < 2; day = addDays(day, -1)) {
    if (studied.has(day)) { streak += 1; missed = 0; } else missed += 1;
  }
  return streak;
}

// decks: [{ progress, cardIds }] for each deck in the set
// -> { icon: 'fire' | 'ice' | 'none', state: 'new' | 'due' | 'started' | 'done', streak, due }
export function setHeat(decks, today) {
  const days = decks.flatMap(({ progress }) => progress.days || []);
  const due = decks.reduce((n, { progress, cardIds }) => n + cardIds.filter((id) => progress.cards[id]?.due <= today).length, 0);
  const everStudied = days.length > 0 || decks.some(({ progress }) => Object.keys(progress.cards).length > 0);
  const streak = studyStreak(days, today);
  const state = !everStudied ? 'new' : !due ? 'done' : days.includes(today) ? 'started' : 'due';
  return { icon: !everStudied ? 'none' : streak >= HOT_STREAK ? 'fire' : 'ice', state, streak, due };
}
