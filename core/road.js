// Road to ready: 0 to 1,000 points, where 1,000 means "ready to book": passing plus the margin you
// chose. Built on the study plan's readiness per exam area (core/readiness.js), so the points can
// never drift from what you actually know. No exam score is ever shown; the scale is its own.
// Plan: docs/design/2026-10-19-study-game-plan.md.

import { addDays, weekOf } from './game.js';

export const MARGIN_SHARE = { just: 0, some: 0.08, lots: 0.15 };
export const MARGIN_NAMES = { just: 'Just pass', some: 'Some margin', lots: 'Lots of margin' };
const MAX_TARGET = 0.95;
const FULL = 1000;

// An area's projected share right: its readiness, or, before there are enough practice answers,
// half the share of its cards learned, with Learn steps climbed as thirds (the study plan's own estimate).
const estimate = (d) => d.readiness ?? (d.cards ? ((d.learned + (d.climbed || 0)) / d.cards) * 0.5 : 0);

// -> { points, target, projected, byDomain: [{ id, name, points }] }
// calibration: how far the official check found the projection ran high (a share, e.g. 0.05).
export function roadToReady({ plan, passShare, margin = 'some', calibration = 0 }) {
  const domains = plan.domains;
  const total = domains.reduce((s, d) => s + d.weight, 0) || 1;
  const raw = domains.reduce((s, d) => s + (d.weight / total) * estimate(d), 0);
  const projected = Math.max(0, raw - calibration);
  const target = Math.min(MAX_TARGET, Math.round((passShare + (MARGIN_SHARE[margin] ?? MARGIN_SHARE.some)) * 100) / 100);
  const uncapped = (FULL * projected) / target;
  const points = Math.min(FULL, Math.round(uncapped));
  // each area's share of the points, scaled with any calibration and the cap so they add up
  const scale = raw ? (projected / raw) * (uncapped ? Math.min(1, FULL / uncapped) : 0) : 0;
  const byDomain = domains.map((d) => ({ id: d.id, name: d.name, points: Math.round(((FULL * (d.weight / total) * estimate(d)) / target) * scale) }));
  return { points, target, projected, byDomain };
}

// The change since the last reading -> { before, after, delta, areas: [{ name, delta }] }, biggest first.
export function pointsChange(before, after) {
  if (!before) return { before: null, after: after.points, delta: null, areas: [] };
  const areas = after.byDomain
    .map((d) => ({ name: d.name, delta: d.points - (before.by?.[d.id] ?? 0) }))
    .filter((a) => a.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
  return { before: before.n, after: after.points, delta: after.points - before.n, areas };
}

// This week's points gained, and the average week over the 4 before it (null without that history).
// Never this week against last week alone: one bad week shown head-on stings like a broken streak.
export function weekView(game, today) {
  const days = Object.keys(game.points || {}).sort();
  const valueOn = (day) => { const d = days.filter((x) => x <= day).at(-1); return d ? game.points[d].n : null; };
  const lastSunday = addDays(weekOf(today), -1);
  const now = valueOn(today) ?? 0;
  const start = valueOn(lastSunday);
  const fourBack = valueOn(addDays(lastSunday, -28));
  return {
    thisWeek: now - (start ?? 0),
    average: start !== null && fourBack !== null ? Math.round((start - fourBack) / 4) : null,
  };
}

const fmt = (n) => n.toLocaleString('en-US');

// The end screen's points, led by the number -> { kind: 'up' | 'down' | 'same', big, detail }.
export function pointsBadge(c) {
  const of = `of ${fmt(FULL)}`;
  if (c.delta === null) return { kind: 'same', big: `${fmt(c.after)} points`, detail: `${of} on the road to ready` };
  if (c.delta === 0) return { kind: 'same', big: `${fmt(c.after)} points`, detail: 'No change this round' };
  if (c.delta < 0) return { kind: 'down', big: `−${-c.delta} points`, detail: `${fmt(c.after)} ${of}. Points follow your recent practice, so a rough round can take a few back.` };
  if (c.after >= FULL) return { kind: 'up', big: `+${c.delta} points`, detail: `${fmt(FULL)} ${of}. You're ready for the official check.` };
  const top = c.areas[0] && c.areas[0].delta > 0 ? `, mostly from ${c.areas[0].name}` : '';
  return { kind: 'up', big: `+${c.delta} points`, detail: `${fmt(c.before)} → ${fmt(c.after)} ${of}${top}` };
}
