// App shell: the deck library, the deck screen, backups, and starting study sessions.
// Everything deck- or subject-specific comes from data/; nothing here knows what is being studied.

import { h, mount, download, localToday, tip } from './core/dom.js';
import { createLocalStorage } from './adapters/storage.js';
import { createDecks } from './adapters/decks.js';
import { createSync, createLocalSync } from './adapters/sync.js';
import { mergeProgress, mergeExam, normaliseRecord } from './core/sync.js';
import { showUpload } from './screens/upload.js';
import { showExam } from './screens/exam.js';
import { showPlan } from './screens/plan.js';
import { showCheck } from './screens/check.js';
import { groupLibrary, collectionOf } from './core/library.js';
import { vocabulary } from './core/vocab.js';
import { studyPlan, nudgeAfter } from './core/readiness.js';
import { journeyFor, PHASES } from './core/journey.js';
import { examFit } from './core/exam-fit.js';
import { migrateGame, recordRound, todayStatus, describeToday, afterRound, setSettings, recordPoints, latestPoints, planSentence, markStepBase, GOALS, MARGINS } from './core/game.js';
import { roadToReady, pointsChange, weekView, pointsBadge, MARGIN_NAMES } from './core/road.js';
import { celebrationFor } from './core/celebrate.js';
import { recordCheck, calibrationOf, weakAreas, verdictFor } from './core/check.js';
import { migrateExam, recordAttempt, questionsByCard, recordAnswer, kinOf } from './core/exam.js';
import { currentUser } from './adapters/identity.js';
import { readCollapsed, setCollapsed } from './core/collapse.js';
import { borrowedCards, cardState } from './core/also.js';
import { showDeckGuide } from './screens/deck-guide.js';
import { handover, greeting, versionText, initial, isLocalCopy, resetAllProgress } from './core/account.js';
import { modeById } from './modes/index.js';
import { createSession } from './core/session.js';
import {
  migrate, applyResult, weakest, passStatus, dueCards, retakeIds,
} from './core/progress.js';
import { learnStatus, resetLearn, deckMeter, LEARNED } from './core/learn.js';
import { toCsv, toQuizletText, makeBackup, parseBackup } from './core/formats.js';

const root = document.getElementById('app');
const storage = createLocalStorage('study:v1:', {
  onWriteError: () => showWarning('This browser stopped saving progress (storage is full or blocked). '
    + 'Keep studying, but download a backup from the home screen before you close this page.'),
});
// the public copy: no server or sign-in, everything stays in this browser
const LOCAL = isLocalCopy(document);
const decks = createDecks({ base: 'data/', storage, ...(LOCAL ? { api: null } : {}) });
const sync = LOCAL ? createLocalSync({ storage }) : createSync({ storage });
const SYNC_NOTE = {
  offline: 'You\'re offline. Progress is saved on this device and syncs when you\'re back.',
  rejected: 'Some progress couldn\'t be saved to the server. It\'s still on this device and will be tried again.',
  'signed-out': 'Your sign-in has expired, so progress isn\'t syncing. Reload the page to sign in again; nothing is lost.',
  unavailable: 'Progress sync is unavailable right now. It\'s saved on this device and will try again.',
};
let cleanup = () => {};
// this browser's own small preferences (folded sets); null when storage is blocked
const prefs = () => { try { return window.localStorage; } catch { return null; } };
let siteTitle = document.title || 'Study'; // the page's own name until the index says otherwise
let studying = null; // deck id of the session on screen, or exam:<bankId> during a practice exam
// During a study session the top bar steps aside, so the round has the whole screen.
function setStudying(v) {
  studying = v;
  document.body.classList.toggle('in-session', Boolean(v));
}

// ⓘ tips and the account menu: closed by a tap anywhere else; tips and kept inside the screen on a phone.
document.addEventListener('click', (e) => {
  for (const t of document.querySelectorAll('details.tip[open], details.menu[open]')) if (!t.contains(e.target)) t.open = false;
});
document.addEventListener('toggle', (e) => {
  const t = e.target;
  if (!t.matches?.('details.tip') || !t.open) return;
  const box = t.querySelector('.tip-text');
  box.style.marginLeft = '0px';
  const r = box.getBoundingClientRect();
  const gap = 12;
  if (r.left < gap) box.style.marginLeft = `${gap - r.left}px`;
  else if (r.right > window.innerWidth - gap) box.style.marginLeft = `${window.innerWidth - gap - r.right}px`;
}, true);

// Ask the browser not to clear saved data on its own (Safari otherwise may, after weeks unused).
navigator.storage?.persist?.().catch(() => {});

function showWarning(text) {
  let el = document.getElementById('storage-warning');
  if (!el) {
    el = h('p', { id: 'storage-warning', class: 'flash warn', role: 'alert' });
    root.before(el);
  }
  el.textContent = text;
}

// Another tab saved progress: drop this tab's copy rather than overwrite the newer one later.
// Saves arrive in bursts, so redraw once after they settle, keeping any notice for the redraw.
let notice = null;
let refreshTimer = null;
window.addEventListener('storage', (e) => {
  if (!e.key || !e.key.startsWith('study:v1:progress:')) return;
  const deckId = e.key.slice('study:v1:progress:'.length);
  if (studying && studying !== deckId) return;
  if (studying === deckId) {
    cleanup();
    cleanup = () => {};
    setStudying(null);
    notice = 'This deck was studied in another tab, so this session stopped to keep that progress. Pick up from here.';
  }
  clearTimeout(refreshTimer);
  // A session started meanwhile already loaded the newer progress; don't tear it down.
  refreshTimer = setTimeout(() => { if (!studying) route(); }, 150);
});

// The notice survives refreshes caused by the other tab's later saves; it clears when you move on.
function takeNotice() {
  return notice;
}

const progressKey = (deckId) => 'progress:' + deckId;
const loadProgress = async (deckId) => migrate(await storage.get(progressKey(deckId)), deckId);
// Every save is stamped, written here at once, and pushed to your other devices a moment later.
let pushTimer = null;
function queuePush(key) {
  sync.markDirty(key);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync.flush(), 2000);
}
// A save merges with what is stored rather than replacing it, so a screen holding an older copy
// (a session started before a pull landed, another tab) can't undo progress that arrived since.
const saveProgress = async (p) => {
  p.updatedAt = new Date().toISOString();
  const key = progressKey(p.deckId);
  const remoteKey = 'deck:' + p.deckId;
  // through sync.update, so a save and a sync on the same deck take turns
  await sync.update(key, (stored) => (stored ? mergeProgress(normaliseRecord(remoteKey, stored), normaliseRecord(remoteKey, p)) : p));
  queuePush(key);
};
const examKey = (bankId) => 'exam:' + bankId;
const loadExamRecord = async (bankId) => migrateExam(await storage.get(examKey(bankId)), bankId);
const gameKey = (collectionId) => 'game:' + collectionId;
const loadGame = async (collectionId) => migrateGame(await storage.get(gameKey(collectionId)), collectionId);
// Change a collection's game record (a finished round, a setting) and send it to your other devices.
async function updateGame(collectionId, fn) {
  const game = await sync.update(gameKey(collectionId), (stored) => {
    const g = migrateGame(stored, collectionId);
    fn(g);
    g.updatedAt = new Date().toISOString();
    return g;
  });
  queuePush(gameKey(collectionId));
  return game;
}
// Road-to-ready points for a collection's study plan (planFor) and game record.
const roadFor = (got, game) => roadToReady({
  plan: got.plan, passShare: got.bank.exam.passShare ?? 0.7, margin: game.settings.margin, calibration: calibrationOf(game),
});

// A finished round counts toward its collection's streak and daily goal, and moves its points
// -> { status, change, celebration } (change is null for a collection without a practice exam), or null.
async function countRound(collectionId) {
  if (!collectionId) return null;
  const collection = (await decks.loadCollections()).collections.find((c) => c.id === collectionId);
  const got = collection ? await planFor(collection) : null;
  let change = null;
  let before = null;
  let phases = {};
  const game = await updateGame(collectionId, (g) => {
    before = todayStatus(g, localToday());
    recordRound(g, localToday());
    if (!got) return;
    markStepBase(g, new Date().toISOString(), got.progress, LEARNED);
    const road = roadFor(got, g);
    const known = latestPoints(g);
    change = pointsChange(known, road);
    recordPoints(g, localToday(), new Date().toISOString(), road);
    const phaseBefore = PHASES[g.phaseReached].id;
    const phaseAfter = reachPhase(g, got);
    // a game that has never seen your progress only catches up: no level up for a phase reached long ago
    if (known) phases = { phaseBefore, phaseAfter };
  });
  const status = todayStatus(game, localToday());
  return { status, change, celebration: celebrationFor({ before, after: status, change, ...phases, phases: PHASES }) };
}
// The furthest phase on the path reached so far; it never goes back -> that phase's id.
function reachPhase(game, got) {
  game.phaseReached = Math.max(game.phaseReached, PHASES.findIndex((p) => p.id === got.journey.current));
  return PHASES[game.phaseReached].id;
}

