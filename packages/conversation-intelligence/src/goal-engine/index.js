const { GoalResolver } = require('./goalResolver');
const { createGoal, getGoal, transitionGoal, appendGoalHistory } = require('./goalManager');
module.exports = { GoalResolver, createGoal, getGoal, transitionGoal, appendGoalHistory };
