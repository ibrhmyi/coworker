import { findProjectRoot, getDbPath } from '../utils/paths.js';
import { initDb, getTask, closeDb } from '../core/store.js';

export async function show(taskId: string, opts: { level?: string }): Promise<void> {
  const projectDir = findProjectRoot();
  if (!projectDir) {
    console.error('No .coworker/ directory found. Run `coworker init` first.');
    process.exit(1);
  }

  initDb(getDbPath(projectDir));

  try {
    const task = getTask(taskId);

    if (!task) {
      console.error(`Task not found: ${taskId}`);
      process.exit(1);
    }

    const level = opts.level ?? 'paragraph';

    console.log(`Task:      ${task.task_id}`);
    console.log(`Status:    ${task.status}`);
    console.log(`Created:   ${task.created_at.replace('T', ' ').slice(0, 19)}`);
    console.log(`Duration:  ${task.duration_seconds != null ? `${task.duration_seconds.toFixed(1)}s` : '-'}`);
    console.log(`Prompt:    ${task.prompt}`);
    console.log(`Session:   ${task.claude_session_id ?? '(none)'}`);
    console.log(`Parent:    ${task.parent_task_id ?? '(none)'}`);

    if (task.failure_reason) {
      console.log(`Failure:   ${task.failure_reason}`);
    }

    console.log('');

    switch (level) {
      case 'oneline':
        console.log(`Summary: ${task.oneline_summary ?? '(none)'}`);
        break;
      case 'full':
        console.log(`Summary:\n  ${task.paragraph_summary ?? '(none)'}`);
        console.log(`\nOutput:    ${task.output_path}`);
        break;
      case 'paragraph':
      default:
        console.log(`Summary:\n  ${task.paragraph_summary ?? '(none)'}`);
        break;
    }
  } finally {
    closeDb();
  }
}
