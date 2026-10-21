// What, if anything, to celebrate at the end of a round: at most one thing, the biggest, for about
// two seconds, leading with what was learned. Plan: docs/design/2026-10-19-study-game-plan.md.
//   ready   crossed 1,000 road-to-ready points: time for the official practice exam
//   phase   moved to a later phase on the path to exam day
//   streak  reached a 7-, 14- or 30-day streak
//   ring    this round filled today's goal

export const STREAK_MILESTONES = [7, 14, 30];

// before/after: today's status (core/game.js todayStatus) either side of the round.
// change: the points change (core/road.js pointsChange), if the collection has points.
// -> { kind, title, detail } | null
export function celebrationFor({ before, after, change = null, phaseBefore = null, phaseAfter = null, phases = [] }) {
  if (change && change.before !== null && change.before < 1000 && change.after >= 1000) {
    return { kind: 'ready', title: '1,000 points: time for the official check', detail: 'Your practice says you\'re ready. Take the official practice exam before you book.' };
  }
  const from = phases.findIndex((p) => p.id === phaseBefore);
  const to = phases.findIndex((p) => p.id === phaseAfter);
  if (from >= 0 && to > from) {
    const next = phases[to];
    return { kind: 'phase', title: `Level up: ${next.label}`, detail: `${phases[from].label} is done. Next: ${next.goal.charAt(0).toLowerCase()}${next.goal.slice(1)}.` };
  }
  if (after.streak > before.streak && STREAK_MILESTONES.includes(after.streak)) {
    return { kind: 'streak', title: `${after.streak}-day streak`, detail: `${after.streak} days running. Short, steady rounds are what make it stick.` };
  }
  if (after.ring.complete && !before.ring.complete) {
    return { kind: 'ring', title: 'Today\'s goal: done', detail: `${after.ring.of} round${after.ring.of === 1 ? '' : 's'} today. Anything more is a bonus.` };
  }
  return null;
}