function setTitle(...parts) {
  document.title = [...parts, siteTitle].filter(Boolean).join(' · ');
}

// ---------- library ----------

async function showLibrary(message) {
  const index = await decks.loadIndex();
  siteTitle = index.siteTitle || 'Study';
  setTitle();
  const today = localToday();

  // One broken deck file must not hide the others, or the backup buttons.
  const rows = await Promise.all(index.decks.map(async (entry) => {
    let deck;
    let p;
    try {
      [deck, p] = await Promise.all([decks.loadDeck(entry.id), loadProgress(entry.id)]);
    } catch (err) {
      return h('li', { 'data-id': entry.id, 'data-source': entry.source, 'data-name': String(entry.title || entry.id).toLowerCase() }, h('div', { class: 'deck-tile' },
        h('span', { class: 'deck-name' }, entry.title || entry.id),
        h('span', { class: 'deck-meta' }, `Could not load this deck: ${err.message}`)));
    }
    const ids = deck.cards.map((c) => c.id);
    const status = passStatus(p, ids);
    const due = ids.filter((id) => p.cards[id] && p.cards[id].due <= today).length;
    const retakes = retakeIds(p, ids).length;
    const meter = deckMeter(p, ids);
    return h('li', { 'data-id': entry.id, 'data-source': entry.source, 'data-name': deck.title.toLowerCase() },
      h('div', { class: 'deck-row' },
        h('a', { class: 'deck-tile', href: '#/deck/' + entry.id },
          h('span', { class: 'deck-name' }, deck.title),
          h('span', { class: 'meter', role: 'img', 'aria-label': `${meter.percent} percent ${meter.measure}` },
            h('span', { class: 'meter-fill', style: { width: `${meter.percent}%` } })),
          h('span', { class: 'deck-meta' },
            `${meter.text} · `,
            status.targetReached ? 'Target reached' : `Pass ${status.number} of ${status.target}`,
            due ? ` · ${due} due` : '',
            retakes ? ` · ${retakes} to retake` : '')),
        h('a', { class: 'flip', href: '#/flip/' + entry.id, 'aria-label': `Flip through ${deck.title}` }, 'Flip')));
  }));

  // Collections first: why each group of decks is being studied; then everything else.
  const lib = groupLibrary(index);
  const rowById = new Map(rows.map((r) => [r.dataset.id, r]));
  const rowsFor = (list) => list.map((d) => rowById.get(d.id)).filter(Boolean);
  const mine = rowsFor(lib.otherDecks.filter((d) => d.source === 'uploaded'));
  const builtIn = rowsFor(lib.otherDecks.filter((d) => d.source !== 'uploaded'));
  // Each study set folds down to its badge and title; this browser remembers which are folded.
  const folded = readCollapsed(prefs());
  const collections = await Promise.all(lib.collections.map(async (c) => {
    const body = h('div', { class: 'collection-body', id: `set-${c.id}`, hidden: folded.has(c.id) || null },
      await homeCard(index.collections.find((raw) => raw.id === c.id)),
      h('ul', { class: 'deck-list' }, rowsFor(c.decks)),
      c.exams.length ? h('ul', { class: 'deck-list exam-list' }, await examItems(c.exams)) : null);
    const fold = h('button', { type: 'button', class: 'collection-fold', 'aria-expanded': String(!folded.has(c.id)), 'aria-controls': body.id,
      onclick: () => {
        const open = body.hidden;
        body.hidden = !open;
        fold.setAttribute('aria-expanded', String(open));
        setCollapsed(prefs(), c.id, !open);
      } }, c.title, h('span', { class: 'fold-mark', 'aria-hidden': 'true' }));
    return h('section', { class: 'collection', 'data-id': c.id },
      h('div', { class: 'collection-head' },
        c.badges.length ? h('div', { class: 'collection-badges' }, c.badges.map((b) => h('a', { href: b.url, target: '_blank', rel: 'noopener', title: `${b.name} on Credly` },
          h('img', { src: b.image, alt: `${b.name} badge`, width: 56, height: 56 })))) : null,
        h('h2', { class: 'collection-title' }, fold, c.purpose ? tip(c.purpose, 'Why these decks') : null)),
      body);
  }));
  const uploadsNote = {
    cached: 'Showing your uploaded decks as saved on this device. The server couldn\'t be reached, so changes made elsewhere may be missing.',
    unavailable: 'Your uploaded decks aren\'t available right now. Check your connection and reload.',
    'signed-out': 'Your sign-in has expired. Reload the page to sign in again. Until then you\'re seeing this device\'s copy of your decks.',
  }[index.uploads];

  const filter = h('input', { type: 'search', id: 'deck-filter', placeholder: 'Find a deck', autocomplete: 'off',
    oninput: (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const li of rows) li.hidden = Boolean(q) && !li.dataset.name.includes(q);
      // while searching, folded sets open so matches are not hidden; clearing the search refolds them
      const stillFolded = readCollapsed(prefs());
      for (const sec of root.querySelectorAll('section.collection')) {
        sec.querySelector('.collection-body').hidden = !q && stillFolded.has(sec.dataset.id);
      }
    } });

  mount(root,
    h('header', { class: 'page-head lib-head' },
      h('h1', {}, greeting(await profileName(), siteTitle))),
    message ? h('p', { class: 'flash', role: 'status' }, message) : null,
    uploadsNote ? h('p', { class: 'flash warn', role: 'status' }, uploadsNote) : null,
    SYNC_NOTE[sync.status()] ? h('p', { class: 'flash warn', role: 'status' }, SYNC_NOTE[sync.status()]) : null,
    rows.length > 6 ? [h('label', { class: 'sr-only', for: 'deck-filter' }, 'Find a deck'), filter] : null,
    collections,
    mine.length ? [h('h2', { class: 'list-head' }, 'Your decks'), h('ul', { class: 'deck-list' }, mine)] : null,
    builtIn.length ? [h('h2', { class: 'list-head' }, mine.length || collections.length ? 'Other decks' : 'Decks'), h('ul', { class: 'deck-list' }, builtIn)] : null,
    rows.length ? null : h('p', {}, 'No decks yet. Add one from a CSV or Markdown file.'),
    lib.otherExams.length ? [h('h2', { class: 'list-head' }, 'Practice exams'), h('ul', { class: 'deck-list' }, await examItems(lib.otherExams))] : null,
    backupPanel());
}

// ---------- the home card: one main path, with points on top ----------
// Like a language app's home: your streak, today's goal and your points in one row, the path with a
// single Continue, and everything optional folded into "More ways to study".

