// Flashcards: flip with click, tap or Space. Browse the deck with arrow keys, or work through a
// session (pass, retake round, due review) where "Got it" and "Missed" record the answer.

import { h, mount } from '../core/dom.js';
import { shuffle } from '../core/progress.js';
import { topBar, endScreen, keys, inPractice, FILLER_NOTE } from './common.js';

export const id = 'flashcards';
export const title = 'Flashcards';

export function start(deck, ctx) {
  let swap = Boolean(ctx.options.swap);
  let flipped = false;
  const tally = { right: 0, wrong: 0, missed: [] };

  // Browse mode walks a list with arrows; session mode asks the session for each card.
  let list = deck.cards.slice();
  let index = 0;
  let step = ctx.session ? ctx.session.next() : { card: list[0], context: 'review', filler: false };
  let stopKeys = () => {};
  if (!step || !step.card) { finish(); return stopKeys; }

  function faces(card) {
    return swap ? [card.definition, card.term] : [card.term, card.definition];
  }

  function status() {
    if (!ctx.session) return `${index + 1} / ${list.length}`;
    return `${ctx.session.remaining()} left`;
  }

  function render() {
    const [front, back] = faces(step.card);
    // No aria-label: it would replace the card text, and a screen reader must read the card itself.
    const card = h('button', { class: 'card' + (flipped ? ' flipped' : ''), type: 'button', onclick: flip },
      h('span', { class: 'face-label' }, flipped ? (swap ? 'Term' : 'Definition') : (swap ? 'Definition' : 'Term')),
      h('span', { class: 'face-text' + (flipped !== swap ? ' long' : '') }, flipped ? back : front),
      h('span', { class: 'sr-only' }, flipped ? '. Activate to flip back.' : '. Activate to flip.'));

    mount(ctx.root,
      topBar(ctx, ctx.label, status()),
      step.filler ? h('p', { class: 'note' }, FILLER_NOTE) : null,
      card,
      flipped ? inPractice(step.card) : null, // the answer side only: the example often names the term
      h('div', { class: 'answer-row' },
        h('button', { class: 'miss', type: 'button', onclick: () => answer(false) }, "Didn't know"),
        h('button', { class: 'got', type: 'button', onclick: () => answer(true) }, 'Knew it')),
      // browsing: the buttons are optional; the arrows move on without recording anything
      ctx.session ? null : h('p', { class: 'muted browse-note' }, "Tap Knew it or Didn't know to track a card, or use the arrows to just flip through."),
      // the arrows get a row of their own, as wide as the answer buttons, so neither wraps away
      ctx.session ? null : h('div', { class: 'nav-row' },
        h('button', { type: 'button', onclick: () => move(-1), 'aria-label': 'Previous card' }, '←'),
        h('button', { type: 'button', onclick: reshuffle }, 'Shuffle'),
        h('button', { type: 'button', onclick: () => move(1), 'aria-label': 'Next card' }, '→')),
      h('div', { class: 'tools' },
        h('label', { class: 'toggle' },
          h('input', { type: 'checkbox', checked: swap, onchange: (e) => { swap = e.target.checked; ctx.options.swap = swap; flipped = false; render(); } }),
          ' Show definition first')),
      h('p', { class: 'hint keys' }, "Space flips. 1 = Didn't know, 2 = Knew it." + (ctx.session ? '' : ' Arrow keys move.')));
  }

  function flip() { flipped = !flipped; render(); ctx.root.querySelector('.card').focus(); }

  function move(delta) {
    if (ctx.session) return;
    index = (index + delta + list.length) % list.length;
    step = { card: list[index], context: 'review', filler: false };
    flipped = false;
    render();
    ctx.root.querySelector('.card').focus();
  }

  function reshuffle() {
    list = shuffle(list);
    index = 0;
    step = { card: list[0], context: 'review', filler: false };
    flipped = false;
    render();
  }

  function answer(correct) {
    const counted = !step.filler;
    if (ctx.session) ctx.session.recordResult(step.card.id, correct, step.context);
    else ctx.record(step.card.id, correct, 'review');
    if (counted) {
      if (correct) tally.right += 1;
      else { tally.wrong += 1; tally.missed.push(step.card); }
    }
    flipped = false;
    if (!ctx.session) {
      if (index === list.length - 1) return finish();
      return move(1);
    }
    step = ctx.session.next();
    if (!step) return finish();
    render();
    ctx.root.querySelector('.card').focus();
  }

  function finish() {
    stopKeys();
    const total = tally.right + tally.wrong;
    endScreen(ctx, {
      heading: total ? `${tally.right} of ${total} right` : 'Nothing to study here right now',
      lines: total ? [] : [ctx.emptyMessage || 'Come back when more cards are due.'],
      missed: tally.missed,
      counted: total > 0,
    });
  }

  stopKeys = keys((e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      // a focused button (including the card itself) already handles these keys natively
      if (e.target.closest('button, label, summary')) return;
      e.preventDefault(); flip();
    } else if (e.key === '1') answer(false);
    else if (e.key === '2') answer(true);
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowLeft') move(-1);
  });

  render();
  ctx.root.querySelector('.card').focus();
  return stopKeys;
}
