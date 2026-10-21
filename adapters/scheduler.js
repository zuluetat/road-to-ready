// Scheduler adapter: Leitner boxes. Swap for SM-2 or FSRS by exporting the same schedule().

export const GAPS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };
export const TOP_BOX = 5;

export function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dueFor(box, today) {
  return addDays(today, GAPS[box]);
}

// schedule(cardState, correct, today) -> new cardState. Never mutates its input.
export function schedule(state, correct, today) {
  const prev = state || { box: 1, seen: 0, correct: 0 };
  const box = correct ? Math.min(prev.box + 1, TOP_BOX) : 1;
  return {
    ...prev,
    box,
    due: dueFor(box, today),
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    lastResult: correct ? 'correct' : 'missed',
    lastStudied: today,
  };
}
