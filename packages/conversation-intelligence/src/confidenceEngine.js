class ConfidenceEngine {
  choose(candidates = []) {
    const positive=[...candidates].filter((c)=>Number(c.confidence)>0);
    const hasDeterministicBusinessIntent=positive.some(c=>
      ['catalog','commerce'].includes(c.capabilityId) &&
      Number(c.confidence)>=.85
    );
    const eligible=hasDeterministicBusinessIntent
      ? positive.filter(c=>!(c.capabilityId==='assistant' && c.reason==='knowledge_question_abstention'))
      : positive;
    const ordered = eligible.sort((a,b) => Number(b.confidence)-Number(a.confidence) || Number(b.priority||0)-Number(a.priority||0));
    const winner = ordered[0] || null;
    return { winner, ordered, needsLlm: !winner || Number(winner.confidence) < .72 };
  }
}
module.exports = { ConfidenceEngine };
