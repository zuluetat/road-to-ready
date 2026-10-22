// The built-in card reader: turns an uploaded CSV or Markdown file into term and definition pairs.
// It reads common shapes only. Anything it can't read is counted as skipped, never guessed at;
// the upload screen shows every card so you can fix or drop it before saving.

import { parseCsvRows } from './formats.js';

const TERM_HEADERS = new Set(['term', 'front', 'question', 'word', 'concept', 'name', 'prompt']);
const DEF_HEADERS = new Set(['definition', 'back', 'answer', 'meaning', 'description', 'explanation']);
const MAX_TERM = 60; // longer than this, "X: Y" is a sentence, not a term
// A field longer than this is skipped before any formatting is stripped, so a pathological file
// can't freeze the page. It is above the 4000-character definition limit on purpose: anything
// this long would be refused at save anyway.
const MAX_FIELD = 5000;
// "Note: …" is a label on a line of prose, not a term and its definition.
const LABELS = new Set(['note', 'notes', 'todo', 'to do', 'example', 'examples', 'e.g.', 'eg', 'tip', 'tips',
  'warning', 'caution', 'important', 'see', 'see also', 'source', 'sources', 'ref', 'reference', 'references',
  'fyi', 'nb', 'n.b.', 'update', 'updated', 'reminder', 'remember']);

// readCards(text, filename) -> { title, cards: [{ term, definition }], skipped, format }
// JSON when the file is .json or the text is a JSON list of cards; CSV when the file is .csv or the
// text starts with a recognised header row (pasted, or a .txt); Markdown otherwise. An AI chat reply
// often puts the cards in a code block with a sentence around it: then only the block is read.
export function readCards(text, filename = '') {
  text = text.replace(/^\uFEFF/, '');
  let format = null;
  const fence = firstFence(text);
  if (fence && (fence.lang === 'json' || (!fence.lang && parsesAsJson(fence.body)))) format = 'json';
  else if (fence && (fence.lang === 'csv' || fence.lang === 'tsv' || startsWithCsvHeader(fence.body))) format = 'csv';
  if (format) text = fence.body;
  else if (/\.json$/i.test(filename) || parsesAsJson(text)) format = 'json';
  else if (/\.csv$/i.test(filename) || startsWithCsvHeader(text)) format = 'csv';
  else format = 'markdown';
  const result = format === 'json' ? readJson(text) : format === 'csv' ? readCsv(text) : readMarkdown(text);
  return { title: result.title || titleFromFilename(filename), cards: result.cards, skipped: result.skipped, format };
}

