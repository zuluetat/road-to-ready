// Code in card and question text: `inline` spans and ```fenced``` blocks, so a reading card can show
// a real snippet. Text without backticks is one plain part, so every other card reads as before.
// Anything unclosed stays plain text, never guessed at.

const FENCE = /```[a-z]*\n([\s\S]*?)\n?```/g;
const INLINE = /`([^`\n]+)`/g;

// codeParts(text) -> [{ kind: 'text' | 'code' | 'block', text }]
export function codeParts(text) {
  const parts = [];
  let at = 0;
  for (const m of text.matchAll(FENCE)) {
    inline(text.slice(at, m.index), parts);
    parts.push({ kind: 'block', text: m[1] });
    at = m.index + m[0].length;
  }
  inline(text.slice(at), parts);
  return parts;
}

function inline(text, parts) {
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) parts.push({ kind: 'text', text: text.slice(at, m.index) });
    parts.push({ kind: 'code', text: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
}
