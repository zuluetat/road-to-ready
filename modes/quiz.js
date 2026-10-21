// Quiz: four-option multiple choice with wrong answers from the same deck.
// Always runs on a session: a sample of 10, 20 or all cards, a full pass, or a retake round.

import { h, mount } from '../core/dom.js';
import { questionFor } from '../adapters/questions.js';
import { topBar, endScreen, keys, FILLER_NOTE, optionList, checkButton } from './common.js';
import { togglePick, ready } from '../core/choice.js';

export const id = 'quiz';
export const title = 'Quiz';

export function start(deck, ctx) {
  const direction = ctx.options.direction || 'term';
  const tally = { right: 0, wrong: 0, missed: [] };
  let step = ctx.session.next();
  let question = null;
  let chosen = null;     // the answer locked in with Check
  let picks = [];        // selected, not yet checked
  let last = null;      // the question just answered, to look back at
  let reviewing = false;
  let stopKeys = () => {};

  if (!step) { finish(); return stopKeys; }
  question = questionFor(deck, step.card, { direction });

  function render() {
    if (reviewing) return renderLookBack();
    const answered = chosen !== null;
    const right = answered && chosen === question.answerIndex;
    mount(ctx.root,
      topBar(ctx, ctx.label, `${ctx.session.remaining()} left`),
      last ? h('button', { class: 'link back-look', type: 'button', onclick: lookBack }, '← Previous question') : null,
      step.filler ? h('p', { class: 'note' }, FILLER_NOTE) : null,
      h('section', { class: 'panel question', tabindex: '-1' },
        h('p', { class: 'face-label' }, direction === 'term' ? 'Pick the definition' : 'Pick the term'),
        h('p', { class: 'prompt' }, question.prompt)),
      optionList({ options: question.options, picks: answered ? [chosen] : picks, answer: answered ? [question.answerIndex] : null, onPick: choose }),
      answered ? h('div', { class: 'feedback', role: 'status' },
        h('strong', {}, right ? 'Correct' : 'Not quite'),
        h('button', { class: 'primary', type: 'button', onclick: advance }, 'Next'))
        : checkButton(picks, 1, check),
      h('p', { class: 'hint keys' }, answered ? 'Enter goes on.' : 'Keys 1 to 4 select; Enter checks.'));
    if (answered) ctx.root.querySelector('.feedback .primary').focus();
  }

  // The question just answered, as it was left: read-only, then back to the current one.
  function renderLookBack() {
    const { question: q, chosen: c } = last;
    mount(ctx.root,
      topBar(ctx, ctx.label, `${ctx.session.remaining()} left`),
      h('section', { class: 'panel question' },
        h('p', { class: 'face-label' }, 'Previous question'),
        h('p', { class: 'prompt' }, q.prompt)),
      optionList({ options: q.options, picks: [c], answer: [q.answerIndex], onPick: () => {} }),
      h('div', { class: 'feedback', role: 'status' },
        h('strong', {}, c === q.answerIndex ? 'You got it' : 'You missed it'),
        h('button', { class: 'primary', type: 'button', onclick: backToCurrent }, 'Back to this question')),
      h('p', { class: 'hint keys' }, 'Enter or Esc goes back.'));
    ctx.root.querySelector('.feedback .primary').focus();
  }

  function lookBack() {
    reviewing = true;
    render();
  }

  function backToCurrent() {
    reviewing = false;
    render();
    if (chosen === null) ctx.root.querySelector('.question').focus({ preventScroll: true });
  }

  function choose(i) {
    if (chosen !== null || i >= question.options.length) return;
    picks = togglePick(picks, i, 1);
    render();
    ctx.root.querySelector('.check-row .primary')?.focus({ preventScroll: true });
  }

  function check() {
    if (chosen !== null || !ready(picks, 1)) return;
    const i = picks[0];
    chosen = i;
    const correct = i === question.answerIndex;
    ctx.session.recordResult(step.card.id, correct, step.context);
    if (!step.filler) {
      if (correct) tally.right += 1;
      else { tally.wrong += 1; tally.missed.push(step.card); }
    }
    render();
  }

  function advance() {
    if (chosen !== null) last = { question, chosen };
    step = ctx.session.next();
    if (!step) return finish();
    question = questionFor(deck, step.card, { direction });
    chosen = null;
    picks = [];
    render();
    // Focus the question, not an option: a quick second Enter must not pick option 1.
    ctx.root.querySelector('.question').focus();
  }

  function finish() {
    stopKeys();
    const total = tally.right + tally.wrong;
    endScreen(ctx, {
      heading: total ? `Score: ${tally.right} of ${total}` : 'Nothing to quiz here right now',
      lines: total ? [`${Math.round((tally.right / total) * 100)}% correct.`] : [ctx.emptyMessage || ''],
      missed: tally.missed,
      counted: total > 0,
    });
  }

  stopKeys = keys((e) => {
    if (reviewing) {
      if ((e.key === 'Enter' && !e.target.closest('button')) || e.key === 'Escape') { e.preventDefault(); backToCurrent(); }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && chosen === null) { e.preventDefault(); choose(n - 1); }
    else if (e.key === 'Enter' && chosen === null && picks.length && !e.target.closest('a, button:not(.option)')) { e.preventDefault(); check(); }
    else if (e.key === 'Enter' && chosen !== null && !e.target.closest('button')) { e.preventDefault(); advance(); }
  });

  render();
  ctx.root.querySelector('.question').focus();
  return () => { stopKeys(); };
}