// The first code block: { lang, body }, or null.
function firstFence(text) {
  const m = text.match(/^(```|~~~)[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)^\1[ \t]*$/m);
  return m ? { lang: m[2].toLowerCase(), body: m[3] } : null;
}

function parsesAsJson(text) {
  if (!/^\s*[[{]/.test(text)) return false;
  try { JSON.parse(text); return true; } catch { return false; }
}

// A list of objects with a term-like and a definition-like field (the same names as CSV headers),
// either on its own or as the first list inside an object ({ "cards": [...] }).
function readJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { cards: [], skipped: 1 }; }
  const list = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray) || [];
  const cards = [];
  let skipped = 0;
  for (const item of list) {
    const entries = item && typeof item === 'object' ? Object.entries(item) : [];
    const pick = (names) => entries.find(([k, v]) => names.has(k.toLowerCase()) && (typeof v === 'string' || typeof v === 'number'))?.[1];
    const card = pair(String(pick(TERM_HEADERS) ?? ''), String(pick(DEF_HEADERS) ?? ''));
    if (card) cards.push(card);
    else skipped += 1;
  }
  return { title: typeof data?.title === 'string' ? strip(data.title) : '', cards, skipped };
}

function startsWithCsvHeader(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  if (first.trim().startsWith('|')) return false; // a Markdown table
  const cells = parseCsvRows(first, csvDelimiter(first))[0] || [];
  return cells.length >= 2 && headerColumns(cells) !== null;
}

function titleFromFilename(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled deck';
}

// Which two columns hold the term and the definition, judged from a header row.
function headerColumns(cells) {
  if (cells.some((c) => (c || '').length > MAX_TERM)) return null; // a header is short; never clean a huge field
  const lower = cells.map((c) => strip(c).toLowerCase());
  const term = lower.findIndex((c) => TERM_HEADERS.has(c));
  const def = lower.findIndex((c) => DEF_HEADERS.has(c));
  return term >= 0 && def >= 0 && term !== def ? { term, def } : null;
}

// Comma, semicolon (European spreadsheets) or tab: whichever the first line uses most.
function csvDelimiter(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function readCsv(text) {
  const delimiter = csvDelimiter(text);
  const rows = parseCsvRows(text, delimiter).filter((r) => r.some((c) => c.trim() !== ''));
  const header = rows.length ? headerColumns(rows[0]) : null;
  const cols = header || { term: 0, def: 1 };
  // The definition is the header's last column: a row with more cells than the header has an
  // unquoted comma in its definition, so the rest of the row belongs to it.
  const defIsLast = header && cols.def === rows[0].length - 1 && cols.term < cols.def;
  const cards = [];
  let skipped = 0;
  for (const row of header ? rows.slice(1) : rows) {
    // the header again (AI tools sometimes repeat it): counted as skipped, never a card
    if (header && headerColumns(row)) { skipped += 1; continue; }
    const definition = defIsLast && row.length > rows[0].length ? row.slice(cols.def).join(delimiter) : row[cols.def];
    const card = pair(row[cols.term], definition);
    if (card) cards.push(card);
    else skipped += 1;
  }
  return { cards, skipped };
}

function pair(term, definition) {
  if ((term || '').length > MAX_FIELD || (definition || '').length > MAX_FIELD) return null;
  const t = strip(term || '');
  const d = strip(definition || '');
  return t && d ? { term: t, definition: d } : null;
}

// Removes Markdown formatting: links keep their text, code ticks and emphasis markers go.
function strip(s) {
  return String(s)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const INDENTED_ITEM = /^(?: {2,}|\t)(?:[-*+]|\d+[.)])\s+/;

// One line of notes -> a card, or null. Tried in order from most to least explicit.
function lineCard(raw) {
  const isListItem = LIST_MARKER.test(raw);
  const line = raw.replace(LIST_MARKER, '').trim();

  const bold = line.match(/^(\*\*|__)(.+?)\1\s*(.*)$/);
  if (bold) {
    const termHasColon = /:\s*$/.test(bold[2]);
    const sep = bold[3].match(/^(?::|—|–|-{1,2})\s*/);
    if (sep || termHasColon) return pair(bold[2].replace(/:\s*$/, ''), bold[3].slice(sep ? sep[0].length : 0));
  }
  const colonAt = line.search(/:\s/);
  if (line.includes('|') && !line.startsWith('|') && !(colonAt >= 0 && colonAt < line.indexOf('|'))) {
    const i = line.indexOf('|');
    return pair(line.slice(0, i), line.slice(i + 1));
  }
  if (line.includes('\t')) {
    const i = line.indexOf('\t');
    return pair(line.slice(0, i), line.slice(i + 1));
  }
  const dash = line.match(isListItem ? /^(.{1,60}?)\s+(?:—|–|-)\s+(.+)$/ : /^(.{1,60}?)\s+(?:—|–)\s+(.+)$/);
  if (dash) return pair(dash[1], dash[2]);
  const colon = line.match(/^([^:]{1,200}?):\s+(.+)$/);
  if (colon && strip(colon[1]).length <= MAX_TERM && !colon[1].includes('//')
    && !LABELS.has(strip(colon[1]).toLowerCase())) return pair(colon[1], colon[2]);
  return null;
}

// Cells split on unescaped pipes; \| inside a cell is a pipe in the text.
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

// "Q: …" then "A: …" on the next line (or Question/Answer, Front/Back): one card.
const ASK = /^(?:q|question|front)\s*:\s*(.+)$/i;
const ANSWER = /^(?:a|answer|back)\s*:\s*(.+)$/i;

const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function readMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];
  let skipped = 0;
  let title = '';
  let section = null; // { term, para: [], paraDone, hasCards }

  let lastListCard = null; // the card a following indented sub-bullet adds to
  let inMarkdownBlock = false;

  const closeSection = () => {
    if (section && section.para.length) {
      const card = section.hasCards ? null : pair(section.term, section.para.join(' '));
      if (card) cards.push(card);
      else skipped += section.para.length;
    }
    section = null;
  };
  // Cards are about to appear under the current heading. If the heading already has its own
  // paragraph, it is a card of its own (emitted first, keeping file order); if not, it is
  // just a label over the cards that follow.
  const cardsFollow = () => {
    if (!section) return;
    if (section.para.length) closeSection();
    else section.hasCards = true;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      // a markdown block (an AI reply's way of wrapping notes) is read like the rest; others are code
      if (inMarkdownBlock) { inMarkdownBlock = false; continue; }
      if (/^(markdown|md)$/i.test(trimmed.slice(3).trim())) { inMarkdownBlock = true; continue; }
      const fence = trimmed.slice(0, 3);
      let close = i + 1;
      while (close < lines.length && !lines[close].trim().startsWith(fence)) close++;
      if (close < lines.length) i = close; // skip the whole code block
      else skipped += 1; // never closed: a stray fence; read on rather than lose the rest of the file
      continue;
    }
    if (!trimmed) {
      if (section && section.para.length) section.paraDone = true;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) || trimmed.startsWith('<!--')) continue;

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeSection();
      lastListCard = null;
      const level = heading[1].length;
      if (level === 1 && !title) title = strip(heading[2]);
      else if (level >= 2 && level <= 4) section = { term: strip(heading[2]), para: [], paraDone: false, hasCards: false };
      continue;
    }

    const outer = trimmed.startsWith('|');
    // a table may leave out the outer pipes; then the divider row under its header gives it away
    const bare = !outer && trimmed.includes('|') && TABLE_RULE.test((lines[i + 1] || '').trim());
    if (outer || bare) {
      const inTable = (l) => (outer ? l.trim().startsWith('|') : l.trim() !== '' && l.includes('|'));
      const block = [];
      while (i < lines.length && inTable(lines[i])) block.push(lines[i++].trim());
      i--;
      const hasRule = block.length > 1 && TABLE_RULE.test(block[1]);
      const header = hasRule ? headerColumns(tableCells(block[0])) : null;
      const cols = header || { term: 0, def: 1 };
      cardsFollow();
      lastListCard = null;
      for (const row of hasRule ? block.slice(2) : block) {
        const cells = tableCells(row);
        const card = pair(cells[cols.term], cells[cols.def]);
        if (card) cards.push(card);
        else skipped += 1;
      }
      continue;
    }

    // An indented sub-bullet belongs to the card above it, not a card of its own.
    if (lastListCard && INDENTED_ITEM.test(line)) {
      const extra = line.replace(LIST_MARKER, '');
      if (extra.length <= MAX_FIELD && strip(extra)) {
        lastListCard.definition += '; ' + strip(extra);
        continue;
      }
    }

    const ask = trimmed.length <= MAX_FIELD ? strip(trimmed).match(ASK) : null;
    if (ask) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = j < lines.length && lines[j].trim().length <= MAX_FIELD ? strip(lines[j].trim()).match(ANSWER) : null;
      if (next) {
        cardsFollow();
        const qa = pair(ask[1], next[1]);
        if (qa) cards.push(qa);
        else skipped += 1;
        lastListCard = null;
        i = j;
        continue;
      }
    }

    const card = lineCard(line);
    if (card) {
      cardsFollow();
      cards.push(card);
      lastListCard = LIST_MARKER.test(line) && !INDENTED_ITEM.test(line) ? card : null;
    } else if (section && !section.paraDone && !LIST_MARKER.test(line)) {
      section.para.push(trimmed);
      lastListCard = null;
    } else {
      skipped += 1;
      lastListCard = null;
    }
  }
  closeSection();
  return { title, cards, skipped };
}
