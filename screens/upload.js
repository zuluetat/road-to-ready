// Add a deck: read a CSV or Markdown file (or pasted notes), show every card found for review and
// editing, then save it to your synced decks. Nothing is saved until you press Save.

import { h, mount } from '../core/dom.js';
import { readCards } from '../core/cardreader.js';
import { makeDeck, deckIdFor, keepCardIds, validateDeck } from '../core/formats.js';

const MAX_FILE = 2_000_000;

const READS = [
  'CSV with columns named Term and Definition (or Front and Back, Question and Answer), or just two columns',
  'Markdown tables',
  'Lines like **Term**: definition, Term: definition, or Term — definition',
  'A heading with a paragraph under it',
  'term|definition lines, and tab-separated lines',
];

// showUpload(root, { decks, existing: [{ id, title }], onSaved(id), onCancel() }) -> cleanup
export function showUpload(root, { decks, existing, onSaved, onCancel }) {
  let draft = null; // { title, cards: [{ term, definition }], skipped, source }
  let message = null;
  let confirmReplace = false;
  let saving = false;

  function read(text, name) {
    const r = readCards(text, name);
    if (!r.cards.length) {
      message = { kind: 'warn', text: `No cards found in ${name || 'that text'}. See what the reader understands below.` };
      draft = null;
    } else {
      draft = { title: r.title, cards: r.cards, skipped: r.skipped, source: name };
      message = null;
    }
    confirmReplace = false;
    render();
  }

  async function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE) {
      message = { kind: 'warn', text: 'That file is over 2 MB. Split it into smaller decks.' };
      return render();
    }
    read(await file.text(), file.name);
  }

  async function save() {
    const cards = draft.cards.filter((c) => c.term.trim() && c.definition.trim());
    const id = deckIdFor(draft.title.trim());
    const clash = existing.find((d) => d.id === id);
    let deck;
    try {
      deck = validateDeck(makeDeck({ id, title: draft.title }, cards), id);
    } catch (err) {
      message = { kind: 'warn', text: err.message };
      return render();
    }
    if (clash && !confirmReplace) {
      confirmReplace = clash.title;
      message = null;
      return render();
    }
    saving = true;
    render();
    try {
      if (clash) {
        // cards whose terms are unchanged keep their ids, and so their progress
        const old = await decks.loadDeck(id).catch(() => null);
        deck = validateDeck(keepCardIds(deck, old), id);
      }
      await decks.saveDeck(deck);
      onSaved(id);
    } catch (err) {
      saving = false;
      message = { kind: 'warn', text: `Couldn't save: ${err.message}. Your cards are still here; try again.` };
      render();
    }
  }

  function pickStep() {
    const pasted = h('textarea', { id: 'paste', rows: '8', placeholder: '**Term**: definition\nAnother term: its definition' });
    return [
      h('section', { class: 'panel' },
        h('h2', {}, 'From a file'),
        h('p', { class: 'muted' }, 'CSV or Markdown. You review every card before anything is saved.'),
        h('div', { class: 'actions' },
          h('input', { type: 'file', id: 'deck-file', class: 'sr-only', accept: '.csv,.md,.markdown,.txt,text/csv,text/markdown,text/plain', onchange: onFile }),
          h('label', { class: 'button primary-label', for: 'deck-file' }, 'Choose a file'))),
      h('details', { class: 'panel' },
        h('summary', {}, 'Or paste notes'),
        pasted,
        h('div', { class: 'actions' },
          h('button', { type: 'button', onclick: () => read(pasted.value, '') }, 'Read pasted notes'))),
      h('section', { class: 'panel' },
        h('h2', {}, 'What the reader understands'),
        h('ul', { class: 'plain' }, READS.map((r) => h('li', {}, r))),
        h('p', { class: 'muted' }, 'Anything else is skipped and counted, never guessed at. Reading free-form notes with AI is a later phase.')),
    ];
  }

  function cardRow(card, i) {
    return h('li', { class: 'edit-card' },
      h('label', { class: 'sr-only', for: `t${i}` }, `Card ${i + 1} term`),
      h('input', { id: `t${i}`, type: 'text', value: card.term, oninput: (e) => { card.term = e.target.value; } }),
      h('label', { class: 'sr-only', for: `d${i}` }, `Card ${i + 1} definition`),
      h('textarea', { id: `d${i}`, rows: '2', oninput: (e) => { card.definition = e.target.value; } }, card.definition),
      h('button', { type: 'button', class: 'remove', 'aria-label': `Remove card ${i + 1}`,
        onclick: () => { draft.cards.splice(i, 1); render(`t${Math.min(i, draft.cards.length - 1)}`); } }, 'Remove'));
  }

  function reviewStep() {
    const title = h('input', { id: 'deck-title', type: 'text', value: draft.title, maxlength: '200',
      oninput: (e) => { draft.title = e.target.value; confirmReplace = false; } });
    return [
      h('section', { class: 'panel' },
        h('label', { for: 'deck-title' }, 'Deck name'),
        title,
        h('p', { class: 'muted' },
          `${draft.cards.length} card${draft.cards.length === 1 ? '' : 's'} found`
          + (draft.skipped ? ` · ${draft.skipped} line${draft.skipped === 1 ? '' : 's'} skipped` : '')
          + (draft.source ? ` · from ${draft.source}` : '')),
        confirmReplace ? h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Replace deck' },
          h('p', {}, `This would replace your deck "${confirmReplace}". Replace it? Progress carries over for cards whose terms are unchanged.`),
          h('button', { class: 'primary', type: 'button', onclick: save, disabled: saving }, 'Replace'),
          h('button', { type: 'button', onclick: () => { confirmReplace = false; render('deck-title'); } }, 'Rename instead'))
          : h('div', { class: 'actions' },
            h('button', { class: 'primary', type: 'button', onclick: save, disabled: saving }, saving ? 'Saving…' : 'Save deck'),
            h('button', { type: 'button', onclick: () => { draft = null; render(); } }, 'Start over'))),
      h('ol', { class: 'edit-list' }, draft.cards.map(cardRow)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => { draft.cards.push({ term: '', definition: '' }); render(`t${draft.cards.length - 1}`); } }, 'Add a card')),
    ];
  }

  function render(focusId) {
    mount(root,
      h('header', { class: 'page-head' },
        h('button', { class: 'link', type: 'button', onclick: onCancel }, '← All decks'),
        h('h1', {}, draft ? 'Check your cards' : 'Add a deck')),
      message ? h('p', { class: 'flash' + (message.kind === 'warn' ? ' warn' : ''), role: 'alert' }, message.text) : null,
      draft ? reviewStep() : pickStep());
    if (focusId) document.getElementById(focusId)?.focus();
    else if (confirmReplace) root.querySelector('.confirm .primary')?.focus();
  }

  render();
  return () => {};
}