async function homeCard(collection) {
  const got = await planFor(collection);
  let game = await loadGame(collection.id);
  const road = got ? roadFor(got, game) : null;
  // keep today's reading current (progress from another device, a changed margin), so the next
  // round's change shows only what that round did
  if (got && (!game.stepBase || latestPoints(game)?.n !== road.points || PHASES.findIndex((p) => p.id === got.journey.current) > game.phaseReached)) {
    game = await updateGame(collection.id, (g) => {
      // points per Learn step start from here: steps already climbed keep today's points as they are
      markStepBase(g, new Date().toISOString(), got.progress, LEARNED);
      recordPoints(g, localToday(), new Date().toISOString(), roadFor(got, g));
      reachPhase(g, got); // a level-up celebrates at the end of the round that earns it, not here
    });
  }
  const s = todayStatus(game, localToday());
  const d = describeToday(s);
  const fmt = (n) => n.toLocaleString('en-US');
  const ready = road && road.points >= 1000;
  // only the notes that change what you'd do today; the rest lives in the menu
  const note = s.restore || s.restored || (s.comeback && !s.ring.complete) ? d.note : null;
  const journey = got?.journey;
  const current = journey?.phases.find((p) => p.id === journey.current);
  return h('section', { class: 'panel home-card' },
    h('div', { class: 'stats' },
      h('div', { class: 'stat' },
        h('div', { class: 'ring small' + (s.ring.complete ? ' complete' : ''), role: 'img', 'aria-label': `Today: ${s.ring.done} of ${s.ring.of} rounds`,
          style: { '--fill': String(s.ring.done / s.ring.of) } }, h('span', { class: 'ring-text' }, s.ring.complete ? '✓' : `${s.ring.done}/${s.ring.of}`)),
        h('span', { class: 'stat-label' }, s.ring.complete ? 'Goal done' : 'Today')),
      h('div', { class: 'stat' },
        h('strong', { class: 'stat-big' + (s.streak ? ' streak-on' : '') }, String(s.streak)),
        h('span', { class: 'stat-label' }, s.streak === 1 ? 'day streak' : 'day streak')),
      road ? h('div', { class: 'stat stat-points' },
        h('strong', { class: 'stat-big' }, fmt(road.points)),
        h('span', { class: 'stat-label' }, 'of 1,000 points'),
        h('span', { class: 'meter', role: 'img', 'aria-label': `${road.points} of 1,000 points to ready` },
          h('span', { class: 'meter-fill', style: { width: `${road.points / 10}%` } }))) : null),
    note ? h('p', { class: 'home-note' }, note) : null,
    journey ? [
      h('ol', { class: 'tracker', 'aria-label': 'Your path to exam day' }, journey.phases.map((p, i) => h('li', {
        class: 'stop' + (p.done ? ' done' : '') + (p.id === journey.current ? ' current' : ''),
        'aria-current': p.id === journey.current ? 'step' : null,
      },
        h('span', { class: 'stop-dot', 'aria-hidden': 'true' }, p.done ? '✓' : String(i + 1)),
        h('span', { class: 'stop-label' }, p.label),
        h('span', { class: 'meter', role: 'img', 'aria-label': `${p.label}: ${Math.round(p.progress * 100)} percent` },
          h('span', { class: 'meter-fill', style: { width: `${Math.round(p.progress * 100)}%` } }))))),
      h('p', { class: 'journey-now' }, h('strong', {}, current.label), ` · ${current.detail}`, tip(`${current.goal}. Continue starts the next step; everything else is under More ways to study.`)),
      h('div', { class: 'actions' },
        ready ? h('a', { class: 'button primary-label', href: `#/check/${collection.id}` }, 'Level up: take the official check') : null,
        h('button', { class: ready ? null : 'primary', type: 'button', onclick: () => continueJourney(got) }, continueLabel(got))),
    ] : null,
    moreMenu(collection, got, game, road));
}

// Everything optional, folded away: like the extra-practice menu under a main path.
function moreMenu(collection, got, game, road) {
  const fmt = (n) => n.toLocaleString('en-US');
  const save = (changes) => updateGame(collection.id, (g) => setSettings(g, changes, new Date().toISOString())).then(() => showLibrary());
  const goal = h('select', { id: `goal-${collection.id}`, onchange: (e) => save({ goal: Number(e.target.value) }) },
    GOALS.map((n) => h('option', { value: String(n), selected: n === game.settings.goal }, `${n} round${n === 1 ? '' : 's'} a day`)));
  const margin = h('select', { id: `margin-${collection.id}`, onchange: (e) => save({ margin: e.target.value }) },
    MARGINS.map((m) => h('option', { value: m, selected: m === game.settings.margin }, MARGIN_NAMES[m])));
  const week = weekView(game, localToday());
  const last = game.checks.at(-1);
  const result = last && { pass: 'passed comfortably', close: 'passed, but only just', miss: 'didn\'t pass yet' }[last.result];
  return h('details', { class: 'more' },
    h('summary', {}, 'More ways to study'),
    got ? h('div', { class: 'more-section' },
      h('h3', {}, 'Study next', tip('Ranked by share of the exam × how far you are from ready; Continue follows it. Readiness comes from your recent answers to practice questions (ones seen before count half), scaled by how much of the area you have covered.')),
      studyNextTable(got)) : null,
    got ? h('div', { class: 'more-section' },
      h('h3', {}, 'What each phase offers', tip('Nothing is locked: use any of these whenever you like. Each deck page groups its options the same way.')),
      h('ul', { class: 'missed' }, got.journey.phases.map((p) => h('li', { class: p.id === got.journey.current ? 'phase-here' : null },
        h('strong', {}, `${p.label}${p.id === got.journey.current ? ' · you\'re here' : ''}`),
        h('span', {}, `${p.goal}. ${p.options.map((o) => OPTION_NAMES[o]).join(', ')}.`)))),
    ) : null,
    got ? fitPanel(got) : null,
    road ? h('div', { class: 'more-section' },
      h('h3', {}, 'Points', tip(`1,000 means ready to book: passing with ${MARGIN_NAMES[game.settings.margin].toLowerCase()}. Points come from your recent practice, so they can go down as well as up.`)),
      h('p', {}, (week.thisWeek ? `This week: ${week.thisWeek > 0 ? '+' : '−'}${fmt(Math.abs(week.thisWeek))} points` : 'This week: no change yet')
        + (week.average === null ? '' : ` · 4-week average: ${week.average >= 0 ? '+' : '−'}${fmt(Math.abs(week.average))}`)),
      h('p', {}, last ? `Last official check (${last.at.slice(0, 10)}): ${result}. ` : '',
        h('a', { class: 'link', href: `#/check/${collection.id}` }, 'Took an official practice exam? Report it'))) : null,
    h('div', { class: 'more-section settings-row' },
      h('h3', {}, 'Your plan'),
      h('label', { for: `goal-${collection.id}` }, 'Daily goal'), goal,
      road ? [h('label', { for: `margin-${collection.id}` }, 'Margin'), margin] : null,
      h('p', { class: 'muted' }, game.settings.cue ? planSentence(game.settings) + ' ' : 'One round a day keeps your streak. ',
        h('a', { class: 'link', href: `#/plan/${collection.id}` }, game.settings.cue ? 'Change' : 'Pick when you\'ll study'))));
}

// ---------- where to study next ----------

// Every practice-question answer, as it is given (exam or Learn scenario): readiness evidence.
function logPracticeAnswer(bankId, questionId, correct) {
  // its rewordings, so a first answer to a reworded question counts as familiar, not new
  const kin = decks.loadExam(bankId).then((bank) => kinOf(bank, questionId), () => []);
  return kin.then((k) => sync.update(examKey(bankId), (stored) => {
    const rec = migrateExam(stored, bankId);
    recordAnswer(rec, questionId, correct, new Date().toISOString(), { kin: k });
    rec.updatedAt = new Date().toISOString();
    return rec;
  })).then(() => queuePush(examKey(bankId)), () => {});
}

// The study plan for a collection with a practice exam: readiness and priority per exam domain.
// Null when the collection has no exam or anything fails to load (the panel just doesn't show).
async function planFor(collection) {
  const bankId = (collection.exams || [])[0];
  if (!bankId) return null;
  try {
    const bank = await decks.loadExam(bankId);
    const list = await Promise.all((collection.decks || []).map((id) => decks.loadDeck(id).catch(() => null)));
    const present = list.filter(Boolean);
    const progress = Object.fromEntries(await Promise.all(present.map(async (d) => [d.id, await loadProgress(d.id)])));
    const record = await loadExamRecord(bankId);
    const game = await loadGame(collection.id);
    const plan = studyPlan({ bank, decks: present, progress, record, foundations: collection.foundations || [], weak: weakAreas(game), stepBase: game.stepBase?.cards ?? null });
    const journey = journeyFor({ bank, decks: present, progress, record, plan });
    return { plan, journey, bankId, bank, record, decks: present, progress, titles: Object.fromEntries(present.map((d) => [d.id, d.title])) };
  } catch {
    return null;
  }
}

const pct = (x) => `${Math.round(x * 100)}%`;

// ---------- the path to exam day (pizza tracker) ----------

const OPTION_NAMES = {
  learn: 'Learn rounds', flashcards: 'Flashcards', match: 'Match', 'exam-short': 'Short practice exams (15 or 30)',
  quiz: 'Quiz', retake: 'Retake missed cards', 'study-next': '"Study next" advice', 'exam-full': 'Full practice exam',
  review: 'Spaced review', pass: 'Full passes through a deck',
};

