// The official check: at 1,000 points, take the official practice exam, then report how it went
// and mark each exam area strong or weak. That outside result keeps the points honest:
//   pass   ready to book
//   close  the margin moves up a notch
//   miss   the projection is lowered to just under the pass mark, so the points drop to match
//   weak   areas marked weak go first in "study next" and read no higher than 60% until new
//          practice lifts them (core/readiness.js)
// Each check is kept in the game record with the calibration it applied, so the total is a sum
// and two devices' checks merge cleanly. Plan: docs/design/2026-10-19-study-game-plan.md.

import { MARGINS, setSettings } from './game.js';

export const RESULTS = [
  { id: 'pass', label: 'Passed comfortably' },
  { id: 'close', label: 'Passed, but only just' },
  { id: 'miss', label: 'Didn\'t pass yet' },
];
const BELOW_PASS = 0.03; // after a miss, the projection lands this far under the pass mark

// check: { at, result, marks: { domainId: 'strong' | 'weak' } }; road: core/road.js roadToReady now.
export function recordCheck(game, check, { road, passShare }) {
  const calibration = check.result === 'miss'
    ? Math.max(0, Math.round((road.projected - (passShare - BELOW_PASS)) * 1000) / 1000) : 0;
  game.checks.push({ at: check.at, result: check.result, marks: { ...check.marks }, calibration });
  if (check.result === 'close') {
    const next = MARGINS[Math.min(MARGINS.length - 1, MARGINS.indexOf(game.settings.margin) + 1)];
    setSettings(game, { margin: next }, check.at);
  }
  return game;
}

export const calibrationOf = (game) => Math.round((game.checks || []).reduce((s, c) => s + c.calibration, 0) * 1000) / 1000;

// The latest check's weak areas -> [{ domainId, since }]
export function weakAreas(game) {
  const last = (game.checks || []).at(-1);
  if (!last) return [];
  return Object.entries(last.marks).filter(([, m]) => m === 'weak').map(([id]) => ({ domainId: Number(id), since: last.at }));
}

// What the app does with a result -> { title, body }; weakNames: the areas marked weak, by name.
export function verdictFor(check, weakNames) {
  const v = {
    pass: ['Ready to book', 'The official check agrees with your practice. Book the exam while it\'s fresh, and keep your streak going with light review until the day.'],
    close: ['Almost: add more margin', 'You\'d likely pass, but with little room. Your target moves up a notch, and a few short rounds in your weakest areas will get you there.'],
    miss: ['Good to know now, not on exam day', 'The app\'s estimate ran high, so it recalibrates and your points drop to match.'],
  }[check.result];
  const body = check.result === 'miss' && !check.calibration
    ? 'Your points were already below ready, so they stay as they are. The areas you marked weak go first from here.' : v[1];
  return { title: v[0], body: body + (weakNames.length ? ` Next quests: ${weakNames.join(', ')}.` : '') };
}
