function createGoal(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || `GOAL-${Date.now().toString(36).toUpperCase()}`,
    type: input.type || 'unknown',
    status: input.status || 'active',
    stage: input.stage || 'started',
    capabilityId: input.capabilityId || null,
    categoryId: input.categoryId || null,
    candidateIds: Array.isArray(input.candidateIds) ? [...new Set(input.candidateIds)] : [],
    selectedProductId: input.selectedProductId || null,
    selectedServiceId: input.selectedServiceId || null,
    entities: { ...(input.entities || {}) },
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}
function getGoal(state) { return state?.context?.goal || null; }
function transitionGoal(goal, patch = {}) {
  if (!goal) return createGoal(patch);
  return { ...goal, ...patch, entities: { ...(goal.entities || {}), ...(patch.entities || {}) }, updatedAt: new Date().toISOString() };
}
function appendGoalHistory(state, entry) {
  const history = Array.isArray(state?.context?.goalHistory) ? state.context.goalHistory : [];
  return [...history, { at: new Date().toISOString(), ...entry }].slice(-50);
}
module.exports = { createGoal, getGoal, transitionGoal, appendGoalHistory };
