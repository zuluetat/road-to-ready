// Multiple choice, the same way everywhere: tap to select (blue), Check to lock it in. Selecting is
// never judged; only after Check do the answers turn green and red, each with a pill saying what it
// is, so colour is never the only signal.

// need: how many answers the question takes (1, or 2 for "choose two").
// One answer: a tap selects it, another tap switches. Two: a tap toggles; a third waits.
export function togglePick(picks, i, need) {
  if (need === 1) return [i];
  if (picks.includes(i)) return picks.filter((p) => p !== i);
  return picks.length >= need ? picks : [...picks, i];
}

export const ready = (picks, need) => picks.length === need;

// After Check -> one entry per option: null, or { state: 'correct' | 'wrong', pill }.
export function optionMarks(answer, picks, count) {
  return Array.from({ length: count }, (_, i) => {
    const right = answer.includes(i);
    const mine = picks.includes(i);
    if (right) return { state: 'correct', pill: mine ? '✓ Your pick' : '✓ Correct' };
    if (mine) return { state: 'wrong', pill: '✗ Your pick' };
    return null;
  });
}
