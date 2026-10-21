// "Report a problem" on the public copy: a link that opens a new GitHub issue on its repo, filled in
// with where the problem is. A practice question goes by a short meaningless code, never its id
// (ids describe the question) or wording, so reading a report never shows the owner an exam question.

export const REPORT_REPO = 'zuluetat/road-to-ready';

// Six letters and digits from the question id (FNV-1a); the same id always gives the same code, so a
// report can be matched back by coding every id in the bank.
export function questionCode(id) {
  let x = 0x811c9dc5;
  for (const ch of String(id)) x = Math.imul(x ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return x.toString(36).padStart(6, '0').slice(-6);
}

export function reportUrl({ deck, card = null, question = null }) {
  const title = question ? `Practice question ${questionCode(question.id)}` : `Card: ${card.term}`;
  const body = [
    `Deck: ${deck}`,
    question ? `Question: ${question.bankId} #${questionCode(question.id)}` : null,
    card ? `Card: ${card.term} (${card.id})` : null,
    '',
    "What's wrong:",
    '',
  ].filter((line) => line !== null).join('\n');
  const q = new URLSearchParams({ title, body });
  return `https://github.com/${REPORT_REPO}/issues/new?${q}`;
}
