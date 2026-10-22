// How to make a deck: brief steps, the sample CSV to copy or download, and where the deck is kept.

import { h, mount } from '../core/dom.js';
import { SAMPLE_CSV, SAMPLE_NAME, SAMPLE_MD, SAMPLE_MD_NAME, whereDecksLive, AI_PROMPT } from '../core/deck-guide.js';

// Copies text, then says so on the button for a moment; falls back to selecting the text to copy by hand.
function copyButton(text, source) {
  const b = h('button', { type: 'button', onclick: async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied';
    } catch {
      getSelection().selectAllChildren(source);
      b.textContent = 'Selected: copy it';
    }
    setTimeout(() => { b.textContent = 'Copy the prompt'; }, 2000);
  } }, 'Copy the prompt');
  return b;
}

// showDeckGuide(root, { local, onDownload(name, text, type), onBack() })
export function showDeckGuide(root, { local, onDownload, onBack }) {
  const prompt = h('pre', { class: 'sample-csv' }, AI_PROMPT);
  mount(root,
    h('header', { class: 'page-head' },
      h('button', { class: 'link', type: 'button', onclick: onBack }, '← All decks'),
      h('h1', {}, 'How to make a deck')),
    h('section', { class: 'panel' },
      h('ol', { class: 'guide-steps' },
        h('li', {}, 'In a spreadsheet, put each term in column A and its definition in column B, with Term and Definition as the first row.'),
        h('li', {}, 'Save it as CSV. Google Sheets: File → Download → Comma-separated values. Excel: Save As → CSV UTF-8. Numbers: File → Export To → CSV.'),
        h('li', {}, 'Open the menu, tap + Add a deck, and choose the file.'),
        h('li', {}, 'Check the cards it found, name the deck, and tap Save deck.')),
      h('p', { class: 'muted' }, whereDecksLive(local))),
    h('section', { class: 'panel' },
      h('h2', {}, 'Make it with AI'),
      h('p', {}, 'Copy this prompt into Claude or another AI chat, replace the part in brackets with your topic or notes, and send it.'),
      prompt,
      h('div', { class: 'actions' }, copyButton(AI_PROMPT, prompt)),
      h('p', {}, 'Then copy the whole reply, open + Add a deck → Or paste notes, paste it, and tap Read pasted notes. Check every card before saving: AI can get facts wrong.')),
    h('section', { class: 'panel' },
      h('h2', {}, 'Sample'),
      h('pre', { class: 'sample-csv' }, SAMPLE_CSV),
      h('details', { class: 'sample-md' }, h('summary', {}, 'Markdown version'), h('pre', { class: 'sample-csv' }, SAMPLE_MD)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => onDownload(SAMPLE_NAME, SAMPLE_CSV, 'text/csv') }, 'Download CSV sample'),
        h('button', { type: 'button', onclick: () => onDownload(SAMPLE_MD_NAME, SAMPLE_MD, 'text/markdown') }, 'Download Markdown sample'),
        h('a', { class: 'button primary', href: '#/upload' }, '+ Add a deck'))),
    h('section', { class: 'panel' },
      h('h2', {}, 'Good to know'),
      h('ul', { class: 'plain' },
        h('li', {}, 'One card per row. A definition with commas is fine: the spreadsheet puts quotes around it for you.'),
        h('li', {}, 'To update a deck, fix the spreadsheet and add it again under the same name. Cards whose terms are unchanged keep their progress.'),
        h('li', {}, 'No spreadsheet? Paste lines like Term: definition into Add a deck → Or paste notes.'),
        h('li', {}, 'Keep notes in Markdown? Lines like **Term**: definition work too; see the Markdown version above.'))));
  return () => {};
}
