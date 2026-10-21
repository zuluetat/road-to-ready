// Learn: short rounds (about seven cards), each card asked at its own step on the ladder
// (core/learn.js), shaped like the exam asks: pick the definition, pick the term from look-alikes,
// then apply it in a scenario question from the practice bank. A missed card comes back once later
// in the round. Every answer also counts as spaced review. Always runs on a 'learn' session.
// ctx.scenarios(cardId) gives the bank questions that test a card.

import { h, mount } from '../core/dom.js';
import { questionFor } from '../adapters/questions.js';
import { shuffleOptions, isCorrect } from '../core/exam.js';
import { learnStatus, LEARNED } from '../core/learn.js';
import { topBar, endScreen, keys, optionList, checkButton, inPractice } from './common.js';
import { togglePick, ready } from '../core/choice.js';
import { linkText, hiddenFor } from '../core/vocab.js';

export const id = 'learn';
export const title = 'Learn';

const STEP_NAMES = {
  choice: 'Pick the definition',
  'reverse-choice': 'Pick the term',
  scenario: 'Apply it',
  recall: 'Check yourself',
};
const NEXT_NAMES = ['picking the definition', 'picking the term', 'a scenario question'];

// moved: { before, after } from the session: what the answer actually did to the card
function movedText({ before, after }) {
  if (after >= LEARNED) return 'Learned.';
  if (after > before) return `Next time: ${NEXT_NAMES[after]}.`;
  if (after < before) return `Back to ${NEXT_NAMES[after]}.`;
  return 'It stays on this step.';
}

// One question to show for this step: { prompt, label, options, answer: [indices], multi, explanation, whyWrong }
// used: scenario question ids already shown this round, so one is not asked twice.
function questionForStep(deck, step, scenarios, used) {
  if (step.kind === 'scenario') {
    // only a question not yet seen this round: a repeat would give its answer away
    const pool = scenarios(step.card.id).filter((q) => !used.has(q.rewords || q.variantOf || q.id));
    if (pool.length) {
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      used.add(chosen.rewords || chosen.variantOf || chosen.id); // its rewordings would give it away later in the round
      const q = { ...shuffleOptions(chosen), bankId: chosen.bankId, id: chosen.id };
      return { kind: 'scenario', id: q.id, bankId: q.bankId, prompt: q.stem, label: 'Scenario', options: q.options, answer: q.answer, multi: q.type === 'multi', explanation: q.explanation, whyWrong: q.whyWrong };
    }
    step = { ...step, kind: 'reverse-choice' }; // no fresh scenario: ask the term; the card holds its step
  }
  const direction = step.kind === 'choice' ? 'term' : 'definition';
  const q = questionFor(deck, step.card, { direction });
  return {
    kind: step.kind, prompt: q.prompt, label: direction === 'term' ? 'Term' : 'Definition',
    options: q.options, answer: [q.answerIndex], multi: false, explanation: null, whyWrong: null,
  };
}