// What Continue does: the obvious next step for the phase you're in.
async function continueJourney(got) {
  if (got.plan.domains.some((d) => d.weak) && got.plan.next?.deckId) return startStudy(await decks.loadDeck(got.plan.next.deckId), 'learn', 'learn');
  const next = got.journey.next;
  if (next.kind === 'learn' && next.deckId) return startStudy(await decks.loadDeck(next.deckId), 'learn', 'learn');
  if (next.kind === 'exam') return navigate(`#/exam/${got.bankId}/${next.length}`);
  // keep it fresh: spaced review on the deck with the most cards due
  const today = localToday();
  const due = (d) => d.cards.filter((c) => got.progress[d.id]?.cards?.[c.id]?.due <= today).length;
  const deck = [...got.decks].sort((a, b) => due(b) - due(a))[0];
  if (deck) return startStudy(deck, 'flashcards', 'review');
  return null;
}

// Continue: the next step on the path. After an official check marks an area weak, it goes there first.
function continueLabel(got) {
  const { journey, titles } = got;
  if (got.plan.domains.some((d) => d.weak) && got.plan.next?.deckId) return `Continue: Learn ${titles[got.plan.next.deckId]}`;
  return {
    learn: () => `Continue: Learn ${titles[journey.next.deckId] || ''}`.trim(),
    exam: () => `Continue: ${journey.next.length}-question practice exam`,
    review: () => 'Continue: spaced review',
  }[journey.next.kind]();
}

// For a bank shared by several candidate exams: which one you look closer to passing.
function fitPanel({ bank, record }) {
  const fit = examFit({ bank, record });
  if (!fit) return null;
  const pick = fit.targets.find((t) => t.id === fit.pick);
  const total = (record?.log || []).filter((x) => bank.questions.some((q) => q.id === x.q)).length;
  return h('details', { class: 'exam-fit' },
    h('summary', {}, pick
      ? ['Which exam: ', h('strong', {}, pick.short), ' looks quicker to pass']
      : `Which exam: too early to tell (${Math.max(0, 15 - total)} more practice answers)`,
    tip('These questions cover what both exams share. "Estimate now" counts the rest of each exam as not learned yet, so an exam this set covers more of needs less extra study. A rough early signal; both pass at a scaled 720 of 1,000.')),
    h('table', { class: 'history' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Exam'), h('th', {}, 'Covered here'), h('th', {}, 'Your answers'), h('th', {}, 'Estimate now'))),
      h('tbody', {}, fit.targets.map((t) => h('tr', { class: t.id === fit.pick ? 'plan-next' : null },
        h('td', {}, t.short),
        h('td', {}, `about ${pct(t.coreShare)}`),
        h('td', {}, t.answers ? pct(t.coreScore) : h('span', { class: 'muted' }, 'none yet')),
        h('td', {}, pct(t.estimate)))))),
  );
}

function studyNextTable({ plan }) {
  return [
    h('table', { class: 'history plan-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Exam domain'), h('th', {}, 'Exam'), h('th', {}, 'Ready'), h('th', {}, 'Practice'))),
      h('tbody', {}, plan.domains.map((d) => h('tr', { class: plan.next?.domainId === d.id ? 'plan-next' : null },
        h('td', {}, d.name, d.weak ? h('span', { class: 'muted' }, ' · weak on the official check') : null, d.stuck ? h('span', { class: 'muted' }, ' · try a different approach') : null),
        h('td', {}, `${d.weight}%`),
        h('td', {}, d.readiness === null
          ? h('span', { class: 'muted', title: `${d.evidence} practice-question answers so far; 5 needed` }, 'not yet')
          : [pct(d.readiness), h('span', { class: 'muted', title: 'recent practice-question answers it is based on' }, ` (${d.evidence})`)]),
        h('td', {}, String(d.answers)))))),
  ];
}

// After a Learn round: a quiet nudge if another deck is clearly the better use of time.
async function nudgeFor(deckId) {
  const collection = collectionOf(await decks.loadCollections(), deckId);
  if (!collection) return null;
  const got = await planFor(collection);
  if (!got) return null;
  // this device's memory of the last advice, per collection; yesterday's advice doesn't count
  const key = 'nudge:' + collection.id;
  const today = localToday();
  const stored = (await storage.get(key)) || {};
  const memory = stored.day === today ? stored : { stuckShown: stored.stuckShown ?? null };
  const { nudge: n, best } = nudgeAfter(got.plan, deckId, { lastBest: memory.lastBest ?? null, stuckShown: memory.stuckShown ?? null, today });
  await storage.set(key, { day: today, lastBest: best, stuckShown: n?.kind === 'stuck' ? today : memory.stuckShown ?? null });
  if (!n) return null;
  if (n.kind === 'stuck') {
    return { text: `You've put ${n.answers} answers into ${n.domainName} and it's at ${pct(n.readiness)}. More of the same may not move it: try a practice exam and read each explanation, or retake the cards you missed.` };
  }
  const to = n.to?.readiness === null || !n.to ? '' : `, you're at ${pct(n.to.readiness)}`;
  const from = n.from?.readiness == null ? '' : ` You're at ${pct(n.from.readiness)} on ${n.from.domainName} (${n.from.weight}% of the exam).`;
  return {
    text: `Good stopping point.${from} More exam points per minute in ${titles(got, n.deckId)}: mostly ${n.domainName} (${n.to?.weight ?? '?'}% of the exam${to}).`,
    deckId: n.deckId, deckTitle: titles(got, n.deckId),
  };
}
const titles = (got, id) => got.titles[id] || id;

function examItems(exams) {
  return Promise.all(exams.map(async (e) => {
    const last = await loadExamRecord(e.id).then((r) => r.attempts.at(-1), () => null);
    return h('li', {}, h('div', { class: 'deck-row' }, h('a', { class: 'deck-tile', href: '#/exam/' + e.id },
      h('span', { class: 'deck-name' }, e.title),
      h('span', { class: 'deck-meta' }, `${e.questionCount} questions`
        + (last ? ` · last score ${last.right}/${last.length} (${last.percent}%)` : ' · not tried yet')))));
  }));
}

// ---------- practice exam ----------

async function showExamScreen(bankId, startLength = null) {
  const bank = await decks.loadExam(bankId);
  setTitle('Practice exam');
  setStudying('exam:' + bankId); // another tab's deck saves must not reset an exam in progress
  cleanup = showExam(root, {
    bank,
    record: await loadExamRecord(bankId),
    loadRecord: () => loadExamRecord(bankId),
    async saveAttempt({ ids, results, flagged = [] }) {
      const at = new Date().toISOString();
      // re-read inside the update: another tab or a sync may have changed the history meanwhile
      const fresh = await sync.update(examKey(bankId), (stored) => {
        const rec = migrateExam(stored, bankId);
        recordAttempt(rec, { date: localToday(), at, ids, results, flagged, bank });
        rec.updatedAt = at;
        return rec;
      });
      queuePush(examKey(bankId));
      return fresh;
    },
    onAnswered: (questionId, correct) => logPracticeAnswer(bankId, questionId, correct),
    onRound: async () => {
      const owner = (await decks.loadCollections()).collections.find((c) => (c.exams || []).includes(bankId));
      const r = await countRound(owner?.id);
      return r && { celebration: r.celebration, points: r.change && pointsBadge(r.change), lines: [afterRound(r.status)] };
    },
    cardTerms: async (refs) => {
      const found = [];
      for (const ref of refs) {
        const [deckId, cardId] = ref.split('/');
        const deck = await decks.loadDeck(deckId).catch(() => null);
        const card = deck?.cards.find((c) => c.id === cardId);
        if (card) found.push({ deckId, term: card.term });
      }
      return found;
    },
    // the set's terms for the score screen: option terms link to their decks and can be learned
    loadTerms: async () => {
      const owner = (await decks.loadCollections()).collections.find((c) => (c.exams || []).includes(bankId));
      const loaded = (await Promise.all((owner?.decks || []).map((id) => decks.loadDeck(id).catch(() => null)))).filter(Boolean);
      const cards = loaded.flatMap((d) => d.cards.map((c) => ({ ...c, id: `${d.id}/${c.id}` })));
      return { vocab: vocabulary(cards), cards: new Map(cards.map((c) => [c.id, c])) };
    },
    // a Learn round on the cards behind your flags, a deck at a time; it ends back on the practice
    // exam page. The address moves there first (no redraw), so a reload mid-round can't start a
    // new full exam.
    learnCards: async (groups) => {
      const deck = await decks.loadDeck(groups[0].deckId);
      const back = '#/exam/' + bankId;
      history.replaceState(null, '', back);
      await startStudy(deck, 'learn', 'learn', { only: groups[0].cardIds, returnTo: back, queue: groups.slice(1) });
    },
    onExit: () => navigate('#/'),
    startLength,
  });
}

