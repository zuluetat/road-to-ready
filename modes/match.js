// Match: six term and definition pairs, a running timer, and a best time per deck.
// A wrong pairing counts as a miss for both cards, so both go to the retake queue.

import { h, mount } from '../core/dom.js';
import { shuffle } from '../core/progress.js';
import { topBar, endScreen } from './common.js';

export const id = 'match';
export const title = 'Match';

const PAIRS = 6;

export function start(deck, ctx) {
  const cards = shuffle(deck.cards).slice(0, PAIRS);
  const tiles = shuffle(cards.flatMap((c) => [
    { cardId: c.id, side: 'term', text: c.term },
    { cardId: c.id, side: 'definition', text: c.definition },
  ]));
  const cleared = new Set();
  const missed = new Map();
  let selected = null;
  let wrongPair = [];
  if (cards.length === 0) {
    endScreen(ctx, { heading: 'This deck has no cards to match' });
    return () => {};
  }
  const started = performance.now();
  const timer = setInterval(tick, 100);

  const elapsed = () => (performance.now() - started) / 1000;

  function tick() {
    const el = ctx.root.querySelector('.timer');
    if (el) el.textContent = elapsed().toFixed(1) + 's';
  }

  function render(focusIndex) {
    mount(ctx.root,
      topBar(ctx, 'Match', h('span', { class: 'timer', role: 'timer' }, elapsed().toFixed(1) + 's')),
      h('p', { class: 'hint' }, 'Pick a term, then its definition.' +
        (ctx.progress.matchBestSeconds ? ` Best: ${ctx.progress.matchBestSeconds.toFixed(1)}s.` : '')),
      h('div', { class: 'match-grid' }, tiles.map((tile, i) => {
        const gone = cleared.has(tile.cardId);
        const cls = ['tile', tile.side,
          selected === i ? 'selected' : '', wrongPair.includes(i) ? 'wrong' : '', gone ? 'gone' : ''].join(' ');
        return h('button', {
          type: 'button', class: cls, disabled: gone, 'aria-pressed': String(selected === i),
          onclick: () => pick(i),
        }, tile.text);
      })));
    if (focusIndex !== undefined) {
      const buttons = ctx.root.querySelectorAll('.tile');
      (buttons[focusIndex]?.disabled ? ctx.root.querySelector('.tile:not([disabled])') : buttons[focusIndex])?.focus();
    }
  }

  function pick(i) {
    wrongPair = [];
    if (selected === null) { selected = i; return render(i); }
    if (selected === i) { selected = null; return render(i); }
    const a = tiles[selected];
    const b = tiles[i];
    if (a.side === b.side) { selected = i; return render(i); }
    if (a.cardId === b.cardId) {
      cleared.add(a.cardId);
    } else {
      for (const t of [a, b]) {
        ctx.record(t.cardId, false, 'review');
        missed.set(t.cardId, deck.cards.find((c) => c.id === t.cardId));
      }
      wrongPair = [selected, i];
    }
    selected = null;
    if (cleared.size === cards.length) return finish();
    render(i);
  }

  function finish() {
    clearInterval(timer);
    const seconds = Math.round(elapsed() * 10) / 10;
    const best = ctx.progress.matchBestSeconds;
    const isBest = best === null || seconds < best;
    if (isBest) {
      ctx.progress.matchBestSeconds = seconds;
      ctx.saveProgress();
    }
    endScreen(ctx, {
      heading: `${seconds.toFixed(1)} seconds`,
      lines: [isBest ? 'New best time for this deck.' : `Best: ${best.toFixed(1)}s.`,
        missed.size ? `${missed.size} card${missed.size === 1 ? '' : 's'} went to the retake queue.` : 'No wrong pairs.'],
      missed: [...missed.values()],
      again: { label: 'Play again', run: () => ctx.restart() },
      counted: true,
    });
  }

  render(0);
  return () => clearInterval(timer);
}