export function start(deck, ctx) {
  const tally = { right: 0, wrong: 0, missed: [] };
  const scenarios = ctx.scenarios || (() => []);
  const usedQuestions = new Set();
  let moved = null; // what the last answer did to the card
  let step = ctx.session.next();
  let question = null;  // every step but a self-check
  let picks = [];       // option indices picked (choose-two collects two)
  let answered = null;  // null until answered, then true/false
  let revealed = false; // self-check card only
  let last = null;      // the card just answered, to look back at: { step, question, picks, answered, moved }
  let reviewing = false;
  let lookup = null;    // the term looked up from an underlined word, shown in a pill below
  const vocab = ctx.vocab || [];
  let stopKeys = () => {};

  if (!step) { finish(); return stopKeys; }
  prepare();

  function prepare() {
    picks = [];
    answered = null;
    revealed = false;
    lookup = null;
    question = step.kind === 'recall' ? null : questionForStep(deck, step, scenarios, usedQuestions);
    // a scenario seen here is no longer fresh for the practice exam
    if (question?.bankId) ctx.onScenarioShown?.(question.bankId, question.id);
  }

  function header() {
    return [
      topBar(ctx, ctx.label, `${ctx.session.remaining()} left`),
      last ? h('button', { class: 'link back-look', type: 'button', onclick: lookBack }, '← Previous card') : null,
      // tabindex so focus can rest here after Next: a fast second Enter must not answer anything
      h('p', { class: 'face-label step-label', tabindex: '-1' },
        // name what is actually asked (a scenario step with no fresh scenario asks for the term)
        `Step ${step.stage + 1} of ${step.steps}: ${STEP_NAMES[question?.kind || step.kind]}`),
    ];
  }

  // Underlined terms in a question's text. Tapping one shows its definition in the pill and
  // nothing else: it doesn't pick the option or flip the card it sits on.
  function hidden() {
    return hiddenFor({ cardId: step.card.id, options: question ? question.options : [], vocab });
  }
  function linked(text, hide) {
    return linkText(text, vocab, { hidden: hide }).map((part) => {
      if (typeof part === 'string') return part;
      const open = (e) => {
        e.stopPropagation();
        e.preventDefault();
        lookup = lookup === part.id ? null : part.id;
        render();
      };
      return h('span', {
        class: 'vocab' + (lookup === part.id ? ' open' : ''), role: 'button', tabindex: '0',
        'aria-label': `${part.text}: look up`, onclick: open,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); },
      }, part.text);
    });
  }
  function lookupPill() {
    const v = lookup && vocab.find((x) => x.id === lookup);
    if (!v) return null;
    return h('div', { class: 'lookup', role: 'status' },
      h('p', {}, h('strong', {}, v.term), ' ', v.definition),
      h('button', { type: 'button', class: 'link', 'aria-label': 'Close', onclick: () => { lookup = null; render(); } }, '✕'));
  }

  function feedback() {
    return h('div', { class: 'feedback', role: 'status' },
      h('span', {}, h('strong', {}, answered ? 'Correct. ' : 'Not quite. '), moved ? movedText(moved) : ''),
      h('button', { class: 'primary', type: 'button', onclick: advance }, 'Next'));
  }

  function renderQuestion() {
    const q = question;
    const hide = hidden();
    mount(ctx.root, header(),
      h('section', { class: 'panel question', tabindex: '-1' },
        h('p', { class: 'face-label' }, q.multi ? 'Scenario · choose two' : q.label),
        // the term being asked is never underlined, so a term prompt stays plain
        h('p', { class: q.label === 'Scenario' ? 'stem' : 'prompt' }, linked(q.prompt, hide))),
      optionList({
        options: q.options, picks, answer: answered !== null ? q.answer : null, onPick: pick,
        whyWrong: q.whyWrong, need: q.answer.length, textOf: (text) => linked(text, hide),
      }),
      lookupPill(),
      answered === null ? checkButton(picks, q.answer.length, check) : null,
      // the explanation in its own labeled box, so it doesn't read as a note on the last option
      answered !== null && q.explanation ? h('section', { class: 'panel explain' }, h('p', {}, h('strong', {}, 'Why: '), q.explanation)) : null,
      answered !== null ? inPractice(step.card) : null,
      answered !== null ? feedback() : null,
      h('p', { class: 'hint keys' }, answered !== null ? 'Enter goes on.'
        : `Keys 1 to ${q.options.length} select; Enter checks.`));
  }

  function renderRecall() {
    const card = h('button', { class: 'card' + (revealed ? ' flipped' : ''), type: 'button', onclick: reveal },
      h('span', { class: 'face-label' }, revealed ? 'Definition' : 'Term'),
      h('span', { class: 'face-text' + (revealed ? ' long' : '') }, revealed ? linked(step.card.definition, hidden()) : step.card.term),
      h('span', { class: 'sr-only' }, revealed ? '. Activate to see the term again.' : '. Activate to see the definition.'));
    mount(ctx.root, header(),
      h('p', { class: 'muted' }, 'Say what it means in your own words, then check.'),
      card,
      lookupPill(),
      answered !== null ? inPractice(step.card) : null,
      answered !== null ? feedback() : h('div', { class: 'answer-row' },
        h('button', { class: 'miss', type: 'button', onclick: () => record(false) }, "Didn't know"),
        h('button', { class: 'got', type: 'button', onclick: () => record(true) }, 'Knew it')),
      h('p', { class: 'hint keys' }, answered !== null ? 'Enter goes on.' : "Space shows the answer. 1 = Didn't know, 2 = Knew it."));
  }

  // The card just answered, as it was left: read-only, then back to the current one.
  function renderLookBack() {
    const { step: s, question: q, picks: p, answered: a, moved: m } = last;
    mount(ctx.root,
      topBar(ctx, ctx.label, `${ctx.session.remaining()} left`),
      h('p', { class: 'face-label step-label', tabindex: '-1' }, 'Previous card'),
      q ? [
        h('section', { class: 'panel question' },
          h('p', { class: 'face-label' }, q.multi ? 'Scenario · choose two' : q.label),
          h('p', { class: q.label === 'Scenario' ? 'stem' : 'prompt' }, q.prompt)),
        optionList({ options: q.options, picks: p, answer: q.answer, onPick: () => {}, whyWrong: q.whyWrong }),
        q.explanation ? h('section', { class: 'panel explain' }, h('p', {}, h('strong', {}, 'Why: '), q.explanation)) : null,
      ] : h('div', { class: 'card flipped' },
        h('span', { class: 'face-label' }, s.card.term),
        h('span', { class: 'face-text long' }, s.card.definition)),
      h('div', { class: 'feedback', role: 'status' },
        h('span', {}, h('strong', {}, a ? 'You got it. ' : 'You missed it. '), m ? movedText(m) : ''),
        h('button', { class: 'primary', type: 'button', onclick: backToCurrent }, 'Back to this card')),
      h('p', { class: 'hint keys' }, 'Enter or Esc goes back.'));
    ctx.root.querySelector('.feedback .primary').focus();
  }

  function lookBack() {
    reviewing = true; // a selection not yet checked stays as it was
    renderLookBack();
  }

  function backToCurrent() {
    reviewing = false;
    render();
    if (answered === null) (ctx.root.querySelector('.question') || ctx.root.querySelector('.card')).focus({ preventScroll: true });
  }

  function render() {
    if (reviewing) return renderLookBack();
    if (question) renderQuestion(); else renderRecall();
    if (answered !== null) ctx.root.querySelector('.feedback .primary').focus();
  }

  function pick(i) {
    if (answered !== null || !question || i >= question.options.length) return;
    picks = togglePick(picks, i, question.answer.length);
    render();
    // one answer: focus moves to Check; choose two: stay on the question to pick the second
    if (!question.multi && ready(picks, 1)) ctx.root.querySelector('.check-row .primary')?.focus({ preventScroll: true });
    else ctx.root.querySelector('.question').focus({ preventScroll: true });
  }

  function check() {
    if (answered !== null || !ready(picks, question.answer.length)) return;
    record(isCorrect({ answer: question.answer }, picks));
  }

  function record(correct) {
    if (answered !== null) return;
    answered = correct;
    revealed = true;
    moved = ctx.session.recordResult(step.card.id, correct, step.context, { askedAs: question ? question.kind : step.kind });
    if (question?.kind === 'scenario' && question.bankId) ctx.onScenarioAnswered?.(question.bankId, question.id, correct);
    if (correct) tally.right += 1;
    else { tally.wrong += 1; if (!tally.missed.includes(step.card)) tally.missed.push(step.card); }
    render();
  }

  function reveal() {
    if (answered !== null) return;
    revealed = !revealed;
    render();
    ctx.root.querySelector('.card').focus();
  }

  function advance() {
    if (answered !== null) last = { step, question, picks: [...picks], answered, moved };
    step = ctx.session.next();
    if (!step) return finish();
    prepare();
    render();
    // Focus the question or step label, not an option or the card: a quick second Enter must not
    // answer the next card or show its answer.
    (ctx.root.querySelector('.question') || ctx.root.querySelector('.step-label')).focus({ preventScroll: true });
  }

  function finish() {
    stopKeys();
    const status = learnStatus(ctx.progress, deck.cards.map((c) => c.id));
    const total = tally.right + tally.wrong;
    const allDone = status.learned === status.total;
    endScreen(ctx, {
      heading: total ? `Round done: ${tally.right} of ${total} answers right` : 'Every card is learned',
      lines: [
        `${status.learned} of ${status.total} cards learned`
          + (status.started ? `, ${status.started} on the way` : '')
          + (status.fresh ? `, ${status.fresh} not started` : '') + '.',
        allDone ? 'Keep them fresh with spaced review, or start Learn over from the deck screen.' : '',
      ].filter(Boolean),
      missed: tally.missed,
      again: allDone ? null : { label: 'Next round', run: ctx.restart, primary: true },
      counted: total > 0,
    });
    showNudge();
  }

  // Quiet: only shown when another deck is clearly the better use of time, or this one is stuck.
  async function showNudge() {
    const n = await ctx.nudge?.();
    const end = ctx.root.querySelector('.end');
    if (!n || !end || !end.isConnected) return;
    end.querySelector('.actions').before(h('div', { class: 'nudge', role: 'note' },
      h('p', {}, n.text),
      n.deckId ? h('button', { type: 'button', onclick: () => ctx.openDeck(n.deckId) }, `Go to ${n.deckTitle}`) : null));
  }

  stopKeys = keys((e) => {
    if (reviewing) {
      if ((e.key === 'Enter' && !e.target.closest('button')) || e.key === 'Escape') { e.preventDefault(); backToCurrent(); }
      return;
    }
    if (answered !== null) {
      if (e.key === 'Enter' && !e.target.closest('button, summary')) { e.preventDefault(); advance(); }
      return;
    }
    if (question) {
      const n = Number(e.key);
      if (n >= 1 && n <= question.options.length) { e.preventDefault(); pick(n - 1); }
      // with enough picked, Enter checks, even from an option, instead of un-picking it
      else if (e.key === 'Enter' && ready(picks, question.answer.length)
        && !e.target.closest('a, button:not(.option)')) { e.preventDefault(); check(); }
    } else if (e.key === ' ') { // not Enter: the Enter that pressed Next must not also show the answer
      if (e.target.closest('button, label, summary')) return;
      e.preventDefault(); reveal();
    } else if (e.key === '1') record(false);
    else if (e.key === '2') record(true);
  });

  render();
  (ctx.root.querySelector('.question') || ctx.root.querySelector('.card')).focus();
  return () => { stopKeys(); };
}
