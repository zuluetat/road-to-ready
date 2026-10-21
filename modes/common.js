// Pieces shared by the study modes: the top bar, the end-of-round screen, and key handling.

import { h, mount } from '../core/dom.js';
import { retakeIds } from '../core/progress.js';
import { optionMarks } from '../core/choice.js';
import { isLocalCopy } from '../core/account.js';
import { reportUrl } from '../core/report.js';

// "Report a problem with this card": the public copy only (the owner fixes his own site directly).
// what: { deck, card?, question? } as core/report.js takes it.
export function reportLink(what) {
  if (!isLocalCopy(globalThis.document)) return null;
  return h('p', { class: 'report-link muted small' },
    h('a', { href: reportUrl(what), target: '_blank', rel: 'noopener noreferrer' },
      what.question ? 'Report a problem with this question' : 'Report a problem with this card'));
}

export function topBar(ctx, title, status) {
  return h('header', { class: 'study-bar' },
    h('button', { class: 'link', type: 'button', onclick: ctx.onExit }, '← ', ctx.deck.title),
    h('div', { class: 'study-title' }, title),
    // text statuses are announced; an element (Match's ticking timer) is not, or it would flood a screen reader
    h('div', { class: 'study-status', 'aria-live': typeof status === 'string' ? 'polite' : null }, status || ''));
}

export function retakeCount(ctx) {
  return retakeIds(ctx.progress, ctx.deck.cards.map((c) => c.id)).length;
}

// The end screen every mode uses: a heading, a few result lines, the missed cards, and what to do next.
export function endScreen(ctx, { heading, lines = [], missed = [], again = null, counted = false }) {
  const left = retakeCount(ctx);
  const inRetake = ctx.session && ctx.session.kind === 'retake';
  const retakeLabel = inRetake
    ? (left ? `Next retake round (${left} left)` : 'Retake queue is empty')
    : `Retake missed cards (${left})`;
  const passDone = ctx.session && ctx.session.kind === 'pass' && !ctx.progress.currentPass;
  const last = ctx.progress.passHistory[ctx.progress.passHistory.length - 1];

  mount(ctx.root,
    topBar(ctx, ctx.label),
    h('section', { class: 'panel end' },
      h('h2', {}, heading),
      passDone && last ? h('p', { class: 'big' },
        `Pass ${last.number} complete: ${last.firstAttemptCorrect} of ${last.total} right on the first try.`) : null,
      lines.map((line) => h('p', {}, line)),
      missed.length ? [
        h('h3', {}, 'Look at these again'),
        h('ul', { class: 'missed' }, missed.map((c) => h('li', {}, h('strong', {}, c.term), h('span', {}, c.definition)))),
      ] : null,
      h('div', { class: 'actions' },
        // again.primary puts the round's own next step first (Learn's next round) ahead of retakes
        again?.primary ? h('button', { class: 'primary', type: 'button', onclick: again.run }, again.label) : null,
        h('button', { class: again?.primary ? null : 'primary', type: 'button', disabled: left === 0, onclick: () => ctx.onRetake(ctx.modeId) }, retakeLabel),
        again && !again.primary ? h('button', { type: 'button', onclick: again.run }, again.label) : null,
        h('button', { type: 'button', onclick: ctx.onExit }, 'Back to deck'))));
  // nothing enabled to lead with (Learn finished, retake queue empty): land on Back to deck
  // the result and any celebration sit at the top; focus the next step without scrolling past them
  (ctx.root.querySelector('button.primary:not([disabled])') || ctx.root.querySelector('.end .actions button:last-child'))?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  // a round with answers in it counts toward today's goal and the streak
  if (counted && ctx.onRound) {
    const end = ctx.root.querySelector('.end');
    ctx.onRound().then((got) => {
      if (!got || !end.isConnected) return;
      end.querySelector('h2').after(h('div', { class: 'today-line', role: 'status' }, got.lines.map((l) => h('p', {}, l))));
      // the points lead the screen, like a language app's XP: the number first, the detail under it
      if (got.points) end.prepend(h('div', { class: `points-gain is-${got.points.kind}`, role: 'status' },
        h('strong', {}, got.points.big), h('p', {}, got.points.detail)));
      if (got.celebration) end.prepend(celebration(got.celebration));
    });
  }
}

const BADGES = { ring: '✓', streak: '🔥', phase: '⬆', ready: '1,000' };