// ---------- study plan ----------

async function showPlanScreen(collectionId) {
  const collection = (await decks.loadCollections()).collections.find((c) => c.id === collectionId);
  if (!collection) return navigate('#/');
  setTitle('Study plan');
  const game = await loadGame(collectionId);
  // saving or skipping stamps the settings, so the plan is only asked for once
  const save = (changes) => updateGame(collectionId, (g) => setSettings(g, changes, new Date().toISOString()));
  cleanup = showPlan(root, {
    title: collection.title,
    settings: game.settings,
    onSave: async (settings) => { await save(settings); navigate('#/', 'Plan saved. One round today starts the streak.'); },
    onSkip: async () => { await save({}); navigate('#/'); },
  });
}

// ---------- official check ----------

async function showCheckScreen(collectionId) {
  const collection = (await decks.loadCollections()).collections.find((c) => c.id === collectionId);
  const got = collection && await planFor(collection);
  if (!got) return navigate('#/');
  setTitle('Official check');
  const game = await loadGame(collectionId);
  cleanup = showCheck(root, {
    title: collection.title,
    points: roadFor(got, game).points,
    official: collection.officialPractice,
    areas: got.bank.exam.domains.map((d) => ({ id: d.id, name: d.name })),
    async onSave({ result, marks }) {
      const at = new Date().toISOString();
      const saved = await updateGame(collectionId, (g) => recordCheck(g, { at, result, marks }, { road: roadFor(got, g), passShare: got.bank.exam.passShare ?? 0.7 }));
      const weakNames = got.bank.exam.domains.filter((d) => marks[d.id] === 'weak').map((d) => d.name);
      return verdictFor(saved.checks.at(-1), weakNames);
    },
    onDone: () => navigate('#/'),
  });
}

// ---------- add a deck ----------

async function showUploadScreen() {
  setTitle('Add a deck');
  const index = await decks.loadIndex();
  cleanup = showUpload(root, {
    decks,
    existing: index.decks.filter((d) => d.source === 'uploaded').map(({ id, title }) => ({ id, title })),
    onSaved: (id) => navigate('#/deck/' + id, LOCAL ? 'Deck saved in this browser.' : 'Deck saved. It syncs to your other devices.'),
    onCancel: () => navigate('#/'),
  });
}

function showGuideScreen() {
  setTitle('How to make a deck');
  showDeckGuide(root, { local: LOCAL, onDownload: (name, text, type) => download(name, text, type), onBack: () => navigate('#/') });
}

async function deleteDeck(deck) {
  try {
    await decks.deleteDeck(deck.id);
    navigate('#/', `Deleted "${deck.title}".`);
  } catch (err) {
    showDeck(deck.id, `Couldn't delete: ${err.message}`);
  }
}

function backupPanel() {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'restore-file', onchange: restore });
  return h('section', { class: 'panel backup' },
    h('h2', {}, 'Backup', storage.persistent ? tip('Progress syncs across your signed-in devices. A backup file is still a good idea now and then.') : null),
    storage.persistent ? null : h('p', { class: 'flash warn' }, 'This browser is blocking saved data, so progress will be lost when you close the page. Download a backup before you leave.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: backupAll }, 'Download progress backup'),
      fileInput,
      h('label', { class: 'button', for: 'restore-file' }, 'Restore from backup')));
}

async function backupAll() {
  const keys = await storage.list('progress:');
  const all = {};
  for (const key of keys) all[key.slice('progress:'.length)] = await storage.get(key);
  const exams = {};
  for (const key of await storage.list('exam:')) exams[key.slice('exam:'.length)] = await storage.get(key);
  download(`study-progress-${localToday()}.json`, JSON.stringify(makeBackup(all, new Date().toISOString(), exams), null, 2), 'application/json');
}

async function restore(e) {
  const file = e.target.files[0];
  if (!file) return;
  let backup;
  try {
    backup = parseBackup(await file.text());
  } catch (err) {
    return showLibrary(err.message + '. Nothing was changed.');
  }
  const ids = Object.keys(backup.decks);
  const panel = root.querySelector('.backup');
  panel.append(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm restore' },
    h('p', {}, `Bring in progress for ${ids.length} deck${ids.length === 1 ? '' : 's'}`
      + (Object.keys(backup.exams).length ? ' and your practice exam history' : '') + ' from this backup'
      + (backup.exportedAt ? ` (${String(backup.exportedAt).slice(0, 10)})` : '')
      + '? It is combined with your current progress: for each card, the most recent answer wins.'),
    h('button', { class: 'primary', type: 'button', onclick: async () => {
      // A restore merges with what this device has (including answers not yet synced) and with your
      // synced progress; for each card the most recent answer wins.
      for (const id of ids) {
        const restored = normaliseRecord('deck:' + id, backup.decks[id]);
        await sync.update(progressKey(id), (local) => (local ? mergeProgress(normaliseRecord('deck:' + id, local), restored) : restored));
        sync.markDirty(progressKey(id));
      }
      for (const [id, rec] of Object.entries(backup.exams)) {
        const restored = normaliseRecord('exam:' + id, rec);
        await sync.update(examKey(id), (local) => (local ? mergeExam(normaliseRecord('exam:' + id, local), restored) : restored));
        sync.markDirty(examKey(id));
      }
      await sync.flush();
      showLibrary(`Restored progress for ${ids.length} deck${ids.length === 1 ? '' : 's'}.`);
    } }, 'Restore'),
    h('button', { type: 'button', onclick: () => showLibrary() }, 'Cancel')));
  panel.querySelector('.confirm .primary').focus();
}

// ---------- deck screen ----------

