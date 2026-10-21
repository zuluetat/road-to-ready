// Tiny element builder. Strings always become text nodes, so card text can never inject markup.

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
