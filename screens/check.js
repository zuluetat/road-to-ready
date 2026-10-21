// Official check screen: take the official practice exam, report how it went, mark each exam area
// strong or weak from its score report, then see what the app does with it. The rules live in
// core/check.js; this file only draws.

import { h, mount } from '../core/dom.js';
import { RESULTS } from '../core/check.js';
import { celebration } from '../modes/common.js';

// showCheck(root, { title, points, official: { name, url? }, areas: [{ id, name }],
//   onSave({ result, marks }) -> Promise<{ title, body }>, onDone }) -> cleanup function
export function showCheck(root, { title, points, official, areas, onSave, onDone }) {
  const chosen = { result: null, marks: {} };
  const ready = points >= 1000;

  function draw() {
    const pressed = (on) => String(on);
    mount(root,
      h('header', { class: 'page-head' },
        h('a', { class: 'link', href: '#/' }, '← All decks'),
        h('h1', {}, ready ? 'Time for the official check' : 'Report an official practice exam'),
        h('p', { class: 'muted' }, title)),
      ready ? celebration({ kind: 'ready', title: '1,000 points', detail: 'Your practice says you\'re ready. Prove it on the official practice before you book.' }) : null,
      h('section', { class: 'panel' },
        h('ol', { class: 'check-steps' },
          h('li', {}, 'Take ', official?.url ? h('a', { class: 'link', href: official.url, target: '_blank', rel: 'noopener' }, official.name) : official?.name || 'the official practice exam', '.'),
          h('li', {}, 'Tell the app how it went, below.'),
          h('li', {}, 'Book the real exam when the check says you\'re ready.'))),
      h('section', { class: 'panel check-report' },
        h('h2', {}, 'How did it go?'),
        h('div', { class: 'plan-cues', role: 'group', 'aria-label': 'Official practice result' },
          RESULTS.map((r) => h('button', { type: 'button', class: 'plan-choice', 'aria-pressed': pressed(chosen.result === r.id),
            onclick: () => { chosen.result = r.id; draw(); } }, r.label))),
        h('h2', {}, 'Mark each area from your score report'),
        h('p', { class: 'muted' }, 'Leave an area blank if the report doesn\'t say. Areas marked weak become your next quests and count as no more than 60% ready until fresh practice lifts them.'),
        h('ul', { class: 'check-areas' }, areas.map((a) => h('li', {},
          h('span', {}, a.name),
          ['strong', 'weak'].map((m) => h('button', { type: 'button', class: `mark mark-${m}`, 'aria-pressed': pressed(chosen.marks[a.id] === m),
            'aria-label': `${a.name}: ${m}`,
            onclick: () => { if (chosen.marks[a.id] === m) delete chosen.marks[a.id]; else chosen.marks[a.id] = m; draw(); } },
          m === 'strong' ? 'Strong' : 'Weak'))))),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', type: 'button', disabled: !chosen.result, onclick: save }, 'Save the result'),
          h('button', { type: 'button', onclick: onDone }, 'Not yet'))));
  }

  async function save() {
    const verdict = await onSave({ result: chosen.result, marks: { ...chosen.marks } });
    mount(root,
      h('header', { class: 'page-head' },
        h('a', { class: 'link', href: '#/' }, '← All decks'),
        h('h1', {}, verdict.title)),
      h('section', { class: 'panel end' },
        h('p', {}, verdict.body),
        h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: onDone }, 'Back to studying'))));
    root.querySelector('.primary').focus({ preventScroll: true });
  }

  draw();
  return () => {};
}