async function showDeck(deckId, message, { settingsOpen = false } = {}) {
  const deck = await decks.loadDeck(deckId);
  const p = await loadProgress(deckId);
  const collection = collectionOf(await decks.loadCollections(), deckId);
  setTitle(deck.title);
  const ids = deck.cards.map((c) => c.id);
  const today = localToday();
  const status = passStatus(p, ids);
  const dueNow = ids.filter((id) => p.cards[id] && p.cards[id].due <= today).length;
  const reviewSize = dueCards(p, ids, today).length;
  const retakes = retakeIds(p, ids).length;
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  const quizCount = h('select', { id: 'quiz-count' },
    ['10', '20', 'all'].map((v) => h('option', { value: v }, v === 'all' ? `All ${ids.length}` : v)));
  const quizDir = h('select', { id: 'quiz-dir' },
    h('option', { value: 'term' }, 'Term → definition'),
    h('option', { value: 'definition' }, 'Definition → term'));
  const quizOptions = () => ({
    count: quizCount.value === 'all' ? 'all' : Number(quizCount.value), direction: quizDir.value,
  });
  const go = (modeId, kind, options = {}) => startStudy(deck, modeId, kind, options);
  // Which phase you're in: the collection's path to exam day, or for a deck on its own, Learn until
  // every card is learned and then Keep it fresh.
  const rawCollection = collection && (await decks.loadCollections()).collections.find((c) => c.id === collection.id);
  const got = rawCollection ? await planFor(rawCollection) : null;
  const examId = got?.bankId ?? null;
  const ls = learnStatus(p, ids);
  const phaseNow = got ? got.journey.current : (ls.learned < ls.total ? 'learn' : 'fresh');
  const also = rawCollection ? await alsoPanel(deck.id, rawCollection.decks) : null;

  mount(root,
    h('header', { class: 'page-head' },
      h('a', { class: 'link', href: '#/' }, '← All decks'),
      h('h1', {}, deck.title),
      collection ? h('p', { class: 'part-of' }, 'Part of ', h('strong', {}, collection.title)) : null,
      deck.description ? h('p', { class: 'muted' }, deck.description) : null,
      h('p', { class: 'deck-meta' }, deckMeter(p, ids).text)),
    message ? h('p', { class: 'flash', role: 'status' }, message) : null,

    // The same options as always, grouped by the phase they belong to; your phase is open.
    phaseGroup('learn', phaseNow, [
      learnPanel(deck, p, ids),
      h('section', { class: 'panel' },
        h('h2', {}, 'Other ways through the cards'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', onclick: () => go('flashcards', null) }, 'Browse flashcards'),
          h('button', { type: 'button', onclick: () => go('match', null) }, 'Match' + (p.matchBestSeconds ? ` (best ${p.matchBestSeconds.toFixed(1)}s)` : '')))),
    ]),
    phaseGroup('practice', phaseNow, [
      examId ? h('section', { class: 'panel' },
        h('h2', {}, 'Practice exam', tip('Exam-style questions across every deck in this collection.')),
        h('div', { class: 'actions' },
          h('a', { class: 'button', href: `#/exam/${examId}/15` }, '15 questions'),
          h('a', { class: 'button', href: `#/exam/${examId}/30` }, '30 questions'))) : null,
      h('section', { class: 'panel' },
        h('h2', {}, 'Retake missed cards'),
        h('p', { class: 'muted' }, retakes
          ? `${retakes} card${retakes === 1 ? '' : 's'} queued. A card leaves after ${p.retakeCorrectNeeded} right in a row.`
          : 'Nothing queued. Missed cards from any mode show up here.'),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', type: 'button', disabled: !retakes, onclick: () => go('flashcards', 'retake') }, `Retake with flashcards (${retakes})`),
          h('button', { type: 'button', disabled: !retakes, onclick: () => go('quiz', 'retake', { direction: quizDir.value }) }, 'Retake as quiz'))),
      h('section', { class: 'panel' },
        h('h2', {}, 'Quiz'),
        h('div', { class: 'quiz-setup' },
          h('label', { for: 'quiz-count' }, 'Questions'), quizCount,
          h('label', { for: 'quiz-dir' }, 'Direction'), quizDir,
          h('button', { type: 'button', onclick: () => go('quiz', 'sample', quizOptions()) }, 'Start quiz'))),
      weakestPanel(p, ids, byId),
    ]),
    examId ? phaseGroup('mock', phaseNow, [
      h('section', { class: 'panel' },
        h('h2', {}, 'Full practice exam', tip('The real exam\'s length and mix. 75% or better completes this phase.')),
        h('div', { class: 'actions' }, h('a', { class: 'button', href: `#/exam/${examId}/65` }, 'Start the full exam'))),
    ]) : null,
    phaseGroup('fresh', phaseNow, [
      h('section', { class: 'panel' },
        h('h2', {}, 'Spaced review', tip('A few minutes on the cards due today keeps them from fading.')),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', type: 'button', disabled: !reviewSize, onclick: () => go('flashcards', 'review') },
            `Spaced review (${dueNow} due${reviewSize > dueNow ? `, ${reviewSize - dueNow} new` : ''})`))),
      h('section', { class: 'panel' },
        h('h2', {}, status.targetReached ? `Passes · target reached (${status.completed} done)` : `Passes · pass ${status.number} of ${status.target}`),
        h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(status.total), 'aria-valuenow': String(status.answered), 'aria-label': 'Cards answered in this pass' },
          h('span', { class: 'meter-fill', style: { width: `${status.total ? (status.answered / status.total) * 100 : 0}%` } })),
        h('p', { class: 'muted' }, p.currentPass
          ? `${status.answered} of ${status.total} cards answered in pass ${status.number}. Retake rounds don't count toward a pass.`
          : 'A pass shows every card once. Missed cards go to the retake queue.'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', onclick: () => go('flashcards', 'pass') }, p.currentPass ? 'Continue pass: flashcards' : 'Start pass: flashcards'),
          h('button', { type: 'button', onclick: () => go('quiz', 'pass', { direction: quizDir.value }) }, p.currentPass ? 'Continue pass: quiz' : 'Start pass: quiz'))),
      historyPanel(p),
    ]),
    also,
    settingsPanel(deck, p, settingsOpen),

    h('section', { class: 'panel' },
      h('h2', {}, 'Export this deck', tip('In Quizlet: Create, then Import. Use | between term and definition, and a new line between cards.')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => download(`${deck.id}.csv`, toCsv(deck), 'text/csv') }, 'CSV'),
        h('button', { type: 'button', onclick: () => download(`${deck.id}-quizlet.txt`, toQuizletText(deck)) }, 'Quizlet text (term|definition)'))),

    deck.id.startsWith('u-') ? uploadedPanel(deck) : null);
}

// Cards on this deck's topic that are learned in another deck of the set, with how far each has
// got there. They are studied only in that deck, so nothing is learned twice.
const STATE_TEXT = { new: 'Not started', learning: 'Learning', learned: 'Learned', mastered: 'Mastered' };
async function alsoPanel(deckId, deckIds) {
  const others = await Promise.all(deckIds.filter((id) => id !== deckId).map((id) => decks.loadDeck(id).catch(() => null)));
  const found = borrowedCards(deckId, others.filter(Boolean));
  if (!found.length) return null;
  const progress = new Map();
  for (const id of new Set(found.map((x) => x.deckId))) progress.set(id, await loadProgress(id));
  const from = [...new Map(found.map((x) => [x.deckId, x.deckTitle])).entries()];
  return h('section', { class: 'panel' },
    h('h2', {}, 'Also on this topic', tip('These cards are learned in another deck, so your progress there counts here too.')),
    from.map(([id, title]) => [
      h('p', { class: 'muted' }, 'Learned in ', h('a', { href: '#/deck/' + id }, title), ':'),
      h('ul', { class: 'missed' }, found.filter((x) => x.deckId === id).map((x) => h('li', {},
        h('strong', {}, x.card.term), h('span', {}, STATE_TEXT[cardState(progress.get(id), x.card.id)])))),
    ]));
}

function learnPanel(deck, p, ids) {
  const s = learnStatus(p, ids);
  const allDone = s.learned === s.total;
  const startOver = async () => {
    // re-read before writing: the copy behind this screen may be older than what is saved
    const fresh = await loadProgress(deck.id);
    await saveProgress(resetLearn(fresh, new Date().toISOString()));
    startStudy(deck, 'learn', 'learn');
  };
  const confirmStartOver = () => {
    panel.querySelector('.actions').replaceWith(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Start Learn over' },
      h('p', {}, `Put all ${s.total} cards back on step 1? Spaced review and passes are not affected.`),
      h('button', { class: 'primary', type: 'button', onclick: startOver }, 'Start over'),
      h('button', { type: 'button', onclick: () => showDeck(deck.id) }, 'Cancel')));
    panel.querySelector('.confirm .primary').focus();
  };
  const panel = h('section', { class: 'panel' },
    h('h2', {}, 'Learn', tip('Short rounds of about seven cards. Each card climbs: pick the definition, pick the term from look-alikes, then apply it in a scenario question (when the practice exam has one). A miss drops it one step and comes back later in the round.')),
    h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(s.total), 'aria-valuenow': String(s.learned), 'aria-label': 'Cards learned' },
      h('span', { class: 'meter-fill', style: { width: `${s.total ? (s.learned / s.total) * 100 : 0}%` } })),
    h('p', { class: 'muted' }, `${s.learned} of ${s.total} learned`
      + (s.started ? ` · ${s.started} on the way` : '') + (s.fresh ? ` · ${s.fresh} not started` : '')),
    h('div', { class: 'actions' },
      allDone
        ? h('button', { class: 'primary', type: 'button', onclick: confirmStartOver }, 'Start Learn over')
        : h('button', { class: 'primary', type: 'button', onclick: () => startStudy(deck, 'learn', 'learn') },
          s.started || s.learned ? 'Continue Learn' : 'Start Learn'),
      !allDone && (s.started || s.learned)
        ? h('button', { type: 'button', onclick: confirmStartOver }, 'Start over') : null));
  return panel;
}

// One phase's options on a deck page: open and marked when it's the phase you're in.
function phaseGroup(id, current, children) {
  const i = PHASES.findIndex((p) => p.id === id);
  const phase = PHASES[i];
  return h('details', { class: 'phase-group' + (id === current ? ' here' : ''), open: id === current },
    h('summary', {}, h('span', { class: 'phase-num' }, String(i + 1)), ` ${phase.label}`,
      h('span', { class: 'muted' }, ` · ${phase.goal}`), id === current ? h('span', { class: 'phase-here-tag' }, "You're here") : null),
    children);
}

