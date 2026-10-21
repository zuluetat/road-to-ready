// Practice exam screen: a start page (length, past scores), then questions one at a time, then a
// score by exam domain. Shorter exams are drills, with the explanation after each answer; the
// full-length exam runs under exam conditions: no feedback until you submit, with Previous, flags
// and a review list, like the real thing. The rules live in core/exam.js; this
// file only draws. Questions link to the flashcards they test through cardTerms(ref).

import { h, mount } from '../core/dom.js';
import { drawExam, shuffleOptions, isCorrect, scoreExam, examConditions, reviewList, gradeAll, kinOf } from '../core/exam.js';
import { keys, celebration, optionList, checkButton } from '../modes/common.js';
import { togglePick, ready } from '../core/choice.js';

const LENGTHS = [15, 30];

// showExam(root, { bank, record, loadRecord() -> Promise<record>, saveAttempt({ ids, results }) -> Promise<record>,
//   cardTerms(refs) -> Promise<[{ deckId, term }]>, onExit, onRound() -> Promise<{ lines, celebration } | null> })
// The record is re-read before each draw and saved through saveAttempt, so another tab's attempts
// are never overwritten. Returns the cleanup function.
export function showExam(root, { bank, record: initial, loadRecord, saveAttempt, cardTerms, onExit, onAnswered, onRound, startLength = null }) {
  let record = initial;
  const domainName = new Map(bank.exam.domains.map((d) => [d.id, d.name]));
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  let stopKeys = () => {};
  let disposed = false; // set when the route changes; async work must not draw after that

  // questions whose idea you have never met: not this question, nor any rewording of it
  const newToYou = (ids) => new Set(ids.filter((id) => ![id, ...kinOf(bank, id)].some((k) => record.seen[k] > 0)));

  function startPage() {
    stopKeys();
    const lengths = [...LENGTHS.filter((n) => n < bank.exam.length), bank.exam.length]
      .filter((n) => n <= bank.questions.length);
    const recent = record.attempts.slice(-5).reverse();
    mount(root,
      h('header', { class: 'page-head' },
        h('button', { class: 'link', type: 'button', onclick: onExit }, '← All decks'),
        h('h1', {}, bank.title),
        bank.note ? h('p', { class: 'muted' }, bank.note) : null,
        bank.exam.differences ? h('p', { class: 'muted' }, bank.exam.differences) : null),
      h('section', { class: 'panel' },
        h('h2', {}, 'Start a practice exam'),
        h('p', { class: 'muted' }, `${bank.questions.length} questions in the bank. Each exam draws by domain weight, `
          + 'questions you have seen least first, with the answers in a new order. Shorter exams show the explanation after each answer; '
          + 'the full exam runs like the real one, with no feedback until you submit. '
          + 'Questions you met as Learn scenarios count as seen, and your score on familiar questions runs high, so the score screen also shows how you did on questions new to you.'),
        h('div', { class: 'actions' }, lengths.map((n, i) => h('button', {
          class: i === lengths.length - 1 ? 'primary' : null, type: 'button', onclick: () => begin(n),
        }, n === bank.exam.length ? `Full exam (${n}) · exam conditions` : `${n} questions`)))),
      h('section', { class: 'panel' },
        h('h2', {}, 'Domains'),
        h('ul', { class: 'missed' }, bank.exam.domains.map((d) => h('li', {}, h('strong', {}, d.name), h('span', {}, `${d.weight}% of the exam`))))),
      recent.length ? h('section', { class: 'panel' },
        h('h2', {}, 'Recent attempts'),
        h('table', { class: 'history' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Questions'), h('th', {}, 'Score'))),
          h('tbody', {}, recent.map((a) => h('tr', {},
            h('td', {}, a.date), h('td', {}, String(a.length)), h('td', {}, `${a.right}/${a.length} (${a.percent}%)`)))))) : null);
    root.querySelector('.actions .primary')?.focus();
  }

  async function begin(length) {
    record = await loadRecord();
    if (disposed) return;
    if (examConditions(bank, length)) runConditions(length); else run(length);
  }

  // fixedIds: retake exactly these questions (the ones just missed) instead of a new draw
  function run(length, fixedIds = null) {
    const ids = fixedIds ? [...fixedIds] : drawExam(bank, { length, seen: record.seen });
    // questions never shown before (not in Learn, not in an exam): the honest readiness measure
    const fresh = newToYou(ids);
    const results = [];
    let at = 0;
    let q = null;
    let picks = [];
    let answered = false;

    function load() {
      q = shuffleOptions(byId.get(ids[at]));
      picks = [];
      answered = false;
    }

    function render() {
      const right = answered && isCorrect(q, picks);
      mount(root,
        h('header', { class: 'study-bar' },
          h('button', { class: 'link', type: 'button', onclick: () => confirmQuit() }, '← Quit'),
          h('div', { class: 'study-title' }, `Question ${at + 1} of ${ids.length}`),
          h('div', { class: 'study-status', 'aria-live': 'polite' }, `${results.filter((r) => r.correct).length} right so far`)),
        h('section', { class: 'panel question', tabindex: '-1' },
          h('p', { class: 'face-label' }, domainName.get(q.domain)),
          h('p', { class: 'stem' }, q.stem)),
        // the same as Learn and Quiz: tap selects (blue), Check answer locks it in, then green and red
        // with pills. Like the real exam, an answer can be changed until it's locked in.
        optionList({ options: q.options, picks, answer: answered ? q.answer : null, onPick: pick, whyWrong: q.whyWrong, need: q.answer.length }),
        !answered ? checkButton(picks, q.answer.length, check) : null,
        answered ? h('section', { class: 'panel explain', role: 'status' },
          h('p', {}, h('strong', {}, right ? 'Correct. ' : 'Not quite. '), q.explanation),
          h('p', { class: 'cards-line muted' }),
          h('p', { class: 'muted small' }, 'Generated practice question, checked against ', h('a', { href: q.checkedAgainst, target: '_blank', rel: 'noopener noreferrer' }, 'this AWS page'), '.'),
          h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: next }, at + 1 < ids.length ? 'Next question' : 'See my score'))) : null,
        h('p', { class: 'hint keys' }, answered ? 'Enter goes on.' : `Keys 1 to ${q.options.length} select; Enter checks.`));
      if (answered) {
        root.querySelector('.explain .primary').focus();
        linkCards(root.querySelector('.cards-line'), q.cards);
      }
    }

    async function linkCards(el, refs) {
      if (!refs.length || !el) return;
      const found = await cardTerms(refs).catch(() => []);
      if (!found.length || !el.isConnected) return;
      el.append('Flashcards: ', ...found.flatMap((c, i) => [i ? ', ' : '', h('a', { href: '#/deck/' + c.deckId, target: '_blank', rel: 'noopener', title: 'Opens in a new tab, so this exam keeps going' }, c.term)]));
    }

    function pick(i) {
      if (answered || i >= q.options.length || root.querySelector('.confirm')) return;
      const need = q.answer.length;
      const full = need > 1 && !picks.includes(i) && picks.length >= need;
      picks = togglePick(picks, i, need);
      render();
      if (full) root.querySelector('.check-row')?.prepend(h('p', { class: 'muted', role: 'status' }, `You have picked ${need}. Tap one again to un-pick it.`));
      // one answer: focus moves to Check answer; choose two: stay on the question for the second
      if (need === 1) root.querySelector('.check-row .primary')?.focus({ preventScroll: true });
      else root.querySelector('.question').focus({ preventScroll: true });
    }

    function check() {
      if (answered || !ready(picks, q.answer.length)) return;
      answered = true;
      results.push({ id: q.id, correct: isCorrect(q, picks), chose: picks.map((x) => q.options[x]) });
      onAnswered?.(q.id, results.at(-1).correct); // logged as given, so a quit exam still counts
      render();
    }

    function next() {
      at += 1;
      if (at >= ids.length) return finish();
      load();
      render();
      root.querySelector('.question').focus({ preventScroll: true }); // not an option: a fast second Enter must not answer
    }

    function closeConfirm() {
      root.querySelector('.confirm')?.remove();
      root.querySelector('.question')?.focus({ preventScroll: true });
    }

    function confirmQuit() {
      const bar = root.querySelector('.study-bar');
      if (root.querySelector('.confirm')) return;
      bar.after(h('div', { class: 'confirm panel', role: 'alertdialog', 'aria-label': 'Quit exam' },
        h('p', {}, results.length ? `Quit now? The ${results.length} answered so far are not saved as an attempt.` : 'Quit this exam?'),
        h('button', { class: 'danger', type: 'button', onclick: startPage }, 'Quit'),
        h('button', { type: 'button', onclick: closeConfirm }, 'Keep going')));
      root.querySelector('.confirm .danger').focus();
    }

    async function finish() {
      stopKeys();
      await showResults({ ids, results, fresh, length });
    }

    stopKeys();
    stopKeys = keys((e) => {
      if (root.querySelector('.confirm')) { if (e.key === 'Escape') closeConfirm(); return; }
      const n = Number(e.key);
      if (!answered && n >= 1 && n <= q.options.length) { e.preventDefault(); pick(n - 1); }
      else if (e.key === 'Enter') {
        // With enough picked, Enter checks, even from an option, instead of un-picking it.
        if (!answered && ready(picks, q.answer.length) && !e.target.closest('a, button:not(.option)')) {
          e.preventDefault(); check();
        } else if (answered && !e.target.closest('button, a')) { e.preventDefault(); next(); }
      }
    });
    load();
    render();
    root.querySelector('.question').focus({ preventScroll: true });
  }

  // The score screen, for drills and the full exam alike.
  async function showResults({ ids, results, fresh, length }) {
    record = await saveAttempt({ ids, results });
    if (disposed) return;
    const s = scoreExam(bank, results);
    const missedResults = results.filter((r) => !r.correct);
    const missed = missedResults.map((r) => byId.get(r.id));
    mount(root,
      h('header', { class: 'study-bar' },
        h('button', { class: 'link', type: 'button', onclick: startPage }, '← Practice exam'),
        h('div', { class: 'study-title' }, 'Score')),
      h('section', { class: 'panel end' },
        h('h2', {}, `${s.right} of ${s.total} right (${s.percent}%)`),
        freshLine(results, fresh),
        h('p', { class: 'muted' }, 'The real exam reports a scaled score from 100 to 1,000 and passes at 700. There is no exact percent conversion, so use this to find weak domains, not to predict a pass.'),
        h('table', { class: 'history' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Domain'), h('th', {}, 'Right'), h('th', {}, ''))),
          h('tbody', {}, s.byDomain.map((d) => h('tr', {},
            h('td', {}, d.name),
            h('td', {}, `${d.right}/${d.total} (${d.percent}%)`),
            h('td', { class: 'bar-cell' }, h('span', { class: 'meter', role: 'img', 'aria-label': `${d.percent} percent` },
              h('span', { class: 'meter-fill', style: { width: `${d.percent}%` } }))))))),
        missed.length ? [
          h('h3', {}, 'Missed'),
          h('ul', { class: 'missed' }, missed.map((m, i) => h('li', {},
            h('details', {},
              h('summary', {}, h('strong', {}, m.stem)),
              missedResults[i].chose ? h('p', {}, h('span', { class: 'pill pill-wrong' }, '✗ Your answer'), ' ',
                missedResults[i].chose.length ? missedResults[i].chose.join(' · ') : 'none') : null,
              h('p', {}, h('span', { class: 'pill pill-correct' }, '✓ Correct'), ' ', m.answer.map((a) => m.options[a]).join(' · ')),
              h('p', { class: 'muted' }, m.explanation))))),
        ] : null,
        h('div', { class: 'actions' },
          missed.length ? h('button', { class: 'primary', type: 'button', onclick: () => run(missed.length, missed.map((m) => m.id)) },
            `Retry the ${missed.length} I missed`) : null,
          h('button', { class: missed.length ? null : 'primary', type: 'button', onclick: () => begin(length) }, `Another ${length}-question exam`),
          h('button', { type: 'button', onclick: startPage }, 'Back'))));
    root.querySelector('.end .primary').focus({ preventScroll: true });
    window.scrollTo(0, 0);
    // a finished exam counts as a round: today's goal, the streak and the points
    const end = root.querySelector('.end');
    onRound?.().then((got) => {
      if (!got || disposed || !end.isConnected) return;
      end.querySelector('h2').after(h('div', { class: 'today-line', role: 'status' }, got.lines.map((l) => h('p', {}, l))));
      if (got.celebration) end.prepend(celebration(got.celebration));
    }, () => {});
  }

  // The full-length exam under exam conditions: select and move on, nothing marked until you
  // submit. Previous and flags as on the real exam; a review list before submitting. Answers count
  // toward readiness only when submitted; quitting saves nothing.
  function runConditions(length) {
    const ids = drawExam(bank, { length, seen: record.seen });
    const fresh = newToYou(ids);
    const qs = ids.map((id) => shuffleOptions(byId.get(id))); // one order per question, kept when you go back
    const picks = qs.map(() => []);
    const flagged = new Set();
    let at = 0;
    let reviewing = false;

    const bar = (title, status) => h('header', { class: 'study-bar' },
      h('button', { class: 'link', type: 'button', onclick: () => confirmQuit() }, '← Quit'),
      h('div', { class: 'study-title' }, title),
      h('div', { class: 'study-status', 'aria-live': 'polite' }, status));

    function render() {
      if (reviewing) return renderReview();
      const q = qs[at];
      const done = reviewList(qs, picks, flagged).answered;
      const last = at + 1 === qs.length;
      mount(root,
        bar(`Question ${at + 1} of ${qs.length}`, `${done} answered`),
        h('section', { class: 'panel question', tabindex: '-1' },
          h('p', { class: 'face-label' }, domainName.get(q.domain) + (q.answer.length > 1 ? ` · choose ${q.answer.length}` : '')),
          h('p', { class: 'stem' }, q.stem)),
        optionList({ options: q.options, picks: picks[at], answer: null, onPick: pick, need: q.answer.length }),
        h('div', { class: 'actions exam-nav' },
          h('button', { type: 'button', disabled: at === 0, onclick: () => go(at - 1) }, '← Previous'),
          h('button', { type: 'button', class: 'flag' + (flagged.has(at) ? ' on' : ''), 'aria-pressed': String(flagged.has(at)), onclick: toggleFlag },
            flagged.has(at) ? '⚑ Flagged' : '⚐ Flag for review'),
          h('button', { class: 'primary', type: 'button', onclick: () => (last ? openReview() : go(at + 1)) }, last ? 'Review answers' : 'Next')),
        h('p', { class: 'hint keys' }, `Keys 1 to ${q.options.length} select; Enter goes on. Nothing is marked until you submit.`));
    }

    function renderReview() {
      const r = reviewList(qs, picks, flagged);
      const summary = [r.unanswered.length ? `${r.unanswered.length} unanswered` : 'Every question answered', r.flagged.length ? `${r.flagged.length} flagged` : null].filter(Boolean).join(' · ');
      mount(root,
        bar('Review', `${r.answered} of ${qs.length} answered`),
        h('section', { class: 'panel review' },
          h('h2', {}, 'Review your answers'),
          h('p', { class: 'muted' }, `${summary}. Tap a number to go back to it.`),
          h('ol', { class: 'review-grid' }, r.items.map((x) => h('li', {},
            h('button', {
              type: 'button', class: 'review-item' + (x.answered ? ' answered' : '') + (x.flagged ? ' flagged' : ''),
              'aria-label': `Question ${x.n}: ${x.answered ? 'answered' : 'unanswered'}${x.flagged ? ', flagged' : ''}`,
              onclick: () => { reviewing = false; go(x.n - 1); },
            }, String(x.n), x.flagged ? h('span', { 'aria-hidden': 'true' }, '⚑') : null)))),
          h('div', { class: 'actions' },
            h('button', { class: 'primary', type: 'button', onclick: confirmSubmit }, 'Submit exam'),
            h('button', { type: 'button', onclick: () => { reviewing = false; go(qs.length - 1); } }, 'Back to the questions'))));
      root.querySelector('.review .primary').focus({ preventScroll: true });
    }

    function go(i) {
      at = i;
      render();
      root.querySelector('.question')?.focus({ preventScroll: true });
    }

    function openReview() {
      reviewing = true;
      render();
    }

    function pick(i) {
      const q = qs[at];
      if (i >= q.options.length || root.querySelector('.confirm')) return;
      picks[at] = togglePick(picks[at], i, q.answer.length);
      render();
      root.querySelector('.question').focus({ preventScroll: true });
    }

    function toggleFlag() {
      if (flagged.has(at)) flagged.delete(at); else flagged.add(at);
      render();
      root.querySelector('.exam-nav .flag')?.focus({ preventScroll: true });
    }

    function closeConfirm() {
      root.querySelector('.confirm')?.remove();
      const actions = root.querySelector('.review .actions');
      if (actions) actions.hidden = false;
      root.querySelector('.question, .review .primary')?.focus({ preventScroll: true });
    }

    function confirmQuit() {
      if (root.querySelector('.confirm')) return;
      root.querySelector('.study-bar').after(h('div', { class: 'confirm panel', role: 'alertdialog', 'aria-label': 'Quit exam' },
        h('p', {}, 'Quit now? Your answers aren\'t marked or counted.'),
        h('button', { class: 'danger', type: 'button', onclick: startPage }, 'Quit'),
        h('button', { type: 'button', onclick: closeConfirm }, 'Keep going')));
      root.querySelector('.confirm .danger').focus();
    }

    function confirmSubmit() {
      const r = reviewList(qs, picks, flagged);
      if (!r.unanswered.length) return submit();
      if (root.querySelector('.confirm')) return;
      const actions = root.querySelector('.review .actions');
      actions.hidden = true; // one Submit at a time: the question's own buttons stand in
      actions.before(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Submit exam' },
        h('p', {}, `${r.unanswered.length} question${r.unanswered.length === 1 ? ' is' : 's are'} unanswered and will count as wrong. Submit anyway?`),
        h('button', { class: 'primary', type: 'button', onclick: submit }, 'Submit exam'),
        h('button', { type: 'button', onclick: closeConfirm }, 'Keep going')));
      root.querySelector('.confirm .primary').focus();
    }

    async function submit() {
      stopKeys();
      const results = gradeAll(qs, picks);
      // the answers given count as readiness evidence now, all at once
      results.forEach((r, i) => { if (picks[i].length) onAnswered?.(r.id, r.correct); });
      await showResults({ ids, results, fresh, length });
    }

    stopKeys();
    stopKeys = keys((e) => {
      if (root.querySelector('.confirm')) { if (e.key === 'Escape') closeConfirm(); return; }
      if (reviewing) return;
      const n = Number(e.key);
      if (n >= 1 && n <= qs[at].options.length) { e.preventDefault(); pick(n - 1); }
      else if (e.key === 'Enter' && !e.target.closest('a, button:not(.option)')) {
        e.preventDefault();
        if (at + 1 < qs.length) go(at + 1); else openReview();
      }
    });
    go(0);
  }

  if (startLength) begin(Math.min(startLength, bank.questions.length)); else startPage();
  return () => { disposed = true; stopKeys(); };
}

// How you did on questions you had never seen; familiar ones (from Learn or earlier exams) flatter.
function freshLine(results, fresh) {
  const mine = results.filter((r) => fresh.has(r.id));
  if (mine.length === results.length) return null; // all new: the main score already is this
  if (!mine.length) {
    return h('p', { class: 'big' }, 'Every question here was one you had seen before, in Learn or an earlier exam, so this score runs high.');
  }
  const right = mine.filter((r) => r.correct).length;
  return h('p', { class: 'big' }, `On the ${mine.length} questions new to you: ${right} right (${Math.round((right / mine.length) * 100)}%). That is the better guide to readiness.`);
}
