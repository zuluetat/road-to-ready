# Road to Ready

[![Pages](https://github.com/zuluetat/road-to-ready/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/zuluetat/road-to-ready/actions/workflows/pages/pages-build-deployment)
![No sign-in](https://img.shields.io/badge/sign--in-none-brightgreen)
![No build step](https://img.shields.io/badge/build-none-blue)

A free study app for two certification exams: **AWS Certified AI Practitioner (AIF-C01)** and **Claude Certified Associate (Foundations)**. It has flashcards, guided lessons, quick games and full practice exams, and it remembers what you got wrong so those cards come back sooner. Open it at **https://zuluetat.github.io/road-to-ready/** and start studying.

> ⚠️ **Unofficial.** This isn't affiliated with or endorsed by Amazon Web Services or Anthropic. The practice questions are written from the public exam guides and product docs. They aren't real exam questions, and a good score here doesn't guarantee a pass.

## Why this exists

- **Official prep material is scattered** across exam guides, skill-builder courses and product docs. These decks follow each exam's own domains, so you study what the exam weighs.
- **Paid question banks test recall more than understanding.** Every card here explains the why, and the practice exams mix in the traps people actually fall for.
- **No account, no cost, no tracking of who you are.** Your progress stays in your own browser.

## What's inside

| Study set | Decks | Cards | Practice questions |
|---|---|---|---|
| AWS Certified AI Practitioner (AIF-C01) | 7: AI and ML fundamentals, generative AI and foundation models, AWS AI services, responsible AI and governance, frameworks, what's new in the 2026 guide, practice-test traps | 227 | 421 |
| Claude Certified Associate (Foundations) | 7: how Claude behaves, prompting and troubleshooting, checking output, products and models, workflows, Projects and connectors, responsible use | 158 | 150 |

| Way to study | What it does |
|---|---|
| Learn | Short guided lessons that introduce a deck's ideas before you're tested on them |
| Flashcards | Spaced repetition: cards you miss come back sooner, cards you know fade back |
| Match and quiz | Quick rounds to drill terms against definitions |
| Practice exam | Timed, exam-style questions weighted by domain, with an explanation for every answer |
| Readiness and plan | Shows which domains are weak and what to study next |
| Daily streak | 🔥 when you're on a run, 🧊 when it's cooled, and how many rounds are left for today |

## Your progress and privacy

- **Progress is saved in this browser only** (local storage). Nothing is sent to a server, and clearing site data or switching devices starts you fresh.
- **Visit counts** come from Cloudflare Web Analytics, which uses no cookies and doesn't identify anyone.

## Use it

**Option 1: in your browser (recommended).** Go to https://zuluetat.github.io/road-to-ready/. It works on a phone too. Use your browser's "Add to Home Screen" to make it look like an app.

**Option 2: run your own copy.** It's plain HTML, CSS and JavaScript, so there's nothing to install or build:

```bash
git clone https://github.com/zuluetat/road-to-ready.git
cd road-to-ready
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk won't work, because browsers block loading the deck files that way. Use any local web server.

## How it works

```
 index.html ──► app.js ──► screens/  (home, plan, practice exam)
                    │
                    ├──► modes/    (learn, flashcards, match, quiz)
                    ├──► core/     (scheduling, scoring, streaks, readiness)
                    │
                    └──► data/index.json ──► data/decks/*.json      (cards)
                                         └──► data/questions/*.json  (practice exams)

 progress ──► adapters/storage.js ──► your browser's local storage
```

Each study set is listed in `data/index.json` and points to its decks and practice-question files. The app reads those JSON files, schedules cards by how well you remember them, and saves your progress in your browser. GitHub Pages serves the files exactly as they are, and `.nojekyll` turns off Pages' own processing.

## Where changes come from

This repository is a published copy, not where the app is developed. The app and its tests live in a separate private project and are exported here, minus the server, sign-in and the owner's personal study sets. Corrections and suggestions are welcome as issues. Please point to the card or question and the source that shows it's wrong.

## License

- **Code** (the HTML, CSS and JavaScript): [MIT](LICENSE).
- **Study content** (the cards, lessons and practice questions in `data/`): [CC BY 4.0](LICENSE-CONTENT.md). Share and adapt it freely; just credit Road to Ready and link back here.
