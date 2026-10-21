// Study-plan screen: a one-time, twenty-second setup per collection. When you'll study (an if-then
// cue tied to something you already do), the daily goal, and how much margin above passing.
// The rules live in core/game.js; this file only draws.

import { h, mount } from '../core/dom.js';
import { CUES, GOALS, MARGINS, planSentence } from '../core/game.js';
import { MARGIN_NAMES } from '../core/road.js';

// showPlan(root, { title, settings, onSave(settings), onSkip }) -> cleanup function
export function showPlan(root, { title, settings, onSave, onSkip }) {
  const chosen = { ...settings };
  const custom = h('input', { type: 'text', id: 'plan-cue-other', maxlength: '120', placeholder: 'Something else: I…', autocomplete: 'off',
    value: CUES.includes(chosen.cue) ? '' : chosen.cue,
    oninput: (e) => { chosen.cue = e.target.value.trim(); render(); } });

  const choice = (label, pressed, onclick, cls = 'plan-choice') => h('button', { type: 'button', class: cls, 'aria-pressed': String(pressed), onclick }, label);

  function render() {
    const sentence = root.querySelector('.plan-sentence');
    if (sentence) {
      // keep the typed text box in place while typing; only redraw the pressed states and the sentence
      for (const b of root.querySelectorAll('[data-cue]')) b.setAttribute('aria-pressed', String(b.dataset.cue === chosen.cue));
      for (const b of root.querySelectorAll('[data-goal]')) b.setAttribute('aria-pressed', String(Number(b.dataset.goal) === chosen.goal));
      for (const b of root.querySelectorAll('[data-margin]')) b.setAttribute('aria-pressed', String(b.dataset.margin === chosen.margin));
      sentence.textContent = planSentence(chosen);
      return;
    }
    mount(root,
      h('header', { class: 'page-head' },
        h('a', { class: 'link', href: '#/' }, '← All decks'),
        h('p', { class: 'today-label' }, 'One-time setup · 20 seconds'),
        h('h1', {}, 'When will you study?'),
        h('p', { class: 'muted' }, `For ${title}. Tie one round to something you already do every day.`)),
      h('section', { class: 'panel plan-screen' },
        h('div', { class: 'plan-cues', role: 'group', 'aria-label': 'Pick a moment' },
          CUES.map((cue) => {
            const b = choice(`When ${cue}`, chosen.cue === cue, () => { chosen.cue = cue; custom.value = ''; render(); });
            b.dataset.cue = cue;
            return b;
          }),
          h('label', { class: 'sr-only', for: 'plan-cue-other' }, 'Something else'), custom),
        h('h2', {}, 'Daily goal'),
        h('div', { class: 'plan-pills', role: 'group', 'aria-label': 'Daily goal in rounds' },
          GOALS.map((n) => {
            const b = choice(`${n} round${n === 1 ? '' : 's'}`, chosen.goal === n, () => { chosen.goal = n; render(); }, 'plan-pill');
            b.dataset.goal = String(n);
            return b;
          })),
        h('p', { class: 'muted' }, 'One round always keeps your streak, whatever the goal.'),
        h('h2', {}, 'How ready before you book?'),
        h('div', { class: 'plan-pills', role: 'group', 'aria-label': 'Margin above the pass mark' },
          MARGINS.map((m) => {
            const b = choice(MARGIN_NAMES[m], chosen.margin === m, () => { chosen.margin = m; render(); }, 'plan-pill');
            b.dataset.margin = m;
            return b;
          })),
        h('p', { class: 'muted' }, 'Practice runs a little easier than the real thing, so some margin is wise. Either way, 1,000 points means ready.'),
        h('div', { class: 'plan-yours' }, h('span', { class: 'today-label' }, 'Your plan'), h('p', { class: 'plan-sentence' }, planSentence(chosen))),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', type: 'button', onclick: () => onSave({ ...chosen }) }, 'Save plan'),
          h('button', { type: 'button', onclick: onSkip }, 'Skip'))));
  }
  render();
  return () => {};
}
