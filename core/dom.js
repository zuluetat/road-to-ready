// Tiny element builder. Strings always become text nodes, so card text can never inject markup.

import { codeParts } from './code.js';

// An ⓘ that opens a short explanation on tap or click (works on phones, where hover tooltips don't).
export function tip(text, label = 'What this means') {
  return h('details', { class: 'tip' }, h('summary', { 'aria-label': label, title: text }, 'ⓘ'), h('span', { class: 'tip-text' }, text));
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') { // object form: allowed under a strict style CSP; '--name' sets a CSS variable
      for (const [k, v] of Object.entries(value)) if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v;
    }
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Card or question text with its code drawn as code (core/code.js): an inline span as <code>, a
// fenced block in its own box that scrolls sideways on a phone and can be reached by keyboard.
// plain(text) draws the parts in between (Learn underlines terms to look up there). Inside a button
// (a card face, a Match tile, an answer option) pass { focusable: false }: a tab stop inside a control
// is a second stop, and the button already takes the tap.
export function withCode(text, plain = (t) => t, { focusable = true } = {}) {
  if (typeof text !== 'string' || !text.includes('`')) return plain(text);
  return codeParts(text).map((p) => (p.kind === 'text' ? plain(p.text)
    : p.kind === 'code' ? h('code', {}, p.text)
      : h('pre', { class: 'code-block', tabindex: focusable ? '0' : null }, h('code', {}, p.text))));
}

// Several texts in a row, each drawn on its own, so a backtick in one can never pair with the next.
export function joinWithCode(texts, sep, plain) {
  return texts.flatMap((t, i) => [i ? sep : null, withCode(t, plain)]).filter((x) => x !== null);
}

export function mount(root, ...children) {
  root.replaceChildren();
  append(root, children);
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Local calendar date, not UTC: a review due "today" should flip at local midnight.
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