function uploadedPanel(deck) {
  const panel = h('section', { class: 'panel' },
    h('h2', {}, 'This deck', tip('You uploaded this deck. It syncs across your devices. To change its cards, upload the file again with the same deck name.')),
    h('div', { class: 'actions' },
      h('a', { class: 'button', href: '#/upload' }, 'Upload a new version'),
      h('button', { type: 'button', class: 'danger', onclick: () => {
        panel.querySelector('.actions').replaceWith(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Delete deck' },
          h('p', {}, LOCAL ? `Delete "${deck.title}" from this browser? Your study progress for it stays in case you upload it again.` : `Delete "${deck.title}" from all your devices? Your study progress for it stays on each device in case you upload it again.`),
          h('button', { type: 'button', class: 'danger', onclick: () => deleteDeck(deck) }, 'Delete'),
          h('button', { type: 'button', onclick: () => showDeck(deck.id) }, 'Cancel')));
        panel.querySelector('.confirm .danger').focus();
      } }, 'Delete this deck')));
  return panel;
}

function weakestPanel(p, ids, byId) {
  const weak = weakest(p, ids, 8);
  if (!weak.length) return null;
  return h('section', { class: 'panel' },
    h('h2', {}, 'Weakest cards'),
    h('ul', { class: 'missed' }, weak.map((id) => {
      const c = p.cards[id];
      return h('li', {}, h('strong', {}, byId.get(id).term),
        h('span', {}, `${c.correct} of ${c.seen} right · box ${c.box}`));
    })));
}

