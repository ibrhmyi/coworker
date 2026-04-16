// Library exports for programmatic use and tests
export { initDb, getDb, closeDb, createTask, updateTask, getTask, listTasks, markOrphanedTasks } from './core/store.js';
export { runClaudeCode, findClaudeBinary } from './core/subprocess.js';
export { buildSummary, buildHeuristicSummary, parseLlmSummaryResponse } from './core/summary.js';
export { submitTask, iterateTask, waitForTask } from './core/dispatcher.js';
export { getRunningCount, killAllProcesses } from './core/processes.js';
export { getDefaultConfig, loadConfig } from './core/config.js';
export { startServer } from './server/mcp.js';
export { startTunnel } from './server/tunnel.js';
export type { Task, SubmitTaskInput, SubmitTaskResult, IterateTaskInput, IterateTaskResult, WaitForTaskInput, WaitForTaskResult, TaskCompletionResult, ClaudeCodeResult, TaskListFilters } from './types/task.js';
