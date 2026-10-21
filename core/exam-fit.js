// Which of several candidate exams you are closer to passing, from one shared practice bank.
//
// A bank can list candidate exams (exam.targets), each with its own domains and weights and the
// share of it the bank covers (coreShare). Each question names its domain on each exam it belongs
// to (question.exams). Per exam: the last 20 answers in each of its domains, first-time answers
// counting fully and repeats half, pulled toward a cautious default as the study plan does; then
// weighted by that exam's domain weights. The part of an exam the bank doesn't cover is still to
// learn, so it counts at the cautious default. The higher estimate is the exam to take, once there
// are enough answers to say.

const RECENT = 20;
const PRIOR = 0.4;
const PRIOR_WEIGHT = 5;
const ENOUGH = 15; // answers in the bank before a pick is offered

// -> null | { targets: [{ id, short, name, coreShare, coreScore, estimate, answers }], enough, pick }
export function examFit({ bank, record }) {
  const targets = bank.exam?.targets;
  if (!targets?.length) return null;
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const log = (record?.log || []).filter((x) => byId.has(x.q));
  const results = targets.map((t) => {
    let weighted = 0;
    let weights = 0;
    let answers = 0;
    for (const d of t.domains) {
      const inDomain = (q) => q.exams?.[t.id] === d.id;
      if (!bank.questions.some(inDomain)) continue; // this bank doesn't teach that domain
      const mine = log.filter((x) => inDomain(byId.get(x.q)));
      answers += mine.length;
      const recent = mine.slice(-RECENT);
      const w = recent.reduce((s, x) => s + (x.fresh ? 1 : 0.5), 0);
      const right = recent.reduce((s, x) => s + (x.ok ? (x.fresh ? 1 : 0.5) : 0), 0);
      weighted += d.weight * ((right + PRIOR * PRIOR_WEIGHT) / (w + PRIOR_WEIGHT));
      weights += d.weight;
    }
    const coreScore = weights ? weighted / weights : PRIOR;
    const share = t.coreShare ?? 1;
    return { id: t.id, short: t.short || t.name, name: t.name, coreShare: share, coreScore, estimate: share * coreScore + (1 - share) * PRIOR, answers };
  });
  const enough = log.length >= ENOUGH;
  const best = [...results].sort((a, b) => b.estimate - a.estimate || b.coreShare - a.coreShare)[0];
  return { targets: results, enough, pick: enough ? best.id : null };
}