function historyPanel(p) {
  if (!p.passHistory.length) return null;
  return h('section', { class: 'panel' },
    h('h2', {}, 'Passes'),
    h('table', { class: 'history' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Pass'), h('th', {}, 'Finished'), h('th', {}, 'First try'), h('th', {}, 'Retake rounds'))),
      h('tbody', {}, p.passHistory.map((r) => h('tr', {},
        h('td', {}, String(r.number)),
        h('td', {}, r.completedAt),
        h('td', {}, `${r.firstAttemptCorrect}/${r.total} (${Math.round((r.firstAttemptCorrect / r.total) * 100)}%)`),
        h('td', {}, String(r.retakeRounds)))))));
}

function settingsPanel(deck, p, open) {
  const field = (key, label, min, max, help) => {
    const input = h('input', { type: 'number', id: 'set-' + key, min: String(min), max: String(max), value: String(p[key]), inputmode: 'numeric' });
    input.addEventListener('change', async () => {
      const n = Math.round(Number(input.value));
      if (!Number.isFinite(n) || n < min || n > max) { input.value = String(p[key]); return; }
      // re-read before writing: the copy behind this screen may be older than what is saved
      const fresh = await loadProgress(deck.id);
      fresh[key] = n;
      fresh.settingsAt = new Date().toISOString(); // so the change wins over older settings on another device
      await saveProgress(fresh);
      await showDeck(deck.id, 'Saved.', { settingsOpen: true });
      document.getElementById('set-' + key)?.focus();
    });
    return h('div', { class: 'field' }, h('label', { for: 'set-' + key }, label), input, h('span', { class: 'muted' }, help));
  };
  return h('details', { class: 'panel settings', open: Boolean(open) },
    h('summary', {}, 'Settings for this deck'),
    field('passTarget', 'Pass target', 1, 20, 'Full passes to aim for before the exam.'),
    field('retakeCorrectNeeded', 'Right answers to clear a retake', 1, 5, 'In a row. A miss starts the count over.'),
    field('recentWindow', 'No-repeat window', 0, 10, 'A card waits this many cards before it can come back.'));
}

// ---------- study ----------

let studyStarts = 0;

// Learn's "apply it" step uses the practice-exam questions that test a card. Loaded once; if the
// banks can't load, Learn simply has no scenario step.
let scenarioMap = null;
function loadScenarios() {
  // a failed load is not kept, so the next Learn round tries again
  // -> { byCard: Map, failed }: failed means the banks exist but didn't load (not "there are none")
  scenarioMap ||= decks.loadIndex()
    .then((index) => Promise.all((index.exams || []).map((e) => decks.loadExam(e.id))))
    .then((banks) => ({ byCard: questionsByCard(banks), failed: false }))
    .catch(() => { scenarioMap = null; return { byCard: new Map(), failed: true }; });
  return scenarioMap;
}
// Learn underlines terms from the whole collection: LoRA's card names PEFT from the same deck,
// but a card may name one from a sibling deck. A deck that won't load just adds nothing.
async function vocabFor(deck, collection) {
  const others = (collection?.decks || []).filter((id) => id !== deck.id);
  const loaded = await Promise.all(others.map((id) => decks.loadDeck(id).catch(() => null)));
  return vocabulary([deck, ...loaded.filter(Boolean)].flatMap((d) => d.cards || []));
}

async function startStudy(deck, modeId, kind, options = {}) {
  cleanup();
  const mine = ++studyStarts;
  await firstSyncSettled(); // study from your latest progress, not this device's older copy
  if (mine !== studyStarts) return; // a second tap while waiting: only the latest one starts
  const p = await loadProgress(deck.id);
  let lastSave = Promise.resolve();
  const save = () => (lastSave = Promise.all([lastSave, saveProgress(p)])); // keep every pending save in the chain
  const scenarios = kind === 'learn' ? await loadScenarios() : { byCard: new Map(), failed: false };
  const collection = collectionOf(await decks.loadCollections(), deck.id);
  const collectionId = collection?.id ?? null;
  const vocab = kind === 'learn' ? await vocabFor(deck, collection) : [];
  if (mine !== studyStarts) return;
  const scenariosFor = (cardId) => scenarios.byCard.get(`${deck.id}/${cardId}`) || [];
  // If the bank didn't load, every card keeps its scenario step (nothing is marked learned without one).
  const banksLoaded = !scenarios.failed;
  const session = kind
    ? createSession({
      kind, deck, progress: p, today: localToday(), count: options.count, only: options.only ?? null, save,
      lastStep: (cardId) => (!banksLoaded || scenariosFor(cardId).length ? 2 : 1),
    })
    : null;
  if (session) save(); // a new pass is stored the moment it starts, so it can resume after a reload

  const labels = {
    pass: () => `Pass ${p.currentPass ? p.currentPass.number : p.passesCompleted} of ${p.passTarget}`,
    retake: () => 'Retake round',
    review: () => 'Spaced review',
    sample: () => 'Quiz',
    learn: () => 'Learn',
  };
  const mode = modeById[modeId];
  setTitle(mode.title, deck.title);

  const ctx = {
    root, deck, session, progress: p, modeId, options, scenarios: scenariosFor, vocab,
    // Learn showed a practice-exam question: count it as seen, so exams draw fresh ones first
    onScenarioShown: (bankId, questionId) => {
      sync.update(examKey(bankId), (stored) => {
        const rec = migrateExam(stored, bankId);
        rec.seen[questionId] = (rec.seen[questionId] || 0) + 1;
        rec.updatedAt = new Date().toISOString();
        return rec;
      }).then(() => queuePush(examKey(bankId)), () => {});
    },
    // the first answer to a practice question, wherever it happens, is the readiness evidence
    onScenarioAnswered: (bankId, questionId, correct) => { lastSave = Promise.all([lastSave, logPracticeAnswer(bankId, questionId, correct)]); },
    // the nudge waits for this round's last saves, so it sees the last answer
    nudge: () => lastSave.then(() => nudgeFor(deck.id)).catch(() => null),
    openDeck: (id) => navigate('#/deck/' + id),
    // a finished round with answers counts toward the collection's streak and goal -> a line, or null
    // waits for the round's last saves, so the points see the last answer
    onRound: () => lastSave.then(() => countRound(collectionId))
      .then((r) => (r ? { celebration: r.celebration, points: r.change && pointsBadge(r.change), lines: [afterRound(r.status)] } : null), () => null),
    label: kind ? labels[kind]() : mode.title,
    emptyMessage: kind === 'review' ? 'No cards are due today.' : kind === 'retake' ? 'The retake queue is empty.' : '',
    record(cardId, correct, context) {
      applyResult(p, { cardId, correct, context, today: localToday(), at: new Date().toISOString() });
      save();
    },
    saveProgress: save,
    onRetake: (m) => startStudy(deck, m === 'match' || m === 'learn' ? 'flashcards' : m, 'retake', options),
    onExit: () => { cleanup(); cleanup = () => {}; setStudying(null); navigate(options.returnTo || '#/deck/' + deck.id); },
    restart: () => startStudy(deck, modeId, kind, options),
    // the next deck's part of a round on chosen cards (the ones behind your flags)
    nextPart: options.queue?.length ? () => {
      const [part, ...rest] = options.queue;
      decks.loadDeck(part.deckId).then(
        (d) => startStudy(d, 'learn', 'learn', { ...options, only: part.cardIds, queue: rest }),
        () => ctx.onExit());
    } : null,
  };
  window.scrollTo(0, 0);
  notice = null;
  setStudying(deck.id);
  cleanup = mode.start(deck, ctx) || (() => {});
}

// ---------- routing ----------

// message, if given, is shown on the screen we land on (a hash change clears older notices).
let carried = null;
function navigate(hash, message = null) {
  if (location.hash === hash) { notice = message; route(); return; }
  carried = message;
  location.hash = hash;
}

async function route() {
  cleanup();
  cleanup = () => {};
  const acct = await account;
  if (acct.status === 'not-listed') return showNotListed(acct);
  renderTopbar();
  setStudying(null);
  const match = location.hash.match(/^#\/deck\/([a-z0-9-]+)$/);
  const flip = location.hash.match(/^#\/flip\/([a-z0-9-]+)$/);
  const exam = location.hash.match(/^#\/exam\/([a-z0-9-]+)(?:\/(\d+))?$/);
  const plan = location.hash.match(/^#\/plan\/([a-z0-9-]+)$/);
  const official = location.hash.match(/^#\/check\/([a-z0-9-]+)$/);
  try {
    if (match) await showDeck(match[1], takeNotice());
    else if (flip) await startStudy(await decks.loadDeck(flip[1]), 'flashcards', null);
    else if (exam) await showExamScreen(exam[1], exam[2] ? Number(exam[2]) : null);
    else if (plan) await showPlanScreen(plan[1]);
    else if (official) await showCheckScreen(official[1]);
    else if (location.hash === '#/upload') await showUploadScreen();
    else if (location.hash === '#/make-a-deck') showGuideScreen();
    else await showLibrary(takeNotice());
  } catch (err) {
    mount(root, h('section', { class: 'panel' },
      h('h1', {}, 'Something went wrong'),
      h('p', {}, err.message),
      h('a', { class: 'link', href: '#/' }, '← All decks')),
    backupPanel()); // saved progress stays reachable even when decks fail to load
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => { notice = carried; carried = null; route(); });
// ---------- who is signed in ----------
// Before anything syncs: who is this? If someone else signed in on this browser, its copy of the
// last person's progress is cleared first (then the page reloads clean). Offline, the last answer
// is used, so the app still works.
const account = (async () => {
  if (LOCAL) return { status: 'local' };
  const me = await currentUser();
  const stored = await storage.get('account');
  if (me.status === 'not-listed') return me;
  const step = handover(stored?.you ?? null, me.status === 'ok' ? me.you : null);
  if (step === 'switch') {
    await storage.clear();
    await storage.set('account', { you: me.you, version: me.version, signOutUrl: me.signOutUrl });
    location.reload();
    return new Promise(() => {}); // the reload takes over
  }
  if (me.status === 'ok') {
    await storage.set('account', { you: me.you, version: me.version, signOutUrl: me.signOutUrl });
    return me;
  }
  return { ...(stored || {}), status: me.status };
})();

const profileName = async () => (await storage.get('profile:me'))?.name || '';

async function saveName(name) {
  const clean = name.trim().slice(0, 40);
  await sync.update('profile:me', () => ({ name: clean, at: new Date().toISOString() }));
  queuePush('profile:me');
}

// Signing out: send anything unsynced first, clear this browser's copy (it may be a shared device),
// then end the Cognito and Access sessions, so the next visit asks who you are.
async function signOut(acct, { force = false } = {}) {
  await sync.flush().catch(() => {});
  const left = await sync.pending();
  if (left && !force) return left;
  await storage.clear();
  location.href = acct.signOutUrl || '/cdn-cgi/access/logout';
  return 0;
}

async function renderTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const acct = await account;
  const name = await profileName();
  const input = h('input', { type: 'text', id: 'your-name', maxlength: '40', value: name, placeholder: 'Your first name', autocomplete: 'given-name' });
  const status = h('p', { class: 'muted menu-status', role: 'status' });
  const out = h('button', { type: 'button', class: 'danger', onclick: async () => {
    out.disabled = true;
    const left = await signOut(acct, { force: out.dataset.force === 'yes' });
    if (left) {
      status.textContent = `${left} change${left === 1 ? ' hasn\'t' : 's haven\'t'} reached the server yet (no connection?). Signing out now would lose ${left === 1 ? 'it' : 'them'}. Tap again to sign out anyway.`;
      out.dataset.force = 'yes';
      out.disabled = false;
    }
  } }, 'Sign out');
  // the public copy has no sign-out, so wiping this browser's progress lives here instead
  const reset = resetAllProgress({ storage, reload: () => { location.hash = '#/'; location.reload(); } });
  const wipe = h('button', { type: 'button', class: 'danger', onclick: async () => {
    const { armed, label } = await reset.tap();
    wipe.textContent = label;
    status.textContent = armed ? 'This erases every deck\'s progress, your streak and points, and any decks you added, in this browser.' : '';
  } }, reset.label);
  // no row of its own: the menu sits at the right of each page's first line (the welcome, on home)
  bar.replaceChildren(
    h('details', { class: 'menu' },
      // an avatar with your initial (who is signed in, at a glance), or a menu icon before a name is set
      h('summary', { 'aria-label': 'Menu', title: 'Menu' }, h('span', { class: 'avatar' + (name ? '' : ' no-name'), 'aria-hidden': 'true' }, initial(name) || '☰')),
      h('div', { class: 'menu-panel' },
        h('p', { class: 'menu-hello' }, name ? (LOCAL ? `Hi, ${name}` : `Signed in as ${name}`) : 'Your account'),
        h('form', { class: 'menu-name', onsubmit: async (e) => {
          e.preventDefault();
          await saveName(input.value);
          await renderTopbar();
          if (!studying) route();
        } },
          h('label', { for: 'your-name' }, 'What should we call you?'),
          h('div', { class: 'menu-row' }, input, h('button', { type: 'submit' }, 'Save'))),
        h('a', { class: 'button menu-link', href: '#/upload', onclick: (e) => { e.currentTarget.closest('details').open = false; } }, '+ Add a deck'),
        h('a', { class: 'link menu-guide', href: '#/make-a-deck', onclick: (e) => { e.currentTarget.closest('details').open = false; } }, 'How to make a deck'),
        h('p', { class: 'muted' }, versionText(acct.version)),
        LOCAL ? h('p', { class: 'muted' }, 'Progress is saved in this browser only. To move it, download a backup from the home screen.') : null,
        status,
        LOCAL ? wipe : out)));
}

// Signed in, but not on this site's list: say so plainly, and offer a way out to try another account.
function showNotListed(acct) {
  setTitle('Not on the list yet');
  mount(root, h('section', { class: 'panel' },
    h('h1', {}, 'You\'re signed in, but not on the list yet'),
    h('p', {}, 'This study site only lets in people its owner has added. Ask them to add the email you signed in with, then sign in again.'),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: () => { location.href = acct.signOutUrl; } }, 'Sign out'))));
}

// Pull your other devices' progress, then push anything waiting from this one. A study session on
// screen is never changed underneath you; other screens redraw when something arrived.
async function syncNow({ redraw = true } = {}) {
  const { changed } = await sync.pull();
  await sync.flush();
  if (redraw && changed.length && !studying) route();
  return changed;
}
// Show the first screen with fresh progress, but never wait more than a moment for the network;
// if the first sync lands later, redraw then.
const firstSync = account.then((a) => (a.status === 'not-listed' ? [] : syncNow({ redraw: false }))).catch(() => []);
// A study session waits for the first sync, but never more than a few seconds.
function firstSyncSettled() { return Promise.race([firstSync, new Promise((r) => setTimeout(r, 5000))]); }
Promise.race([firstSync.then(() => 'in time'), new Promise((r) => setTimeout(() => r('late'), 2500))]).then((when) => {
  route();
  if (when === 'late') firstSync.then((changed) => { if (changed.length && !studying) route(); });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !studying) syncNow().catch(() => {}); });
window.addEventListener('online', () => { if (!studying) syncNow().catch(() => {}); });