// A short celebration (about two seconds of motion, none if the device asks for reduced motion).
export function celebration({ kind, title, detail }) {
  const big = kind === 'phase' || kind === 'ready';
  return h('div', { class: `celebrate is-${kind}`, role: 'status' },
    big ? h('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => h('span', { style: { '--i': String(i) } }))) : null,
    h('div', { class: 'celebrate-badge', 'aria-hidden': 'true' }, BADGES[kind]),
    h('div', {}, h('strong', {}, title), h('p', {}, detail)));
}

// The answer options, the same in Learn and Quiz: a selection is blue (never judged); after Check
// the answers are green and a wrong pick red, each with a pill. -> <ol>
//   options: texts; picks: selected indices; answer: correct indices, or null until checked;
//   onPick(i); whyWrong: optional notes per option, shown after checking; need: 1 or 2
// textOf: optional, renders an option's text (Learn underlines terms to look up). Its options
// then stay tappable after answering, marked aria-disabled, so a looked-up word still answers.
export function optionList({ options, picks, answer = null, onPick, whyWrong = null, need = 1, textOf = null }) {
  const marks = answer ? optionMarks(answer, picks, options.length) : [];
  return h('ol', { class: 'options' }, options.map((text, i) => {
    const mark = marks[i];
    const state = mark ? ` ${mark.state}` : !answer && picks.includes(i) ? ' selected' : '';
    return h('li', {},
      h('button', {
        type: 'button', class: 'option' + state, onclick: () => { if (!answer) onPick(i); },
        disabled: Boolean(answer) && !textOf, 'aria-disabled': answer && textOf ? 'true' : null,
        'aria-pressed': answer ? null : String(picks.includes(i)),
      },
        h('span', { class: 'key' }, String(i + 1)), h('span', { class: 'option-text' }, textOf ? textOf(text, i) : text),
        mark ? h('span', { class: `pill pill-${mark.state}` }, mark.pill) : null),
      answer && whyWrong?.[i] ? h('p', { class: 'why muted' }, whyWrong[i]) : null);
  }));
}

// The same words as the practice exam's button, so it reads the same everywhere.
// Which of a card's examples there are, and which to show: { views, show }. Only the general one,
// or only Tim's, shows that one; with both, the remembered choice wins and General comes first.
const hasExample = (ex) => Boolean(ex?.text || ex?.steps?.length);
export function exampleViews(card, remembered) {
  const views = [hasExample(card?.example) ? 'general' : null, hasExample(card?.mine) ? 'mine' : null].filter(Boolean);
  return { views, show: views.includes(remembered) ? remembered : views[0] ?? null };
}

// The toggle's last choice, per browser: a convenience, so it is fine if storage is unavailable.
const VIEW_KEY = 'study.exampleView';
const rememberedView = () => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } };
const rememberView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* not kept */ } };

// A card's real-world examples, folded until you open it, one at a time: a general one and one
// from Tim's own projects, with a toggle when there are both (a phone screen holds one, not two).
// A lifecycle walks its stages as a list. Shown only once the answer is out, so it can't give the
// answer away. null when the card has neither.
export function inPractice(card) {
  let { views, show } = exampleViews(card, rememberedView());
  if (!show) return null;
  const scene = (ex) => [
    ex.text ? h('p', {}, ex.text) : null,
    ex.steps?.length ? h('ol', {}, ex.steps.map((s) => h('li', {}, h('strong', {}, s.name + ': '), s.text))) : null,
  ];
  const body = h('div', { class: 'in-practice-body' });
  const tabs = views.length > 1 ? h('div', { class: 'example-toggle', role: 'group', 'aria-label': 'Which example' }) : null;
  const draw = () => {
    if (tabs) {
      tabs.replaceChildren(...views.map((v) => h('button', {
        type: 'button', 'aria-pressed': String(v === show), class: v === show ? 'on' : null,
        onclick: () => { show = v; rememberView(v); draw(); },
      }, v === 'general' ? 'General' : "Tim's use case")));
    }
    body.replaceChildren(...[
      show === 'mine' ? h('p', { class: 'example-project' }, card.mine.project) : null,
      scene(show === 'mine' ? card.mine : card.example),
    ].flat().filter(Boolean));
  };
  draw();
  return h('details', { class: 'in-practice' }, h('summary', {}, 'ⓘ In practice'), tabs, body);
}

export function checkButton(picks, need, onCheck) {
  return h('div', { class: 'actions check-row' },
    h('button', { class: 'primary', type: 'button', disabled: picks.length !== need, onclick: onCheck }, 'Check answer'));
}

// Keyboard shortcuts for a mode; ignored while typing in a field. Returns the cleanup function.
export function keys(handler) {
  const listener = (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat) return; // a held key must not answer card after card
    handler(e);
  };
  document.addEventListener('keydown', listener);
  return () => document.removeEventListener('keydown', listener);
}

export const FILLER_NOTE = 'Spacer card: it keeps a card you just saw from coming straight back. It counts as review only.';
