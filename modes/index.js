// Study mode registry. A mode is a module exporting id, title and start(deck, ctx), which
// returns a cleanup function. Add a mode by writing modes/<name>.js and listing it here.
//
// ctx gives a mode everything it may touch; modes never reach storage or fetch directly:
//   root          element to render into
//   session       card order and answer recording (pass, retake, review, sample), or null
//   progress      this deck's progress record (read it; change it only through record or session)
//   record(cardId, correct, context)  report an answer when there is no session
//   saveProgress()  persist a change the mode made itself (Match best time)
//   options       { direction, swap }
//   label         heading for this session, e.g. "Pass 2 of 3"
//   onRetake(modeId), onExit(), restart()

import * as flashcards from './flashcards.js';
import * as quiz from './quiz.js';
import * as match from './match.js';
import * as learn from './learn.js';

export const modes = [learn, flashcards, quiz, match];
export const modeById = Object.fromEntries(modes.map((m) => [m.id, m]));
